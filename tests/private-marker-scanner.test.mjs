/**
 * Tests for the private release scanner.
 *
 * Every marker is generated at run time from randomness, so this file ships no
 * value that looks like a real one. That is the same rule the scanner enforces:
 * a tracked file must never carry an operational value, not even as a fixture.
 *
 * The mutation probes matter more than the clean runs. A scanner that has never
 * found anything is not evidence it works; it is equally consistent with one
 * that reads nothing. So every scope is proved to fail on purpose, including
 * the ones a filesystem-based scanner would miss entirely: a marker in a
 * filename, in author or committer identity, in a tag name, and in the target
 * text of a symlink.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, rm, chmod, stat, symlink } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMarkers, positionsIn, scanRepository, SCOPES } from '../scripts/scan-private-markers.mjs';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCANNER = path.join(ROOT, 'scripts', 'scan-private-markers.mjs');

/** A marker that cannot collide with anything real, invented per run. */
const synthetic = (label) => `SYNTHETIC-${label}-${randomBytes(9).toString('hex')}`;
const needlesFor = (values) => values.map((v) => Buffer.from(v, 'utf8'));
const ALL = Object.fromEntries(SCOPES.map((s) => [s, true]));
const only = (...names) => Object.fromEntries(names.map((n) => [n, true]));

let work;
before(async () => {
  work = await mkdtemp(path.join(tmpdir(), 'scout-marker-test-'));
});
after(async () => {
  if (work) await rm(work, { recursive: true, force: true });
});

async function cli(args) {
  try {
    const { stdout, stderr } = await run(process.execPath, [SCANNER, ...args], { cwd: ROOT });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

const g = (repo) => (args) => run('git', args, { cwd: repo });

async function makeRepo(name, files = { 'a.txt': 'nothing interesting\n' }) {
  const repo = path.join(work, name);
  await mkdir(repo, { recursive: true });
  const git = g(repo);
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'probe@example.invalid']);
  await git(['config', 'user.name', 'Probe']);
  for (const [f, content] of Object.entries(files)) {
    const full = path.join(repo, f);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content, 'utf8');
  }
  await git(['add', '-A']);
  await git(['commit', '-q', '-m', 'initial']);
  return repo;
}

async function markerFile(name, values) {
  const p = path.join(work, name);
  await writeFile(p, values.join('\n') + '\n', { mode: 0o600 });
  await chmod(p, 0o600);
  return p;
}

/** Scans and returns which scopes fired. */
async function scopesHit(repo, values, scopes = ALL) {
  const { tally } = await scanRepository({ repo, needles: needlesFor(values), scopes });
  return SCOPES.filter((s) => tally[s].findings > 0);
}

describe('reading the marker list', () => {
  test('loads markers and reports a stable digest', async () => {
    const values = [synthetic('A'), synthetic('B')];
    const file = await markerFile('load.txt', values);
    const loaded = await loadMarkers(file);
    assert.equal(loaded.count, 2);
    assert.equal(loaded.sha256, createHash('sha256').update(values.join('\n') + '\n').digest('hex'));
  });

  test('ignores blank lines and comments', async () => {
    const file = await markerFile('comments.txt', ['# a note', '', synthetic('C'), '   ']);
    assert.equal((await loadMarkers(file)).count, 1);
  });

  test('refuses a marker short enough to match everything', async () => {
    const file = await markerFile('short.txt', [synthetic('D'), 'ab']);
    await assert.rejects(() => loadMarkers(file), /shorter than 4 characters: M2/);
  });

  test('refuses an empty list rather than reporting a clean scan', async () => {
    const file = await markerFile('empty.txt', ['# only a comment']);
    await assert.rejects(() => loadMarkers(file), /no markers/);
  });

  test('the marker file is created unreadable to others', async () => {
    const file = await markerFile('perm.txt', [synthetic('E')]);
    assert.equal((await stat(file)).mode & 0o077, 0);
  });

  test('markers are matched as bytes, so binary content is covered', () => {
    const value = synthetic('BIN');
    const buf = Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(value), Buffer.from([0])]);
    assert.deepEqual(positionsIn(buf, needlesFor([value])), [1]);
  });
});

