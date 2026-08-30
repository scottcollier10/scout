#!/usr/bin/env node
/**
 * Scans a Git repository for exact private values supplied at run time.
 *
 * This file is safe to publish because it contains no private value. The list
 * lives outside every repository that could become public and is passed in as a
 * path. That separation is the design: a denylist of real values cannot live in
 * the thing it protects. See docs/decision-log.md entry 20.
 *
 * It reads Git objects, never the filesystem. That distinction matters more
 * than it looks:
 *
 *   - A working-tree read follows symlinks. A tracked symlink pointing outside
 *     the repository would make the scanner read a file it was never asked to
 *     look at, and a symlink's own stored target text, which Git does commit,
 *     would never be scanned at all.
 *   - The index and the working tree can differ. The index is what becomes the
 *     commit, so the index is what has to be clean.
 *   - A file can be unreadable on disk while its blob is perfectly readable.
 *     Skipping it would be a silent coverage gap.
 *
 * Path names are scanned as well as contents, because a filename is committed
 * too and is just as public. All Git output is NUL-delimited, so a path
 * containing a space, tab, or newline cannot truncate a record or slip past.
 *
 * Output discipline. This prints no marker, no fragment, no matching path, no
 * commit hash, no ref or tag name, no author or committer identity, and no
 * matching line. A finding is a count against a scope, plus the marker
 * positions involved (M1, M2). The marker file is identified by its SHA-256 so
 * a run can be tied to a list without naming its contents.
 *
 * Usage:
 *   node scripts/scan-private-markers.mjs --markers <path> [scopes] [--repo <dir>]
 *
 * Scopes, all enabled when none is named:
 *   --index-paths     tracked path names in the index
 *   --index-blobs     tracked blob contents in the index, symlink targets included
 *   --history-paths   every path name in every reachable commit tree
 *   --history-blobs   every blob reachable from any ref
 *   --commits         raw commit objects: author, committer, and message
 *   --tags            annotated tag objects: tagger and annotation
 *   --refs            tag ref names, lightweight and annotated
 *
 * Exit codes: 0 clean, 1 at least one match, 2 usage or input error.
 */
import { execFile } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const run = promisify(execFile);

export const SCOPES = [
  'index-paths',
  'index-blobs',
  'history-paths',
  'history-blobs',
  'commits',
  'tags',
  'refs'
];

/** Reads the marker list. Blank lines and `#` comments are ignored. */
export async function loadMarkers(markerPath) {
  const raw = await readFile(markerPath, 'utf8');
  const markers = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  if (markers.length === 0) throw new Error('marker file contains no markers');
  const tooShort = markers.map((m, i) => (m.length < 4 ? i + 1 : 0)).filter(Boolean);
  if (tooShort.length > 0) {
    throw new Error(`markers shorter than 4 characters: ${tooShort.map((i) => `M${i}`).join(', ')}`);
  }
  return {
    markers,
    // Compared as raw bytes, so a marker inside a binary blob is found and no
    // decoding can mangle it on the way.
    needles: markers.map((m) => Buffer.from(m, 'utf8')),
    sha256: createHash('sha256').update(raw).digest('hex'),
    count: markers.length
  };
}

/** 1-based positions of every marker present in a Buffer or string. */
export function positionsIn(subject, needles) {
  const buf = Buffer.isBuffer(subject) ? subject : Buffer.from(String(subject), 'utf8');
  const hits = [];
  for (let i = 0; i < needles.length; i += 1) {
    if (buf.includes(needles[i])) hits.push(i + 1);
  }
  return hits;
}

/** Splits NUL-delimited output without dropping a trailing empty record. */
const splitNul = (s) => s.split('\0').filter((r) => r.length > 0);

