import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeWorkflow } from '../scripts/sanitize-export.mjs';
import { stableTemplateId } from '../scripts/lib/public-export-policy.mjs';

const PUBLIC_NAME = 'Scout 02 | Manual Signal Intake';

/**
 * A synthetic export that mimics the *shape* of a private n8n export without
 * copying any value from Scott's real workflows.
 */
function syntheticPrivateExport() {
  return {
    id: 'wKq3PrivateWorkflow',
    name: 'Internal Draft — Private Intake',
    versionId: 'a1b2c3d4-0000-4000-8000-abcdefabcdef',
    meta: {
      instanceId: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      templateCredsSetupCompleted: true
    },
    active: true,
    nodes: [
      {
        id: '11111111-2222-4333-8444-555555555555',
        name: 'On form submission',
        type: 'n8n-nodes-base.formTrigger',
        typeVersion: 2.2,
        position: [0, 0],
        webhookId: '99999999-8888-4777-8666-555555555555',
        parameters: { formTitle: 'Capture a signal' }
      },
      {
        id: '22222222-3333-4444-8555-666666666666',
        name: 'Classify Signal',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.2,
        position: [220, 0],
        parameters: {
          url: 'https://api.anthropic.com/v1/messages',
          method: 'POST'
        },
        credentials: {
          httpHeaderAuth: { id: 'yTk91', name: 'Private Anthropic Key' }
        }
      },
      {
        id: '33333333-4444-4555-8666-777777777777',
        name: 'Notes',
        type: 'n8n-nodes-base.stickyNote',
        typeVersion: 1,
        position: [0, -200],
        parameters: { content: 'Internal note' }
      }
    ],
    connections: {
      'On form submission': {
        main: [[{ node: 'Classify Signal', type: 'main', index: 0 }]]
      }
    },
    settings: { executionOrder: 'v1' },
    pinData: { 'Classify Signal': [{ json: { relevant: true } }] },
    tags: [{ id: 'tag-1', name: 'private' }],
    staticData: null,
    triggerCount: 4,
    updatedAt: '2026-02-01T00:00:00.000Z',
    createdAt: '2025-11-01T00:00:00.000Z'
  };
}

describe('sanitizeWorkflow', () => {
  test('removes root id, versionId, and meta', () => {
    const out = sanitizeWorkflow(syntheticPrivateExport(), PUBLIC_NAME);
    assert.equal('id' in out, false);
    assert.equal('versionId' in out, false);
    assert.equal('meta' in out, false);
  });

  test('drops non-public root bookkeeping fields', () => {
    const out = sanitizeWorkflow(syntheticPrivateExport(), PUBLIC_NAME);
    for (const key of ['staticData', 'triggerCount', 'updatedAt', 'createdAt']) {
      assert.equal(key in out, false, `${key} must not survive sanitization`);
    }
    assert.deepEqual(Object.keys(out).sort(), [
      'active',
      'connections',
      'name',
      'nodes',
      'pinData',
      'settings',
      'tags'
    ]);
  });

  test('applies the public name', () => {
    const out = sanitizeWorkflow(syntheticPrivateExport(), PUBLIC_NAME);
    assert.equal(out.name, PUBLIC_NAME);
  });

  test('forces the workflow inactive', () => {
    const out = sanitizeWorkflow(syntheticPrivateExport(), PUBLIC_NAME);
    assert.equal(out.active, false);
  });

  test('clears pin data and tags', () => {
    const out = sanitizeWorkflow(syntheticPrivateExport(), PUBLIC_NAME);
    assert.deepEqual(out.pinData, {});
    assert.deepEqual(out.tags, []);
  });

  test('removes every credential binding', () => {
    const out = sanitizeWorkflow(syntheticPrivateExport(), PUBLIC_NAME);
    for (const node of out.nodes) {
      assert.equal('credentials' in node, false);
    }
  });

  test('replaces node ids with deterministic public template ids', () => {
    const out = sanitizeWorkflow(syntheticPrivateExport(), PUBLIC_NAME);
    for (const node of out.nodes) {
      assert.equal(node.id, stableTemplateId(`${PUBLIC_NAME}:${node.name}`));
    }
  });

  test('keeps a required webhook id but makes it deterministic', () => {
    const out = sanitizeWorkflow(syntheticPrivateExport(), PUBLIC_NAME);
    const trigger = out.nodes.find((n) => n.name === 'On form submission');
    assert.equal(
      trigger.webhookId,
      stableTemplateId(`${PUBLIC_NAME}:webhook:On form submission`)
    );
  });

  test('removes webhook ids from nodes that do not require one', () => {
    const input = syntheticPrivateExport();
    input.nodes[1].webhookId = '44444444-5555-4666-8777-888888888888';
    const out = sanitizeWorkflow(input, PUBLIC_NAME);
    const http = out.nodes.find((n) => n.name === 'Classify Signal');
    assert.equal('webhookId' in http, false);
  });

  test('preserves node names, types, parameters, positions, and connections', () => {
    const input = syntheticPrivateExport();
    const out = sanitizeWorkflow(input, PUBLIC_NAME);
    assert.deepEqual(
      out.nodes.map((n) => n.name),
      ['On form submission', 'Classify Signal', 'Notes']
    );
    assert.deepEqual(
      out.nodes.map((n) => n.type),
      input.nodes.map((n) => n.type)
    );
    assert.deepEqual(out.nodes[1].parameters, input.nodes[1].parameters);
    assert.deepEqual(out.nodes[0].position, [0, 0]);
    assert.deepEqual(out.connections, input.connections);
  });

  test('assigns deterministic ids to Set node assignments', () => {
    const input = syntheticPrivateExport();
    input.nodes.push({
      id: '55555555-6666-4777-8888-999999999999',
      name: 'Scout Setup',
      type: 'n8n-nodes-base.set',
      typeVersion: 3.4,
      position: [110, 0],
      parameters: {
        mode: 'manual',
        includeOtherFields: true,
        assignments: {
          assignments: [
            { id: 'private-assignment-id', name: 'notionDatabaseId', value: '', type: 'string' }
          ]
        },
        options: {}
      }
    });
    const out = sanitizeWorkflow(input, PUBLIC_NAME);
    const setup = out.nodes.find((n) => n.name === 'Scout Setup');
    assert.equal(
      setup.parameters.assignments.assignments[0].id,
      stableTemplateId(`${PUBLIC_NAME}:Scout Setup:notionDatabaseId`)
    );
  });

  test('never mutates the input object', () => {
    const input = syntheticPrivateExport();
    const before = JSON.stringify(input);
    sanitizeWorkflow(input, PUBLIC_NAME);
    assert.equal(JSON.stringify(input), before);
  });

  test('is reproducible', () => {
    const a = sanitizeWorkflow(syntheticPrivateExport(), PUBLIC_NAME);
    const b = sanitizeWorkflow(syntheticPrivateExport(), PUBLIC_NAME);
    assert.deepEqual(a, b);
  });

  test('requires a non-empty public name', () => {
    assert.throws(() => sanitizeWorkflow(syntheticPrivateExport(), ''), /public name/i);
  });
});