describe('mutation probes: every scope is proved able to fail', () => {
  test('a clean repository scans clean across all scopes', async () => {
    const repo = await makeRepo('clean');
    assert.deepEqual(await scopesHit(repo, [synthetic('I')]), []);
  });

  test('index blobs: a marker in tracked content', async () => {
    const v = synthetic('BLOB');
    const repo = await makeRepo('p-blob', { 'a.txt': `token = ${v}\n` });
    assert.deepEqual(await scopesHit(repo, [v], only('index-blobs')), ['index-blobs']);
  });

  test('index paths: a marker in a tracked filename', async () => {
    // A filename is committed and published just like content.
    const v = synthetic('NAME');
    const repo = await makeRepo('p-name', { [`${v}.txt`]: 'ordinary content\n' });
    assert.deepEqual(await scopesHit(repo, [v], only('index-paths')), ['index-paths']);
    assert.deepEqual(await scopesHit(repo, [v], only('index-blobs')), []);
  });

  test('history paths: a filename found after the file is deleted', async () => {
    const v = synthetic('DELNAME');
    const repo = await makeRepo('p-delname', { [`${v}.txt`]: 'ordinary\n' });
    await g(repo)(['rm', '-q', `${v}.txt`]);
    await g(repo)(['commit', '-qm', 'remove it']);
    assert.deepEqual(await scopesHit(repo, [v], only('index-paths')), [], 'gone from the index');
    assert.deepEqual(await scopesHit(repo, [v], only('history-paths')), ['history-paths']);
  });

  test('history blobs: content found after deletion', async () => {
    const v = synthetic('HIST');
    const repo = await makeRepo('p-hist', { 'a.txt': `token = ${v}\n` });
    await writeFile(path.join(repo, 'a.txt'), 'cleaned\n', 'utf8');
    await g(repo)(['commit', '-qam', 'remove it']);
    assert.deepEqual(await scopesHit(repo, [v], only('index-blobs')), [], 'gone from the index');
    assert.deepEqual(await scopesHit(repo, [v], only('history-blobs')), ['history-blobs']);
  });

  test('commits: a marker in the message', async () => {
    const v = synthetic('MSG');
    const repo = await makeRepo('p-msg');
    await writeFile(path.join(repo, 'b.txt'), 'ordinary\n', 'utf8');
    await g(repo)(['add', '-A']);
    await g(repo)(['commit', '-q', '-m', `mentions ${v}`]);
    assert.deepEqual(await scopesHit(repo, [v], only('commits')), ['commits']);
  });

  test('commits: a marker in the author name or email', async () => {
    const v = synthetic('AUTHOR');
    const repo = await makeRepo('p-author');
    await writeFile(path.join(repo, 'c.txt'), 'ordinary\n', 'utf8');
    await g(repo)(['add', '-A']);
    await g(repo)([
      '-c', `user.name=${v}`, '-c', 'user.email=x@example.invalid',
      'commit', '-q', '-m', 'ordinary subject'
    ]);
    assert.deepEqual(await scopesHit(repo, [v], only('commits')), ['commits']);
  });

  test('commits: a marker in the committer email, with a different author', async () => {
    const v = synthetic('COMMITTER');
    const repo = await makeRepo('p-committer');
    await writeFile(path.join(repo, 'd.txt'), 'ordinary\n', 'utf8');
    await g(repo)(['add', '-A']);
    await run('git', ['commit', '-q', '-m', 'ordinary subject'], {
      cwd: repo,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Someone', GIT_AUTHOR_EMAIL: 'a@example.invalid',
        GIT_COMMITTER_NAME: 'Someone Else', GIT_COMMITTER_EMAIL: `${v}@example.invalid`
      }
    });
    assert.deepEqual(await scopesHit(repo, [v], only('commits')), ['commits']);
  });

  test('refs: a marker in a lightweight tag name', async () => {
    const v = synthetic('LIGHT');
    const repo = await makeRepo('p-light');
    await g(repo)(['tag', `rel-${v}`]);
    assert.deepEqual(await scopesHit(repo, [v], only('refs')), ['refs']);
    assert.deepEqual(await scopesHit(repo, [v], only('tags')), [], 'a lightweight tag has no object');
  });

  test('refs and tags: a marker in an annotated tag name and its tagger', async () => {
    const inName = synthetic('ANNNAME');
    const inTagger = synthetic('TAGGER');
    const repo = await makeRepo('p-annotated');
    await run('git', ['tag', '-a', `rel-${inName}`, '-m', 'ordinary annotation'], {
      cwd: repo,
      env: {
        ...process.env,
        GIT_COMMITTER_NAME: inTagger, GIT_COMMITTER_EMAIL: 't@example.invalid',
        GIT_AUTHOR_NAME: inTagger, GIT_AUTHOR_EMAIL: 't@example.invalid'
      }
    });
    assert.deepEqual(await scopesHit(repo, [inName], only('refs')), ['refs']);
    assert.deepEqual(await scopesHit(repo, [inTagger], only('tags')), ['tags'], 'tagger metadata is inside the object');
  });

  test('tags: a marker in an annotation body', async () => {
    const v = synthetic('ANNOT');
    const repo = await makeRepo('p-annotbody');
    await g(repo)(['tag', '-a', 'v1.0.0', '-m', `notes mentioning ${v}`]);
    assert.deepEqual(await scopesHit(repo, [v], only('tags')), ['tags']);
  });

  test('multiple annotated tags are each readable', async () => {
    const repo = await makeRepo('p-two-tags');
    await g(repo)(['tag', '-a', 'v1.0.0', '-m', 'first']);
    await g(repo)(['tag', '-a', 'v1.0.1', '-m', 'second']);
    const result = await scanRepository({
      repo,
      needles: needlesFor([synthetic('TWO-TAGS')]),
      scopes: only('tags', 'refs')
    });
    assert.equal(result.counts.refs, 2);
    assert.equal(result.counts.tagObjects, 2);
    assert.equal(result.counts.unreadable, 0);
  });

  test('symlinks: the stored target text is scanned', async () => {
    // Git commits a symlink as a blob whose content is the target path.
    const v = synthetic('LINKTARGET');
    const repo = await makeRepo('p-link');
    await symlink(`./${v}.txt`, path.join(repo, 'pointer'));
    await g(repo)(['add', '-A']);
    await g(repo)(['commit', '-qm', 'add a link']);
    assert.deepEqual(await scopesHit(repo, [v], only('index-blobs')), ['index-blobs']);
  });

  test('symlinks: a target outside the repository is never read', async () => {
    const outside = path.join(work, 'outside-tree');
    await mkdir(outside, { recursive: true });
    const secret = synthetic('NEVERREAD');
    await writeFile(path.join(outside, 'secret.txt'), `contains ${secret}\n`, 'utf8');

    const repo = await makeRepo('p-escape');
    await symlink(path.join(outside, 'secret.txt'), path.join(repo, 'escape'));
    await g(repo)(['add', '-A']);
    await g(repo)(['commit', '-qm', 'add an escaping link']);

    // The value lives only in the file the link points at. A scanner that
    // followed the link would find it; one that reads the blob cannot.
    assert.deepEqual(
      await scopesHit(repo, [secret], ALL),
      [],
      'the scanner must not read through a symlink to outside the repository'
    );
  });

  test('awkward filenames cannot create a coverage gap', async () => {
    // Spaces, tabs and newlines in a path break line-oriented parsing. The
    // scanner reads NUL-delimited records for exactly this case.
    const withSpace = synthetic('SPACE');
    const withTab = synthetic('TAB');
    const withNewline = synthetic('NEWLINE');
    const repo = await makeRepo('p-awkward', {
      [`a file with ${withSpace}.txt`]: 'ordinary\n',
      [`tab\there ${withTab}.txt`]: 'ordinary\n',
      [`new\nline ${withNewline}.txt`]: 'ordinary\n'
    });
    const hits = await scopesHit(repo, [withSpace, withTab, withNewline], only('index-paths'));
    assert.deepEqual(hits, ['index-paths']);
    const { tally } = await scanRepository({
      repo,
      needles: needlesFor([withSpace, withTab, withNewline]),
      scopes: only('index-paths')
    });
    assert.equal(tally['index-paths'].markers.size, 3, 'all three awkward names must be seen');
  });

  test('a blob committed at two paths is counted at both', async () => {
    const v = synthetic('TWOPATH');
    const repo = await makeRepo('p-twopath', { 'a.txt': `v = ${v}\n`, 'b.txt': `v = ${v}\n` });
    const { tally } = await scanRepository({
      repo, needles: needlesFor([v]), scopes: only('history-blobs')
    });
    assert.equal(tally['history-blobs'].findings, 2);
  });
});

