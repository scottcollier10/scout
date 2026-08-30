import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { executeCodeNode } from '../scripts/lib/code-node-runner.mjs';
import { SETUP_KEY_CONTRACT } from '../scripts/lib/public-export-policy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function loadJson(relative) {
  return JSON.parse(await readFile(path.join(ROOT, relative), 'utf8'));
}

const wf01 = await loadJson('workflows/core/01-hubspot-community-signals.json');
const wf02 = await loadJson('workflows/core/02-manual-signal-intake.json');
const wf03 = await loadJson('workflows/core/03-stale-signal-nudge.json');
const wf04 = await loadJson('workflows/extensions/04-community-engagement-sync.json');
const wf05 = await loadJson('workflows/extensions/05-draft-backfill.json');
const wf06 = await loadJson('workflows/extensions/06-weekly-scorecard.json');

const WORKFLOWS_BY_FILE = {
  '01-hubspot-community-signals.json': wf01,
  '02-manual-signal-intake.json': wf02,
  '03-stale-signal-nudge.json': wf03,
  '04-community-engagement-sync.json': wf04,
  '05-draft-backfill.json': wf05,
  '06-weekly-scorecard.json': wf06
};

const communityPost = await loadJson('examples/fixtures/community-post.json');
const anthropicRelevant = await loadJson('examples/fixtures/anthropic-relevant.json');
const anthropicIrrelevant = await loadJson('examples/fixtures/anthropic-irrelevant.json');
const expectedRecord = await loadJson('examples/fixtures/expected-notion-record.json');
const manualSignal = await loadJson('examples/fixtures/manual-signal.json');
const openSignals = await loadJson('examples/fixtures/notion-open-signals.json');

/** An Anthropic Messages response carrying `text` as its only content block. */
function anthropicText(text) {
  return { json: { content: [{ type: 'text', text }] } };
}

/** The instant the synthetic fixtures are anchored to. */
const NOW = new Date('2026-08-26T12:00:00.000Z');

const SETUP = {
  notionDatabaseId: '',
  anthropicModel: 'claude-haiku-4-5-20251001',
  hubspotCommunityFeeds: [
    'https://community.hubspot.com/c/revops-data-hub/64.rss',
    'https://community.hubspot.com/c/crm-sales-hub/crm/103.rss',
    'https://community.hubspot.com/c/marketing-content/61.rss'
  ],
  lookbackHours: 48,
  maxPostsPerFeed: 5
};

function setupOutput(overrides = {}) {
  return [{ json: { ...SETUP, ...overrides } }];
}

/** Run Extract Posts against the synthetic feed. */
function extractPosts(setupOverrides = {}) {
  return executeCodeNode({
    workflow: wf01,
    nodeName: 'Extract Posts',
    inputItems: [{ json: communityPost }],
    nodeOutputs: { 'Scout Setup': setupOutput(setupOverrides) },
    now: NOW
  });
}

/** Run the full classify-to-Notion mapping for one post and one model reply. */
async function mapToNotion(modelResponse, setupOverrides = {}) {
  const posts = await extractPosts(setupOverrides);
  const requests = await executeCodeNode({
    workflow: wf01,
    nodeName: 'Build Claude Request',
    inputItems: posts,
    nodeOutputs: { 'Scout Setup': setupOutput(setupOverrides) },
    now: NOW
  });
  return executeCodeNode({
    workflow: wf01,
    nodeName: 'Parse + Map to Notion',
    inputItems: [modelResponse],
    nodeOutputs: {
      'Scout Setup': setupOutput(setupOverrides),
      'Build Claude Request': requests
    },
    now: NOW
  });
}

describe('Scout 01 configuration contract', () => {
  test('Scout Setup exposes exactly the documented keys in order', () => {
    const setup = wf01.nodes.find((n) => n.name === 'Scout Setup');
    const keys = setup.parameters.assignments.assignments.map((a) => a.name);
    assert.deepEqual(keys, SETUP_KEY_CONTRACT['01-hubspot-community-signals.json']);
  });

  test('ships inactive with no bound credentials', () => {
    assert.equal(wf01.active, false);
    for (const node of wf01.nodes) {
      assert.equal('credentials' in node, false, `${node.name} must not bind a credential`);
    }
  });

  test('uses UTC so the schedule is explicit rather than inherited', () => {
    assert.equal(wf01.settings.timezone, 'UTC');
  });

  test('retries RSS twice and external API writes three times with a two second delay', () => {
    const byName = Object.fromEntries(wf01.nodes.map((n) => [n.name, n]));
    assert.equal(byName['Fetch RSS'].maxTries, 2);
    assert.equal(byName['Classify (Claude)'].maxTries, 3);
    assert.equal(byName['Classify (Claude)'].waitBetweenTries, 2000);
    assert.equal(byName['Create Notion Row'].maxTries, 3);
    assert.equal(byName['Create Notion Row'].waitBetweenTries, 2000);
  });

  test('carries the three required sticky notes', () => {
    const stickies = wf01.nodes
      .filter((n) => n.type === 'n8n-nodes-base.stickyNote')
      .map((n) => n.name);
    assert.deepEqual(stickies.sort(), [
      'Configure before running',
      'Human review boundary',
      'What Scout does'
    ]);
  });

  test('makes no unsupported claim about the community platform', () => {
    // Scout does not know, and does not need to know, which forum software
    // HubSpot Community runs on. The pattern is assembled at runtime so this
    // file does not ship the vendor name as a literal, the same reason
    // scripts/check-local-paths.mjs builds its patterns from fragments.
    const vendor = new RegExp(['dis', 'course'].join(''), 'i');
    const serialized = JSON.stringify(wf01);
    assert.ok(
      !vendor.test(serialized),
      'no workflow text may name a specific forum vendor as the community platform'
    );
  });

  test('contains no sticky note URLs', () => {
    for (const node of wf01.nodes.filter((n) => n.type === 'n8n-nodes-base.stickyNote')) {
      assert.ok(
        !/https?:\/\//i.test(node.parameters.content),
        `sticky note "${node.name}" must not contain a URL`
      );
    }
  });
});

describe('Scout 01 setup validation', () => {
  async function validateWith(overrides) {
    return executeCodeNode({
      workflow: wf01,
      nodeName: 'Validate Setup',
      inputItems: [{ json: {} }],
      nodeOutputs: { 'Scout Setup': setupOutput(overrides) },
      now: NOW
    });
  }

  test('passes with a complete configuration', async () => {
    const out = await validateWith({ notionDatabaseId: 'synthetic-database-id' });
    assert.equal(out[0].json.validated, true);
    assert.equal(out[0].json.feedCount, 3);
  });

  test('stops before any API call when notionDatabaseId is empty', async () => {
    await assert.rejects(validateWith({}), /notionDatabaseId is empty/);
  });

  test('names the missing Scout Setup field in the error', async () => {
    await assert.rejects(validateWith({}), /Scout Setup is not configured correctly/);
  });

  test('rejects an empty feed list', async () => {
    await assert.rejects(
      validateWith({ notionDatabaseId: 'x', hubspotCommunityFeeds: [] }),
      /hubspotCommunityFeeds is empty/
    );
  });

  test('rejects maxPostsPerFeed outside 1 to 100', async () => {
    await assert.rejects(
      validateWith({ notionDatabaseId: 'x', maxPostsPerFeed: 0 }),
      /maxPostsPerFeed must be a whole number from 1 to 100/
    );
    await assert.rejects(
      validateWith({ notionDatabaseId: 'x', maxPostsPerFeed: 101 }),
      /maxPostsPerFeed must be a whole number from 1 to 100/
    );
  });

  test('rejects lookbackHours outside 1 to 168', async () => {
    await assert.rejects(
      validateWith({ notionDatabaseId: 'x', lookbackHours: 0 }),
      /lookbackHours must be a whole number from 1 to 168/
    );
    await assert.rejects(
      validateWith({ notionDatabaseId: 'x', lookbackHours: 169 }),
      /lookbackHours must be a whole number from 1 to 168/
    );
  });

  test('reports every problem at once rather than one at a time', async () => {
    await assert.rejects(validateWith({ lookbackHours: 0, maxPostsPerFeed: 0 }), (err) => {
      assert.match(err.message, /notionDatabaseId/);
      assert.match(err.message, /lookbackHours/);
      assert.match(err.message, /maxPostsPerFeed/);
      return true;
    });
  });
});