export async function scanRepository({ repo, needles, scopes }) {
  const git = async (args, options = {}) => {
    const { stdout } = await run('git', args, {
      cwd: repo,
      maxBuffer: 512 * 1024 * 1024,
      ...options
    });
    return stdout;
  };
  const gitBuf = async (args) =>
    (await run('git', args, { cwd: repo, encoding: 'buffer', maxBuffer: 512 * 1024 * 1024 })).stdout;

  // Per scope: how many records matched, and which markers were involved.
  const tally = Object.fromEntries(SCOPES.map((s) => [s, { findings: 0, markers: new Set() }]));
  const counts = {
    indexEntries: 0,
    commits: 0,
    historyPairs: 0,
    commitObjects: 0,
    tagObjects: 0,
    refs: 0,
    unreadable: 0
  };

  const record = (scope, hits) => {
    if (hits.length === 0) return;
    tally[scope].findings += 1;
    for (const h of hits) tally[scope].markers.add(h);
  };

  /* -------------------------------------------------------------- */
  /* The index: what would actually be committed                     */
  /* -------------------------------------------------------------- */

  // `-s` gives mode, object id, stage and path. `-z` makes the path field the
  // last thing before a NUL, so any byte may appear in it safely.
  let indexEntries = [];
  if (scopes['index-paths'] || scopes['index-blobs']) {
    indexEntries = splitNul(await git(['ls-files', '-s', '-z'])).map((rec) => {
      const tab = rec.indexOf('\t');
      const [mode, sha] = rec.slice(0, tab).split(/\s+/);
      return { mode, sha, path: rec.slice(tab + 1) };
    });
    counts.indexEntries = indexEntries.length;
  }

  if (scopes['index-paths']) {
    for (const entry of indexEntries) record('index-paths', positionsIn(entry.path, needles));
  }

  if (scopes['index-blobs']) {
    for (const entry of indexEntries) {
      // Read the object, not the path. Mode 120000 is a symlink, whose blob is
      // its target text: that text is scanned, and the target is never opened.
      let buf;
      try {
        buf = await gitBuf(['cat-file', 'blob', entry.sha]);
      } catch {
        // Never silent. An object that cannot be read is a scan that did not
        // happen, and it is counted so the summary cannot look clean.
        counts.unreadable += 1;
        continue;
      }
      record('index-blobs', positionsIn(buf, needles));
    }
  }

  /* -------------------------------------------------------------- */
  /* History                                                         */
  /* -------------------------------------------------------------- */

  if (scopes['history-paths'] || scopes['history-blobs']) {
    const commits = splitNul(await git(['rev-list', '--all', '-z']));
    counts.commits = commits.length;
    const pairs = new Map();
    for (const commit of commits) {
      const listing = await git(['ls-tree', '-r', '-z', commit]).catch(() => '');
      for (const rec of splitNul(listing)) {
        const tab = rec.indexOf('\t');
        if (tab === -1) continue;
        const meta = rec.slice(0, tab).split(/\s+/);
        if (meta[1] !== 'blob') continue;
        pairs.set(`${meta[2]}\t${rec.slice(tab + 1)}`, { sha: meta[2], path: rec.slice(tab + 1) });
      }
    }
    counts.historyPairs = pairs.size;

    if (scopes['history-paths']) {
      // Distinct path names only: the same name in fifty commits is one name.
      for (const name of new Set([...pairs.values()].map((p) => p.path))) {
        record('history-paths', positionsIn(name, needles));
      }
    }

    if (scopes['history-blobs']) {
      const cache = new Map();
      for (const { sha } of pairs.values()) {
        if (!cache.has(sha)) {
          let buf = null;
          try {
            buf = await gitBuf(['cat-file', 'blob', sha]);
          } catch {
            counts.unreadable += 1;
          }
          cache.set(sha, buf);
        }
        const buf = cache.get(sha);
        if (buf) record('history-blobs', positionsIn(buf, needles));
      }
    }
  }

  /* -------------------------------------------------------------- */
  /* Commit objects: identity as well as message                     */
  /* -------------------------------------------------------------- */

  if (scopes.commits) {
    const commits = splitNul(await git(['rev-list', '--all', '-z']));
    counts.commitObjects = commits.length;
    for (const sha of commits) {
      // The raw object carries the author and committer lines verbatim, so a
      // marker in a name or an email address is inside what is scanned.
      const raw = await gitBuf(['cat-file', 'commit', sha]).catch(() => null);
      if (!raw) {
        counts.unreadable += 1;
        continue;
      }
      record('commits', positionsIn(raw, needles));
    }
  }

  /* -------------------------------------------------------------- */
  /* Tags: objects and names                                         */
  /* -------------------------------------------------------------- */

  if (scopes.tags || scopes.refs) {
    const refs = splitNul(
      await git(['for-each-ref', '--format=%(refname:short)%00%(objecttype)%00', 'refs/tags'])
    );
    // Records arrive as name, type, name, type ...
    const parsed = [];
    for (let i = 0; i + 1 < refs.length; i += 2) parsed.push({ name: refs[i], type: refs[i + 1] });
    counts.refs = parsed.length;

    if (scopes.refs) {
      // A tag name is public. Lightweight and annotated alike.
      for (const { name } of parsed) record('refs', positionsIn(name, needles));
    }

    if (scopes.tags) {
      for (const { name, type } of parsed) {
        if (type !== 'tag') continue; // lightweight tags have no object of their own
        counts.tagObjects += 1;
        const raw = await gitBuf(['cat-file', 'tag', name]).catch(() => null);
        if (!raw) {
          counts.unreadable += 1;
          continue;
        }
        // Includes the tagger line, so tagger name and email are covered.
        record('tags', positionsIn(raw, needles));
      }
    }
  }

  const findings = SCOPES.reduce((n, s) => n + tally[s].findings, 0);
  const allMarkers = new Set(SCOPES.flatMap((s) => [...tally[s].markers]));
  return { tally, counts, findings, distinctMarkers: allMarkers.size };
}

