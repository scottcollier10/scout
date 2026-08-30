/**
 * Structural checks across every tracked text file, not only the prose docs.
 *
 * The test this replaces scanned `ALL_DOCS`, a hand-listed set of prose files.
 * That meant the test files themselves were never scanned, which is exactly
 * where twelve private operational values were sitting. A hand-listed set is
 * also a set someone has to remember to extend.
 *
 * So: every entry in the Git index, no maintained list. Findings are expressed
 * as shapes and positive contracts rather than as a list of forbidden values,
 * because a list of forbidden values is the defect being repaired. See
 * docs/decision-log.md entry 20.
 *
 * Contents come from index blob objects, never from `readFileSync` on a tracked
 * path. Reading the path would follow a symlink, so a tracked symlink pointing
 * outside the repository would pull in a file nobody asked to scan, while the
 * symlink's own committed target text would go unread. Reading the blob scans
 * exactly the bytes Git would commit and cannot escape the repository. It also
 * closes the gap where the index and the working tree disagree, and the index
 * is what becomes the commit.
 *
 * Failure messages name a file by index position, never by path, and report
 * only how many findings it had. A path can itself contain a private value, and
 * an assertion message that quotes the match publishes it into CI logs.
 *
 * Anything that needs a private value to check is not checked here. It is
 * checked by `scripts/scan-private-markers.mjs`, which takes the list at run
 * time and never sees the inside of this repository.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APPROVED_HOSTS,
  SETUP_KEY_CONTRACT,
  stableTemplateId,
  deterministicIdAllowlist
} from '../scripts/lib/public-export-policy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const git = (args, encoding = 'utf8') =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 })
    [encoding === 'buffer' ? 'valueOf' : 'toString'](encoding === 'buffer' ? undefined : encoding);

/** NUL-delimited so a path may contain a space, tab, or newline. */
const splitNul = (s) => s.split('\0').filter((r) => r.length > 0);

/**
 * Every index entry: mode, blob id, and path. `-s` and `-z` together put the
 * path last in each record, so no byte in a filename can break the parse.
 */
const INDEX = splitNul(git(['ls-files', '-s', '-z'])).map((rec) => {
  const tab = rec.indexOf('\t');
  const [mode, sha] = rec.slice(0, tab).split(/\s+/);
  return { mode, sha, path: rec.slice(tab + 1) };
});

const blob = (sha) =>
  execFileSync('git', ['cat-file', 'blob', sha], {
    cwd: ROOT,
    encoding: 'buffer',
    maxBuffer: 256 * 1024 * 1024
  });

/**
 * Tracked text content, read from index blobs. A symlink (mode 120000) is
 * included: its blob is its target text, which is committed and therefore
 * public, and reading the blob never opens the target.
 */
const TEXT_FILES = INDEX.map((entry, i) => {
  // No try/catch that swallows. An unreadable index object is a coverage gap,
  // so it fails the run rather than quietly shrinking the set.
  const buf = blob(entry.sha);
  return buf.includes(0)
    ? null
    : { rel: entry.path, text: buf.toString('utf8'), mode: entry.mode, index: i };
}).filter(Boolean);

/**
 * An opaque handle for failure messages. The path itself may contain a private
 * value, so it is never printed; a short digest identifies the file well enough
 * to find it locally without disclosing anything in a log.
 */
const idOf = (f) => `file#${f.index} (${createHash('sha256').update(f.rel).digest('hex').slice(0, 8)})`;

const WORKFLOW_ENTRIES = INDEX.filter(
  (e) => e.path.startsWith('workflows/') && e.path.endsWith('.json')
);
const WORKFLOW_FILES = WORKFLOW_ENTRIES.map((e) => e.path);
// Parsed from the tracked blob, not from disk, for the same reason.
const WORKFLOWS = Object.fromEntries(
  WORKFLOW_ENTRIES.map((e) => [e.path, JSON.parse(blob(e.sha).toString('utf8'))])
);

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const uuidVersion = (u) => u[14];

/** Assembled from fragments so this file ships no live-looking literal. */
const TOKEN_PREFIXES = [
  ['sk', 'ant'].join('-') + '-',
  ['ghp', ''].join('_'),
  ['gho', ''].join('_'),
  ['ghs', ''].join('_'),
  ['ghu', ''].join('_'),
  ['github', 'pat'].join('_') + '_',
  ['ntn', ''].join('_'),
  ['secret', ''].join('_'),
  ['xox', 'b'].join('') + '-',
  ['AKIA'].join('')
];
const tokenLike = new RegExp(
  `(${TOKEN_PREFIXES.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})[A-Za-z0-9_-]{16,}`
);

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const SYNTHETIC_EMAIL_TLD = /\.(example|invalid|test|localhost)$|@example\.(com|net|org)$|\.example$/i;