describe('Scout 01 feed URL validation', () => {
  // Feed URLs decide what this workflow fetches, so a wrong entry is an
  // outbound request to somewhere Scout never promised to go. Validate Setup
  // sits before Fetch RSS and fails the whole run, not just the bad entry.
  async function withFeeds(feeds) {
    return executeCodeNode({
      workflow: wf01,
      nodeName: 'Validate Setup',
      inputItems: [{ json: {} }],
      nodeOutputs: {
        'Scout Setup': setupOutput({
          notionDatabaseId: 'synthetic-database-id',
          hubspotCommunityFeeds: feeds
        })
      },
      now: NOW
    });
  }

  test('accepts the shipped default feeds', async () => {
    const out = await withFeeds(SETUP.hubspotCommunityFeeds);
    assert.equal(out[0].json.validated, true);
    assert.equal(out[0].json.feedCount, 3);
  });

  test('rejects a value that is not an absolute URL', async () => {
    await assert.rejects(
      withFeeds(['/c/revops-data-hub/64.rss']),
      /hubspotCommunityFeeds\[0\] is not an absolute URL/
    );
  });

  test('rejects plain HTTP', async () => {
    await assert.rejects(
      withFeeds(['http://community.hubspot.com/c/revops-data-hub/64.rss']),
      /hubspotCommunityFeeds\[0\] must use https/
    );
  });

  test('rejects a different host entirely', async () => {
    await assert.rejects(
      withFeeds(['https://feeds.example.com/c/revops-data-hub/64.rss']),
      /hubspotCommunityFeeds\[0\] must be hosted on community\.hubspot\.com/
    );
  });

  test('rejects a subdomain of the community host', async () => {
    await assert.rejects(
      withFeeds(['https://mirror.community.hubspot.com/c/revops-data-hub/64.rss']),
      /must be hosted on community\.hubspot\.com/
    );
  });

  test('rejects a lookalike host that only starts with the community host', async () => {
    await assert.rejects(
      withFeeds(['https://community.hubspot.com.example.net/c/revops-data-hub/64.rss']),
      /must be hosted on community\.hubspot\.com/
    );
  });

  test('rejects a path that is not an RSS feed', async () => {
    await assert.rejects(
      withFeeds(['https://community.hubspot.com/c/revops-data-hub/64']),
      /hubspotCommunityFeeds\[0\] must point at a \.rss path/
    );
  });

  test('rejects embedded credentials', async () => {
    await assert.rejects(
      withFeeds(['https://user:secret@community.hubspot.com/c/revops-data-hub/64.rss']),
      /hubspotCommunityFeeds\[0\] must not embed a username or password/
    );
  });

  test('names the offending entry by index when a later feed is bad', async () => {
    await assert.rejects(
      withFeeds([SETUP.hubspotCommunityFeeds[0], 'https://feeds.example.com/64.rss']),
      /hubspotCommunityFeeds\[1\] must be hosted on/
    );
  });

  test('one bad entry fails the run even when the others are valid', async () => {
    await assert.rejects(
      withFeeds([...SETUP.hubspotCommunityFeeds, 'http://community.hubspot.com/x.rss']),
      /Scout Setup is not configured correctly/
    );
  });
});

describe('Scout 01 post extraction', () => {
  test('keeps the RevOps post and drops the off-topic one', async () => {
    const posts = await extractPosts();
    const urls = posts.map((p) => p.json.postUrl);
    assert.ok(urls.includes('https://example.com/community/post-001'));
    assert.ok(!urls.includes('https://example.com/community/post-002'));
  });

  test('drops posts older than lookbackHours', async () => {
    const posts = await extractPosts();
    const urls = posts.map((p) => p.json.postUrl);
    assert.ok(
      !urls.includes('https://example.com/community/post-003'),
      'a post from six weeks ago must fall outside a 48 hour lookback'
    );
  });

  test('widening lookbackHours lets the older post back in', async () => {
    const posts = await extractPosts({ lookbackHours: 168 });
    const urls = posts.map((p) => p.json.postUrl);
    assert.ok(!urls.includes('https://example.com/community/post-003'));

    const veryWide = await executeCodeNode({
      workflow: wf01,
      nodeName: 'Extract Posts',
      inputItems: [{ json: communityPost }],
      nodeOutputs: { 'Scout Setup': setupOutput({ lookbackHours: 168 }) },
      now: new Date('2026-07-15T00:00:00.000Z')
    });
    assert.ok(veryWide.map((p) => p.json.postUrl).includes('https://example.com/community/post-003'));
  });

  test('strips HTML from the snippet', async () => {
    const posts = await extractPosts();
    assert.ok(!/[<>]/.test(posts[0].json.postSnippet));
  });

  test('caps how many posts survive per feed', async () => {
    const posts = await extractPosts({ maxPostsPerFeed: 1 });
    assert.equal(posts.length, 1);
  });

  test('reads the board name from the feed', async () => {
    const posts = await extractPosts();
    assert.equal(posts[0].json.board, 'RevOps & Data Hub');
  });
});

describe('Scout 01 request building', () => {
  test('uses the model from Scout Setup rather than a hard-coded id', async () => {
    const posts = await extractPosts();
    const requests = await executeCodeNode({
      workflow: wf01,
      nodeName: 'Build Claude Request',
      inputItems: posts,
      nodeOutputs: { 'Scout Setup': setupOutput({ anthropicModel: 'model-from-setup' }) },
      now: NOW
    });
    assert.equal(requests[0].json._anthropicBody.model, 'model-from-setup');
  });

  test('asks for the pain_areas key that matches the public schema', async () => {
    const posts = await extractPosts();
    const requests = await executeCodeNode({
      workflow: wf01,
      nodeName: 'Build Claude Request',
      inputItems: posts,
      nodeOutputs: { 'Scout Setup': setupOutput() },
      now: NOW
    });
    const system = requests[0].json._anthropicBody.system;
    assert.match(system, /pain_areas/);
    assert.ok(!/pain_buckets/.test(system));
  });
});

describe('Scout 01 relevant classification', () => {
  test('creates exactly one Notion body', async () => {
    const out = await mapToNotion(anthropicRelevant);
    assert.equal(out.length, 1);
    assert.ok(out[0].json._notionBody);
  });

  test('matches the expected public Notion record', async () => {
    const out = await mapToNotion(anthropicRelevant);
    assert.deepEqual(out[0].json._notionBody.properties, expectedRecord.properties);
  });

  test('uses public property names only', async () => {
    // A positive contract on the whole key set, not a list of names to avoid.
    // Any unexpected property fails here, so no denylist of private property
    // names is needed and none may be reintroduced.
    const out = await mapToNotion(anthropicRelevant);
    const keys = Object.keys(out[0].json._notionBody.properties).sort();
    assert.deepEqual(keys, Object.keys(expectedRecord.properties).sort());
    assert.ok(keys.includes('Evidence'));
    assert.ok(keys.includes('Pain area'));
  });

  test('takes the database id from Scout Setup', async () => {
    const out = await mapToNotion(anthropicRelevant, { notionDatabaseId: 'db-from-setup' });
    assert.equal(out[0].json._notionBody.parent.database_id, 'db-from-setup');
  });

  test('constrains every select value to the documented options', async () => {
    const out = await mapToNotion(anthropicRelevant);
    const props = out[0].json._notionBody.properties;
    assert.ok(
      ['Tier 1 (hot)', 'Tier 2 (warm)', 'Tier 3 (cool)', 'Tier 4 (cold)'].includes(
        props['Warmth tier'].select.name
      )
    );
    assert.ok(
      ['ICP buyer', 'ICP practitioner', 'Partner / consultant', 'Peer / networker', 'Unknown'].includes(
        props['Persona type'].select.name
      )
    );
    assert.ok(['Sales (ICP)', 'Connector', 'Unknown'].includes(props.Track.select.name));
    assert.ok(
      ['Comment', 'DM', 'Connect', 'Monitor', 'Ignore'].includes(props['Next action'].select.name)
    );
    assert.ok(
      ['New', 'Engaged', 'In conversation', 'Scan/Demo', 'Closed', 'Needs review'].includes(
        props.Status.select.name
      )
    );
  });

  test('discards model enum values outside the allowlist', async () => {
    const rogue = structuredClone(anthropicRelevant);
    rogue.content[0].text = JSON.stringify({
      relevant: true,
      warmth_tier: 'Tier 0 (on fire)',
      pain_areas: ['Routing', 'Telepathy'],
      best_angle: 'a',
      draft_comment: 'b',
      persona_type: 'Time traveller',
      track: 'Unknown'
    });
    const out = await mapToNotion(rogue);
    const props = out[0].json._notionBody.properties;
    assert.equal(props['Warmth tier'].select.name, 'Tier 3 (cool)');
    assert.deepEqual(props['Pain area'].multi_select, [{ name: 'Routing' }]);
    assert.equal(props['Persona type'].select.name, 'Unknown');
  });

  test('caps long text fields at 1900 characters', async () => {
    const long = structuredClone(anthropicRelevant);
    long.content[0].text = JSON.stringify({
      relevant: true,
      warmth_tier: 'Tier 1 (hot)',
      pain_areas: ['Routing'],
      best_angle: 'A'.repeat(5000),
      draft_comment: 'B'.repeat(5000),
      persona_type: 'ICP buyer',
      track: 'Sales (ICP)'
    });
    const out = await mapToNotion(long);
    const props = out[0].json._notionBody.properties;
    assert.equal(props['Best angle'].rich_text[0].text.content.length, 1900);
    assert.equal(props.Draft.rich_text[0].text.content.length, 1900);
  });

  test('caps the source snippet at 1200 characters before the model sees it', async () => {
    const wide = structuredClone(communityPost);
    wide.rss.channel.item[0].description = `<p>${'lifecycle routing '.repeat(400)}</p>`;
    const posts = await executeCodeNode({
      workflow: wf01,
      nodeName: 'Extract Posts',
      inputItems: [{ json: wide }],
      nodeOutputs: { 'Scout Setup': setupOutput() },
      now: NOW
    });
    assert.equal(posts[0].json.postSnippet.length, 1200);
  });

  test('caps the Signal excerpt at 1900 characters', async () => {
    const wide = structuredClone(communityPost);
    // Title and snippet together must exceed the cap. The snippet alone
    // cannot, because Extract Posts already trims it to 1200.
    wide.rss.channel.item[0].title = `Lifecycle routing ${'X'.repeat(2000)}`;
    wide.rss.channel.item[0].description = `<p>${'lifecycle routing '.repeat(400)}</p>`;
    const posts = await executeCodeNode({
      workflow: wf01,
      nodeName: 'Extract Posts',
      inputItems: [{ json: wide }],
      nodeOutputs: { 'Scout Setup': setupOutput() },
      now: NOW
    });
    const requests = await executeCodeNode({
      workflow: wf01,
      nodeName: 'Build Claude Request',
      inputItems: posts,
      nodeOutputs: { 'Scout Setup': setupOutput() },
      now: NOW
    });
    const out = await executeCodeNode({
      workflow: wf01,
      nodeName: 'Parse + Map to Notion',
      inputItems: [anthropicRelevant],
      nodeOutputs: { 'Scout Setup': setupOutput(), 'Build Claude Request': requests },
      now: NOW
    });
    assert.equal(out[0].json._notionBody.properties.Signal.rich_text[0].text.content.length, 1900);
  });
});