describe('the CLI discloses nothing about what it found', () => {
  /** Asserts the output leaks neither the value nor any fragment of it. */
  const assertOpaque = (out, ...values) => {
    for (const v of values) {
      assert.ok(!out.includes(v), 'the output must not contain the marker');
      for (let i = 0; i + 10 <= v.length; i += 3) {
        assert.ok(!out.includes(v.slice(i, i + 10)), 'the output must not contain a fragment');
      }
    }
  };

  test('nothing identifying appears for any scope', async () => {
    const inBlob = synthetic('OUTBLOB');
    const inName = synthetic('OUTNAME');
    const inMsg = synthetic('OUTMSG');
    const inAuthor = synthetic('OUTAUTH');
    const inTag = synthetic('OUTTAG');

    const repo = await makeRepo('p-output', { [`${inName}.txt`]: `body ${inBlob}\n` });
    await writeFile(path.join(repo, 'more.txt'), 'ordinary\n', 'utf8');
    await g(repo)(['add', '-A']);
    await g(repo)([
      '-c', `user.name=${inAuthor}`, '-c', 'user.email=x@example.invalid',
      'commit', '-q', '-m', `subject ${inMsg}`
    ]);
    await g(repo)(['tag', '-a', `rel-${inTag}`, '-m', 'ordinary annotation']);

    const file = await markerFile('output.txt', [inBlob, inName, inMsg, inAuthor, inTag]);
    const r = await cli(['--markers', file, '--repo', repo]);
    assert.equal(r.code, 1, 'a match must exit non-zero');
    const out = r.stdout + r.stderr;

    assertOpaque(out, inBlob, inName, inMsg, inAuthor, inTag);
    assert.ok(!out.includes('.txt'), 'no filename may appear');
    assert.ok(!out.includes('rel-'), 'no tag or ref name may appear');
    assert.ok(!/\b[0-9a-f]{40}\b/.test(out), 'no commit or blob hash may appear');
    assert.ok(!out.includes('@'), 'no email or identity may appear');
    assert.ok(!out.includes('example.invalid'), 'no hostname may appear');
    assert.ok(!out.includes('subject'), 'no matching line may appear');

    // What it may say: scope names, counts, and marker positions.
    for (const scope of ['index-paths', 'index-blobs', 'history-paths', 'history-blobs', 'commits', 'tags', 'refs']) {
      assert.ok(out.includes(scope), `the scope ${scope} must be named`);
    }
    assert.match(out, /markers M\d/);
    assert.match(out, /sha256 [0-9a-f]{64}/);
    assert.match(out, /5 of 5 marker\(s\) present/);
  });

  test('a clean run exits zero and reports what it scanned', async () => {
    const repo = await makeRepo('p-cleanrun');
    const file = await markerFile('cleanrun.txt', [synthetic('OK')]);
    const r = await cli(['--markers', file, '--repo', repo]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /findings: 0/);
    assert.match(r.stdout, /index entr\(ies\)/);
  });

  test('a missing marker file is a usage error, not a clean pass', async () => {
    const repo = await makeRepo('p-nofile');
    const r = await cli(['--markers', path.join(work, 'nope.txt'), '--repo', repo]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /Cannot read markers/);
  });

  test('omitting the marker path is a usage error', async () => {
    const r = await cli(['--index-blobs']);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /missing required --markers/);
  });

  test('an unknown scope is rejected rather than silently ignored', async () => {
    const file = await markerFile('unknown.txt', [synthetic('U')]);
    const r = await cli(['--markers', file, '--not-a-scope']);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /unknown argument/);
  });
});
