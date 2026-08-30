#!/usr/bin/env node
/**
 * Rejects user-specific absolute home paths in tracked public files.
 *
 * A hardcoded absolute home path once shipped in this repository as a constant.
 * It was not a secret, but it was machine-specific: it pinned a safety gate to
 * one checkout, and it put a username and directory layout into a public tree.
 * The existing gates looked for credentials and found nothing, because there
 * was nothing of that kind to find.
 *
 * Two checks live here:
 *
 *   --tree     every tracked file in the current working tree
 *   --history  every blob reachable from any ref
 *
 * The patterns below are assembled from fragments at runtime, so this file does
 * not itself contain the shape of path it exists to reject. Otherwise the gate
 * would report itself and have to be exempted, which is how allowlists start.
 */
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const git = async (args, options = {}) => {
  const { stdout } = await run('git', args, { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024, ...options });
  return stdout;
};

/* ------------------------------------------------------------------ */
/* Patterns, built from fragments so this file is not its own finding   */
/* ------------------------------------------------------------------ */

const SEP = '/';
const NAME = '[^/\\\\\\s"\'`)\\]]+';

/** A home-directory prefix followed by a user name and another separator. */
const posixHome = (dir) => new RegExp(`${SEP}${dir}${SEP}${NAME}${SEP}`);

// Each entry is described rather than illustrated. Writing an example of the
// shape here would make this file its own finding, which is how a gate ends up
// needing an exemption for itself.
const PATTERNS = [
  // The macOS per-user home directory, followed by a user name segment.
  { label: 'macOS home path', re: posixHome(['U', 'sers'].join('')) },
  // The Linux per-user home directory, followed by a user name segment.
  { label: 'Linux home path', re: posixHome(['h', 'ome'].join('')) },
  // The root account's home directory used as a path prefix.
  { label: 'root home path', re: new RegExp(`${SEP}${['r', 'oot'].join('')}${SEP}`) },
  // The Windows per-user home directory under a drive letter, in either
  // backslash or forward-slash form. Case-insensitive, because Windows paths
  // are, and a lowercase spelling is just as much of a leak.
  {
    label: 'Windows home path',
    re: new RegExp(`[A-Za-z]:[\\\\/]${['U', 'sers'].join('')}[\\\\/]${NAME}[\\\\/]`, 'i')
  }
];

/**
 * Portable references that must keep working. These are not user-specific and
 * appear legitimately in documentation and scripts.
 */
const ALLOWED_EXAMPLES = ['~/', '/tmp', '/private/tmp'];

/**
 * Returns the labels of any patterns that matched. The matched text is
 * deliberately not returned: a gate that prints the offending path writes it
 * into build logs, which is the opposite of the point.
 */
function findingsIn(text) {
  return PATTERNS.filter(({ re }) => re.test(text)).map(({ label }) => label);
}

const isProbablyText = (buf) => !buf.includes(0);

/* ------------------------------------------------------------------ */
/* Current tree                                                         */
/* ------------------------------------------------------------------ */

async function checkTree() {
  // Every tracked file, not a maintained list. A gate that needs updating when
  // a file is added is a gate that will be out of date.
  const files = (await git(['ls-files', '-z'])).split('\0').filter(Boolean);
  const problems = [];

  for (const file of files) {
    // Both the working copy and the staged copy. They can differ, and it is the
    // staged copy that becomes the commit: editing a path out of the working
    // file after staging it leaves the finding in the index, where a
    // working-tree-only scan would miss it entirely.
    const working = await readFile(path.join(REPO_ROOT, file)).catch(() => null);
    const staged = await git(['show', `:${file}`], { encoding: 'buffer' }).catch(() => null);

    for (const [source, content] of [['working tree', working], ['index', staged]]) {
      if (!content || !isProbablyText(content)) continue;
      for (const label of findingsIn(content.toString('utf8'))) {
        problems.push(`${file} (${source}): ${label}`);
      }
    }
  }

  console.log(`local-paths tree: ${files.length} tracked file(s), working tree and index, ${problems.length} finding(s)`);
  for (const p of problems) console.log(`  FINDING ${p}`);
  return problems.length === 0;
}

/* ------------------------------------------------------------------ */
/* History                                                              */
/* ------------------------------------------------------------------ */

/**
 * There is no accepted historical exception, and there is no mechanism for one.
 *
 * The private development archive needed one: a blob predating the gate sat in
 * its history, and rewriting that history would have invalidated a reviewed
 * commit and every hash in its evidence trail. This repository has no such
 * history. It begins at one commit whose tree was gated before it existed, so
 * an exception would be a door with nothing behind it, and a door is worth
 * removing while nobody needs it.
 *
 * The public history gate therefore requires three things at once: a
 * non-shallow repository, zero findings, and zero accepted exceptions. The
 * third is not vestigial. It fails if anyone reintroduces an allowlist, which
 * is how a clean history quietly stops being one.
 */