describe('Scout 01 irrelevant classification', () => {
  test('creates no Notion body', async () => {
    const out = await mapToNotion(anthropicIrrelevant);
    assert.deepEqual(out, []);
  });
});

describe('Scout 01 malformed model output', () => {
  const cases = [
    ['unparseable prose', { content: [{ type: 'text', text: 'I could not answer that.' }] }],
    ['empty content', { content: [] }],
    ['truncated JSON', { content: [{ type: 'text', text: '{"relevant":tr' }] }],
    [
      'missing relevant flag',
      { content: [{ type: 'text', text: '{"warmth_tier":"Tier 1 (hot)"}' }] }
    ]
  ];

  for (const [label, response] of cases) {
    test(`creates one Needs review row for ${label}`, async () => {
      const out = await mapToNotion(response);
      assert.equal(out.length, 1);
      assert.equal(out[0].json.needsReview, true);
      assert.equal(
        out[0].json._notionBody.properties.Status.select.name,
        'Needs review'
      );
    });
  }

  test('records the source title and source URL', async () => {
    const out = await mapToNotion({ content: [{ type: 'text', text: 'nonsense' }] });
    const props = out[0].json._notionBody.properties;
    assert.equal(
      props.Name.title[0].text.content,
      'Duplicate companies keep reappearing after our lifecycle stage sync'
    );
    assert.equal(props['Source URL'].url, 'https://example.com/community/post-001');
  });

  test('records a short error label', async () => {
    const out = await mapToNotion({ content: [{ type: 'text', text: 'nonsense' }] });
    assert.equal(out[0].json.errorLabel, 'Model response was not valid JSON');
    assert.match(
      out[0].json._notionBody.properties.Evidence.rich_text[0].text.content,
      /Model response was not valid JSON/
    );
  });

  test('never stores the raw model response', async () => {
    const secretish = 'RAW_MODEL_TEXT_THAT_MUST_NOT_BE_STORED';
    const out = await mapToNotion({ content: [{ type: 'text', text: secretish }] });
    assert.ok(
      !JSON.stringify(out).includes(secretish),
      'the raw model response must never reach Notion'
    );
  });

  test('leaves the draft empty so nothing unreviewed looks ready to send', async () => {
    const out = await mapToNotion({ content: [{ type: 'text', text: 'nonsense' }] });
    const props = out[0].json._notionBody.properties;
    assert.equal(props.Draft.rich_text[0].text.content, '');
    assert.equal(props['Next action'].select.name, 'Monitor');
    assert.equal(props.Replied.checkbox, false);
  });
});

/* ================================================================== */
/* Release-wide contract                                               */
/* ================================================================== */

describe('Scout release configuration contract', () => {
  test('every workflow exposes exactly its documented Scout Setup keys in order', () => {
    assert.deepEqual(
      Object.keys(WORKFLOWS_BY_FILE).sort(),
      Object.keys(SETUP_KEY_CONTRACT).sort()
    );
    for (const [file, workflow] of Object.entries(WORKFLOWS_BY_FILE)) {
      const setup = workflow.nodes.find((n) => n.name === 'Scout Setup');
      assert.ok(setup, `${file} must contain a Scout Setup node`);
      const keys = setup.parameters.assignments.assignments.map((a) => a.name);
      assert.deepEqual(keys, SETUP_KEY_CONTRACT[file], `${file} Scout Setup keys`);
    }
  });

  test('every Scout Setup keeps incoming fields so trigger payloads survive', () => {
    for (const [file, workflow] of Object.entries(WORKFLOWS_BY_FILE)) {
      const setup = workflow.nodes.find((n) => n.name === 'Scout Setup');
      assert.equal(setup.parameters.includeOtherFields, true, file);
    }
  });

  test('every workflow ships inactive with no bound credentials', () => {
    for (const [file, workflow] of Object.entries(WORKFLOWS_BY_FILE)) {
      assert.equal(workflow.active, false, file);
      for (const node of workflow.nodes) {
        assert.equal('credentials' in node, false, `${file}: ${node.name} binds a credential`);
      }
    }
  });

  test('no sticky note anywhere in the release carries a URL', () => {
    for (const [file, workflow] of Object.entries(WORKFLOWS_BY_FILE)) {
      for (const node of workflow.nodes.filter((n) => n.type === 'n8n-nodes-base.stickyNote')) {
        assert.ok(
          !/https?:\/\//i.test(node.parameters.content),
          `${file}: sticky note "${node.name}" must not contain a URL`
        );
      }
    }
  });

  test('every external request except the RSS fetch retries three times with a two second delay', () => {
    const RETRYING_TYPES = new Set(['n8n-nodes-base.httpRequest', 'n8n-nodes-base.gmail']);
    for (const [file, workflow] of Object.entries(WORKFLOWS_BY_FILE)) {
      for (const node of workflow.nodes) {
        if (!RETRYING_TYPES.has(node.type)) continue;
        // The RSS fetch is deliberately gentler: HubSpot Community is a public
        // endpoint Scout has no business hammering.
        if (node.name === 'Fetch RSS') continue;
        assert.equal(node.retryOnFail, true, `${file}: ${node.name}`);
        assert.equal(node.maxTries, 3, `${file}: ${node.name}`);
        assert.equal(node.waitBetweenTries, 2000, `${file}: ${node.name}`);
      }
    }
  });

  test('scheduled workflows pin a timezone rather than inheriting one', () => {
    for (const [file, workflow] of Object.entries(WORKFLOWS_BY_FILE)) {
      const scheduled = workflow.nodes.some((n) => n.type === 'n8n-nodes-base.scheduleTrigger');
      if (!scheduled) continue;
      assert.equal(workflow.settings.timezone, 'UTC', file);
    }
  });
});

/* ================================================================== */
/* Scout 02: manual signal intake                                      */
/* ================================================================== */

const SETUP_02 = { notionDatabaseId: 'scout-db-02', anthropicModel: 'claude-haiku-4-5-20251001' };

function setup02(overrides = {}) {
  return [{ json: { ...SETUP_02, ...overrides } }];
}

/** The fixture as the form trigger emits it, without the fixture's own note. */
function formItem(overrides = {}) {
  const { description, ...fields } = manualSignal;
  return { json: { ...fields, ...overrides } };
}

function validate02(item) {
  return executeCodeNode({
    workflow: wf02,
    nodeName: 'Validate Input',
    inputItems: [item],
    nodeOutputs: { 'Scout Setup': setup02() },
    now: NOW
  });
}

const MANUAL_VERDICT = JSON.stringify({
  relevant: true,
  warmth_tier: 'Tier 2 (warm)',
  pain_areas: ['Lifecycle', 'Routing'],
  persona_type: 'ICP practitioner',
  track: 'Sales (ICP)',
  next_action: 'DM',
  best_angle: 'Does owner get overwritten on import, or when the lifecycle stage changes?',
  draft: 'Worth checking which write lands last. If the import runs after the lifecycle automation it will keep reclaiming owner no matter how the routing rule is written.'
});

async function manualRow(modelResponse, formOverrides = {}) {
  const validated = await validate02(formItem(formOverrides));
  const requests = await executeCodeNode({
    workflow: wf02,
    nodeName: 'Build Claude Request',
    inputItems: validated,
    nodeOutputs: { 'Scout Setup': setup02() },
    now: NOW
  });
  return executeCodeNode({
    workflow: wf02,
    nodeName: 'Build Notion Row',
    inputItems: [modelResponse],
    nodeOutputs: { 'Scout Setup': setup02(), 'Build Claude Request': requests },
    now: NOW
  });
}

describe('Scout 02 input validation', () => {
  test('accepts the fixture submission and normalises its fields', async () => {
    const [item] = await validate02(formItem());
    assert.deepEqual(item.json, {
      name: 'priya_revops',
      note: manualSignal['What you saw'],
      company: 'Meridian Freight',
      url: 'https://example.com/community/post-042',
      source: 'HubSpot Community'
    });
  });

  test('rejects a URL that is not http or https', async () => {
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,x']) {
      await assert.rejects(
        validate02(formItem({ URL: url })),
        /URL must use http or https/,
        `expected ${url} to be rejected`
      );
    }
  });

  test('rejects a URL that is not absolute', async () => {
    await assert.rejects(
      validate02(formItem({ URL: 'community.example.com/post' })),
      /URL is not a valid absolute URL/
    );
  });

  test('treats the URL as optional', async () => {
    const [item] = await validate02(formItem({ URL: '' }));
    assert.equal(item.json.url, '');
  });

  test('rejects a name outside 2 to 200 characters', async () => {
    await assert.rejects(validate02(formItem({ Name: 'x' })), /Name must be between 2 and 200/);
    await assert.rejects(
      validate02(formItem({ Name: 'x'.repeat(201) })),
      /Name must be between 2 and 200/
    );
  });

  test('rejects a note outside 10 to 5000 characters', async () => {
    await assert.rejects(
      validate02(formItem({ 'What you saw': 'too short' })),
      /What you saw must be between 10 and 5000/
    );
    await assert.rejects(
      validate02(formItem({ 'What you saw': 'x'.repeat(5001) })),
      /What you saw must be between 10 and 5000/
    );
  });

  test('rejects a source label outside the documented list', async () => {
    await assert.rejects(validate02(formItem({ Source: 'Twitter' })), /Source must be one of/);
  });

  test('stops before any API call when Scout Setup is empty', async () => {
    await assert.rejects(
      executeCodeNode({
        workflow: wf02,
        nodeName: 'Validate Input',
        inputItems: [formItem()],
        nodeOutputs: { 'Scout Setup': setup02({ notionDatabaseId: '' }) },
        now: NOW
      }),
      /notionDatabaseId is empty/
    );
  });
});

