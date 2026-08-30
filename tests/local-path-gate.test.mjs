/**
 * Mutation probes for the local-path gate.
 *
 * A gate that has never failed is not evidence that it works. Each test here
 * plants a synthetic user-specific path and requires the gate to reject it, and
 * a final group holds open the property this repository is built on: the
 * history gate admits no exception, and there is no mechanism for one.
 *
 * Every planted value is synthetic. None of them is the path this gate was
 * written to remove, and that path is not present in this file.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GATE = path.join(REPO_ROOT, 'scripts', 'check-local-paths.mjs');

/**
 * Synthetic offending values, assembled from fragments for the same reason the
 * gate itself is: a file that contains the literal shape would be flagged by
 * the gate it is testing.
 */
const SYNTHETIC = {
  macos: ['', 'U' + 'sers', 'probe-user', 'work', 'file.txt'].join('/'),
  linux: ['', 'h' + 'ome', 'probe-user', 'work', 'file.txt'].join('/'),
  root: ['', 'r' + 'oot', 'work', 'file.txt'].join('/'),
  windows: 'C:\\' + 'U' + 'sers' + '\\probe-user\\work\\file.txt'
};

/** Windows paths are case-insensitive, so every spelling has to be caught. */
const WINDOWS_CASES = {
  'upper-case': 'C:\\' + 'U' + 'SERS' + '\\probe-user\\file.txt',
  'lower-case': 'c:/' + 'u' + 'sers' + '/probe-user/file.txt',
  'mixed-case': 'C:/' + 'U' + 'sErS' + '/probe-user/file.txt'
};

let work;

before(async () => {
  work = await mkdtemp(path.join(tmpdir(), 'scout-pathgate-'));
});

after(async () => {
  if (work) await rm(work, { recursive: true, force: true });
});

async function gate(repoDir, args) {
  const script = path.join(repoDir, 'scripts', 'check-local-paths.mjs');
  try {
    const { stdout } = await run(process.execPath, [script, ...args], { cwd: repoDir });
    return { code: 0, stdout };
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? '' };
  }
}

