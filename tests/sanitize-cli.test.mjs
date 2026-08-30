/**
 * Process-level tests for the sanitizer CLI.
 *
 * These run the script as a subprocess on purpose. The defect they exist to
 * prevent was invisible to a unit test of `sanitizeWorkflow()`: the pre-write
 * safety gate compared the output path against an absolute path hardcoded for
 * one machine, so in any other checkout the gate silently did nothing and
 * unscanned output could be written straight into a working tree. Importing the
 * function would have kept passing the whole time.
 *
 * Every fixture here is synthetic. Nothing reads a private export.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, rm, cp, symlink, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'sanitize-export.mjs');

/**
 * An export that is deliberately unsafe: it carries a bound credential and a
 * live-instance root id, so the safety gate must refuse to write it into a
 * checkout. Values are synthetic and use example.invalid.
 */
const UNSAFE_EXPORT = {
  id: 'live-instance-root-id',
  name: 'Private Source Workflow',
  active: true,
  nodes: [
    {
      id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      name: 'Notify',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [0, 0],
      parameters: { url: 'https://hooks.example.invalid/notify' },
      credentials: { httpHeaderAuth: { id: 'cred-1', name: 'Example Auth' } }
    }
  ],
  connections: {}
};

/** An export with nothing the gate objects to. */
const SAFE_EXPORT = {
  name: 'Private Source Workflow',
  nodes: [
    {
      id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      name: 'Noop',
      type: 'n8n-nodes-base.noOp',
      typeVersion: 1,
      position: [0, 0],
      parameters: {}
    }
  ],
  connections: {}
};

let work;

before(async () => {
  work = await mkdtemp(path.join(tmpdir(), 'scout-cli-test-'));
  await writeFile(path.join(work, 'unsafe.json'), JSON.stringify(UNSAFE_EXPORT), 'utf8');
  await writeFile(path.join(work, 'safe.json'), JSON.stringify(SAFE_EXPORT), 'utf8');
});

after(async () => {
  if (work) await rm(work, { recursive: true, force: true });
});