describe('Scout 02 mapping to Notion', () => {
  test('maps the fixture submission onto the public schema', async () => {
    const [row] = await manualRow(anthropicText(MANUAL_VERDICT));
    assert.deepEqual(row.json._notionBody, {
      parent: { database_id: 'scout-db-02' },
      properties: {
        Name: { title: [{ text: { content: 'priya_revops' } }] },
        Signal: { rich_text: [{ text: { content: manualSignal['What you saw'] } }] },
        Source: { select: { name: 'HubSpot Community' } },
        Replied: { checkbox: false },
        Company: { rich_text: [{ text: { content: 'Meridian Freight' } }] },
        'Source URL': { url: 'https://example.com/community/post-042' },
        'Warmth tier': { select: { name: 'Tier 2 (warm)' } },
        'Persona type': { select: { name: 'ICP practitioner' } },
        Track: { select: { name: 'Sales (ICP)' } },
        'Next action': { select: { name: 'DM' } },
        Status: { select: { name: 'New' } },
        'Pain area': { multi_select: [{ name: 'Lifecycle' }, { name: 'Routing' }] },
        'Best angle': {
          rich_text: [
            {
              text: {
                content: 'Does owner get overwritten on import, or when the lifecycle stage changes?'
              }
            }
          ]
        },
        Draft: {
          rich_text: [
            {
              text: {
                content:
                  'Worth checking which write lands last. If the import runs after the lifecycle automation it will keep reclaiming owner no matter how the routing rule is written.'
              }
            }
          ]
        }
      }
    });
  });

  test('takes the database id from Scout Setup', async () => {
    const [row] = await manualRow(anthropicText(MANUAL_VERDICT));
    assert.equal(row.json._notionBody.parent.database_id, 'scout-db-02');
  });

  test('routes a LinkedIn source to LinkedIn URL, which Scout never fetches', async () => {
    const [row] = await manualRow(anthropicText(MANUAL_VERDICT), { Source: 'LinkedIn post' });
    const props = row.json._notionBody.properties;
    assert.equal(props['LinkedIn URL'].url, 'https://example.com/community/post-042');
    assert.equal('Source URL' in props, false);
  });

  test('routes a non-LinkedIn source to Source URL', async () => {
    const [row] = await manualRow(anthropicText(MANUAL_VERDICT), { Source: 'Reddit' });
    const props = row.json._notionBody.properties;
    assert.equal(props['Source URL'].url, 'https://example.com/community/post-042');
    assert.equal('LinkedIn URL' in props, false);
  });

  test('omits Company when the operator left it blank', async () => {
    const [row] = await manualRow(anthropicText(MANUAL_VERDICT), { Company: '' });
    assert.equal('Company' in row.json._notionBody.properties, false);
  });

  test('discards model enum values outside the allowlist', async () => {
    const [row] = await manualRow(
      anthropicText(
        JSON.stringify({
          warmth_tier: 'Tier 0 (scorching)',
          pain_areas: ['Routing', 'Vibes'],
          persona_type: 'Wizard',
          track: 'Sideways',
          next_action: 'Call them',
          best_angle: 'x',
          draft: 'y'
        })
      )
    );
    const props = row.json._notionBody.properties;
    assert.equal(props['Warmth tier'].select.name, 'Tier 4 (cold)');
    assert.equal(props['Persona type'].select.name, 'Unknown');
    assert.equal(props.Track.select.name, 'Unknown');
    assert.equal(props['Next action'].select.name, 'Monitor');
    assert.deepEqual(props['Pain area'].multi_select, [{ name: 'Routing' }]);
  });

  test('files an unreadable model response as Needs review instead of losing it', async () => {
    const [row] = await manualRow(anthropicText('I am terribly sorry, I cannot help with that.'));
    const props = row.json._notionBody.properties;
    assert.equal(row.json.needsReview, true);
    assert.equal(props.Status.select.name, 'Needs review');
    assert.equal(props.Name.title[0].text.content, 'priya_revops');
    assert.equal(props.Signal.rich_text[0].text.content, manualSignal['What you saw']);
    assert.equal('Draft' in props, false, 'nothing unreviewed should look ready to send');
  });

  test('never stores the raw model response', async () => {
    const [row] = await manualRow(anthropicText('I am terribly sorry, I cannot help with that.'));
    assert.ok(!JSON.stringify(row.json).includes('terribly sorry'));
  });

  test('caps long text fields at 1900 characters', async () => {
    const [row] = await manualRow(
      anthropicText(JSON.stringify({ ...JSON.parse(MANUAL_VERDICT), draft: 'x'.repeat(2500) })),
      { 'What you saw': 'y'.repeat(4000) }
    );
    const props = row.json._notionBody.properties;
    assert.equal(props.Draft.rich_text[0].text.content.length, 1900);
    assert.equal(props.Signal.rich_text[0].text.content.length, 1900);
  });

  test('sends the model id from Scout Setup rather than a hard-coded one', async () => {
    const validated = await validate02(formItem());
    const [request] = await executeCodeNode({
      workflow: wf02,
      nodeName: 'Build Claude Request',
      inputItems: validated,
      nodeOutputs: { 'Scout Setup': setup02({ anthropicModel: 'some-other-model' }) },
      now: NOW
    });
    assert.equal(request.json._anthropicBody.model, 'some-other-model');
    assert.ok(!JSON.stringify(wf02).includes('hard-coded'));
  });
});

/* ================================================================== */
/* Scout 03: stale signal nudge                                        */
/* ================================================================== */

const STALE_DEFAULTS = { DM: 4, Comment: 5, Connect: 6, Monitor: 14, default: 7 };
const SETUP_03 = {
  notionDatabaseId: 'scout-db-03',
  recipientEmail: 'operator@example.com',
  staleDaysByAction: STALE_DEFAULTS
};

function setup03(overrides = {}) {
  return [{ json: { ...SETUP_03, ...overrides } }];
}

function validate03(overrides = {}) {
  return executeCodeNode({
    workflow: wf03,
    nodeName: 'Validate Setup',
    nodeOutputs: { 'Scout Setup': setup03(overrides) },
    now: NOW
  });
}

function computeStale(results, overrides = {}) {
  return executeCodeNode({
    workflow: wf03,
    nodeName: 'Compute Stale',
    inputItems: [{ json: { results } }],
    nodeOutputs: { 'Scout Setup': setup03(overrides) },
    now: NOW
  });
}

describe('Scout 03 setup validation', () => {
  test('passes with a complete configuration', async () => {
    const [item] = await validate03();
    assert.equal(item.json.validated, true);
  });

  test('rejects an empty recipient before Gmail is asked to send', async () => {
    await assert.rejects(validate03({ recipientEmail: '' }), /recipientEmail is empty/);
  });

  test('rejects an address that does not look like an address', async () => {
    for (const bad of ['operator', 'operator@', '@example.com', 'operator example.com', 'a@b.c']) {
      await assert.rejects(
        validate03({ recipientEmail: bad }),
        /recipientEmail does not look like an email address/,
        `expected ${bad} to be rejected`
      );
    }
  });

  test('rejects a follow-up window outside 1 to 90 days', async () => {
    for (const days of [0, 91, 2.5, -3, 'soon']) {
      await assert.rejects(
        validate03({ staleDaysByAction: { ...STALE_DEFAULTS, DM: days } }),
        /staleDaysByAction\.DM must be a whole number of days from 1 to 90/,
        `expected ${days} to be rejected`
      );
    }
  });

  test('requires every documented window including the default', async () => {
    await assert.rejects(
      validate03({ staleDaysByAction: { DM: 4 } }),
      /staleDaysByAction\.default must be a whole number/
    );
  });
});

describe('Scout 03 stale detection', () => {
  test('flags exactly the rows past their own follow-up window', async () => {
    const [out] = await computeStale(openSignals.results);
    assert.equal(out.json.staleCount, 4);
    assert.equal(out.json.shouldEmail, true);
  });

  test('skips Ignore rows and Closed rows', async () => {
    const [out] = await computeStale(openSignals.results);
    assert.ok(!out.json.html.includes('not_a_fit'), 'Ignore rows must not be nudged');
    assert.ok(!out.json.html.includes('already_handled'), 'Closed rows must not be nudged');
  });

  test('groups the digest by next action, hottest action first', async () => {
    const [out] = await computeStale(openSignals.results);
    const sections = ['Connect &mdash;', 'DM &mdash;', 'Monitor &mdash;'].map((needle) =>
      out.json.html.indexOf(needle)
    );
    assert.ok(sections.every((i) => i !== -1), 'every action with a stale row gets a section');
    // Connect leads because its only row is the hottest and stalest overall,
    // then DM, then Monitor.
    assert.deepEqual([...sections].sort((a, b) => a - b), sections);
  });

  test('orders rows inside an action hottest tier first, then longest stale', async () => {
    const [out] = await computeStale(openSignals.results);
    const order = ['Ops &amp;', 'northstar_ops', 'renewal_owner', 'ops_lead'].map((needle) =>
      out.json.html.indexOf(needle)
    );
    assert.ok(order.every((i) => i !== -1), 'every stale row must appear');
    // northstar_ops (Tier 1) precedes renewal_owner (Tier 2) within the DM section.
    assert.deepEqual([...order].sort((a, b) => a - b), order);
  });

  test('a widened window makes rows stop being stale', async () => {
    const [out] = await computeStale(openSignals.results, {
      staleDaysByAction: { ...STALE_DEFAULTS, DM: 30 }
    });
    assert.equal(out.json.staleCount, 2);
    assert.ok(!out.json.html.includes('northstar_ops'));
    assert.ok(!out.json.html.includes('renewal_owner'));
  });

  test('a narrowed window makes more rows stale', async () => {
    const [out] = await computeStale(openSignals.results, {
      staleDaysByAction: { DM: 1, Comment: 1, Connect: 1, Monitor: 1, default: 1 }
    });
    assert.equal(out.json.staleCount, 5);
  });

  test('falls back to the default window for an action with no explicit one', async () => {
    const page = {
      id: 'page-fallback',
      created_time: '2026-08-16T00:00:00.000Z',
      properties: {
        Name: { title: [{ plain_text: 'fallback_row' }] },
        'Next action': { select: { name: 'Comment' } },
        Status: { select: { name: 'New' } },
        'Warmth tier': { select: { name: 'Tier 2 (warm)' } }
      }
    };
    const windows = { DM: 4, Comment: 'nonsense', Connect: 6, Monitor: 14, default: 7 };
    const [out] = await computeStale([page], { staleDaysByAction: windows });
    assert.equal(out.json.staleCount, 1);
  });

  test('ages a never-touched row from its creation time', async () => {
    const page = {
      id: 'page-untouched',
      created_time: '2026-08-01T00:00:00.000Z',
      properties: {
        Name: { title: [{ plain_text: 'never_touched' }] },
        'Next action': { select: { name: 'DM' } },
        Status: { select: { name: 'New' } }
      }
    };
    const [out] = await computeStale([page]);
    assert.equal(out.json.staleCount, 1);
  });
});