async function checkHistory({ strict = false } = {}) {
  // Every reachable commit tree, not `rev-list --objects`.
  //
  // `rev-list --objects` prints one path per object: whichever it happened to
  // walk first. The same blob committed at a second path is invisible there, so
  // a blob accepted at one path would silently excuse a copy of it anywhere
  // else. Walking each commit's tree and deduplicating exact (blob, path) pairs
  // is what makes the pin a pin rather than a content-based exemption.
  const commits = (await git(['rev-list', '--all'])).split('\n').filter(Boolean);
  // `--is-shallow-repository` is the direct question, and it does not depend on
  // a .git layout this script would otherwise have to guess at.
  const shallow = (await git(['rev-parse', '--is-shallow-repository'])).trim() === 'true';

  const pairs = new Map(); // "sha\tpath" -> { sha, path }
  for (const commit of commits) {
    const listing = await git(['ls-tree', '-r', commit]).catch(() => '');
    for (const line of listing.split('\n')) {
      if (!line) continue;
      // "<mode> <type> <sha>\t<path>"
      const tab = line.indexOf('\t');
      if (tab === -1) continue;
      const meta = line.slice(0, tab).split(/\s+/);
      if (meta[1] !== 'blob') continue;
      const sha = meta[2];
      const objPath = line.slice(tab + 1);
      pairs.set(`${sha}\t${objPath}`, { sha, path: objPath });
    }
  }

  // Read each distinct blob once, however many paths it appears at.
  const contentCache = new Map();
  const problems = [];
  const accepted = 0; // no exception mechanism exists; reported so the count is visible

  for (const { sha, path: objPath } of pairs.values()) {
    if (!contentCache.has(sha)) {
      const buf = await git(['cat-file', 'blob', sha], { encoding: 'buffer' }).catch(() => null);
      contentCache.set(sha, buf && isProbablyText(buf) ? buf.toString('utf8') : null);
    }
    const text = contentCache.get(sha);
    if (text === null) continue;

    const hits = findingsIn(text);
    if (hits.length === 0) continue;

    // Every finding is a finding. Nothing is excused.
    problems.push(`blob ${sha} at ${objPath}: ${hits.join(', ')}`);
  }

  console.log(
    `local-paths history: ${commits.length} commit(s), ${pairs.size} distinct (blob, path) pair(s), ` +
      `${accepted} accepted pair(s), ${problems.length} finding(s)`
  );
  for (const p of problems) console.log(`  FINDING ${p}`);

  let ok = problems.length === 0;

  if (strict) {
    // A shallow clone can report zero findings because it read almost nothing.
    // Requiring depth is what stops the strictest gate being the easiest one to
    // pass by accident.
    if (shallow) {
      console.log('  FAILED this is a shallow clone; the full history was not scanned');
      ok = false;
    }
    if (commits.length === 0) {
      console.log('  FAILED no commits were reachable');
      ok = false;
    }
    if (accepted !== 0) {
      console.log(
        `  FAILED expected 0 accepted historical exceptions, found ${accepted}. ` +
          'This repository has no exception mechanism and must not acquire one.'
      );
      ok = false;
    }
  }

  return ok;
}

/* ------------------------------------------------------------------ */

const KNOWN_FLAGS = new Set(['--tree', '--history', '--strict-history']);
const args = new Set(process.argv.slice(2));

// An unrecognised flag is a hard error, never an ignored one. Silently
// accepting it is how an invocation ends up selecting no scope at all, running
// nothing, and exiting zero: a gate that passes because it never looked.
const unknown = [...args].filter((a) => !KNOWN_FLAGS.has(a));
if (unknown.length > 0) {
  console.error(
    `Unknown argument(s): ${unknown.join(', ')}\n` +
      `Usage: node scripts/check-local-paths.mjs [${[...KNOWN_FLAGS].join('] [')}]`
  );
  process.exit(2);
}

// --strict-history is the official full-depth form: it additionally insists the
// repository is not shallow and that no exception mechanism has appeared.
const strict = args.has('--strict-history');
const wantTree = args.has('--tree') || (args.size === 0);
const wantHistory = args.has('--history') || strict || (args.size === 0);

// Selecting nothing must never look like passing. Today every recognised flag
// selects a scope, so this cannot trigger; it is here so that adding a flag
// later cannot quietly produce an invocation that scans nothing and exits zero.
if (!wantTree && !wantHistory) {
  console.error('No scan scope selected. Nothing was checked, which is not a pass.');
  process.exit(2);
}

let ok = true;
if (wantTree) ok = (await checkTree()) && ok;
if (wantHistory) ok = (await checkHistory({ strict })) && ok;

if (!ok) {
  console.log(
    '\nA user-specific absolute home path was found. Replace it with a path derived\n' +
      'at runtime, or a portable reference such as ' + ALLOWED_EXAMPLES.join(', ') + '.'
  );
}
process.exitCode = ok ? 0 : 1;