function parseArgs(argv) {
  const args = { markers: null, repo: process.cwd(), scopes: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--markers') args.markers = argv[++i];
    else if (a === '--repo') args.repo = argv[++i];
    else if (a.startsWith('--') && SCOPES.includes(a.slice(2))) args.scopes[a.slice(2)] = true;
    else return { error: `unknown argument: ${a}` };
  }
  if (!args.markers) return { error: 'missing required --markers <path>' };
  if (Object.keys(args.scopes).length === 0) {
    args.scopes = Object.fromEntries(SCOPES.map((s) => [s, true]));
  }
  return args;
}

export async function main(argv) {
  const args = parseArgs(argv);
  if (args.error) {
    process.stderr.write(
      `${args.error}\n\nUsage: node scripts/scan-private-markers.mjs --markers <path> ` +
        `[${SCOPES.map((s) => `--${s}`).join('] [')}] [--repo <dir>]\n` +
        'The marker file must live outside any repository that could become public.\n'
    );
    return 2;
  }

  let loaded;
  try {
    loaded = await loadMarkers(args.markers);
  } catch (error) {
    process.stderr.write(`Cannot read markers: ${error.message}\n`);
    return 2;
  }

  const { tally, counts, findings, distinctMarkers } = await scanRepository({
    repo: args.repo,
    needles: loaded.needles,
    scopes: args.scopes
  });

  const active = SCOPES.filter((s) => args.scopes[s]);
  console.log(
    `private-markers: ${loaded.count} marker(s), sha256 ${loaded.sha256}\n` +
      `  scopes:   ${active.join(', ')}\n` +
      `  scanned:  ${counts.indexEntries} index entr(ies), ${counts.commits} commit(s), ` +
      `${counts.historyPairs} distinct (blob, path) pair(s), ${counts.commitObjects} commit object(s), ` +
      `${counts.tagObjects} annotated tag(s), ${counts.refs} tag ref(s)\n` +
      `  findings: ${findings}`
  );

  // Counts and marker positions per scope. No path, hash, ref, identity, or
  // line ever reaches this output.
  for (const scope of active) {
    const t = tally[scope];
    if (t.findings === 0) continue;
    const positions = [...t.markers].sort((a, b) => a - b).map((n) => `M${n}`).join(', ');
    console.log(`  FINDING scope ${scope}: ${t.findings} record(s), markers ${positions}`);
  }

  if (counts.unreadable > 0) {
    console.log(`  WARNING ${counts.unreadable} object(s) could not be read and were not scanned`);
  }

  if (findings > 0) {
    console.log(
      `\n${distinctMarkers} of ${loaded.count} marker(s) present. This repository must not be published.`
    );
  }

  // An unreadable object means the scan was incomplete, which is not a pass.
  return findings === 0 && counts.unreadable === 0 ? 0 : 1;
}

const invoked = process.argv[1]
  ? await realpath(process.argv[1]).catch(() => process.argv[1])
  : '';
const self = await realpath(fileURLToPath(import.meta.url)).catch(() =>
  fileURLToPath(import.meta.url)
);
if (invoked !== '' && pathToFileURL(invoked).href === pathToFileURL(self).href) {
  process.exitCode = await main(process.argv.slice(2));
}