describe('Scout 03 email safety', () => {
  test('escapes every HTML metacharacter that arrives from Notion', async () => {
    const [out] = await computeStale(openSignals.results);
    const html = out.json.html;
    assert.ok(html.includes('Ops &amp; &quot;Data&quot; &lt;team&gt; won&#39;t wait'));
    assert.ok(!html.includes('<team>'), 'raw angle brackets must not survive');
    assert.ok(html.includes('&lt;b&gt;Which&lt;/b&gt;'), 'rich text must be escaped too');
  });

  test('refuses to link a URL that is not http or https', async () => {
    const [out] = await computeStale(openSignals.results);
    assert.ok(!out.json.html.includes('javascript:'));
  });

  test('links an ordinary http URL', async () => {
    const [out] = await computeStale(openSignals.results);
    assert.ok(out.json.html.includes('<a href="https://example.com/community/post-001">'));
  });
});

describe('Scout 03 quiet run', () => {
  test('reports zero and asks not to be emailed when nothing is stale', async () => {
    const [out] = await computeStale([]);
    assert.equal(out.json.staleCount, 0);
    assert.equal(out.json.shouldEmail, false);
  });

  test('produces no digest table when nothing is stale', async () => {
    const [out] = await computeStale([]);
    assert.ok(!out.json.html.includes('<table'));
  });

  test('routes an empty run away from the email node', () => {
    const branches = wf03.connections['Any Stale?'].main;
    assert.deepEqual(branches[0].map((c) => c.node), ['Email Nudge']);
    assert.deepEqual(branches[1].map((c) => c.node), ['No Stale Signals']);
  });

  test('the email node is reachable only from the true branch', () => {
    const reaching = Object.entries(wf03.connections).filter(([, outputs]) =>
      (outputs.main ?? []).some((branch) => branch.some((c) => c.node === 'Email Nudge'))
    );
    assert.deepEqual(reaching.map(([source]) => source), ['Any Stale?']);
  });

  test('sends to the address in Scout Setup rather than a literal one', () => {
    const email = wf03.nodes.find((n) => n.name === 'Email Nudge');
    assert.match(email.parameters.sendTo, /Scout Setup.*recipientEmail/);
  });
});

/* ================================================================== */
/* Scout 04: community engagement sync                                 */
/* ================================================================== */

const SETUP_04 = { notionDatabaseId: 'scout-db-04' };

const COMMUNITY_NOTIFICATION = {
  json: {
    id: 'gmail-message-1',
    subject: 'northstar_ops replied to "Duplicate companies keep reappearing"',
    snippet: 'Reply to this email at notifications@hubspot.example to respond in the thread.',
    text: 'northstar_ops replied on the thread https://community.hubspot.com/t/revops-data-hub/12345/3'
  }
};

const UNRELATED_EMAIL = {
  json: {
    id: 'gmail-message-2',
    subject: 'Your HubSpot invoice is ready',
    snippet: 'View your invoice.',
    text: 'Nothing here points at a community topic.'
  }
};

function validate04(overrides = {}) {
  return executeCodeNode({
    workflow: wf04,
    nodeName: 'Validate Setup',
    inputItems: [{ json: {} }],
    nodeOutputs: { 'Scout Setup': [{ json: { ...SETUP_04, ...overrides } }] },
    now: NOW
  });
}

// Validate Setup now sits between the trigger and Parse Notification, so the
// parser reads the mail from the trigger by name and its own input is just the
// validation result.
function parseNotifications(items) {
  return executeCodeNode({
    workflow: wf04,
    nodeName: 'Parse Notification',
    inputItems: [{ json: { validated: true } }],
    nodeOutputs: {
      'Community Notifications': items,
      'Scout Setup': [{ json: SETUP_04 }]
    },
    now: NOW
  });
}

async function decideAndBuild(notionResponses, items = [COMMUNITY_NOTIFICATION]) {
  const parsed = await parseNotifications(items);
  return executeCodeNode({
    workflow: wf04,
    nodeName: 'Decide & Build',
    inputItems: notionResponses,
    nodeOutputs: { 'Scout Setup': [{ json: SETUP_04 }], 'Parse Notification': parsed },
    now: NOW
  });
}

describe('Scout 04 setup validation', () => {
  test('passes with a database id set', async () => {
    const out = await validate04();
    assert.equal(out[0].json.validated, true);
  });

  test('stops the run when notionDatabaseId is empty', async () => {
    await assert.rejects(validate04({ notionDatabaseId: '' }), /notionDatabaseId is empty/);
  });

  test('names Scout Setup as the place to fix it', async () => {
    await assert.rejects(
      validate04({ notionDatabaseId: '   ' }),
      /Scout Setup is not configured correctly/
    );
  });

  test('an empty database id cannot reach the first Notion request', async () => {
    // Find Existing Row is the first node that talks to Notion. Validate Setup
    // is upstream of it on the only path from the trigger, so a failed
    // validation stops the run before any request is built.
    const byName = Object.fromEntries(wf04.nodes.map((n) => [n.name, n]));
    assert.ok(byName['Validate Setup'], 'Validate Setup must exist');

    const downstream = (start) => {
      const seen = new Set();
      const queue = [start];
      while (queue.length > 0) {
        const current = queue.shift();
        for (const group of wf04.connections[current]?.main ?? []) {
          for (const link of group) {
            if (seen.has(link.node)) continue;
            seen.add(link.node);
            queue.push(link.node);
          }
        }
      }
      return seen;
    };

    assert.ok(
      downstream('Community Notifications').has('Validate Setup'),
      'Validate Setup must run after the trigger'
    );
    assert.ok(
      downstream('Validate Setup').has('Find Existing Row'),
      'the first Notion request must sit downstream of Validate Setup'
    );
    assert.ok(
      !downstream('Find Existing Row').has('Validate Setup'),
      'validation must not be reachable only after the Notion request'
    );
    await assert.rejects(validate04({ notionDatabaseId: '' }));
  });
});

describe('Scout 04 notification parsing', () => {
  test('extracts the topic URL and the public display name', async () => {
    const [item] = await parseNotifications([COMMUNITY_NOTIFICATION]);
    assert.equal(item.json.topicUrl, 'https://community.hubspot.com/t/revops-data-hub/12345');
    assert.equal(item.json.topicId, '12345');
    assert.equal(item.json.replier, 'northstar_ops');
  });

  test('drops mail with no community topic link', async () => {
    const parsed = await parseNotifications([UNRELATED_EMAIL]);
    assert.equal(parsed.length, 0);
  });

  test('keeps only the community mail when both arrive together', async () => {
    const parsed = await parseNotifications([UNRELATED_EMAIL, COMMUNITY_NOTIFICATION]);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].json.replier, 'northstar_ops');
  });

  test('never carries a sender address forward', async () => {
    // The parser redacts addresses before matching a display name, and then
    // keeps only the topic link and that name. Neither the address nor the
    // redaction marker that replaced it survives, because the text they were
    // in is discarded.
    const parsed = await parseNotifications([COMMUNITY_NOTIFICATION]);
    const serialized = JSON.stringify(parsed);
    assert.ok(!serialized.includes('@'), 'no address may survive parsing');
    assert.ok(!serialized.includes('notifications@hubspot.example'));
  });
});

