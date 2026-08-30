import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  stableTemplateId,
  scanWorkflow,
  validateWorkflow,
  APPROVED_HOSTS,
  SETUP_KEY_CONTRACT
} from '../scripts/lib/public-export-policy.mjs';

const WF_NAME = 'Scout 01 | HubSpot Community Signals';
const WF_PATH = 'workflows/core/01-hubspot-community-signals.json';

/**
 * Build a value that looks like a real credential without ever storing a
 * realistic credential pattern in this file. The prefix is assembled from
 * fragments and the body is derived at runtime, so grep over the repository
 * never sees a token-shaped literal.
 */
function syntheticSecret() {
  const prefix = ['sk', 'ant', 'api03'].join('-');
  const body = createHash('sha256')
    .update('scout-public-export-policy-test-seed')
    .digest('base64url');
  return `${prefix}-${body}`;
}

function syntheticHex32() {
  return createHash('sha256')
    .update('scout-private-database-identifier-seed')
    .digest('hex')
    .slice(0, 32);
}

function node(spec, wfName = WF_NAME) {
  return { id: stableTemplateId(`${wfName}:${spec.name}`), ...spec };
}

function assignments(nodeName, entries, wfName = WF_NAME) {
  return entries.map(([name, value, type]) => ({
    id: stableTemplateId(`${wfName}:${nodeName}:${name}`),
    name,
    value,
    type
  }));
}

function buildSafeWorkflow() {
  const nodes = [
    node({
      name: 'Daily Trigger',
      type: 'n8n-nodes-base.scheduleTrigger',
      typeVersion: 1.2,
      position: [0, 0],
      parameters: { rule: { interval: [{ triggerAtHour: 7 }] } }
    }),
    node({
      name: 'Scout Setup',
      type: 'n8n-nodes-base.set',
      typeVersion: 3.4,
      position: [200, 0],
      parameters: {
        mode: 'manual',
        includeOtherFields: true,
        assignments: {
          assignments: assignments('Scout Setup', [
            ['notionDatabaseId', '', 'string'],
            ['anthropicModel', 'claude-haiku-4-5-20251001', 'string'],
            [
              'hubspotCommunityFeeds',
              [
                'https://community.hubspot.com/t5/RevOps-Data-Hub/bd-p/revops/rss',
                'https://community.hubspot.com/t5/CRM-Sales-Hub/bd-p/crm/rss',
                'https://community.hubspot.com/t5/Marketing-Content/bd-p/marketing/rss'
              ],
              'array'
            ],
            ['lookbackHours', 48, 'number'],
            ['maxPostsPerFeed', 5, 'number']
          ])
        },
        options: {}
      }
    }),
    node({
      name: 'Validate Setup',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [400, 0],
      parameters: {
        jsCode: "const cfg = $('Scout Setup').first().json;\nreturn $input.all();"
      }
    }),
    node({
      name: 'Fetch Community Feed',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [600, 0],
      parameters: {
        url: 'https://community.hubspot.com/t5/RevOps-Data-Hub/bd-p/revops/rss'
      }
    }),
    node({
      name: 'Classify Post',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [800, 0],
      parameters: { url: 'https://api.anthropic.com/v1/messages', method: 'POST' }
    }),
    node({
      name: 'Create Signal Record',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [1000, 0],
      parameters: { url: 'https://api.notion.com/v1/pages', method: 'POST' }
    }),
    node({
      name: 'What Scout does',
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [0, -220],
      parameters: { content: '## What Scout does\nReads public HubSpot Community RSS.' }
    })
  ];

  return {
    name: WF_NAME,
    nodes,
    connections: {
      'Daily Trigger': { main: [[{ node: 'Scout Setup', type: 'main', index: 0 }]] },
      'Scout Setup': { main: [[{ node: 'Validate Setup', type: 'main', index: 0 }]] },
      'Validate Setup': { main: [[{ node: 'Fetch Community Feed', type: 'main', index: 0 }]] },
      'Fetch Community Feed': { main: [[{ node: 'Classify Post', type: 'main', index: 0 }]] },
      'Classify Post': { main: [[{ node: 'Create Signal Record', type: 'main', index: 0 }]] }
    },
    active: false,
    settings: { executionOrder: 'v1', timezone: 'UTC' },
    pinData: {},
    tags: []
  };
}