/** A throwaway git repository carrying its own copy of the gate. */
async function makeRepo(name) {
  const dir = path.join(work, name);
  await mkdir(path.join(dir, 'scripts'), { recursive: true });
  await cp(GATE, path.join(dir, 'scripts', 'check-local-paths.mjs'));
  await run('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  await run('git', ['config', 'user.email', 'probe@example.invalid'], { cwd: dir });
  await run('git', ['config', 'user.name', 'Probe'], { cwd: dir });
  await run('git', ['add', '-A'], { cwd: dir });
  await run('git', ['commit', '-q', '-m', 'base'], { cwd: dir });
  return dir;
}

describe('the local-path gate rejects what it is meant to reject', () => {
  for (const [platform, value] of Object.entries(SYNTHETIC)) {
    test(`a tracked file containing a ${platform} home path fails the tree check`, async () => {
      const dir = await makeRepo(`tree-${platform}`);
      const clean = await gate(dir, ['--tree']);
      assert.equal(clean.code, 0, 'baseline must pass');

      await writeFile(path.join(dir, 'planted.txt'), `const p = "${value}";\n`, 'utf8');
      await run('git', ['add', '-A'], { cwd: dir });

      const dirty = await gate(dir, ['--tree']);
      assert.equal(dirty.code, 1, `a ${platform} path must fail`);
      assert.match(dirty.stdout, /FINDING planted\.txt/);
    });
  }

  test('the gate never echoes the offending value', async () => {
    // Printing it would put the path back into build logs.
    const dir = await makeRepo('no-echo');
    await writeFile(path.join(dir, 'planted.txt'), `x = "${SYNTHETIC.macos}"\n`, 'utf8');
    await run('git', ['add', '-A'], { cwd: dir });
    const r = await gate(dir, ['--tree']);
    assert.equal(r.code, 1);
    assert.ok(!r.stdout.includes('probe-user'), 'the user segment must not appear in output');
  });

  test('portable references are not flagged', async () => {
    const dir = await makeRepo('portable');
    await writeFile(
      path.join(dir, 'portable.txt'),
      ['~/.config/example', '/tmp/scratch', '/private/tmp/scratch'].join('\n') + '\n',
      'utf8'
    );
    await run('git', ['add', '-A'], { cwd: dir });
    const r = await gate(dir, ['--tree']);
    assert.equal(r.code, 0, 'portable references must keep working');
  });

  test('a path committed then deleted still fails the history check', async () => {
    // The case a working-tree scan cannot see, and the reason the history
    // check exists at all.
    const dir = await makeRepo('history-deleted');
    await writeFile(path.join(dir, 'planted.txt'), `x = "${SYNTHETIC.macos}"\n`, 'utf8');
    await run('git', ['add', '-A'], { cwd: dir });
    await run('git', ['commit', '-q', '-m', 'add planted'], { cwd: dir });
    await run('git', ['rm', '-q', 'planted.txt'], { cwd: dir });
    await run('git', ['commit', '-q', '-m', 'remove planted'], { cwd: dir });

    const tree = await gate(dir, ['--tree']);
    assert.equal(tree.code, 0, 'the working tree is clean again');

    const history = await gate(dir, ['--history']);
    assert.equal(history.code, 1, 'history still holds the blob');
    assert.match(history.stdout, /FINDING blob [0-9a-f]{40} at planted\.txt/);
  });

  for (const [spelling, value] of Object.entries(WINDOWS_CASES)) {
    test(`a ${spelling} Windows home path is caught`, async () => {
      const dir = await makeRepo(`win-${spelling}`);
      await writeFile(path.join(dir, 'planted.txt'), `x = "${value}"\n`, 'utf8');
      await run('git', ['add', '-A'], { cwd: dir });
      const r = await gate(dir, ['--tree']);
      assert.equal(r.code, 1, `${spelling} must fail`);
    });
  }

  test('a finding staged then edited out of the working copy still fails', async () => {
    // The index is what becomes the commit. Removing the path from the working
    // file after staging it leaves the finding in the index, where a
    // working-tree-only scan sees nothing.
    const dir = await makeRepo('index-only');
    const file = path.join(dir, 'planted.txt');
    await writeFile(file, `x = "${SYNTHETIC.macos}"\n`, 'utf8');
    await run('git', ['add', '-A'], { cwd: dir });
    await writeFile(file, 'x = "clean"\n', 'utf8');

    const r = await gate(dir, ['--tree']);
    assert.equal(r.code, 1, 'the staged copy still carries the path');
    assert.match(r.stdout, /planted\.txt \(index\)/);
  });

  test('the accepted historical object does not hide an unrelated occurrence', async () => {
    // The pin is a single blob at a single path. A different blob carrying a
    // home path must still fail, even in the same file.
    const dir = await makeRepo('history-unrelated');
    await mkdir(path.join(dir, 'scripts'), { recursive: true });
    await writeFile(path.join(dir, 'scripts', 'other.mjs'), `x = "${SYNTHETIC.linux}"\n`, 'utf8');
    await run('git', ['add', '-A'], { cwd: dir });
    await run('git', ['commit', '-q', '-m', 'unrelated occurrence'], { cwd: dir });

    const r = await gate(dir, ['--history']);
    assert.equal(r.code, 1, 'an unrelated historical occurrence must fail');
    assert.match(r.stdout, /scripts\/other\.mjs/);
  });
});

describe('the public history gate admits no exception', () => {
  // The private development archive carried one accepted historical object,
  // pinned by blob and path, because rewriting its history would have
  // invalidated a reviewed commit. This repository begins at one commit whose
  // tree was gated before it existed, so there is nothing to except and no
  // mechanism to except it with. These tests hold that open.

  test('a clean one-commit history passes the strict gate', async () => {
    // makeRepo commits once, which is exactly the shape this repository has.
    const dir = await makeRepo('clean-single-commit');
    const r = await gate(dir, ['--strict-history']);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /1 commit\(s\)/);
    assert.match(r.stdout, /0 accepted pair\(s\)/);
    assert.match(r.stdout, /0 finding\(s\)/);
  });

  test('a shallow clone fails rather than reporting a clean history', async () => {
    // A shallow clone can read almost nothing and still find nothing. Depth is
    // what stops the strictest gate being the easiest to pass by accident.
    const source = await makeRepo('shallow-source');
    for (const n of [1, 2, 3]) {
      await writeFile(path.join(source, `f${n}.mjs`), `export const n = ${n};\n`, 'utf8');
      await run('git', ['add', '-A'], { cwd: source });
      await run('git', ['commit', '-q', '-m', `commit ${n}`], { cwd: source });
    }
    const shallow = path.join(path.dirname(source), 'shallow-clone');
    await run('git', ['clone', '-q', '--depth', '1', `file://${source}`, shallow]);

    const isShallow = (await run('git', ['rev-parse', '--is-shallow-repository'], { cwd: shallow }))
      .stdout.trim();
    assert.equal(isShallow, 'true', 'the fixture must actually be shallow');

    const r = await gate(shallow, ['--strict-history']);
    assert.equal(r.code, 1, 'a shallow clone must fail the strict gate');
    assert.match(r.stdout, /shallow clone/i);
  });

  test('an absolute path committed and later deleted still fails', async () => {
    // The case only a history walk sees. Deleting the file is exactly what
    // someone does on noticing, and it does not remove the blob.
    const dir = await makeRepo('deleted-but-in-history');
    await writeFile(path.join(dir, 'leaky.mjs'), `const ROOT = '${SYNTHETIC.macos}';\n`, 'utf8');
    await run('git', ['add', '-A'], { cwd: dir });
    await run('git', ['commit', '-q', '-m', 'add it'], { cwd: dir });
    await run('git', ['rm', '-q', 'leaky.mjs'], { cwd: dir });
    await run('git', ['commit', '-q', '-m', 'remove it'], { cwd: dir });

    const tree = await gate(dir, ['--tree']);
    assert.equal(tree.code, 0, 'the tree is clean once the file is gone');

    const history = await gate(dir, ['--strict-history']);
    assert.equal(history.code, 1, 'history still holds the blob');
    assert.match(history.stdout, /1 finding\(s\)/);
    assert.ok(
      !history.stdout.includes(SYNTHETIC.macos),
      'the gate must not echo the offending value'
    );
  });

  test('no accepted historical pair remains anywhere in the gate', async () => {
    const source = await readFile(new URL('../scripts/check-local-paths.mjs', import.meta.url), 'utf8');
    for (const pattern of [
      /ACCEPTED_HISTORICAL/,
      /accepted\s*\+=/,
      /--require-accepted/,
      /new Map\(\s*\[\s*\[\s*['"`][0-9a-f]{40}['"`]/
    ]) {
      assert.ok(!pattern.test(source), `the gate still carries an exception mechanism: ${pattern}`);
    }
    // And no allowlist of any other shape.
    for (const pattern of [/\bALLOWLIST\b/, /\bALLOW_LIST\b/, /\ballowlist\s*=/, /\bEXCEPTIONS\b/]) {
      assert.ok(!pattern.test(source), `the gate declares an allowlist: ${pattern}`);
    }
  });

  test('the strict gate refuses a repository with no commits', async () => {
    // Not via makeRepo, which commits. A repository with no commit reaches no
    // blobs, so reporting it clean would be reporting on nothing.
    const dir = path.join(work, 'no-commits');
    await mkdir(path.join(dir, 'scripts'), { recursive: true });
    await cp(GATE, path.join(dir, 'scripts', 'check-local-paths.mjs'));
    await run('git', ['init', '-q', '-b', 'main'], { cwd: dir });

    const r = await gate(dir, ['--strict-history']);
    assert.equal(r.code, 1, 'an empty repository is not a clean history');
    assert.match(r.stdout, /no commits were reachable/i);
  });

  test('this repository has a clean current tree', async () => {
    const r = await gate(REPO_ROOT, ['--tree']);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /0 finding\(s\)/);
  });
});