/** Runs a given copy of the CLI, returning exit code and streams, never throwing. */
async function cliAt(scriptPath, args, options = {}) {
  try {
    const { stdout, stderr } = await run(process.execPath, [scriptPath, ...args], options);
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

/** Runs this repository's own copy of the CLI. */
const cli = (args, options = {}) => cliAt(SCRIPT, args, options);

const exists = async (p) => access(p).then(() => true).catch(() => false);

/** A throwaway directory shaped like a checkout, with the script inside it. */
async function makeCheckout(name) {
  const root = path.join(work, name);
  await mkdir(path.join(root, 'scripts', 'lib'), { recursive: true });
  await cp(SCRIPT, path.join(root, 'scripts', 'sanitize-export.mjs'));
  await cp(path.join(REPO_ROOT, 'scripts', 'lib', 'public-export-policy.mjs'),
    path.join(root, 'scripts', 'lib', 'public-export-policy.mjs'));
  // The script derives its repository root from its own location, so the copy
  // inside this throwaway checkout is the one that has to run. Invoking the
  // repository's own copy would resolve the root somewhere else entirely and
  // test nothing.
  return { root, script: path.join(root, 'scripts', 'sanitize-export.mjs') };
}

describe('the sanitizer refuses to write unscanned output into a checkout', () => {
  test('1. refuses unsafe output inside an arbitrary temporary checkout', async () => {
    // This is the case the old hardcoded root missed entirely.
    const { root: checkout, script } = await makeCheckout('checkout-a');
    const out = path.join(checkout, 'workflows', 'core', 'x.json');
    await mkdir(path.dirname(out), { recursive: true });
    const r = await cliAt(script,
      ['--input', path.join(work, 'unsafe.json'), '--output', out, '--name', 'Scout 99 | Test'],
      { cwd: checkout }
    );
    assert.equal(r.code, 1, 'must refuse');
    assert.match(r.stderr, /Refusing to write into the public repository/);
    assert.equal(await exists(out), false, 'no output file may be created');
  });

  test('2. refuses the same case from an unrelated working directory', async () => {
    // Proves the gate does not depend on cwd.
    const { root: checkout, script } = await makeCheckout('checkout-b');
    const out = path.join(checkout, 'workflows', 'core', 'x.json');
    await mkdir(path.dirname(out), { recursive: true });
    const elsewhere = path.join(work, 'unrelated-cwd');
    await mkdir(elsewhere, { recursive: true });
    const r = await cliAt(script,
      ['--input', path.join(work, 'unsafe.json'), '--output', out, '--name', 'Scout 99 | Test'],
      { cwd: elsewhere }
    );
    assert.equal(r.code, 1);
    assert.equal(await exists(out), false);
  });

  test('3. allows unsafe output in a throwaway directory outside the checkout', async () => {
    // The authoring boundary: sanitize somewhere disposable, inspect, then copy.
    const { script } = await makeCheckout('checkout-c');
    const outside = path.join(work, 'throwaway');
    await mkdir(outside, { recursive: true });
    const out = path.join(outside, 'x.json');
    const r = await cliAt(script,
      ['--input', path.join(work, 'unsafe.json'), '--output', out, '--name', 'Scout 99 | Test'],
      { cwd: work }
    );
    assert.equal(r.code, 0, r.stderr);
    assert.equal(await exists(out), true, 'the authoring boundary must still work');
  });

  test('4. treats a prefix lookalike directory as outside the checkout', async () => {
    // `<name>-copy` shares a string prefix with the checkout but is a sibling.
    const { root: checkout, script } = await makeCheckout('scout-oss');
    const lookalike = `${checkout}-copy`;
    await mkdir(lookalike, { recursive: true });
    const out = path.join(lookalike, 'x.json');
    const r = await cliAt(script,
      ['--input', path.join(work, 'unsafe.json'), '--output', out, '--name', 'Scout 99 | Test'],
      { cwd: work }
    );
    assert.equal(r.code, 0, 'a sibling directory is not inside the checkout');
    assert.equal(await exists(out), true);
  });

  test('5. normalizes an output path containing ..', async () => {
    // Written as an escape from a subdirectory, it still lands in the checkout.
    const { root: checkout, script } = await makeCheckout('checkout-dots');
    await mkdir(path.join(checkout, 'sub'), { recursive: true });
    const out = path.join(checkout, 'sub', '..', 'x.json');
    const r = await cliAt(script,
      ['--input', path.join(work, 'unsafe.json'), '--output', out, '--name', 'Scout 99 | Test'],
      { cwd: work }
    );
    assert.equal(r.code, 1, 'normalization must resolve this back inside the checkout');
    assert.equal(await exists(path.join(checkout, 'x.json')), false);
  });

  test('6. sees through a symlinked alias of the checkout', async () => {
    const { root: checkout, script } = await makeCheckout('checkout-real');
    const alias = path.join(work, 'checkout-alias');
    await symlink(checkout, alias);
    const out = path.join(alias, 'x.json');
    const r = await cliAt(script,
      ['--input', path.join(work, 'unsafe.json'), '--output', out, '--name', 'Scout 99 | Test'],
      { cwd: work }
    );
    assert.equal(r.code, 1, 'an alias of the same checkout is still the checkout');
    assert.equal(await exists(path.join(checkout, 'x.json')), false);
  });

  test('8. writes safe output inside the checkout', async () => {
    // The gate must not block legitimate work.
    const { root: checkout, script } = await makeCheckout('checkout-safe');
    const out = path.join(checkout, 'ok.json');
    const r = await cliAt(script,
      ['--input', path.join(work, 'safe.json'), '--output', out, '--name', 'Scout 99 | Test'],
      { cwd: work }
    );
    assert.equal(r.code, 0, r.stderr);
    assert.equal(await exists(out), true);
  });

  test('9. exits 1 with a diagnostic when the output directory does not exist', async () => {
    const missing = path.join(work, 'no-such-dir', 'x.json');
    const r = await cli(
      ['--input', path.join(work, 'safe.json'), '--output', missing, '--name', 'Scout 99 | Test'],
      { cwd: work }
    );
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Output directory does not exist/);
    assert.ok(!/\n\s+at .+:\d+:\d+/.test(r.stderr), 'must not print a stack trace');
    assert.equal(await exists(missing), false, 'the directory must not be created');
  });
});

describe('the CLI entry guard survives awkward invocation paths', () => {
  // The old guard compared import.meta.url against a hand-built file:// string.
  // Each case below broke that comparison, and the failure was silent: exit 0
  // with no work done and no message.

  test('7a. runs through a path containing spaces', async () => {
    const spaced = path.join(work, 'dir with spaces');
    await mkdir(path.join(spaced, 'scripts', 'lib'), { recursive: true });
    await cp(SCRIPT, path.join(spaced, 'scripts', 'sanitize-export.mjs'));
    await cp(path.join(REPO_ROOT, 'scripts', 'lib', 'public-export-policy.mjs'),
      path.join(spaced, 'scripts', 'lib', 'public-export-policy.mjs'));
    const r = await cli([], { cwd: work });
    assert.equal(r.code, 2, 'baseline: usage path is reachable');

    const viaSpaces = await promisify(execFile)(
      process.execPath, [path.join(spaced, 'scripts', 'sanitize-export.mjs')], { cwd: work }
    ).then(() => ({ code: 0, stderr: '' }), (e) => ({ code: e.code, stderr: e.stderr ?? '' }));
    assert.equal(viaSpaces.code, 2, 'a spaced path must still reach main()');
    assert.match(viaSpaces.stderr, /Usage: node/);
  });

  test('7b. runs when invoked through a symlink', async () => {
    const link = path.join(work, 'sanitize-link.mjs');
    await symlink(SCRIPT, link);
    const r = await promisify(execFile)(process.execPath, [link], { cwd: work })
      .then(() => ({ code: 0, stderr: '' }), (e) => ({ code: e.code, stderr: e.stderr ?? '' }));
    assert.equal(r.code, 2, 'a symlinked invocation must still reach main()');
    assert.match(r.stderr, /Usage: node/);
  });

  test('7c. missing arguments print usage and exit 2, never a silent 0', async () => {
    const r = await cli([], { cwd: REPO_ROOT });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /Usage: node scripts\/sanitize-export\.mjs/);
  });
});