describe('Scout 04 update versus create', () => {
  const MATCHED = [{ json: { results: [{ id: 'page-001' }] } }];
  const UNMATCHED = [{ json: { results: [] } }];

  test('updates the matched row instead of creating a duplicate', async () => {
    const [item] = await decideAndBuild(MATCHED);
    assert.equal(item.json.matched, true);
    assert.equal(item.json._method, 'PATCH');
    assert.equal(item.json._url, 'https://api.notion.com/v1/pages/page-001');
    assert.deepEqual(item.json._notionBody, {
      properties: {
        Replied: { checkbox: true },
        Status: { select: { name: 'In conversation' } },
        'Next action': { select: { name: 'DM' } },
        'Last touch': { date: { start: '2026-08-26' } }
      }
    });
  });

  test('creates a hot row when nothing matches', async () => {
    const [item] = await decideAndBuild(UNMATCHED);
    assert.equal(item.json.matched, false);
    assert.equal(item.json._method, 'POST');
    assert.equal(item.json._url, 'https://api.notion.com/v1/pages');
    const body = item.json._notionBody;
    assert.equal(body.parent.database_id, 'scout-db-04');
    assert.equal(body.properties.Name.title[0].text.content, 'northstar_ops');
    assert.equal(body.properties['Warmth tier'].select.name, 'Tier 1 (hot)');
    assert.equal(body.properties.Status.select.name, 'Engaged');
    assert.equal(body.properties.Source.select.name, 'HubSpot Community');
    assert.equal(
      body.properties['Source URL'].url,
      'https://community.hubspot.com/t/revops-data-hub/12345'
    );
    assert.equal(body.properties['Last touch'].date.start, '2026-08-26');
  });

  test('leaves persona and track Unknown because nothing classified the row', async () => {
    const [item] = await decideAndBuild(UNMATCHED);
    assert.equal(item.json._notionBody.properties['Persona type'].select.name, 'Unknown');
    assert.equal(item.json._notionBody.properties.Track.select.name, 'Unknown');
  });

  test('stores no email address on the created row', async () => {
    const [item] = await decideAndBuild(UNMATCHED);
    assert.ok(!JSON.stringify(item.json._notionBody).includes('@'));
  });

  test('pairs each Notion response with its own notification', async () => {
    const second = {
      json: {
        id: 'gmail-message-3',
        subject: 'ops_lead replied to "Reporting rebuild"',
        snippet: 'Reply in thread.',
        text: 'ops_lead replied on the thread https://community.hubspot.com/t/revops-data-hub/67890/2'
      }
    };
    const out = await decideAndBuild(
      [{ json: { results: [{ id: 'page-001' }] } }, { json: { results: [] } }],
      [COMMUNITY_NOTIFICATION, second]
    );
    assert.equal(out.length, 2);
    assert.equal(out[0].json.topicUrl, 'https://community.hubspot.com/t/revops-data-hub/12345');
    assert.equal(out[1].json.topicUrl, 'https://community.hubspot.com/t/revops-data-hub/67890');
    assert.equal(out[1].json._notionBody.properties.Name.title[0].text.content, 'ops_lead');
  });
});

describe('Scout 04 keeps mail content out of Notion', () => {
  const UNMATCHED = [{ json: { results: [] } }];

  // Every field carries a token that appears nowhere else, so any leak into the
  // request body is a substring match rather than a judgement call. The display
  // name is deliberately a plain value, because the name is the one thing the
  // row is allowed to carry.
  const TOKENS = {
    id: 'ZQXGMAILIDTOKEN',
    threadId: 'ZQXTHREADIDTOKEN',
    from: 'ZQXSENDERTOKEN@notifications.hubspot.example',
    subject: 'ZQXSUBJECTTOKEN quarterly pipeline numbers',
    snippet: 'ZQXSNIPPETTOKEN a private note from the notification preview',
    body: 'ZQXBODYTOKEN the full message body of the notification'
  };

  const LEAKY_NOTIFICATION = {
    json: {
      ...TOKENS,
      text: 'northstar_ops replied on the thread https://community.hubspot.com/t/revops-data-hub/12345/3'
    }
  };

  // No name precedes a reply verb, so the parser finds no display name and the
  // create path has to fall back.
  const ANONYMOUS_NOTIFICATION = {
    json: {
      id: 'ZQXANONIDTOKEN',
      subject: 'ZQXANONSUBJECTTOKEN new activity on a thread you follow',
      snippet: 'ZQXANONSNIPPETTOKEN open the thread to see it.',
      text: 'New activity is waiting on https://community.hubspot.com/t/revops-data-hub/24680/1'
    }
  };

  test('the parser emits only the topic link and a display name', async () => {
    const [item] = await parseNotifications([LEAKY_NOTIFICATION]);
    assert.deepEqual(Object.keys(item.json).sort(), ['replier', 'topicId', 'topicUrl']);
  });

  test('no subject, snippet, body, message id or address reaches the request body', async () => {
    const [item] = await decideAndBuild(UNMATCHED, [LEAKY_NOTIFICATION]);
    const serialized = JSON.stringify(item.json._notionBody);
    for (const token of ['ZQXGMAILIDTOKEN', 'ZQXTHREADIDTOKEN', 'ZQXSENDERTOKEN', 'ZQXSUBJECTTOKEN', 'ZQXSNIPPETTOKEN', 'ZQXBODYTOKEN']) {
      assert.ok(!serialized.includes(token), `${token} must not reach the Notion request body`);
    }
    assert.ok(!serialized.includes('@'), 'no address may reach the Notion request body');
  });

  test('Signal is fixed neutral text, not a quote from the mail', async () => {
    const [item] = await decideAndBuild(UNMATCHED, [LEAKY_NOTIFICATION]);
    assert.equal(
      item.json._notionBody.properties.Signal.rich_text[0].text.content,
      'Inbound HubSpot Community engagement'
    );
  });

  test('the topic URL is still stored', async () => {
    const [item] = await decideAndBuild(UNMATCHED, [LEAKY_NOTIFICATION]);
    assert.equal(
      item.json._notionBody.properties['Source URL'].url,
      'https://community.hubspot.com/t/revops-data-hub/12345'
    );
  });

  test('an unreadable display name falls back to a neutral label, not the subject', async () => {
    const [item] = await decideAndBuild(UNMATCHED, [ANONYMOUS_NOTIFICATION]);
    const name = item.json._notionBody.properties.Name.title[0].text.content;
    assert.equal(name, 'HubSpot Community participant');
    const serialized = JSON.stringify(item.json._notionBody);
    for (const token of ['ZQXANONIDTOKEN', 'ZQXANONSUBJECTTOKEN', 'ZQXANONSNIPPETTOKEN']) {
      assert.ok(!serialized.includes(token), `${token} must not reach the Notion request body`);
    }
  });

  test('the create path builds its body from a fixed set of properties', async () => {
    const [item] = await decideAndBuild(UNMATCHED, [LEAKY_NOTIFICATION]);
    assert.deepEqual(Object.keys(item.json._notionBody.properties).sort(), [
      'Evidence',
      'Last touch',
      'Name',
      'Next action',
      'Persona type',
      'Replied',
      'Signal',
      'Source',
      'Source URL',
      'Status',
      'Track',
      'Warmth tier'
    ]);
  });
});

/* ================================================================== */
/* Scout 05: draft backfill                                            */
/* ================================================================== */

const SETUP_05 = {
  notionDatabaseId: 'scout-db-05',
  anthropicModel: 'claude-haiku-4-5-20251001',
  batchSize: 5
};

function setup05(overrides = {}) {
  return [{ json: { ...SETUP_05, ...overrides } }];
}

function prepRows(overrides = {}) {
  return executeCodeNode({
    workflow: wf05,
    nodeName: 'Prep Rows',
    inputItems: [{ json: openSignals }],
    nodeOutputs: { 'Scout Setup': setup05(overrides) },
    now: NOW
  });
}

async function buildPatch(responses, overrides = {}) {
  const prepped = await prepRows(overrides);
  return executeCodeNode({
    workflow: wf05,
    nodeName: 'Build Patch',
    inputItems: responses,
    nodeOutputs: { 'Scout Setup': setup05(overrides), 'Prep Rows': prepped },
    now: NOW
  });
}

describe('Scout 05 setup validation', () => {
  function validate05(overrides) {
    return executeCodeNode({
      workflow: wf05,
      nodeName: 'Validate Setup',
      nodeOutputs: { 'Scout Setup': setup05(overrides) },
      now: NOW
    });
  }

  test('passes with a complete configuration', async () => {
    const [item] = await validate05({});
    assert.equal(item.json.batchSize, 5);
  });

  test('rejects a batch size outside 1 to 50', async () => {
    for (const size of [0, 51, 12.5, -1, 'lots']) {
      await assert.rejects(
        validate05({ batchSize: size }),
        /batchSize must be a whole number from 1 to 50/,
        `expected ${size} to be rejected`
      );
    }
  });

  test('accepts the boundaries', async () => {
    assert.equal((await validate05({ batchSize: 1 }))[0].json.batchSize, 1);
    assert.equal((await validate05({ batchSize: 50 }))[0].json.batchSize, 50);
  });
});

describe('Scout 05 row selection', () => {
  test('drafts only for rows a human would actually write to', async () => {
    const prepped = await prepRows();
    assert.deepEqual(
      prepped.map((i) => i.json.pageId),
      ['page-001', 'page-002', 'page-004', 'page-006', 'page-007']
    );
    assert.ok(prepped.every((i) => ['Comment', 'DM', 'Connect'].includes(i.json.action)));
  });

  test('batchSize caps how many model calls a run can make', async () => {
    const prepped = await prepRows({ batchSize: 2 });
    assert.equal(prepped.length, 2);
  });

  test('sends the model id from Scout Setup', async () => {
    const prepped = await prepRows({ anthropicModel: 'some-other-model' });
    assert.ok(prepped.every((i) => i.json._anthropicBody.model === 'some-other-model'));
  });

  test('describes the pain area using the public property name', async () => {
    const [first] = await prepRows();
    const content = first.json._anthropicBody.messages[0].content;
    assert.ok(content.includes('PAIN AREA: Dedupe, Lifecycle'));
  });
});

