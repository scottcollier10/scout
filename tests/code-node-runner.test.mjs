import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { executeCodeNode } from '../scripts/lib/code-node-runner.mjs';

function workflowWith(jsCode, name = 'Probe') {
  return {
    name: 'Runner Fixture',
    nodes: [
      { name, type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode } },
      { name: 'Not Code', type: 'n8n-nodes-base.set', typeVersion: 3.4, parameters: {} }
    ]
  };
}

describe('executeCodeNode', () => {
  test('returns items produced by the node', async () => {
    const out = await executeCodeNode({
      workflow: workflowWith('return [{ json: { ok: true } }];'),
      nodeName: 'Probe'
    });
    assert.deepEqual(out, [{ json: { ok: true } }]);
  });

  test('exposes $input.all() and $input.first()', async () => {
    const out = await executeCodeNode({
      workflow: workflowWith(
        'return [{ json: { count: $input.all().length, firstId: $input.first().json.id } }];'
      ),
      nodeName: 'Probe',
      inputItems: [{ json: { id: 'a' } }, { json: { id: 'b' } }]
    });
    assert.deepEqual(out[0].json, { count: 2, firstId: 'a' });
  });

  test('wraps bare objects as items', async () => {
    const out = await executeCodeNode({
      workflow: workflowWith('return [{ json: { id: $input.first().json.id } }];'),
      nodeName: 'Probe',
      inputItems: [{ id: 'bare' }]
    });
    assert.equal(out[0].json.id, 'bare');
  });

  test('exposes $(name).all() and $(name).first()', async () => {
    const out = await executeCodeNode({
      workflow: workflowWith(
        "return [{ json: { model: $('Scout Setup').first().json.anthropicModel, n: $('Scout Setup').all().length } }];"
      ),
      nodeName: 'Probe',
      nodeOutputs: { 'Scout Setup': [{ json: { anthropicModel: 'test-model' } }] }
    });
    assert.deepEqual(out[0].json, { model: 'test-model', n: 1 });
  });

  test('fails loudly when a referenced node was not supplied', async () => {
    await assert.rejects(
      executeCodeNode({
        workflow: workflowWith("return $('Missing').all();"),
        nodeName: 'Probe'
      }),
      /referenced node "Missing"/
    );
  });

  test('pins $now and Date.now() to the supplied instant', async () => {
    const now = new Date('2026-08-26T12:00:00.000Z');
    const out = await executeCodeNode({
      workflow: workflowWith(
        'return [{ json: { viaNow: +$now, viaDate: Date.now(), viaCtor: new Date().getTime() } }];'
      ),
      nodeName: 'Probe',
      now
    });
    assert.equal(out[0].json.viaNow, now.getTime());
    assert.equal(out[0].json.viaDate, now.getTime());
    assert.equal(out[0].json.viaCtor, now.getTime());
  });

  test('still parses explicit dates normally', async () => {
    const out = await executeCodeNode({
      workflow: workflowWith(
        "return [{ json: { parsed: Date.parse('Wed, 26 Aug 2026 09:15:00 +0000') } }];"
      ),
      nodeName: 'Probe',
      now: new Date('2026-08-26T12:00:00.000Z')
    });
    assert.equal(out[0].json.parsed, Date.parse('2026-08-26T09:15:00.000Z'));
  });

  test('propagates thrown configuration errors', async () => {
    await assert.rejects(
      executeCodeNode({
        workflow: workflowWith("throw new Error('Scout Setup is not configured correctly.');"),
        nodeName: 'Probe'
      }),
      /Scout Setup is not configured correctly/
    );
  });

  test('denies the sandbox access to process', async () => {
    await assert.rejects(
      executeCodeNode({
        workflow: workflowWith('return [{ json: { cwd: process.cwd() } }];'),
        nodeName: 'Probe'
      }),
      /process is not defined/
    );
  });

  test('denies the sandbox access to require', async () => {
    await assert.rejects(
      executeCodeNode({
        workflow: workflowWith("return [{ json: { fs: require('node:fs') } }];"),
        nodeName: 'Probe'
      }),
      /require is not defined/
    );
  });

  test('denies the sandbox access to fetch', async () => {
    await assert.rejects(
      executeCodeNode({
        workflow: workflowWith("return [{ json: { r: await fetch('https://example.com') } }];"),
        nodeName: 'Probe'
      }),
      /fetch is not defined/
    );
  });

  test('rejects an unknown node name', async () => {
    await assert.rejects(
      executeCodeNode({ workflow: workflowWith('return [];'), nodeName: 'Nope' }),
      /no node named "Nope"/
    );
  });

  test('rejects a node that is not a Code node', async () => {
    await assert.rejects(
      executeCodeNode({ workflow: workflowWith('return [];'), nodeName: 'Not Code' }),
      /not a Code node/
    );
  });

  test('rejects a Code node that does not return an array', async () => {
    await assert.rejects(
      executeCodeNode({
        workflow: workflowWith('return { json: {} };'),
        nodeName: 'Probe'
      }),
      /must return an array/
    );
  });
});

/* ================================================================== */
/* Sandbox fidelity with the real n8n Code node                        */
/* ================================================================== */

describe('the sandbox withholds what n8n withholds', () => {
  // This suite exists because the harness once supplied `URL`. n8n 2.36.8 does
  // not, so four workflows shipped calling `new URL(...)` and every one of them
  // failed on a live instance while these tests passed. A harness that is more
  // generous than the runtime does not prove anything about the runtime.
  const ABSENT = ['URL', 'URLSearchParams', 'fetch', 'process', 'require', 'setTimeout'];

  for (const name of ABSENT) {
    test(`${name} is undefined, as in n8n`, async () => {
      const out = await executeCodeNode({
        workflow: workflowWith(`return [{ json: { t: typeof ${name} } }];`),
        nodeName: 'Probe'
      });
      assert.equal(out[0].json.t, 'undefined', `${name} must not be reachable from a Code node`);
    });
  }

  test('constructing a URL throws rather than silently succeeding', async () => {
    await assert.rejects(
      executeCodeNode({
        workflow: workflowWith("return [{ json: { u: new URL('https://example.com') } }];"),
        nodeName: 'Probe'
      }),
      /URL is not defined/
    );
  });

  test('no shipped Code node depends on the URL global', async () => {
    const { readFile, readdir } = await import('node:fs/promises');
    const pathMod = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    // fileURLToPath, not URL.pathname: the latter leaves percent-encoding in
    // place, so a checkout path containing a space resolves to a path that
    // does not exist.
    const root = pathMod.resolve(pathMod.dirname(fileURLToPath(import.meta.url)), '..');
    for (const group of ['core', 'extensions']) {
      const dir = pathMod.join(root, 'workflows', group);
      for (const file of await readdir(dir)) {
        const wf = JSON.parse(await readFile(pathMod.join(dir, file), 'utf8'));
        for (const node of wf.nodes) {
          const code = node.parameters?.jsCode;
          if (!code) continue;
          assert.ok(
            !/\bnew\s+URL\s*\(/.test(code),
            `${file} / ${node.name} calls new URL(), which n8n cannot run`
          );
          assert.ok(
            !/\bURLSearchParams\b/.test(code),
            `${file} / ${node.name} uses URLSearchParams, which n8n cannot run`
          );
        }
      }
    }
  });
});