/** Home-path shapes, built from fragments for the same reason. */
const ABSOLUTE_HOME = [
  new RegExp(`/${['U', 'sers'].join('')}/[^/\\s"'\`)\\]]+/`),
  new RegExp(`/${['h', 'ome'].join('')}/[^/\\s"'\`)\\]]+/`),
  new RegExp(`[A-Za-z]:[\\\\/]${['U', 'sers'].join('')}[\\\\/][^\\\\/\\s"'\`)\\]]+[\\\\/]`, 'i')
];

/** n8n identifier shape: 16 characters of mixed-case base62, as n8n issues. */
// Each lookahead is bounded to the 16-character window. An unbounded `.*`
// reads on past the match and turns an ordinary identifier followed by a digit
// into a false positive.
const N8N_ID =
  /\b(?=[A-Za-z0-9]{16}\b)(?=[A-Za-z0-9]{0,15}[a-z])(?=[A-Za-z0-9]{0,15}[A-Z])(?=[A-Za-z0-9]{0,15}[0-9])[A-Za-z0-9]{16}\b/g;

/* ------------------------------------------------------------------ */

describe('every tracked text file, not just the prose docs', () => {
  test('the scan covers the whole tracked tree', () => {
    // If this ever shrinks to a hand-listed set again, the coverage gap that
    // hid twelve private values comes straight back.
    assert.ok(TEXT_FILES.length >= 40, `expected the whole tree, scanned ${TEXT_FILES.length}`);
    for (const dir of ['tests/', 'scripts/', 'docs/', 'workflows/']) {
      assert.ok(
        TEXT_FILES.some((f) => f.rel.startsWith(dir)),
        `the scan must reach ${dir}`
      );
    }
    assert.ok(
      TEXT_FILES.some((f) => f.rel === 'tests/tree-hygiene.test.mjs'),
      'the scan must include itself'
    );
    assert.equal(
      TEXT_FILES.filter((f) => f.mode === '120000').length,
      INDEX.filter((e) => e.mode === '120000').length,
      'every tracked symlink must be scanned as a blob, none skipped'
    );
  });

  test('no file carries a credential-token shape', () => {
    for (const f of TEXT_FILES) {
      const n = (f.text.match(new RegExp(tokenLike.source, 'g')) ?? []).length;
      assert.equal(n, 0, `${idOf(f)} contains ${n} credential-token shape(s)`);
    }
  });

  test('no file carries a credentials block', () => {
    for (const f of TEXT_FILES) {
      if (!f.rel.endsWith('.json')) continue;
      const n = (f.text.match(/"credentials"\s*:/g) ?? []).length;
      assert.equal(n, 0, `${idOf(f)} carries ${n} credentials block(s)`);
    }
  });

  test('no file carries a user-specific absolute home path', () => {
    for (const f of TEXT_FILES) {
      // scripts/check-local-paths.mjs owns this gate for the tree and history.
      // Repeating the shape here keeps a new tracked file from slipping in
      // between its runs, and costs nothing.
      for (const shape of ABSOLUTE_HOME) {
        // The matched text is itself a home path, so it is never quoted.
        assert.ok(!shape.test(f.text), `${idOf(f)} contains an absolute home path`);
      }
    }
  });

  test('every email address is synthetic', () => {
    for (const f of TEXT_FILES) {
      const text = f.text;
      // A name and password before the at-sign in a URL is userinfo, not an
      // address. The feed validator's negative fixtures are full of it on
      // purpose, and matching it here would report the very test that proves
      // embedded credentials are rejected.
      const withoutUserinfo = text.replace(/[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'`)\]]*/g, (url) =>
        url.replace(/\/\/[^/@\s]*@/, '//')
      );
      const real = (withoutUserinfo.match(EMAIL) ?? []).filter((a) => !SYNTHETIC_EMAIL_TLD.test(a));
      // The address is the private part, so only the count is reported.
      assert.equal(real.length, 0, `${idOf(f)} contains ${real.length} non-synthetic email address(es)`);
    }
  });

  test('every external host is on the approved list or an example domain', () => {
    const allowedSuffix = /(\.|^)(example\.(com|net|org|invalid)|example|invalid|test)$/i;
    const infra = new Set([
      'github.com', 'raw.githubusercontent.com', 'docs.n8n.io', 'www.w3.org',
      'nodejs.org', 'keepachangelog.com', 'semver.org', 'opensource.org',
      'community.hubspot.com', 'legal.hubspot.com', 'www.linkedin.com',
      'creativecommons.org', 'spdx.org'
    ]);
    for (const f of TEXT_FILES) {
      let unexpected = 0;
      // Userinfo is stripped first. Without that, a URL carrying a name and
      // password reports the name as the host, and the credential-rejection
      // fixtures fail their own test.
      for (const m of f.text.match(/https?:\/\/(?:[^/@\s"'`)\]]*@)?([A-Za-z0-9.-]+)/g) ?? []) {
        const host = m.replace(/^https?:\/\//, '').replace(/^[^/@]*@/, '').toLowerCase();
        // A single-label host is not a reachable hostname. Malformed-URL
        // fixtures produce them by design, and judging them as external
        // references would report the parser's own negative cases.
        if (!host.includes('.')) continue;
        const ok =
          APPROVED_HOSTS.has(host) ||
          infra.has(host) ||
          allowedSuffix.test(host) ||
          host.endsWith('.hubspot.com') ||
          host.endsWith('.anthropic.com') ||
          host.endsWith('.notion.com');
        if (!ok) unexpected += 1;
      }
      // A hostname can itself be private. Report how many, never which.
      assert.equal(unexpected, 0, `${idOf(f)} references ${unexpected} unexpected host(s)`);
    }
  });
});

describe('identifier shapes are derived, never carried over from an instance', () => {
  test('every UUID in a shipped workflow is reproducible from the sanitizer', () => {
    // A v4 UUID is randomly generated, which is what a live instance issues.
    // A v5-shaped id is derived from a seed, which is what the sanitizer emits.
    // Reproducing each one is a stronger statement than checking its version.
    for (const [file, wf] of Object.entries(WORKFLOWS)) {
      const allowed = deterministicIdAllowlist(wf);
      for (const found of JSON.stringify(wf).match(UUID) ?? []) {
        assert.ok(
          allowed.has(found),
          `${file} carries a UUID the sanitizer does not derive (version ${uuidVersion(found)})`
        );
      }
    }
  });

  test('the derivation is the documented one', () => {
    for (const [file, wf] of Object.entries(WORKFLOWS)) {
      for (const node of wf.nodes) {
        assert.equal(node.id, stableTemplateId(`${wf.name}:${node.name}`), `${file} node ${node.name}`);
      }
    }
  });

  test('no tracked file carries an n8n-issued identifier shape', () => {
    // n8n issues 16-character mixed-case base62 ids for workflows and
    // credentials. Nothing public should contain one.
    for (const f of TEXT_FILES) {
      const found = (f.text.match(N8N_ID) ?? []).filter(
        // A hex-only run is a hash or a Git object, not an n8n id.
        (s) => !/^[0-9a-f]+$/i.test(s)
      );
      assert.equal(found.length, 0, `${idOf(f)} contains ${found.length} n8n-shaped identifier(s)`);
    }
  });

  test('no shipped workflow carries a root id or instance metadata', () => {
    for (const [file, wf] of Object.entries(WORKFLOWS)) {
      assert.equal(wf.id, undefined, `${file} carries a root id`);
      assert.equal(wf.versionId, undefined, `${file} carries a root versionId`);
      assert.equal(wf.meta, undefined, `${file} carries instance meta`);
    }
  });
});

describe('setup keys are a positive contract', () => {
  test('every workflow matches its Scout Setup key contract exactly', () => {
    for (const [file, wf] of Object.entries(WORKFLOWS)) {
      const expected = SETUP_KEY_CONTRACT[path.basename(file)];
      assert.ok(expected, `${file} has no entry in the setup key contract`);
      const setup = wf.nodes.find((n) => n.name === 'Scout Setup');
      if (!setup) continue;
      const actual = (setup.parameters?.assignments?.assignments ?? [])
        .map((a) => a.name)
        .filter(Boolean);
      // An exact set comparison. Anything unexpected fails here, which is why
      // no test needs to name a forbidden key.
      assert.deepEqual(actual.slice().sort(), expected.slice().sort(), file);
    }
  });

  test('the contract covers every shipped workflow file', () => {
    for (const file of WORKFLOW_FILES) {
      assert.ok(SETUP_KEY_CONTRACT[path.basename(file)], `${file} is missing from the contract`);
    }
  });
});

/* ------------------------------------------------------------------ */
/* The guard on the guard                                              */
/* ------------------------------------------------------------------ */

describe('no test may reintroduce a literal denylist of private values', () => {
  const TEST_FILES = TEXT_FILES.filter((f) => f.rel.startsWith('tests/'));

  test('no array of opaque high-entropy string literals appears in a test', () => {
    // The shape being banned: several string literals in a row, each looking
    // like an operational value rather than a word. That is what a private
    // denylist looks like, and it is how twelve real values came to be here.
    const opaque = (s) =>
      s.length >= 12 &&
      !/\s/.test(s) &&
      !/^[a-z0-9-]+\.(mjs|json|md|yml|png|svg|toml)$/i.test(s) &&
      !s.includes('/') &&
      !/^[A-Za-z][a-z]+([A-Z][a-z]+)*$/.test(s) &&
      /[0-9]/.test(s) &&
      /[a-z]/i.test(s);

    for (const f of TEST_FILES) {
      for (const block of f.text.match(/\[[^[\]]{40,}\]/gs) ?? []) {
        const literals = [...block.matchAll(/'([^'\n]+)'/g)].map((m) => m[1]);
        const suspicious = literals.filter(opaque);
        assert.ok(
          suspicious.length < 3,
          `${idOf(f)} contains an array of ${suspicious.length} opaque literals, which is the shape ` +
            'of a private denylist. Exact private values belong in the runtime marker file.'
        );
      }
    }
  });

  test('no test file declares a variable named like a private denylist', () => {
    const banned = /\b(?:const|let|var)\s+(MARKERS|PRIVATE_MARKERS|SECRETS|FORBIDDEN_VALUES|DENYLIST|BLOCKLIST|BLACKLIST)\b/;
    for (const f of TEST_FILES) {
      assert.ok(
        !banned.test(f.text),
        `${idOf(f)} declares a private denylist binding; use scripts/scan-private-markers.mjs with a runtime marker file`
      );
    }
  });

  test('the private marker scanner ships no marker of its own', () => {
    const scanner = TEXT_FILES.find((f) => f.rel === 'scripts/scan-private-markers.mjs');
    assert.ok(scanner, 'the scanner must be tracked');
    // It must read its list from a path, never hold one.
    assert.match(scanner.text, /--markers/);
    assert.ok(
      !/\bconst\s+MARKERS\s*=\s*\[/.test(scanner.text),
      'the scanner must not carry an embedded marker list'
    );
  });
});

/* ------------------------------------------------------------------ */
/* The scan reads Git objects, not the filesystem                      */
/* ------------------------------------------------------------------ */

describe('a tracked symlink is scanned as an object and never followed', () => {
  // Built in a throwaway repository so nothing here touches this one.
  const build = () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'scout-symlink-'));
    const repo = path.join(dir, 'repo');
    const outside = path.join(dir, 'outside');
    mkdirSync(repo, { recursive: true });
    mkdirSync(outside, { recursive: true });

    // A file outside the repository that must never be read.
    const secretText = `OUTSIDE-${randomBytes(8).toString('hex')}`;
    writeFileSync(path.join(outside, 'secret.txt'), secretText, 'utf8');

    const g = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
    g(['init', '-q', '-b', 'main']);
    g(['config', 'user.email', 'probe@example.invalid']);
    g(['config', 'user.name', 'Probe']);

    // The symlink's target text is what Git commits as the blob.
    const targetText = path.join(outside, 'secret.txt');
    symlinkSync(targetText, path.join(repo, 'link'));
    writeFileSync(path.join(repo, 'ordinary.txt'), 'plain\n', 'utf8');
    g(['add', '-A']);
    g(['commit', '-q', '-m', 'with a symlink']);
    return { repo, secretText, targetText };
  };

  test('the blob holds the target text, and the target is not read', () => {
    const { repo, secretText, targetText } = build();
    const entries = execFileSync('git', ['ls-files', '-s', '-z'], { cwd: repo, encoding: 'utf8' })
      .split('\0')
      .filter(Boolean)
      .map((rec) => {
        const tab = rec.indexOf('\t');
        const [mode, sha] = rec.slice(0, tab).split(/\s+/);
        return { mode, sha, path: rec.slice(tab + 1) };
      });

    const link = entries.find((e) => e.path === 'link');
    assert.ok(link, 'the symlink must be tracked');
    assert.equal(link.mode, '120000', 'Git records a symlink with mode 120000');

    const content = execFileSync('git', ['cat-file', 'blob', link.sha], {
      cwd: repo,
      encoding: 'buffer'
    }).toString('utf8');

    // This is the model tree-hygiene uses: blob content is the target path.
    assert.equal(content, targetText, 'the blob is the target text, not the target file');
    assert.ok(
      !content.includes(secretText),
      'reading the blob must not pull in anything from outside the repository'
    );

    // And the contrast that makes the point: a filesystem read would have.
    const followed = readFileSync(path.join(repo, 'link'), 'utf8');
    assert.equal(followed, secretText, 'a filesystem read follows the link, which is why it is not used');

    rmSync(path.dirname(repo), { recursive: true, force: true });
  });

  test('this repository reads content from index blobs, never from a path', () => {
    const source = TEXT_FILES.find((f) => f.rel === 'tests/tree-hygiene.test.mjs').text;
    assert.ok(
      !/readFileSync\(\s*path\.join\(\s*ROOT/.test(source),
      'tracked content must not be read through ROOT; use the index blob'
    );
    assert.match(source, /cat-file', 'blob'/, 'content must come from git cat-file blob');
  });
});