describe('Scout 05 malformed model response', () => {
  test('writes the draft when the model returns usable text', async () => {
    const [item] = await buildPatch([anthropicText('Which write lands last?')], { batchSize: 1 });
    assert.equal(item.json.draftReady, true);
    assert.equal(item.json._url, 'https://api.notion.com/v1/pages/page-001');
    assert.deepEqual(item.json._notionBody, {
      properties: { Draft: { rich_text: [{ text: { content: 'Which write lands last?' } }] } }
    });
  });

  test('leaves the row unchanged and emits Needs review when the response is empty', async () => {
    const [item] = await buildPatch([{ json: { content: [] } }], { batchSize: 1 });
    assert.equal(item.json.draftReady, false);
    assert.equal(item.json.status, 'Needs review');
    assert.equal(item.json.pageId, 'page-001');
    assert.equal('_url' in item.json, false, 'no Notion request may be built');
    assert.equal('_notionBody' in item.json, false, 'the row must be left unchanged');
  });

  test('treats an error payload the same way', async () => {
    const [item] = await buildPatch([{ json: { error: { type: 'overloaded_error' } } }], {
      batchSize: 1
    });
    assert.equal(item.json.draftReady, false);
    assert.equal(item.json.status, 'Needs review');
  });

  test('names the row and the reason so nothing fails silently', async () => {
    const [item] = await buildPatch([{ json: { content: [] } }], { batchSize: 1 });
    assert.equal(item.json.name, 'northstar_ops');
    assert.match(item.json.reason, /left unchanged/);
  });

  test('one bad response does not block the good ones beside it', async () => {
    const out = await buildPatch([{ json: { content: [] } }, anthropicText('Useful reply.')], {
      batchSize: 2
    });
    assert.deepEqual(out.map((i) => i.json.draftReady), [false, true]);
    assert.equal(out[1].json._url, 'https://api.notion.com/v1/pages/page-002');
  });

  test('routes needs-review items away from the Notion write', () => {
    const branches = wf05.connections['Draft Ready?'].main;
    assert.deepEqual(branches[0].map((c) => c.node), ['Write Draft']);
    assert.deepEqual(branches[1].map((c) => c.node), ['Needs Review']);
  });

  test('caps the drafted text at 1900 characters', async () => {
    const [item] = await buildPatch([anthropicText('x'.repeat(2500))], { batchSize: 1 });
    assert.equal(item.json._notionBody.properties.Draft.rich_text[0].text.content.length, 1900);
  });
});

/* ================================================================== */
/* Scout 06: weekly scorecard                                          */
/* ================================================================== */

const WEEKLY_TARGETS = { newSignals: 10, tier2Plus: 4, replies: 1, scanOrDemo: 1 };
const SETUP_06 = {
  notionDatabaseId: 'scout-db-06',
  recipientEmail: 'operator@example.com',
  weeklyTargets: WEEKLY_TARGETS
};

function setup06(overrides = {}) {
  return [{ json: { ...SETUP_06, ...overrides } }];
}

function scorecard(created, touched, overrides = {}) {
  return executeCodeNode({
    workflow: wf06,
    nodeName: 'Compute Scorecard',
    inputItems: [{ json: {} }],
    nodeOutputs: {
      'Scout Setup': setup06(overrides),
      'Query New This Week': [{ json: { results: created } }],
      'Query Touched This Week': [{ json: { results: touched } }]
    },
    now: NOW
  });
}

describe('Scout 06 setup validation', () => {
  function validate06(overrides) {
    return executeCodeNode({
      workflow: wf06,
      nodeName: 'Validate Setup',
      nodeOutputs: { 'Scout Setup': setup06(overrides) },
      now: NOW
    });
  }

  test('passes with a complete configuration', async () => {
    const [item] = await validate06({});
    assert.equal(item.json.validated, true);
  });

  test('rejects an empty or malformed recipient', async () => {
    await assert.rejects(validate06({ recipientEmail: '' }), /recipientEmail is empty/);
    await assert.rejects(validate06({ recipientEmail: 'nope' }), /does not look like an email/);
  });

  test('rejects a non-integer target', async () => {
    await assert.rejects(
      validate06({ weeklyTargets: { ...WEEKLY_TARGETS, newSignals: 'lots' } }),
      /weeklyTargets\.newSignals must be a whole number from 0 to 1000/
    );
  });

  test('allows a target of zero for an operator who does not want scoring', async () => {
    const [item] = await validate06({
      weeklyTargets: { newSignals: 0, tier2Plus: 0, replies: 0, scanOrDemo: 0 }
    });
    assert.equal(item.json.validated, true);
  });
});

describe('Scout 06 weekly counts', () => {
  test('counts the week from both Notion queries', async () => {
    const [out] = await scorecard(openSignals.results, openSignals.results);
    assert.equal(out.json.quietWeek, false);
    assert.equal(out.json.newCount, 7);
    assert.equal(out.json.tier1, 2);
    assert.equal(out.json.tier2, 2);
    assert.equal(out.json.tier2Plus, 4);
    assert.equal(out.json.replies, 2);
    assert.equal(out.json.scanOrDemo, 1);
    assert.equal(out.json.inConversation, 1);
  });

  test('compares against the targets from Scout Setup', async () => {
    const [out] = await scorecard(openSignals.results, openSignals.results, {
      weeklyTargets: { newSignals: 99, tier2Plus: 0, replies: 0, scanOrDemo: 0 }
    });
    assert.ok(out.json.html.includes('<td style="text-align:right;color:#888">99</td>'));
  });

  test('lists the hot signals of the week', async () => {
    const [out] = await scorecard(openSignals.results, openSignals.results);
    assert.ok(out.json.html.includes('northstar_ops'));
  });

  test('sends to the address in Scout Setup rather than a literal one', () => {
    const email = wf06.nodes.find((n) => n.name === 'Email Scorecard');
    assert.match(email.parameters.sendTo, /Scout Setup.*recipientEmail/);
  });
});

describe('Scout 06 zero activity', () => {
  test('reports a quiet week instead of failing', async () => {
    const [out] = await scorecard([], []);
    assert.equal(out.json.quietWeek, true);
    assert.equal(out.json.newCount, 0);
    assert.match(out.json.subject, /no activity/);
    assert.ok(out.json.html.includes('No new signals and no activity on existing rows this week.'));
  });

  test('does not render empty tables on a quiet week', async () => {
    const [out] = await scorecard([], []);
    assert.ok(!out.json.html.includes('<table'));
  });

  test('still names the targets so the week has context', async () => {
    const [out] = await scorecard([], []);
    assert.ok(out.json.html.includes('10 new signals'));
  });

  test('a week with touches but no new rows is not treated as quiet', async () => {
    const [out] = await scorecard([], openSignals.results);
    assert.equal(out.json.quietWeek, false);
    assert.equal(out.json.newCount, 0);
    assert.equal(out.json.replies, 2);
  });
});

describe('Scout 06 email safety', () => {
  test('escapes every HTML metacharacter that arrives from Notion', async () => {
    const [out] = await scorecard(openSignals.results, openSignals.results);
    const html = out.json.html;
    assert.ok(html.includes('Ops &amp; &quot;Data&quot; &lt;team&gt; won&#39;t wait'));
    assert.ok(!html.includes('<team>'));
  });

  test('refuses to link a URL that is not http or https', async () => {
    const [out] = await scorecard(openSignals.results, openSignals.results);
    assert.ok(!out.json.html.includes('javascript:'));
  });

  test('links an ordinary http URL', async () => {
    const [out] = await scorecard(openSignals.results, openSignals.results);
    assert.ok(out.json.html.includes('<a href="https://example.com/community/post-001">'));
  });
});

/* ================================================================== */
/* URL parsing without the URL global                                   */
/* ================================================================== */