function errorsOf(findings) {
  return findings.filter((f) => f.severity === 'error');
}

function codesOf(findings) {
  return errorsOf(findings).map((f) => f.code);
}

describe('stableTemplateId', () => {
  test('is deterministic for the same seed', () => {
    assert.equal(stableTemplateId('a:b'), stableTemplateId('a:b'));
  });

  test('differs for different seeds', () => {
    assert.notEqual(stableTemplateId('a:b'), stableTemplateId('a:c'));
  });

  test('formats a version 5 RFC 4122 UUID', () => {
    const id = stableTemplateId('Scout 01 | HubSpot Community Signals:Scout Setup');
    assert.match(
      id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });
});

describe('scanWorkflow rejects unsafe exports', () => {
  const unsafeCases = [
    ['root workflow id', { id: 'private-id' }, 'ROOT_ID', 'private-id'],
    ['root version id', { versionId: 'private-version' }, 'VERSION_ID', 'private-version'],
    [
      'instance metadata',
      { meta: { instanceId: 'private-instance' } },
      'INSTANCE_META',
      'private-instance'
    ],
    ['active export', { active: true }, 'ACTIVE_WORKFLOW', null],
    [
      'credential binding',
      {
        nodes: [
          {
            name: 'Call API',
            type: 'n8n-nodes-base.httpRequest',
            credentials: { httpHeaderAuth: { id: '1', name: 'Private' } }
          }
        ]
      },
      'CREDENTIAL_BINDING',
      'Private'
    ],
    [
      'literal recipient',
      {
        nodes: [
          {
            name: 'Email',
            type: 'n8n-nodes-base.gmail',
            parameters: { sendTo: 'person@example.test' }
          }
        ]
      },
      'LITERAL_EMAIL',
      'person@example.test'
    ],
    [
      'database identifier in a URL',
      {
        nodes: [
          {
            name: 'Query',
            type: 'n8n-nodes-base.httpRequest',
            parameters: {
              url: `https://api.notion.com/v1/databases/${syntheticHex32()}/query`
            }
          }
        ]
      },
      'PRIVATE_IDENTIFIER',
      syntheticHex32()
    ],
    [
      'secret-shaped value',
      {
        nodes: [
          {
            name: 'Call API',
            type: 'n8n-nodes-base.httpRequest',
            parameters: { token: syntheticSecret() }
          }
        ]
      },
      'SECRET_PATTERN',
      syntheticSecret()
    ],
    [
      'unapproved host',
      {
        nodes: [
          {
            name: 'Scrape',
            type: 'n8n-nodes-base.httpRequest',
            parameters: { url: 'https://www.linkedin.com/feed/' }
          }
        ]
      },
      'UNAPPROVED_HOST',
      null
    ]
  ];

  for (const [label, patch, expectedCode, privateValue] of unsafeCases) {
    test(`reports ${label}`, () => {
      const workflow = { ...buildSafeWorkflow(), ...patch };
      const findings = scanWorkflow(workflow, WF_PATH);
      assert.ok(
        codesOf(findings).includes(expectedCode),
        `expected ${expectedCode}, got ${JSON.stringify(codesOf(findings))}`
      );
    });

    if (privateValue) {
      test(`never echoes the private value for ${label}`, () => {
        const workflow = { ...buildSafeWorkflow(), ...patch };
        const serialized = JSON.stringify(scanWorkflow(workflow, WF_PATH));
        assert.ok(
          !serialized.includes(privateValue),
          'scanner output must never contain the matched private value'
        );
      });
    }
  }

  test('every finding carries the required shape', () => {
    const workflow = { ...buildSafeWorkflow(), id: 'private-id', active: true };
    for (const finding of scanWorkflow(workflow, WF_PATH)) {
      assert.ok(['error', 'warning'].includes(finding.severity));
      assert.equal(typeof finding.code, 'string');
      assert.equal(finding.workflow, WF_PATH);
      assert.equal(typeof finding.location, 'string');
      assert.equal(typeof finding.message, 'string');
    }
  });
});

describe('scanWorkflow accepts a clean public export', () => {
  test('reports no errors', () => {
    const findings = scanWorkflow(buildSafeWorkflow(), WF_PATH);
    assert.deepEqual(errorsOf(findings), []);
  });

  test('does not flag deterministic template node identifiers', () => {
    const findings = scanWorkflow(buildSafeWorkflow(), WF_PATH);
    assert.ok(!codesOf(findings).includes('PRIVATE_IDENTIFIER'));
  });

  test('approves exactly the three documented hosts', () => {
    assert.deepEqual(
      [...APPROVED_HOSTS].sort(),
      ['api.anthropic.com', 'api.notion.com', 'community.hubspot.com']
    );
  });
});

describe('validateWorkflow structural rules', () => {
  test('accepts the clean hero workflow', () => {
    assert.deepEqual(errorsOf(validateWorkflow(buildSafeWorkflow(), WF_PATH)), []);
  });

  test('rejects an empty workflow name', () => {
    const wf = { ...buildSafeWorkflow(), name: '' };
    assert.ok(codesOf(validateWorkflow(wf, WF_PATH)).includes('MISSING_NAME'));
  });

  test('rejects an active workflow', () => {
    const wf = { ...buildSafeWorkflow(), active: true };
    assert.ok(codesOf(validateWorkflow(wf, WF_PATH)).includes('ACTIVE_WORKFLOW'));
  });

  test('rejects more than one executable trigger', () => {
    const wf = buildSafeWorkflow();
    wf.nodes.push(
      node({
        name: 'Second Trigger',
        type: 'n8n-nodes-base.manualTrigger',
        typeVersion: 1,
        position: [0, 200],
        parameters: {}
      })
    );
    wf.connections['Second Trigger'] = {
      main: [[{ node: 'Scout Setup', type: 'main', index: 0 }]]
    };
    assert.ok(codesOf(validateWorkflow(wf, WF_PATH)).includes('TRIGGER_COUNT'));
  });

  test('requires Scout Setup immediately after the trigger', () => {
    const wf = buildSafeWorkflow();
    wf.connections['Daily Trigger'] = {
      main: [[{ node: 'Validate Setup', type: 'main', index: 0 }]]
    };
    assert.ok(codesOf(validateWorkflow(wf, WF_PATH)).includes('SETUP_NOT_AFTER_TRIGGER'));
  });

  test('requires Scout Setup to retain incoming fields', () => {
    const wf = buildSafeWorkflow();
    const setup = wf.nodes.find((n) => n.name === 'Scout Setup');
    setup.parameters.includeOtherFields = false;
    assert.ok(codesOf(validateWorkflow(wf, WF_PATH)).includes('SETUP_DROPS_FIELDS'));
  });

  test('rejects a connection to a missing node', () => {
    const wf = buildSafeWorkflow();
    wf.connections['Classify Post'] = {
      main: [[{ node: 'Nonexistent Node', type: 'main', index: 0 }]]
    };
    assert.ok(codesOf(validateWorkflow(wf, WF_PATH)).includes('BROKEN_CONNECTION'));
  });

  test('rejects a disconnected executable node', () => {
    const wf = buildSafeWorkflow();
    wf.nodes.push(
      node({
        name: 'Orphan',
        type: 'n8n-nodes-base.noOp',
        typeVersion: 1,
        position: [1200, 400],
        parameters: {}
      })
    );
    assert.ok(codesOf(validateWorkflow(wf, WF_PATH)).includes('DISCONNECTED_NODE'));
  });

  test('allows a disconnected sticky note', () => {
    assert.deepEqual(errorsOf(validateWorkflow(buildSafeWorkflow(), WF_PATH)), []);
  });

  test('rejects an expression referencing a missing node', () => {
    const wf = buildSafeWorkflow();
    const target = wf.nodes.find((n) => n.name === 'Classify Post');
    target.parameters.body = "={{ $('Missing Setup').first().json.model }}";
    assert.ok(codesOf(validateWorkflow(wf, WF_PATH)).includes('MISSING_NODE_REFERENCE'));
  });

  test('requires connection-based execution order', () => {
    const wf = buildSafeWorkflow();
    wf.settings = { executionOrder: 'v0' };
    assert.ok(codesOf(validateWorkflow(wf, WF_PATH)).includes('EXECUTION_ORDER'));
  });

  test('rejects credential bindings', () => {
    const wf = buildSafeWorkflow();
    wf.nodes.find((n) => n.name === 'Classify Post').credentials = {
      httpHeaderAuth: { id: '1', name: 'Private' }
    };
    assert.ok(codesOf(validateWorkflow(wf, WF_PATH)).includes('CREDENTIAL_BINDING'));
  });

  test('rejects a setup node missing a contract key', () => {
    const wf = buildSafeWorkflow();
    const setup = wf.nodes.find((n) => n.name === 'Scout Setup');
    setup.parameters.assignments.assignments =
      setup.parameters.assignments.assignments.filter((a) => a.name !== 'lookbackHours');
    assert.ok(codesOf(validateWorkflow(wf, WF_PATH)).includes('SETUP_KEYS'));
  });

  test('rejects a setup node with an extra key', () => {
    const wf = buildSafeWorkflow();
    const setup = wf.nodes.find((n) => n.name === 'Scout Setup');
    setup.parameters.assignments.assignments.push({
      id: stableTemplateId(`${WF_NAME}:Scout Setup:linkedinCookie`),
      name: 'linkedinCookie',
      value: '',
      type: 'string'
    });
    assert.ok(codesOf(validateWorkflow(wf, WF_PATH)).includes('SETUP_KEYS'));
  });

  test('rejects a non built-in node type', () => {
    const wf = buildSafeWorkflow();
    wf.nodes.find((n) => n.name === 'Classify Post').type =
      'n8n-nodes-community-scraper.linkedin';
    assert.ok(codesOf(validateWorkflow(wf, WF_PATH)).includes('NON_BUILTIN_NODE'));
  });

  test('rejects pin data', () => {
    const wf = buildSafeWorkflow();
    wf.pinData = { 'Classify Post': [{ json: { relevant: true } }] };
    assert.ok(codesOf(validateWorkflow(wf, WF_PATH)).includes('PIN_DATA'));
  });

  test('rejects unknown root metadata', () => {
    const wf = { ...buildSafeWorkflow(), staticData: { lastSeen: 'x' } };
    assert.ok(codesOf(validateWorkflow(wf, WF_PATH)).includes('UNKNOWN_ROOT_KEY'));
  });

  test('publishes the exact documented setup contract', () => {
    assert.deepEqual(SETUP_KEY_CONTRACT['01-hubspot-community-signals.json'], [
      'notionDatabaseId',
      'anthropicModel',
      'hubspotCommunityFeeds',
      'lookbackHours',
      'maxPostsPerFeed'
    ]);
    assert.deepEqual(SETUP_KEY_CONTRACT['02-manual-signal-intake.json'], [
      'notionDatabaseId',
      'anthropicModel'
    ]);
    assert.deepEqual(SETUP_KEY_CONTRACT['03-stale-signal-nudge.json'], [
      'notionDatabaseId',
      'recipientEmail',
      'staleDaysByAction'
    ]);
    assert.deepEqual(SETUP_KEY_CONTRACT['04-community-engagement-sync.json'], [
      'notionDatabaseId'
    ]);
    assert.deepEqual(SETUP_KEY_CONTRACT['05-draft-backfill.json'], [
      'notionDatabaseId',
      'anthropicModel',
      'batchSize'
    ]);
    assert.deepEqual(SETUP_KEY_CONTRACT['06-weekly-scorecard.json'], [
      'notionDatabaseId',
      'recipientEmail',
      'weeklyTargets'
    ]);
  });
});