describe('Scout parses URLs the way n8n can actually run', () => {
  // Every case here runs against the shipped `parseHttpUrl`, inlined into each
  // Code node, under a sandbox that withholds `URL` exactly as n8n does.

  function feeds(list) {
    return executeCodeNode({
      workflow: wf01,
      nodeName: 'Validate Setup',
      inputItems: [{ json: {} }],
      nodeOutputs: {
        'Scout Setup': setupOutput({
          notionDatabaseId: 'synthetic-database-id',
          hubspotCommunityFeeds: list
        })
      },
      now: NOW
    });
  }

  describe('workflow 01 feed rules survive the rewrite', () => {
    for (const feed of SETUP.hubspotCommunityFeeds) {
      const label = feed.slice(feed.indexOf('/c/'));
      test(`accepts the shipped feed ${label}`, async () => {
        const out = await feeds([feed]);
        assert.equal(out[0].json.validated, true);
        assert.equal(out[0].json.feedCount, 1);
      });
    }

    test('accepts a feed carrying a query string and fragment', async () => {
      const out = await feeds(['https://community.hubspot.com/c/x/64.rss?page=2#top']);
      assert.equal(out[0].json.validated, true);
    });

    const REJECTED = {
      'a relative path': ['/c/revops-data-hub/64.rss', /is not an absolute URL/],
      'a scheme-relative URL': ['//community.hubspot.com/x.rss', /is not an absolute URL/],
      'a non-http scheme': ['ftp://community.hubspot.com/x.rss', /is not an absolute URL/],
      'an empty authority': ['https:///x.rss', /is not an absolute URL/],
      'a missing authority': ['https://', /is not an absolute URL/],
      'an embedded space': ['https://community.hubspot.com/a b.rss', /is not an absolute URL/],
      'a tab character': ['https://community.hubspot.com/a\tb.rss', /is not an absolute URL/],
      'a newline': ['https://community.hubspot.com/a\nb.rss', /is not an absolute URL/],
      'plain http': ['http://community.hubspot.com/x.rss', /must use https/],
      'embedded credentials': ['https://user:pw@community.hubspot.com/x.rss', /must not embed a username or password/],
      'a bare username': ['https://user@community.hubspot.com/x.rss', /must not embed a username or password/],
      'a subdomain': ['https://feeds.community.hubspot.com/x.rss', /must be hosted on community\.hubspot\.com/],
      'a suffixed lookalike host': ['https://community.hubspot.com.evil.example/x.rss', /must be hosted on community\.hubspot\.com/],
      'a prefixed lookalike host': ['https://notcommunity.hubspot.com/x.rss', /must be hosted on community\.hubspot\.com/],
      'a non-rss path': ['https://community.hubspot.com/c/revops-data-hub/64', /must point at a \.rss path/]
    };

    for (const [label, [feed, expected]] of Object.entries(REJECTED)) {
      test(`rejects ${label}`, async () => {
        await assert.rejects(feeds([feed]), expected);
      });
    }

    test('rejects backslash authority confusion', async () => {
      // A backslash reads as "/" in a browser, so this string can name one host
      // to a browser and another to a parser that treats it literally. Scout
      // refuses it rather than choosing an interpretation.
      await assert.rejects(
        feeds(['https://community.hubspot.com\\@evil.example/x.rss']),
        /is not an absolute URL/
      );
    });

    test('does not mistake a port for part of the hostname', async () => {
      // The host is exactly community.hubspot.com; the port must not make it
      // look like a different host, in either direction.
      const out = await feeds(['https://community.hubspot.com:8443/c/x/64.rss']);
      assert.equal(out[0].json.validated, true);
      await assert.rejects(
        feeds(['https://community.hubspot.com:notaport/c/x/64.rss']),
        /is not an absolute URL/
      );
    });
  });

  describe('workflow 02 keeps its optional-URL contract', () => {
    test('accepts an ordinary https URL and stores it unchanged', async () => {
      const [item] = await validate02(formItem({ URL: 'https://example.com/a/b?c=1#d' }));
      assert.equal(item.json.url, 'https://example.com/a/b?c=1#d');
    });

    test('accepts an ordinary http URL', async () => {
      const [item] = await validate02(formItem({ URL: 'http://example.com/x' }));
      assert.equal(item.json.url, 'http://example.com/x');
    });

    test('keeps the scheme complaint distinct from the malformed complaint', async () => {
      for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,x', 'ftp://example.com/x']) {
        await assert.rejects(validate02(formItem({ URL: url })), /URL must use http or https/, url);
      }
      for (const url of ['community.example.com/post', '/relative', 'https://', 'https://exa mple.com/']) {
        await assert.rejects(validate02(formItem({ URL: url })), /URL is not a valid absolute URL/, url);
      }
    });

    test('rejects backslash authority confusion', async () => {
      await assert.rejects(
        validate02(formItem({ URL: 'https://example.com\\@evil.example/' })),
        /URL is not a valid absolute URL/
      );
    });

    test('still treats the URL as optional', async () => {
      const [item] = await validate02(formItem({ URL: '' }));
      assert.equal(item.json.url, '');
    });
  });

  describe('digest links survive in workflows 03 and 06', () => {
    // The regression that prompted this: safeHref returned '' for every value,
    // so operators received digests with every link silently removed and no
    // error anywhere.
    function withUrl(url) {
      return openSignals.results.map((row) => ({
        ...row,
        properties: { ...row.properties, 'Source URL': { url } }
      }));
    }

    const SAFE = 'https://community.hubspot.com/t/topic/12345';

    test('workflow 03 links an ordinary https URL', async () => {
      const [out] = await computeStale(withUrl(SAFE));
      assert.ok(out.json.html.includes(`<a href="${SAFE}"`), 'a safe link must survive');
    });

    test('workflow 06 links an ordinary https URL', async () => {
      const [out] = await scorecard(withUrl(SAFE), withUrl(SAFE));
      assert.ok(out.json.html.includes(`<a href="${SAFE}"`), 'a safe link must survive');
    });

    for (const [label, url] of Object.entries({
      'a script URL': 'javascript:alert(1)',
      'a data URL': 'data:text/html,<script>x</script>',
      'a relative path': '/community/post-001',
      'a backslash-confused authority': 'https://good.example\\@evil.example/'
    })) {
      test(`workflow 03 refuses to link ${label}`, async () => {
        const [out] = await computeStale(withUrl(url));
        assert.ok(!/<a href="(?!https?:)/.test(out.json.html), `${label} must not become an anchor`);
        assert.ok(!out.json.html.includes('javascript:'));
      });

      test(`workflow 06 refuses to link ${label}`, async () => {
        const [out] = await scorecard(withUrl(url), withUrl(url));
        assert.ok(!/<a href="(?!https?:)/.test(out.json.html), `${label} must not become an anchor`);
        assert.ok(!out.json.html.includes('javascript:'));
      });
    }

    test('escapes a quote inside the href so it cannot break out of the attribute', async () => {
      const hostile = 'https://example.com/a"onmouseover="alert(1)';
      const [out] = await computeStale(withUrl(hostile));
      assert.ok(!out.json.html.includes('onmouseover="alert'), 'the attribute must not break out');
      assert.ok(out.json.html.includes('&quot;'), 'the quote must be escaped, not dropped');
    });
  });
});

/* ================================================================== */
/* Scout 03 subject line agreement                                      */
/* ================================================================== */

describe('Scout 03 subject agrees in number', () => {
  // The live run produced "1 signal need attention". The noun was pluralised
  // and the verb was not, so the singular case read as broken English in the
  // one place an operator sees before opening anything.

  // A minimal stale row: past its window, draftable action, not closed.
  function staleRow(id) {
    return {
      object: 'page',
      id,
      created_time: '2026-08-01T09:00:00.000Z',
      properties: {
        Name: { title: [{ plain_text: `synthetic_${id}` }] },
        Signal: { rich_text: [{ plain_text: 'Synthetic stale signal for subject testing.' }] },
        'Warmth tier': { select: { name: 'Tier 2 (warm)' } },
        'Next action': { select: { name: 'Comment' } },
        Status: { select: { name: 'New' } },
        'Source URL': { url: 'https://community.hubspot.com/t/synthetic/1' },
        'Last touch': { date: null }
      }
    };
  }

  test('one stale row reads "1 signal needs attention"', async () => {
    const [out] = await computeStale([staleRow('row-1')]);
    assert.equal(out.json.staleCount, 1);
    assert.equal(out.json.subject, 'Scout: 1 signal needs attention');
  });

  for (const n of [2, 3, 7]) {
    test(`${n} stale rows read "${n} signals need attention"`, async () => {
      const rows = Array.from({ length: n }, (_, i) => staleRow(`row-${i + 1}`));
      const [out] = await computeStale(rows);
      assert.equal(out.json.staleCount, n);
      assert.equal(out.json.subject, `Scout: ${n} signals need attention`);
    });
  }

  test('never emits the ungrammatical singular the live run produced', async () => {
    const [out] = await computeStale([staleRow('row-1')]);
    assert.ok(
      !/\b1 signal need attention\b/.test(out.json.subject),
      'the singular must not use the plural verb'
    );
    assert.ok(
      !/\bsignals needs\b/.test(out.json.subject),
      'the plural must not use the singular verb'
    );
  });

  test('the shipped code contains no split noun-verb construction', () => {
    // The original bug was pluralising the noun inline while leaving the verb
    // fixed. Asserting on the source stops that shape returning in another form.
    const code = wf03.nodes.find((n) => n.name === 'Compute Stale').parameters.jsCode;
    assert.ok(
      !/' signal' \+ \(/.test(code),
      'the subject must not be assembled by pluralising the noun alone'
    );
    assert.ok(code.includes('signal needs attention'), 'the singular phrasing must be present');
    assert.ok(code.includes('signals need attention'), 'the plural phrasing must be present');
  });
});

/* ================================================================== */
/* Sticky notes must be tall enough to show their content              */
/* ================================================================== */

describe('Scout 01 sticky notes are not truncated on the canvas', () => {
  // The first hero screenshot caught this: the setup note was 640x340 while its
  // content needed 448px to render, so n8n clipped roughly 110px with
  // overflow:hidden. No error, no warning, just missing instructions on the one
  // note that tells a new user how to configure the template.
  const stickies = wf01.nodes.filter((n) => n.type === 'n8n-nodes-base.stickyNote');

  /**
   * Conservative estimate of the height n8n needs to render a sticky's markdown
   * at its configured width. Deliberately pessimistic: it is better to demand
   * too much height than to ship a clipped note.
   */
  function estimateHeight({ content, width }) {
    const charsPerLine = Math.floor(width / 7.2);
    let lines = 0;
    for (const raw of String(content).split('\n')) {
      const line = raw.replace(/[*_`#]/g, '');
      if (line.trim() === '') { lines += 0.5; continue; }
      // List items wrap into a narrower column because of their indent.
      const indented = /^\s*(\d+\.|[-*])\s/.test(line);
      const usable = indented ? charsPerLine - 6 : charsPerLine;
      lines += Math.max(1, Math.ceil(line.length / usable));
    }
    return Math.ceil(lines * 18) + 54; // line height plus heading and padding
  }

  test('every sticky note is at least as tall as its content needs', () => {
    for (const note of stickies) {
      const needed = estimateHeight(note.parameters);
      assert.ok(
        note.parameters.height >= needed,
        `"${note.name}" is ${note.parameters.height}px tall but needs about ${needed}px at ${note.parameters.width}px wide`
      );
    }
  });

  test('the setup note carries slack, not a hairline fit', () => {
    // Measured in a real n8n 2.36.8 canvas, this note's content rendered to
    // scrollHeight 448 against clientHeight 338. Sitting exactly at the measured
    // height would re-truncate the moment a word is added or a font changes.
    const note = stickies.find((n) => n.name === 'Configure before running');
    assert.ok(note, 'the setup note must exist');
    assert.ok(
      note.parameters.height >= 470,
      `the setup note rendered to 448px in n8n and must keep headroom above that, got ${note.parameters.height}`
    );
  });

  test('no setup instruction was removed to make the note fit', () => {
    const note = stickies.find((n) => n.name === 'Configure before running');
    for (const instruction of [
      'Scout Setup',
      'Notion database id',
      'HTTP Header Auth',
      'lookbackHours',
      'maxPostsPerFeed',
      'hubspotCommunityFeeds',
      '.rss',
      'UTC'
    ]) {
      assert.ok(
        note.parameters.content.includes(instruction),
        `the setup note must still mention ${instruction}`
      );
    }
    assert.ok(note.parameters.content.length >= 880, 'the note must not have been trimmed to fit');
  });
});
