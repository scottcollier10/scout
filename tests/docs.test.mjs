/**
 * Documentation tests.
 *
 * The README and docs make claims about what Scout is allowed to do. Those
 * claims are part of the product, not decoration, so they are asserted here the
 * same way workflow behavior is. Several tests read the workflow JSON directly,
 * so the reference documentation cannot drift away from the shipped files.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function read(relative) {
  return readFile(path.join(ROOT, relative), 'utf8');
}

async function loadJson(relative) {
  return JSON.parse(await read(relative));
}

const README = await read('README.md');
const CONTRIBUTING = await read('CONTRIBUTING.md');
const SECURITY = await read('SECURITY.md');
const CHANGELOG = await read('CHANGELOG.md');
const ARCHITECTURE = await read('docs/architecture.md');
const SETUP = await read('docs/setup.md');
const NOTION_SCHEMA = await read('docs/notion-schema.md');
const SOURCE_POLICY = await read('docs/source-policy.md');
const WORKFLOW_REFERENCE = await read('docs/workflow-reference.md');
const DECISION_LOG = await read('docs/decision-log.md');
const RELEASE_CHECKLIST = await read('docs/release-checklist.md');
const LIVE_VERIFICATION = await read('docs/live-verification.md');
const N8N_SUBMISSION = await read('docs/n8n-submission.md');
const EXAMPLES_README = await read('examples/README.md');
const CI_WORKFLOW = await read('.github/workflows/ci.yml');
const GITLEAKS_CONFIG = await read('.gitleaks.toml');
const PACKAGE_JSON = await read('package.json');

/** Every prose file the release ships, keyed by repository-relative path. */
const ALL_DOCS = {
  'README.md': README,
  'CONTRIBUTING.md': CONTRIBUTING,
  'SECURITY.md': SECURITY,
  'CHANGELOG.md': CHANGELOG,
  'docs/architecture.md': ARCHITECTURE,
  'docs/setup.md': SETUP,
  'docs/notion-schema.md': NOTION_SCHEMA,
  'docs/source-policy.md': SOURCE_POLICY,
  'docs/workflow-reference.md': WORKFLOW_REFERENCE,
  'docs/decision-log.md': DECISION_LOG,
  'docs/release-checklist.md': RELEASE_CHECKLIST,
  'docs/live-verification.md': LIVE_VERIFICATION,
  'docs/n8n-submission.md': N8N_SUBMISSION,
  'examples/README.md': EXAMPLES_README
};

const WORKFLOW_FILES = [
  'workflows/core/01-hubspot-community-signals.json',
  'workflows/core/02-manual-signal-intake.json',
  'workflows/core/03-stale-signal-nudge.json',
  'workflows/extensions/04-community-engagement-sync.json',
  'workflows/extensions/05-draft-backfill.json',
  'workflows/extensions/06-weekly-scorecard.json'
];

const WORKFLOWS = Object.fromEntries(
  await Promise.all(WORKFLOW_FILES.map(async (f) => [f, await loadJson(f)]))
);

const TAGLINE = 'Turn HubSpot Community questions into prioritized RevOps follow-up.';

/* ================================================================== */
/* README                                                              */
/* ================================================================== */

describe('README contract', () => {
  test('leads with the exact public tagline', () => {
    assert.ok(README.includes(TAGLINE), 'README must carry the approved tagline verbatim');
  });

  test('carries every required section heading', () => {
    for (const heading of [
      'What Scout does',
      'Quickstart',
      'How the six workflows fit together',
      'Requirements',
      'Human review and source limits'
    ]) {
      assert.match(README, new RegExp(`^#{2,3} ${heading}\\s*$`, 'm'), `missing heading: ${heading}`);
    }
  });

  test('links to every document the release ships', () => {
    for (const target of [
      'docs/architecture.md',
      'docs/setup.md',
      'docs/notion-schema.md',
      'docs/source-policy.md',
      'docs/workflow-reference.md',
      'docs/decision-log.md',
      'examples/README.md',
      'CONTRIBUTING.md',
      'SECURITY.md',
      'CHANGELOG.md'
    ]) {
      assert.ok(README.includes(`(${target})`), `README must link to ${target}`);
    }
  });

  test('names every shipped workflow file', () => {
    for (const file of WORKFLOW_FILES) {
      assert.ok(README.includes(file), `README must name ${file}`);
    }
  });

  test('never mentions SignalFlow', () => {
    for (const [name, text] of Object.entries(ALL_DOCS)) {
      assert.ok(!/signalflow/i.test(text), `${name} must not reference SignalFlow`);
    }
  });

  test('quickstart uses workflow 01 only and runs manually before activating', () => {
    const quickstart = README.split(/^#{2,3} Quickstart\s*$/m)[1].split(/^#{2,3} /m)[0];
    assert.ok(
      !/02-manual|03-stale|04-community|05-draft|06-weekly/.test(quickstart),
      'the quickstart must require only workflow 01'
    );
    const manualRun = quickstart.search(/run it manually|run manually/i);
    const activate = quickstart.search(/activate/i);
    assert.ok(manualRun !== -1, 'quickstart must tell the reader to run manually first');
    assert.ok(activate !== -1, 'quickstart must cover activation');
    assert.ok(manualRun < activate, 'the manual run must come before activation');
  });

  test('promises no setup duration', () => {
    assert.ok(
      !/in (under |about |roughly )?\d+\s*(minutes?|mins?|hours?)/i.test(README),
      'setup time has not been measured, so the README must not promise one'
    );
  });
});

describe('README makes no unsupported claim', () => {
  const FORBIDDEN_CLAIMS = [
    /production[-\s]ready/i,
    /enterprise[-\s]grade/i,
    /battle[-\s]tested/i,
    /fully tested/i,
    /guaranteed/i,
    /secure by (default|design)/i,
    /legally (approved|cleared|compliant)/i,
    /complies with/i,
    /approved by (hubspot|linkedin|notion|anthropic)/i,
    /any rss feed/i,
    /arbitrary (rss|feed|source)/i,
    /works with any/i,
    /100%/
  ];

  test('claims no production readiness, security guarantee, or legal approval', () => {
    for (const pattern of FORBIDDEN_CLAIMS) {
      for (const [name, text] of Object.entries(ALL_DOCS)) {
        assert.ok(!pattern.test(text), `${name} contains an unsupported claim matching ${pattern}`);
      }
    }
  });

  test('claims no compatibility with sources other than HubSpot Community RSS', () => {
    assert.match(
      README,
      /HubSpot Community RSS/,
      'the README must name the one automated source'
    );
    assert.ok(
      !/(reddit|linkedin|twitter|x\.com|slack|discord) (feed|connector|integration|source) is supported/i.test(README),
      'no other automated source may be advertised'
    );
  });

  test('claims no live execution, delivery, or production use', () => {
    // Fresh-instance acceptance, the bounded live checks recorded in
    // live-verification.md, and Workflow 01's v0.1.1 Editor import are earned.
    // Everything below remains unearned: no mail has been delivered, nobody
    // has run Scout in production, and the full system is not verified.
    const UNEARNED = [
      /(tested|verified|checked) against the (notion|anthropic|gmail) api/i,
      /(notion|anthropic|gmail) api (was|has been) (called|tested|verified)/i,
      /(email|digest|notification) (was|were|has been|have been) (sent|delivered|received)/i,
      /confirmed working/i,
      /(has|have) been run in production/i,
      /(is|are) production[- ]ready/i,
      /we ran it against/i,
      /(is|has been|was) fully verified/i,
      /end[- ]to[- ]end (test|verif)/i
    ];
    // Checked line by line, because these documents have to be able to *deny*
    // each claim in words, and "No email has been sent" contains the phrase it
    // is denying. A line that negates is a disclosure, not a boast.
    const DENIAL =
      /\b(not|never|no|none|nothing|neither|nor|without|cannot|unverified|has yet to|have yet to)\b/i;
    for (const [name, text] of Object.entries(ALL_DOCS)) {
      for (const line of text.split('\n')) {
        if (DENIAL.test(line)) continue;
        for (const pattern of UNEARNED) {
          assert.ok(
            !pattern.test(line),
            `${name} claims a verification that has not happened: ${pattern}\n  ${line.trim()}`
          );
        }
      }
    }
  });

  test('states plainly that live execution is still unverified', () => {
    assert.match(
      README,
      /^#{2,3} Verification status\s*$/m,
      'the README must have a verification status section'
    );
    assert.match(README, /not (yet )?been (verified|checked)|not yet verified|unverified/i);
    assert.match(
      README,
      /Import through the Editor UI in a browser \| Verified for Workflow 01 on v0\.1\.2 in n8n `2\.36\.9`; not separately tested for workflows 02 through 06/,
      'the README must scope the Editor UI evidence to the workflow that was exercised'
    );
  });
});

describe('documentation vocabulary', () => {
  // The release copy may name these behaviors only to say Scout does not do
  // them. Used approvingly they would describe a different product.
  const RESTRICTED = ['scrape', 'scraping', 'scraper', 'harvest', 'prospect database', 'autonomous outreach', 'growth hack', 'AI agent'];
  const NEGATION = /\b(not|never|no|without|nor|prohibit\w*|restrict\w*|forbid\w*|out of scope|excluded|avoid\w*|instead of|rather than)\b/i;

  test('restricted terms appear only where Scout is ruling the behavior out', () => {
    for (const [name, text] of Object.entries(ALL_DOCS)) {
      for (const term of RESTRICTED) {
        const pattern = new RegExp(term.replace(/ /g, '\\s+'), 'i');
        for (const line of text.split('\n')) {
          if (!pattern.test(line)) continue;
          assert.ok(
            NEGATION.test(line),
            `${name}: "${term}" must only appear in a sentence ruling it out, got: ${line.trim()}`
          );
        }
      }
    }
  });

  test('describes drafts as suggestions rather than sent messages', () => {
    assert.match(README, /human review|you review|for you to review/i);
    assert.ok(
      !/(scout|it) (sends|posts|comments|messages|dms) (on your behalf|automatically)/i.test(README)
    );
  });
});

/* ================================================================== */
/* Storage and retention                                               */
/* ================================================================== */

describe('storage and retention are disclosed honestly', () => {
  const N8N_EXECUTION_DOCS =
    'https://docs.n8n.io/deploy/host-n8n/configure-n8n/scaling/manage-execution-data/';

  test('architecture has a storage and retention section', () => {
    assert.match(ARCHITECTURE, /^#{2,3} Storage and retention\s*$/m);
  });

  test('names all three places Scout data comes to rest', () => {
    // Notion is the obvious one. The other two are the ones a reader would
    // otherwise have to discover by inspecting their own instance.
    assert.match(ARCHITECTURE, /Notion holds the durable signal map/i);
    assert.match(ARCHITECTURE, /`Remove Duplicates` node holds seen-post state inside n8n/i);
    assert.match(ARCHITECTURE, /n8n may retain the inputs and outputs of every execution/i);
  });

  test('lists what n8n execution data can contain for Scout specifically', () => {
    // "May retain execution data" tells an operator nothing actionable. The
    // categories are what changes whether they tighten the setting.
    const section = ARCHITECTURE.split(/^#{2,3} Storage and retention\s*$/m)[1].split(/^#{2,3} /m)[0];
    for (const pattern of [
      /RSS content/i,
      /manual form submissions/i,
      /request bodies sent to Anthropic and the responses/i,
      /Notion request and response data/i,
      /Gmail notification data/i
    ]) {
      assert.match(section, pattern, `the retention section must name: ${pattern}`);
    }
  });

  test('says the operator decides retention through execution-data settings', () => {
    assert.match(
      ARCHITECTURE,
      /execution[- ]data settings|execution saving and pruning/i
    );
    assert.match(ARCHITECTURE, /decided by the operator|the operator of the\s+n8n instance/i);
  });

  test('tells operators to review saving and pruning before activating', () => {
    for (const [name, text] of [['docs/architecture.md', ARCHITECTURE], ['docs/setup.md', SETUP], ['README.md', README]]) {
      assert.match(
        text,
        /(review|set|decide) .{0,80}(execution[- ]data|execution saving|saving and pruning)/is,
        `${name} must tell the operator to review execution-data settings`
      );
      assert.match(text, /before .{0,40}activat/is, `${name} must place that review before activation`);
    }
  });

  test('links the official n8n execution-data documentation', () => {
    for (const [name, text] of [['docs/architecture.md', ARCHITECTURE], ['docs/setup.md', SETUP]]) {
      assert.ok(
        text.includes(N8N_EXECUTION_DOCS),
        `${name} must link ${N8N_EXECUTION_DOCS}`
      );
    }
    assert.ok(
      SETUP.includes('https://docs.n8n.io/build/manage-workflows/configure-workflow-settings/'),
      'setup must also link the per-workflow settings page'
    );
  });

  test('makes no claim that Notion is the only storage or that n8n keeps nothing', () => {
    const WITHDRAWN = [
      /Notion is the only place/i,
      /only place Scout (stores|data)/i,
      /the only durable state/i,
      /no state outside/i,
      /n8n (stores|retains|keeps) nothing/i,
      /nothing is (stored|retained|kept) (in|by) n8n/i,
      /no data is (written|stored) to n8n/i
    ];
    for (const pattern of WITHDRAWN) {
      for (const [name, text] of Object.entries(ALL_DOCS)) {
        assert.ok(!pattern.test(text), `${name} still makes a withdrawn storage claim: ${pattern}`);
      }
    }
  });

  test('any remaining no-local-storage statement is scoped to Scout, not to n8n', () => {
    // Scout's own nodes really do write no file. Saying so is fine only if the
    // sentence refuses to be read as a claim about n8n's database.
    const match = ARCHITECTURE.match(/no local database[^.]*\./i);
    if (match) {
      const after = ARCHITECTURE.slice(ARCHITECTURE.indexOf(match[0]) + match[0].length, ARCHITECTURE.indexOf(match[0]) + match[0].length + 240);
      assert.match(
        after,
        /not about n8n's backing store|statement about Scout's nodes/i,
        'a no-local-storage sentence must be immediately qualified'
      );
    }
  });
});

/* ================================================================== */
/* Anthropic boundary                                                  */
/* ================================================================== */

describe('the Anthropic boundary is disclosed in full', () => {
  /** Workflow files that actually contain a request to the Anthropic API. */
  const CALLERS = WORKFLOW_FILES.filter((f) =>
    WORKFLOWS[f].nodes.some((n) => JSON.stringify(n.parameters ?? {}).includes('api.anthropic.com'))
  );

  test('exactly workflows 01, 02, and 05 call Anthropic', () => {
    // Guards the documentation below against a workflow gaining or losing a
    // model call without the prose being updated.
    assert.deepEqual(CALLERS, [
      'workflows/core/01-hubspot-community-signals.json',
      'workflows/core/02-manual-signal-intake.json',
      'workflows/extensions/05-draft-backfill.json'
    ]);
  });

  test('architecture lists the fields each calling workflow sends', () => {
    const section = ARCHITECTURE.split(/^#{2,3} Exactly what Scout sends to Anthropic\s*$/m)[1];
    assert.ok(section, 'architecture must have an Anthropic field-list section');
    const scoped = section.split(/^#{2,3} /m)[0];

    // 01: post content only.
    assert.match(scoped, /post title.{0,80}excerpt.{0,60}board name/is);
    // 02: everything the operator typed about another person.
    for (const field of [/name/i, /company/i, /source label/i, /URL/i, /note/i]) {
      assert.match(scoped, field, `workflow 02's disclosure must name ${field}`);
    }
    // 05: the stored row context used for drafting.
    for (const field of [/next action/i, /`Signal`/, /`Best angle`/, /`Pain area`/, /row title/i]) {
      assert.match(scoped, field, `workflow 05's disclosure must name ${field}`);
    }
  });

  test('states plainly that manual form input about a person is sent to Anthropic', () => {
    for (const [name, text] of [['docs/architecture.md', ARCHITECTURE], ['docs/workflow-reference.md', WORKFLOW_REFERENCE]]) {
      assert.match(
        text,
        /(type|typed|enter|entered)\s.{0,120}another person.{0,200}sent\s+to\s+Anthropic/is,
        `${name} must say manual input about a person is sent to Anthropic`
      );
    }
  });

  test('states that workflow 05 sends stored signal context back out', () => {
    for (const [name, text] of [['docs/architecture.md', ARCHITECTURE], ['docs/workflow-reference.md', WORKFLOW_REFERENCE]]) {
      assert.match(
        text,
        /stored signal context/i,
        `${name} must describe workflow 05's drafting input as stored signal context`
      );
    }
  });

  test('says which workflows make no model request at all', () => {
    assert.match(ARCHITECTURE, /Workflows 03, 04, and 06 make no Anthropic request/i);
    assert.match(WORKFLOW_REFERENCE, /Workflows 03, 04, and 06 make\s+no model request/i);
  });

  test('the workflow reference carries a per-workflow Anthropic row', () => {
    const rows = WORKFLOW_REFERENCE.match(/^\| Sends to Anthropic \|/gm) ?? [];
    assert.equal(rows.length, CALLERS.length, 'one Anthropic disclosure row per calling workflow');
  });
});

/* ================================================================== */
/* Claims that must match the shipped workflows                        */
/* ================================================================== */

describe('behavior claims match the workflow JSON', () => {
  const wf01 = WORKFLOWS['workflows/core/01-hubspot-community-signals.json'];
  const codeOf = (wf, nodeName) => wf.nodes.find((n) => n.name === nodeName).parameters.jsCode;

  test('workflow 01 assigns Comment itself rather than asking the model', () => {
    assert.ok(
      !/next_action/.test(codeOf(wf01, 'Build Claude Request')),
      'workflow 01 must not request a next action from the model'
    );
    assert.ok(
      codeOf(wf01, 'Parse + Map to Notion').includes("'Next action': { select: { name: 'Comment' } }"),
      'workflow 01 must assign Comment in the mapping node'
    );
  });

  test('no document says the model chooses workflow 01 next action', () => {
    for (const [name, text] of Object.entries(ALL_DOCS)) {
      assert.ok(
        !/(claude|the model|anthropic) .{0,40}(picks|chooses|decides|selects|assigns) .{0,40}next action/i.test(text),
        `${name} credits the model with choosing the next action`
      );
    }
  });

  test('the documentation says Scout assigns the next action', () => {
    assert.match(README, /`Next action`[\s\S]{0,120}assigns/i);
    assert.match(
      WORKFLOW_REFERENCE,
      /It is not asked for a next action|assigns `Next action` itself/i
    );
  });

  test('no outreach claim overreaches past the digest emails', () => {
    // Workflows 03 and 06 do send mail, so an unqualified "nothing is sent" is
    // false. The claim that matters is that nothing goes to the signal map.
    for (const [name, text] of Object.entries(ALL_DOCS)) {
      assert.ok(!/\bNothing is sent\b/.test(text), `${name} says "Nothing is sent", which is not true of 03 and 06`);
    }
    assert.match(README, /No outreach is sent/);
    assert.match(README, /Workflows 03 and 06 do send email/i);
  });

  test('the quickstart separates what was run from what was not', () => {
    // Workflow 01 has now been run end to end, so the quickstart may say so.
    // Scheduling and activation have not been exercised, so it must still say
    // that too, and must point at the record rather than assert it alone.
    for (const [name, text] of Object.entries(ALL_DOCS)) {
      assert.ok(!/working signal map/i.test(text), `${name} implies a signal map already observed working`);
    }
    const quickstart = README.split(/^#{2,3} Quickstart\s*$/m)[1].split(/^#{2,3} /m)[0];
    assert.match(
      quickstart,
      /have not been exercised|has not been put on a schedule|nothing has been put on a schedule/i,
      'the quickstart must still disclaim the steps nobody has run'
    );
    assert.ok(
      quickstart.includes('docs/live-verification.md'),
      'the quickstart must point at the verification record'
    );
  });
});

/* ================================================================== */
/* Source scope                                                        */
/* ================================================================== */

describe('the LinkedIn exclusion is scoped to v0.1', () => {
  test('source policy scopes the exclusion to this version', () => {
    assert.match(SOURCE_POLICY, /In v0\.1, LinkedIn automated ingestion is not supported/i);
    assert.match(SOURCE_POLICY, /decision about v0\.1, not a permanent/i);
  });

  test('drops the permanent-exclusion wording', () => {
    const PERMANENT = [
      /will not be added/i,
      /out of scope for future versions/i,
      /no automated LinkedIn ingestion, ever/i,
      /never, in this repository/i
    ];
    for (const pattern of PERMANENT) {
      for (const [name, text] of Object.entries(ALL_DOCS)) {
        assert.ok(!pattern.test(text), `${name} still states the exclusion as permanent: ${pattern}`);
      }
    }
  });

  test('ties any future automated source to an interface and a terms review', () => {
    assert.match(SOURCE_POLICY, /first-party API or RSS interface/i);
    assert.match(SOURCE_POLICY, /separate terms review/i);
    // The LinkedIn section must point at that bar rather than at a flat refusal.
    const linkedin = SOURCE_POLICY.split(/^#{2,3} LinkedIn\s*$/m)[1].split(/^#{2,3} /m)[0];
    assert.match(linkedin, /first-party API or RSS interface/i);
    assert.match(linkedin, /separate terms review/i);
  });

  test('still states that nothing fetches LinkedIn today', () => {
    assert.match(SOURCE_POLICY, /No workflow in this\s+repository fetches, polls, crawls, or retrieves anything from LinkedIn/i);
    for (const [file, wf] of Object.entries(WORKFLOWS)) {
      const text = JSON.stringify(wf).toLowerCase();
      assert.ok(!text.includes('linkedin.com'), `${file} must not reference a LinkedIn host`);
    }
  });
});

/* ================================================================== */
/* Notification privacy                                                */
/* ================================================================== */

describe('the engagement sync stores nothing from the mail body', () => {
  const wf04 = WORKFLOWS['workflows/extensions/04-community-engagement-sync.json'];
  const codeOf = (nodeName) => wf04.nodes.find((n) => n.name === nodeName).parameters.jsCode;

  test('the parser carries no subject or snippet forward', () => {
    // The privacy claim is only true if the fields never leave the parser, so
    // this asserts the shape of what it returns rather than trusting the prose.
    const parser = codeOf('Parse Notification');
    const returned = parser.slice(parser.indexOf('out.push('));
    for (const field of ['subject', 'snippet', 'body', 'mail.id', 'Subject']) {
      assert.ok(
        !returned.includes(field),
        `Parse Notification must not emit ${field}`
      );
    }
  });

  test('the created row uses fixed signal text and a neutral name fallback', () => {
    const decide = codeOf('Decide & Build');
    assert.ok(
      decide.includes("'Inbound HubSpot Community engagement'"),
      'Signal must be a fixed phrase'
    );
    assert.ok(
      decide.includes("'HubSpot Community participant'"),
      'an unreadable display name must fall back to a neutral label'
    );
    assert.ok(
      !/src\.(subject|snippet|body)/.test(decide),
      'the create path must not read any mail field'
    );
  });

  test('the source policy describes that behavior', () => {
    assert.match(
      SOURCE_POLICY,
      /public display name and the topic URL,\s+and\s+nothing else/i
    );
    assert.match(SOURCE_POLICY, /HubSpot Community participant/);
    assert.match(SOURCE_POLICY, /fixed phrase rather than a quote/i);
  });

  test('the reference names the neutral fallback and the fixed signal text', () => {
    assert.match(WORKFLOW_REFERENCE, /HubSpot Community participant/);
    assert.match(WORKFLOW_REFERENCE, /Inbound HubSpot Community engagement/);
    assert.match(WORKFLOW_REFERENCE, /Nothing on it is quoted from the mail/i);
  });

  test('the architecture document says the mail fields are discarded', () => {
    assert.match(ARCHITECTURE, /strips email addresses/i);
    assert.match(ARCHITECTURE, /subject, snippet, body, and message\s+id are discarded/i);
  });
});

/* ================================================================== */
/* Manual rows                                                         */
/* ================================================================== */

describe('a manual row is not described as only what you typed', () => {
  test('the withdrawn wording is gone', () => {
    const WITHDRAWN = [/exactly what you typed/i, /only what the operator typed/i];
    for (const pattern of WITHDRAWN) {
      for (const [name, text] of Object.entries(ALL_DOCS)) {
        assert.ok(!pattern.test(text), `${name} still says a manual row is ${pattern}`);
      }
    }
  });

  test('the source policy names the derived fields stored alongside the submission', () => {
    const section = SOURCE_POLICY.split(/^#{2,3} What lands in Notion\s*$/m)[1].split(/^#{2,3} /m)[0];
    assert.match(section, /For a manual row/);
    for (const field of ['tier', 'persona', 'track', 'pain area', 'angle', 'next action', 'draft']) {
      assert.ok(
        new RegExp(field.replace(/ /g, '\\s+'), 'i').test(section),
        `the manual row description must name ${field}`
      );
    }
    assert.match(section, /not only what\s+you typed/i);
  });
});

/* ================================================================== */
/* CI supply chain                                                     */
/* ================================================================== */

describe('CI pins its actions and stays read-only', () => {
  // "uses: owner/repo@ref" with whatever trailing comment is on the line.
  const USES = /^\s*uses:\s*(\S+)\s*(#.*)?$/gm;
  const steps = [...CI_WORKFLOW.matchAll(USES)].map(([, ref, comment]) => ({
    ref,
    comment: comment ?? ''
  }));

  test('the workflow actually uses some actions', () => {
    assert.ok(steps.length >= 3, `expected at least 3 action references, found ${steps.length}`);
  });

  test('every action is pinned to a 40-character commit SHA', () => {
    for (const { ref } of steps) {
      const pin = ref.split('@')[1];
      assert.ok(pin, `${ref} has no pinned ref at all`);
      assert.match(pin, /^[0-9a-f]{40}$/, `${ref} is not pinned to a commit SHA`);
    }
  });

  test('no floating or major-only tag survives anywhere in the file', () => {
    for (const pattern of [/@main\b/, /@master\b/, /uses:\s*\S+@v\d+(\.\d+)*\s*$/m]) {
      assert.ok(!pattern.test(CI_WORKFLOW), `CI still contains a movable ref: ${pattern}`);
    }
  });

  test('each pin carries the release tag it came from in a comment', () => {
    for (const { ref, comment } of steps) {
      assert.match(comment, /#\s*v\d+\.\d+\.\d+/, `${ref} does not name the release tag it was resolved from`);
    }
  });

  test('the decision log records the same tag and SHA for every pinned action', () => {
    // A pin nobody can trace back to a release is not auditable, so the table
    // in the decision log has to agree with the file.
    for (const { ref, comment } of steps) {
      const [action, sha] = ref.split('@');
      const tag = comment.match(/v\d+\.\d+\.\d+/)[0];
      const row = DECISION_LOG.split('\n').find(
        (line) => line.includes(`\`${action}\``) && line.includes('|')
      );
      assert.ok(row, `the decision log has no row for ${action}`);
      assert.ok(row.includes(sha), `the decision log records a different SHA for ${action}`);
      assert.ok(row.includes(tag), `the decision log records a different tag for ${action}`);
    }
  });

  test('permissions are read-only and no job widens them', () => {
    const permissions = [...CI_WORKFLOW.matchAll(/^\s*permissions:\s*$/gm)];
    assert.ok(permissions.length >= 1, 'CI must declare permissions');
    const granted = [...CI_WORKFLOW.matchAll(/^\s{2,}([a-z-]+):\s*(read|write|none)\s*$/gm)];
    assert.ok(granted.length >= 1, 'expected at least one explicit permission scope');
    for (const [, scope, level] of granted) {
      assert.equal(level, 'read', `CI grants ${scope}: ${level}, which is not read-only`);
    }
  });

  test('superseded runs on the same ref are cancelled', () => {
    assert.match(CI_WORKFLOW, /concurrency:/);
    assert.match(CI_WORKFLOW, /cancel-in-progress:\s*true/);
  });

  test('the full history is scanned, not a shallow clone', () => {
    assert.match(CI_WORKFLOW, /fetch-depth:\s*0/);
  });

  test('the check suite runs on the Node version the package requires', () => {
    const engines = JSON.parse(PACKAGE_JSON).engines.node;
    const pinned = CI_WORKFLOW.match(/node-version:\s*(\S+)/)[1];
    assert.match(pinned, /^\d+\.\d+\.\d+$/, 'CI must pin an exact Node version');
    assert.equal(
      pinned.split('.')[0],
      engines.split('.')[0],
      'CI Node major must match the engines field'
    );
    assert.match(CI_WORKFLOW, /npm run check/);
  });
});

/** Returns the body of a numbered release-checklist section, without its heading. */
const checklistSection = (n) =>
  (RELEASE_CHECKLIST.split(new RegExp(`^## ${n}\\. .*$`, 'm'))[1] ?? '').split(/^## /m)[0];

describe('the secret scan config exempts nothing broad', () => {
  test('it extends the default rule set', () => {
    assert.match(GITLEAKS_CONFIG, /\[extend\][\s\S]*useDefault\s*=\s*true/);
  });

  test('it allowlists no path and no whole file', () => {
    // A directory exemption is the failure this scan exists to prevent, since
    // workflows/, tests/, and examples/ are where a real credential would land.
    for (const pattern of [/^\s*paths\s*=/m, /^\s*files\s*=/m, /^\s*stopwords\s*=/m]) {
      assert.ok(!pattern.test(GITLEAKS_CONFIG), `.gitleaks.toml uses a broad exemption: ${pattern}`);
    }
    for (const dir of ['workflows/', 'tests/', 'examples/', 'scripts/']) {
      assert.ok(
        !new RegExp(`['"\`]?${dir}`).test(GITLEAKS_CONFIG.replace(/^\s*#.*$/gm, '')),
        `.gitleaks.toml exempts ${dir}`
      );
    }
  });

  test('the release checklist requires two distinct scans, one probe each', () => {
    // Two scans, because two is how many genuinely different things there are
    // to look at: the files on disk, and the commits. A third run against a
    // copy with .gitignore removed was measured and found to duplicate the
    // first, so requiring it again would be requiring ceremony.
    const scans = checklistSection(2);
    assert.match(scans, /gitleaks dir/, 'the directory scan must be named');
    assert.match(scans, /gitleaks git/, 'the history scan must be named');
    assert.match(scans, /two secret scans|two scans/i);
    assert.ok(
      !/three secret scans|all three scans|all three probes/i.test(RELEASE_CHECKLIST),
      'the checklist must no longer require three scans'
    );

    const probes = checklistSection(3);
    assert.match(probes, /directory probe/i);
    assert.match(probes, /history probe/i);
    assert.ok(
      !/ignored-file probe/i.test(probes),
      'the ignored-file probe is not a third probe'
    );
    assert.match(RELEASE_CHECKLIST, /mutation probe/i);
    assert.match(RELEASE_CHECKLIST, /never entered this repository/i);
  });

  test('the directory probe keeps .gitignore in place', () => {
    // A probe that deletes .gitignore first proves nothing about whether the
    // scan reaches ignored paths, which is the only thing it is there to prove.
    const probes = checklistSection(3);
    const directory = probes.split(/history probe/i)[0];
    assert.match(directory, /`\.gitignore` intact/i,
      'the directory probe must state that .gitignore stays in place');
    assert.match(directory, /\.n8n/, 'the probe must plant its value in an ignored path');
    assert.match(directory, /gitleaks dir/);
  });

  test('the history probe is the one that shows the two scans differ', () => {
    const probes = checklistSection(3);
    const history = probes.split(/history probe/i)[1] ?? '';
    assert.match(history, /delete it in a later commit/i);
    assert.match(history, /gitleaks git.{0,40}fail[\s\S]{0,60}gitleaks dir.{0,20}pass/i);
  });

  test('no shipped document claims that removing .gitignore adds coverage', () => {
    // The claim was wrong: gitleaks 8.30.1 scans ignored paths either way. It
    // may be described as a superseded belief, never as a current requirement.
    const forbidden = [
      /scan that honours it can pass/i,
      /a scan honouring it can report clean/i,
      /would otherwise never see/i,
      /reaches paths .{0,40}would never see/i
    ];
    for (const [name, text] of Object.entries(ALL_DOCS)) {
      for (const pattern of forbidden) {
        assert.ok(!pattern.test(text), `${name} still claims .gitignore removal adds coverage: ${pattern}`);
      }
    }
  });

  test('the decision log records the correction instead of hiding it', () => {
    const heading = (DECISION_LOG.match(/^#{3} 15\..*$/m) ?? [''])[0];
    assert.match(heading, /two distinct secret scans/i);
    const body = DECISION_LOG.split(/^#{3} 15\..*$/m)[1].split(/^#{3} /m)[0];
    // The superseded procedure was really executed. Saying so is the point.
    assert.match(body, /originally required \*three\* runs|originally required three runs/i);
    assert.match(body, /were executed and all exited zero/i);
    assert.match(body, /8\.30\.1/, 'the correction must name the measured version');
    // The allowlist rules are not collateral damage.
    assert.match(body, /no `paths` allowlist and no whole-file exemption/i);
    assert.match(body, /allowlist on that one exact literal value/i);
  });
});

/* ================================================================== */
/* House style                                                         */
/* ================================================================== */

describe('house style', () => {
  test('public prose contains no em dash', () => {
    const EM_DASH = '\u2014';
    for (const [name, text] of Object.entries(ALL_DOCS)) {
      const lines = text.split('\n').filter((l) => l.includes(EM_DASH));
      assert.equal(lines.length, 0, `${name} uses an em dash: ${lines[0]?.trim() ?? ''}`);
    }
  });
});

/* ================================================================== */
/* Link integrity                                                      */
/* ================================================================== */

describe('documentation links resolve', () => {
  const RELATIVE_LINK = /\]\(([^)\s]+)\)/g;

  test('every relative link points at a file that exists', async () => {
    const existing = new Set();
    async function walk(dir) {
      for (const entry of await readdir(path.join(ROOT, dir), { withFileTypes: true })) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        const rel = dir === '.' ? entry.name : `${dir}/${entry.name}`;
        if (entry.isDirectory()) await walk(rel);
        else existing.add(rel);
      }
    }
    await walk('.');

    for (const [name, text] of Object.entries(ALL_DOCS)) {
      const base = path.posix.dirname(name);
      for (const match of text.matchAll(RELATIVE_LINK)) {
        const target = match[1];
        if (/^(https?:|mailto:|#)/.test(target)) continue;
        const resolved = path.posix.normalize(
          base === '.' ? target.split('#')[0] : `${base}/${target.split('#')[0]}`
        );
        assert.ok(existing.has(resolved), `${name} links to a missing file: ${target}`);
      }
    }
  });

  test('external links are absolute https URLs', () => {
    for (const [name, text] of Object.entries(ALL_DOCS)) {
      for (const match of text.matchAll(/\]\((http[^)\s]+)\)/g)) {
        assert.match(match[1], /^https:\/\//, `${name} links over plain HTTP: ${match[1]}`);
      }
    }
  });
});

/* ================================================================== */
/* Source policy                                                       */
/* ================================================================== */

describe('source policy states the boundary', () => {
  const REQUIRED = [
    /automated .{0,40}source .{0,30}is HubSpot Community RSS/i,
    /once (a day|daily)/i,
    /three (public )?feeds|three .{0,20}RSS feeds/i,
    /technical interface/i,
    /not .{0,30}permission/i,
    /you are responsible|users are responsible/i,
    /short derived signal|derived signal.{0,40}link|does not (store|mirror) .{0,30}full/i,
    /does not crawl (member )?profiles/i,
    /does not (extract|collect) email/i,
    /does not automate .{0,30}engagement/i,
    /LinkedIn .{0,60}(not supported|out of scope)/i,
    /first-party API or RSS/i,
    /separate terms review/i
  ];

  test('covers every required statement', () => {
    for (const pattern of REQUIRED) {
      assert.match(SOURCE_POLICY, pattern, `source policy is missing: ${pattern}`);
    }
  });

  test('links the four terms documents', () => {
    for (const url of [
      'https://legal.hubspot.com/website-terms-of-use',
      'https://legal.hubspot.com/community-tou',
      'https://www.linkedin.com/legal/crawling-terms',
      'https://www.linkedin.com/legal/user-agreement'
    ]) {
      assert.ok(SOURCE_POLICY.includes(url), `source policy must link ${url}`);
    }
  });

  test('carries the exact disclaimer', () => {
    assert.ok(SOURCE_POLICY.includes('This is product guidance, not legal advice.'));
  });

  test('does not present RSS availability as legal clearance', () => {
    assert.ok(!/legal clearance|cleared for use|permission to reuse/i.test(SOURCE_POLICY.replace(/not a legal clearance/gi, '')));
  });

  test('marks the manual source labels as user-supplied', () => {
    for (const label of [
      'LinkedIn post',
      'LinkedIn people',
      'HubSpot Community',
      'Reddit',
      'Job posting',
      'Partner directory',
      'Referral'
    ]) {
      assert.ok(SOURCE_POLICY.includes(label), `source policy must list the ${label} label`);
    }
    assert.match(SOURCE_POLICY, /user-supplied|you (type|paste|enter|supply)/i);
    assert.match(SOURCE_POLICY, /does not fetch|never fetches|Scout does not retrieve/i);
  });
});

/* ================================================================== */
/* Notion schema                                                       */
/* ================================================================== */

describe('Notion schema documentation', () => {
  const PROPERTIES = [
    ['Name', 'Title'],
    ['Company', 'Rich text'],
    ['Signal', 'Rich text'],
    ['Evidence', 'Rich text'],
    ['Warmth tier', 'Select'],
    ['Pain area', 'Multi-select'],
    ['Best angle', 'Rich text'],
    ['Draft', 'Rich text'],
    ['Persona type', 'Select'],
    ['Track', 'Select'],
    ['Source', 'Select'],
    ['Source URL', 'URL'],
    ['LinkedIn URL', 'URL'],
    ['Next action', 'Select'],
    ['Status', 'Select'],
    ['Replied', 'Checkbox'],
    ['Last touch', 'Date']
  ];

  const OPTIONS = [
    'Tier 1 (hot)', 'Tier 2 (warm)', 'Tier 3 (cool)', 'Tier 4 (cold)',
    'Routing', 'Lifecycle', 'Dedupe', 'Enrichment', 'Data quality', 'Reporting',
    'ICP buyer', 'ICP practitioner', 'Partner / consultant', 'Peer / networker', 'Unknown',
    'Sales (ICP)', 'Connector',
    'Comment', 'DM', 'Connect', 'Monitor', 'Ignore',
    'New', 'Engaged', 'In conversation', 'Scan/Demo', 'Closed', 'Needs review'
  ];

  test('documents all seventeen properties with their Notion types', () => {
    assert.equal(PROPERTIES.length, 17);
    for (const [name, type] of PROPERTIES) {
      assert.ok(NOTION_SCHEMA.includes(`\`${name}\``), `schema doc must name ${name}`);
      assert.ok(NOTION_SCHEMA.includes(type), `schema doc must give the ${type} type`);
    }
  });

  test('documents every select and multi-select option', () => {
    for (const option of OPTIONS) {
      assert.ok(NOTION_SCHEMA.includes(option), `schema doc must list the option ${option}`);
    }
  });

  test('explains sharing the database with the integration', () => {
    assert.match(NOTION_SCHEMA, /connect|share|add connection/i);
    assert.match(NOTION_SCHEMA, /integration/i);
  });

  test('explains where the database id comes from', () => {
    assert.match(NOTION_SCHEMA, /database id/i);
    assert.match(NOTION_SCHEMA, /notionDatabaseId/);
  });

  test('states that page creation time drives the weekly new-signal count', () => {
    assert.match(NOTION_SCHEMA, /created time|creation time/i);
    assert.ok(!/`Added`/.test(NOTION_SCHEMA), 'no separate Added property is required');
  });

  test('never says Scout fetches a LinkedIn URL', () => {
    assert.match(NOTION_SCHEMA, /LinkedIn URL/);
    assert.match(NOTION_SCHEMA, /never fetch|not fetched|does not fetch|never retrieved/i);
  });
});

/* ================================================================== */
/* Setup guide                                                         */
/* ================================================================== */

describe('setup guide', () => {
  test('explains HTTP Header Auth for Anthropic', () => {
    assert.match(SETUP, /HTTP Header Auth/);
    assert.match(SETUP, /x-api-key/);
    assert.match(SETUP, /anthropic-version/);
    assert.ok(SETUP.includes('2023-06-01'), 'the pinned Anthropic API version must be documented');
  });

  test('explains the Notion header credential', () => {
    assert.match(SETUP, /Authorization/);
    assert.match(SETUP, /Bearer/);
    assert.ok(SETUP.includes('2022-06-28'), 'the pinned Notion API version must be documented');
  });

  test('shows no token-shaped example anywhere', () => {
    const TOKEN_SHAPES = [
      /sk-ant-[A-Za-z0-9_-]{8,}/,
      /secret_[A-Za-z0-9]{16,}/,
      /ntn_[A-Za-z0-9]{16,}/,
      /Bearer\s+[A-Za-z0-9_-]{20,}/
    ];
    for (const [name, text] of Object.entries(ALL_DOCS)) {
      for (const shape of TOKEN_SHAPES) {
        assert.ok(!shape.test(text), `${name} contains a token-shaped example matching ${shape}`);
      }
    }
  });

  test('tells the reader to set the workflow timezone before activating a schedule', () => {
    assert.match(SETUP, /timezone/i);
    assert.match(SETUP, /UTC/);
  });

  test('says credentials live in n8n rather than in node parameters', () => {
    assert.match(SETUP, /credential/i);
    assert.ok(
      /never .{0,60}(node parameter|workflow json|paste .{0,20}token)/i.test(SETUP) ||
        /do not .{0,60}(node parameter|workflow json)/i.test(SETUP),
      'setup must warn against putting a token in a node parameter'
    );
  });
});

/* ================================================================== */
/* Workflow reference, checked against the shipped JSON                */
/* ================================================================== */

describe('workflow reference matches the shipped workflows', () => {
  test('documents every workflow file and its public name', () => {
    for (const [file, workflow] of Object.entries(WORKFLOWS)) {
      assert.ok(WORKFLOW_REFERENCE.includes(file), `reference must name ${file}`);
      assert.ok(
        WORKFLOW_REFERENCE.includes(workflow.name),
        `reference must give the public name ${workflow.name}`
      );
    }
  });

  test('documents every Scout Setup key of every workflow', () => {
    for (const [file, workflow] of Object.entries(WORKFLOWS)) {
      const setup = workflow.nodes.find((n) => n.name === 'Scout Setup');
      for (const assignment of setup.parameters.assignments.assignments) {
        assert.ok(
          WORKFLOW_REFERENCE.includes(assignment.name),
          `reference must document ${assignment.name} for ${file}`
        );
      }
    }
  });

  test('documents the trigger of every workflow', () => {
    for (const [file, workflow] of Object.entries(WORKFLOWS)) {
      const trigger = workflow.nodes.find((n) => /trigger/i.test(n.type));
      assert.ok(
        WORKFLOW_REFERENCE.includes(trigger.name),
        `reference must name the trigger ${trigger.name} for ${file}`
      );
    }
  });

  test('records the deferred pagination limit where it applies', () => {
    assert.match(WORKFLOW_REFERENCE, /100/);
    assert.match(WORKFLOW_REFERENCE, /paginat/i);
  });

  test('records which credentials each workflow needs', () => {
    for (const label of ['Anthropic', 'Notion', 'Gmail']) {
      assert.ok(WORKFLOW_REFERENCE.includes(label), `reference must mention ${label} credentials`);
    }
  });

  test('records the failure behavior of the two review paths', () => {
    assert.match(WORKFLOW_REFERENCE, /Needs review/);
    assert.match(WORKFLOW_REFERENCE, /Needs Review/);
  });
});

/* ================================================================== */
/* Architecture                                                        */
/* ================================================================== */

describe('architecture document', () => {
  test('describes the trust boundaries', () => {
    assert.match(ARCHITECTURE, /trust boundar/i);
    for (const surface of ['Anthropic', 'Notion', 'Gmail', 'HubSpot Community']) {
      assert.ok(ARCHITECTURE.includes(surface), `architecture must cover ${surface}`);
    }
  });

  test('states that no data leaves the operator n8n instance except to named services', () => {
    assert.match(ARCHITECTURE, /community\.hubspot\.com|HubSpot Community RSS/);
    assert.match(ARCHITECTURE, /api\.notion\.com|Notion API/);
    assert.match(ARCHITECTURE, /api\.anthropic\.com|Anthropic Messages API/);
  });

  test('names the human review step as part of the data flow', () => {
    assert.match(ARCHITECTURE, /review/i);
  });
});

/* ================================================================== */
/* Decision log                                                        */
/* ================================================================== */

describe('decision log', () => {
  const REQUIRED_DECISIONS = [
    /separate .{0,40}product|not part of .{0,30}SignalFlow|its own repository/i,
    /Notion .{0,60}only|Notion and Anthropic .{0,40}fixed/i,
    /HubSpot Community RSS .{0,60}only automated source|only automated source/i,
    /one hero workflow|hero template|workflow 01 only/i,
    /Scout Setup .{0,60}instead of|\$env/,
    /live exports? .{0,60}(never|not) .{0,30}(git|public)/i,
    /HTTP Request/,
    /page[_ ]size|page size/i,
    /human[- ]reviewed|human review/i,
    /evidence/i
  ];

  test('records every required decision', () => {
    for (const pattern of REQUIRED_DECISIONS) {
      assert.match(DECISION_LOG, pattern, `decision log is missing: ${pattern}`);
    }
  });

  test('states the evidence, or absence of evidence, for each verification claim', () => {
    assert.match(DECISION_LOG, /unverified|not yet verified|no evidence yet/i);
  });

  test('the human-review decision is titled "no outreach is sent"', () => {
    const headings = DECISION_LOG.match(/^#{3} .*$/gm) ?? [];
    const outreach = headings.filter((h) => /human[- ]reviewed|drafts stay/i.test(h));
    assert.equal(outreach.length, 1, 'expected exactly one human-review decision heading');
    assert.match(outreach[0], /no outreach is sent/i);
    assert.ok(
      !/nothing is sent/i.test(outreach[0]),
      'the heading must not claim nothing is sent'
    );
  });

  test('that decision still explains the digest emails', () => {
    const body = DECISION_LOG.split(/^#{3} .*no outreach is sent.*$/im)[1].split(/^#{3} /m)[0];
    assert.match(body, /Workflows 03 and 06 do send email/i);
    assert.match(body, /single operator address you configure/i);
  });

  test('gives a reason for every decision rather than only the outcome', () => {
    const headings = DECISION_LOG.match(/^#{3} /gm) ?? [];
    assert.ok(headings.length >= 10, `expected at least 10 logged decisions, found ${headings.length}`);
    const whys = DECISION_LOG.match(/^\*\*Why:\*\*/gm) ?? [];
    assert.equal(whys.length, headings.length, 'every decision needs a Why');
  });
});

/* ================================================================== */
/* Contributing, security, examples, changelog                         */
/* ================================================================== */

describe('contributing guide', () => {
  test('never asks for raw exports, logs, credential screenshots, or OAuth traces', () => {
    assert.match(CONTRIBUTING, /do not (attach|paste|send|include)/i);
    for (const term of ['raw workflow export', 'execution log', 'credential', 'OAuth']) {
      assert.ok(CONTRIBUTING.includes(term), `contributing must address ${term}`);
    }
  });

  test('asks contributors to run the check suite', () => {
    assert.ok(CONTRIBUTING.includes('npm run check'));
  });

  test('asks contributors to sanitize fixtures', () => {
    assert.match(CONTRIBUTING, /sanitiz/i);
    assert.match(CONTRIBUTING, /fixture/i);
  });
});

describe('security policy', () => {
  test('explains what to do instead of filing a public issue', () => {
    assert.match(SECURITY, /public issue|publicly/i);
    assert.match(SECURITY, /private/i);
  });

  test('states that the repository holds no credentials', () => {
    assert.match(SECURITY, /no (live )?credential|contains no credential/i);
  });

  test('describes the scanner as a safety net rather than a guarantee', () => {
    assert.match(SECURITY, /scan/i);
    assert.ok(
      !/cannot leak|impossible|guarantee/i.test(SECURITY),
      'the scanner must not be described as a guarantee'
    );
  });
});

describe('examples readme', () => {
  test('marks every fixture as synthetic', () => {
    assert.match(EXAMPLES_README, /synthetic/i);
    assert.match(EXAMPLES_README, /fictional|no real (person|company)/i);
  });

  test('names every fixture file', async () => {
    for (const file of await readdir(path.join(ROOT, 'examples/fixtures'))) {
      assert.ok(EXAMPLES_README.includes(file), `examples README must describe ${file}`);
    }
  });
});

describe('changelog', () => {
  test('package metadata and changelog agree on v0.1.2', async () => {
    const packageJson = JSON.parse(PACKAGE_JSON);
    const lock = JSON.parse(await read('package-lock.json'));
    assert.equal(packageJson.version, '0.1.2');
    assert.equal(lock.version, packageJson.version);
    assert.equal(lock.packages[''].version, packageJson.version);
    assert.match(CHANGELOG, new RegExp(`^## ${packageJson.version.replaceAll('.', '\\.')}`, 'm'));
  });

  test('opens at the latest patch and preserves the original release', () => {
    const firstVersion = CHANGELOG.match(/^#{2} .*$/m);
    assert.ok(firstVersion, 'changelog needs a version heading');
    assert.match(firstVersion[0], /^## 0\.1\.2 - \d{4}-\d{2}-\d{2}$/);
    assert.match(CHANGELOG, /^## 0\.1\.0 - \d{4}-\d{2}-\d{2}$/m);
  });

  test('no longer describes itself as unreleased or untagged', () => {
    assert.ok(!/0\.1\.0 - Unreleased/.test(CHANGELOG));
    assert.ok(
      !/[Nn]ot yet tagged|[Nn]ot yet published|release candidate/.test(
        CHANGELOG.split(/^#{2} /m)[1] ?? ''
      ),
      'the released section must not still call itself a candidate'
    );
  });
});

describe('Decision 22 keeps authoring and private-marker verification separate', () => {
  test('forbids private marker values from the authoring route', () => {
    assert.match(
      DECISION_LOG,
      /no private export,[\s\S]*private marker value enters the authoring input or diff/
    );
    assert.match(DECISION_LOG, /authoring\s+process never reads the external marker list/);
  });

  test('limits the external list to the post-commit scanner boundary', () => {
    assert.match(DECISION_LOG, /post-commit marker gate is a separate verification boundary/);
    assert.match(DECISION_LOG, /only the\s+scanner may load the owner-only external list/);
    assert.match(DECISION_LOG, /records only its count and SHA-256 plus scope totals/);
    assert.match(DECISION_LOG, /removed\s+by exact path immediately after the fresh-clone scan/);
  });
});

/* ================================================================== */
/* Private material must not reach the docs                            */
/* ================================================================== */

describe('documentation carries no private material', () => {
  // The exact-value denylist that used to live here has been removed. It named
  // twelve private operational values, which meant this file published exactly
  // what it existed to keep out, and it only ever scanned the prose files in
  // ALL_DOCS, so it could not have caught them here in any case.
  //
  // Structural coverage across every tracked file now lives in
  // tree-hygiene.test.mjs. Exact private values are checked by
  // scripts/scan-private-markers.mjs, which takes the list as a runtime
  // argument and is run against a fresh clone before release. See
  // docs/decision-log.md entry 20.

  test('contains no email address', () => {
    for (const [name, text] of Object.entries(ALL_DOCS)) {
      const found = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
      const real = found.filter((a) => !/example\.(com|net|org)$/i.test(a));
      assert.deepEqual(real, [], `${name} contains an email address: ${real.join(', ')}`);
    }
  });
});

/* ================================================================== */
/* Clean-import verification claims                                     */
/* ================================================================== */

describe('the import verification record matches the shipped workflows', () => {
  const countType = (type) =>
    Object.values(WORKFLOWS).reduce(
      (total, wf) => total + wf.nodes.filter((n) => n.type === type).length,
      0
    );

  test('no shipped workflow carries a top-level id', () => {
    // Decision 16 commits to this. If an id is ever added back to satisfy the
    // CLI importer, the reasoning recorded in the decision log becomes false.
    for (const [file, wf] of Object.entries(WORKFLOWS)) {
      assert.equal(wf.id, undefined, `${file} must not carry a root id`);
    }
  });

  test('the audit total equals every Code and HTTP Request node shipped', () => {
    // The audit flags these two node types categorically, so the number it
    // reports is a property of the workflows, not a discovered vulnerability.
    // Deriving it here means adding a Code node without updating the record
    // fails the build rather than quietly making the document wrong.
    const code = countType('n8n-nodes-base.code');
    const http = countType('n8n-nodes-base.httpRequest');
    assert.ok(
      LIVE_VERIFICATION.includes(`${code} Code nodes and ${http} HTTP Request nodes`),
      `live-verification.md must state ${code} Code and ${http} HTTP Request nodes`
    );
    assert.ok(
      new RegExp(`Official risky nodes \\|\\s*${code + http}\\s*\\|`).test(LIVE_VERIFICATION),
      `the audit table must record ${code + http} findings`
    );
  });

  test('the v0.1.0 per-workflow table preserves the original import evidence', () => {
    const countLinks = (connections) => {
      let n = 0;
      for (const outputs of Object.values(connections ?? {})) {
        for (const branches of Object.values(outputs ?? {})) {
          for (const branch of branches ?? []) n += (branch ?? []).length;
        }
      }
      return n;
    };
    for (const [file, wf] of Object.entries(WORKFLOWS)) {
      const number = file.match(/\/(\d{2})-/)[1];
      const row = LIVE_VERIFICATION.split('\n').find((line) =>
        line.startsWith(`| ${number} `)
      );
      assert.ok(row, `live-verification.md needs a row for workflow ${number}`);
      const cells = row.split('|').map((c) => c.trim());
      const historicalNodeCount = number === '01' ? 15 : wf.nodes.length;
      assert.equal(cells[2], String(historicalNodeCount), `${file} historical node count`);
      assert.equal(cells[3], String(countLinks(wf.connections)), `${file} connection count`);
      assert.equal(cells[4], '`false`', `${file} must import inactive`);
      assert.equal(cells[5], 'none', `${file} must show no drift`);
    }
  });

  test('the v0.1.1 Editor UI table matches the current Workflow 01 file', () => {
    const countLinks = (connections) => {
      let n = 0;
      for (const outputs of Object.values(connections ?? {})) {
        for (const branches of Object.values(outputs ?? {})) {
          for (const branch of branches ?? []) n += (branch ?? []).length;
        }
      }
      return n;
    };
    const [file, workflow] = Object.entries(WORKFLOWS).find(([name]) =>
      name.includes('/01-')
    );
    const section = LIVE_VERIFICATION.split('### v0.1.1 Workflow 01 Editor UI import')[1]
      .split(/^### /m)[0];
    const row = section.split('\n').find((line) =>
      line.startsWith('| 01 HubSpot Community Signals |')
    );
    assert.ok(row, 'v0.1.1 needs a current Workflow 01 import row');
    const cells = row.split('|').map((cell) => cell.trim());
    assert.equal(cells[2], String(workflow.nodes.length), `${file} current node count`);
    assert.equal(cells[3], String(countLinks(workflow.connections)), `${file} current connection count`);
    assert.equal(cells[4], '5', `${file} sticky-note count`);
    assert.equal(cells[5], '`false`', `${file} must import inactive`);
    assert.equal(cells[6], 'none', `${file} must import without credentials`);
    assert.equal(cells[7], 'none', `${file} must show no drift`);
  });

  test('the v0.1.2 Creator layout table matches the current Workflow 01 file', () => {
    const [file, workflow] = Object.entries(WORKFLOWS).find(([name]) =>
      name.includes('/01-')
    );
    const section = LIVE_VERIFICATION.split('### v0.1.2 Workflow 01 Creator layout correction')[1]
      .split(/^### /m)[0];
    const row = section.split('\n').find((line) =>
      line.startsWith('| 01 HubSpot Community Signals |')
    );
    assert.ok(row, 'v0.1.2 needs a current Workflow 01 layout row');
    const cells = row.split('|').map((cell) => cell.trim());
    assert.equal(cells[2], String(workflow.nodes.length), `${file} current node count`);
    assert.equal(cells[3], '11', `${file} connection count`);
    assert.equal(cells[4], '5', `${file} sticky-note count`);
    assert.equal(cells[5], '`false`', `${file} must import inactive`);
    assert.equal(cells[6], 'none', `${file} must import without credentials`);
    assert.equal(cells[7], 'none', `${file} must show no overlap`);
  });

  test('records the pinned image by digest, not only by tag', () => {
    assert.ok(
      /sha256:[0-9a-f]{64}/.test(LIVE_VERIFICATION),
      'the image digest must be recorded, because a tag can be moved'
    );
    assert.ok(LIVE_VERIFICATION.includes('2.36.8'));
  });

  test('records the exact toolchain the import ran on', () => {
    // Without these a reader cannot reproduce the run or tell whether a later
    // failure came from Scout or from a different Docker or Node.
    assert.match(
      LIVE_VERIFICATION,
      /Docker: client `\d+\.\d+\.\d+`, server `\d+\.\d+\.\d+`/,
      'the Docker client and server versions must be recorded'
    );
    assert.match(
      LIVE_VERIFICATION,
      /Node\.js inside the container: `v\d+\.\d+\.\d+`/,
      'the container Node.js version must be recorded'
    );
  });

  test('does not present the five checks as a ladder', () => {
    // They are independent dimensions. Calling them levels invites a reader to
    // assume a passing import implies the live execution below it.
    assert.ok(
      /separate dimensions, not a ladder/.test(LIVE_VERIFICATION),
      'the document must say the checks are independent'
    );
    assert.ok(
      !/strictly weaker claim|each level below/i.test(LIVE_VERIFICATION),
      'the superseded ladder framing must be gone'
    );
    assert.ok(
      !/^\| Level \|/m.test(LIVE_VERIFICATION),
      'the table must not be headed "Level"'
    );
  });

  test('separates the historical REST import from the v0.1.1 Editor UI check', () => {
    assert.ok(
      /Browser interaction with the Editor UI was not\s+separately tested/.test(LIVE_VERIFICATION),
      'the original v0.1.0 REST result must keep its historical UI limit'
    );
    assert.ok(
      /### v0\.1\.1 Workflow 01 Editor UI import/.test(LIVE_VERIFICATION),
      'the current Workflow 01 Editor UI check must be recorded separately'
    );
    assert.ok(
      /not a public API|no stability guarantee/i.test(LIVE_VERIFICATION),
      'the internal endpoint must not read as a recommended interface'
    );
    assert.ok(
      /Import from File/.test(LIVE_VERIFICATION),
      'the document must still name the setup path users follow'
    );
  });

  test('still says email delivery and the Gmail trigger have not happened', () => {
    // A live run against Notion and Anthropic must never be allowed to read as
    // passing everything. These two rows are the ones that stayed unproven.
    for (const claim of [
      /\| Email delivery \|[^\n]*\*\*Not done\*\*/,
      /\| Gmail trigger \|[^\n]*\*\*Not done\*\*/
    ]) {
      assert.match(LIVE_VERIFICATION, claim);
    }
    assert.match(
      LIVE_VERIFICATION,
      /Nothing here is "fully verified\."/,
      'the document must refuse the phrase outright rather than leaving it ambiguous'
    );
    for (const section of [
      'No email has been sent or received',
      'Workflow 04 has never run',
      'It has not been run in production'
    ]) {
      assert.ok(LIVE_VERIFICATION.includes(section), `missing disclosure: ${section}`);
    }
    assert.match(README, /Live email delivery[^\n]*Not yet verified/);
  });

  test('the README records instance acceptance without implying a UI clickthrough', () => {
    const row = README.split('\n').find((l) => l.includes('accepts the workflow JSON'));
    assert.ok(row, 'the README verification table must cover instance acceptance');
    assert.ok(!/Not yet verified/.test(row), 'instance acceptance has been verified');
    assert.ok(
      row.includes('POST /rest/workflows'),
      'the row must name the endpoint that was actually exercised'
    );
    assert.ok(
      README.includes('Import from File'),
      'the README must still point users at the Editor UI setup path'
    );
    assert.ok(
      README.includes('docs/live-verification.md'),
      'the README must point at the evidence'
    );
  });

  test('the CLI import limitation is disclosed rather than hidden', () => {
    assert.ok(LIVE_VERIFICATION.includes('import:workflow'));
    assert.ok(
      /workflow_entity\.id/.test(LIVE_VERIFICATION),
      'the actual error must be recorded so a reader can recognise it'
    );
    assert.ok(
      /decision-log\.md/.test(LIVE_VERIFICATION) && /16\./.test(DECISION_LOG),
      'the decision log must carry the matching entry'
    );
    assert.ok(
      /top-level workflow id/i.test(DECISION_LOG),
      'decision 16 must explain why no root id was added'
    );
  });
});

/* ================================================================== */
/* Superseded verification claims must not come back                   */
/* ================================================================== */

describe('the verification summaries match what has actually been run', () => {
  // Both of these sentences were true once and became false when the live run
  // happened. A stale disclaimer is not harmlessly conservative: it tells a
  // reader that evidence they could rely on does not exist.

  test('no document claims nothing has been checked against a live service', () => {
    const OBSOLETE = [
      /nothing here has yet been checked against a live\s+service/i,
      /nothing has (yet )?been (checked|run|tested) against a live/i,
      /has not been (checked|run|tested) against any live service/i
    ];
    for (const pattern of OBSOLETE) {
      for (const [name, text] of Object.entries(ALL_DOCS)) {
        assert.ok(
          !pattern.test(text),
          `${name} still claims nothing was checked live, which the recorded run contradicts: ${pattern}`
        );
      }
    }
  });

  test('no document claims live verification has never been attempted', () => {
    const OBSOLETE = [
      /full live verification is still pending/i,
      /it has not been attempted since the fix/i,
      /live (execution|verification) has not been attempted/i
    ];
    for (const pattern of OBSOLETE) {
      for (const [name, text] of Object.entries(ALL_DOCS)) {
        assert.ok(!pattern.test(text), `${name} carries a superseded claim: ${pattern}`);
      }
    }
  });

  test('the sandbox regression is described as narrower than, and before, the live run', () => {
    assert.match(
      LIVE_VERIFICATION,
      /came before the live run recorded below, and is narrower than it/i,
      'the ordering and scope of the sandbox check must be explicit'
    );
    const sandboxAt = LIVE_VERIFICATION.indexOf('What the sandbox regression check covers');
    const liveAt = LIVE_VERIFICATION.indexOf('Live run against real services');
    assert.ok(sandboxAt !== -1 && liveAt !== -1, 'both sections must exist');
    assert.ok(sandboxAt < liveAt, 'the sandbox section must precede the live-run section');
  });

  test('the narrower no-external-calls statement survives', () => {
    // This one is still true and must not be lost while widening the summary:
    // neither the failed attempt nor the correction touched an external service.
    assert.match(
      LIVE_VERIFICATION,
      /No\s+RSS feed was fetched, no Anthropic request was made, no Notion row was written\s+or modified/i
    );
    assert.match(
      LIVE_VERIFICATION,
      /during either the\s+failed attempt or the correction itself/i,
      'the statement must stay scoped to those two events, not to the whole project'
    );
  });

  test('the README table still separates verified rows from unverified ones', () => {
    const section = README.split(/^#{2,3} Verification status\s*$/m)[1].split(/^#{2,3} /m)[0];
    assert.match(section, /separates the two|separates completed .* from/i);
    assert.ok(/\| Verified/.test(section), 'at least one row must be marked verified');
    assert.ok(/Not yet verified/.test(section), 'at least one row must remain unverified');
  });
});

/* ================================================================== */
/* Release assets                                                      */
/* ================================================================== */

describe('release assets are safe to publish', () => {
  const ARCH = 'assets/architecture.svg';
  const SHOT = 'assets/workflow-01.png';

  test('both assets exist and are non-trivial', async () => {
    const { stat } = await import('node:fs/promises');
    for (const rel of [ARCH, SHOT]) {
      const info = await stat(path.join(ROOT, rel));
      assert.ok(info.size > 2000, `${rel} looks empty at ${info.size} bytes`);
    }
  });

  test('the diagram carries no script, external reference, or embedded image', async () => {
    const svg = await read(ARCH);
    for (const banned of [/<script/i, /xlink:href/i, /<image\b/i, /<foreignObject/i, /@import/i, /url\(\s*https?:/i]) {
      assert.ok(!banned.test(svg), `architecture.svg contains ${banned}`);
    }
    // The SVG namespace declaration is required markup, not a fetched resource.
    const withoutNamespace = svg.replace(/xmlns(:\w+)?="[^"]*"/g, '');
    assert.ok(
      !/https?:\/\//.test(withoutNamespace),
      'the diagram must contain no URL beyond its namespace declaration'
    );
  });

  test('the diagram uses real text, not outlined paths', async () => {
    const svg = await read(ARCH);
    const textCount = (svg.match(/<text\b/g) ?? []).length;
    assert.ok(textCount >= 25, `expected readable <text> elements, found ${textCount}`);
    assert.match(svg, /<title\b/, 'the diagram needs an accessible title');
    assert.match(svg, /<desc\b/, 'the diagram needs an accessible description');
  });

  test('the diagram names the boundary and the sources it claims', async () => {
    const svg = await read(ARCH);
    for (const phrase of ['HUMAN REVIEW BOUNDARY', 'HubSpot Community RSS', 'Notion', 'Anthropic']) {
      assert.ok(svg.includes(phrase), `the diagram must name ${phrase}`);
    }
    assert.ok(
      /never comments, connects, messages, or emails/i.test(svg),
      'the diagram must state what Scout does not do'
    );
  });

  test('the screenshot carries no metadata chunks', async () => {
    const { readFile } = await import('node:fs/promises');
    const buf = await readFile(path.join(ROOT, SHOT));
    assert.equal(buf.subarray(0, 8).toString('latin1'), '\x89PNG\r\n\x1a\n', 'must be a PNG');
    const types = new Set();
    let i = 8;
    while (i < buf.length) {
      const len = buf.readUInt32BE(i);
      const type = buf.subarray(i + 4, i + 8).toString('latin1');
      types.add(type);
      i += 12 + len;
      if (type === 'IEND') break;
    }
    for (const meta of ['tEXt', 'iTXt', 'zTXt', 'eXIf']) {
      assert.ok(!types.has(meta), `screenshot carries a ${meta} chunk, which can leak metadata`);
    }
  });

  test('the README shows both assets with alt text', () => {
    for (const rel of [ARCH, SHOT]) {
      const m = README.match(new RegExp(`!\\[([^\\]]*)\\]\\(${rel.replace('.', '\\.')}\\)`));
      assert.ok(m, `README must embed ${rel}`);
      assert.ok(m[1].length > 60, `${rel} needs descriptive alt text, got ${m[1].length} characters`);
    }
  });
});

describe('the submission packet claims only what exists', () => {
  const TITLE = 'Turn HubSpot Community posts into prioritized RevOps signals with Claude and Notion';

  test('uses the exact creator title', () => {
    assert.ok(N8N_SUBMISSION.includes(TITLE), 'the exact submission title must appear verbatim');
  });

  test('carries every required section', () => {
    for (const heading of [
      'Who this is for', 'What it does', 'How it works', 'Prerequisites', 'Setup',
      'Required credentials', 'Notion schema', 'Safe first run', 'Customization',
      'Verification boundaries', 'Suggested categories and tags', 'Support path',
      'Assets to upload', 'Forum post outline'
    ]) {
      assert.match(N8N_SUBMISSION, new RegExp(`^#{2,3} .*${heading}`, 'mi'), `missing section: ${heading}`);
    }
  });

  test('recommends only categories the library actually shows', () => {
    assert.match(N8N_SUBMISSION, /\*\*Categories:\*\*\s*`Sales` and `AI`/);
    assert.ok(
      /`AI Summarization` is offered as a tag or use case, not as a category/i.test(N8N_SUBMISSION),
      'AI Summarization must be qualified as a tag rather than a category'
    );
  });

  test('links only URLs that exist, and still invents none', () => {
    // The repository and its issue tracker now exist, so the packet may link
    // them. A Creator Hub listing and a forum thread still do not.
    const EXISTING = ['https://github.com/scottcollier10/scout/issues'];
    const urls = N8N_SUBMISSION.match(/https?:\/\/[^\s)`]+/g) ?? [];
    const invented = urls.filter((u) => !EXISTING.includes(u));
    assert.deepEqual(invented, [], `the packet links a URL that does not exist: ${invented.join(', ')}`);
    assert.ok(
      N8N_SUBMISSION.includes(EXISTING[0]),
      'the support path must link the real issue tracker'
    );
    assert.ok(
      /[Dd]o not\s*substitute an email/.test(N8N_SUBMISSION),
      'the instruction not to substitute a personal address must survive'
    );
    for (const absent of [/creators\.n8n\.io\/[a-z]+\/[a-z0-9-]+/i, /community\.n8n\.io\/t\//i]) {
      assert.ok(!absent.test(N8N_SUBMISSION), `must not link a listing that does not exist: ${absent}`);
    }
  });

  test('states the observed first run without inflating it', () => {
    for (const fact of [
      'All three RSS endpoints responded',
      'two Anthropic requests',
      'one row',
      'not a throughput benchmark'
    ]) {
      assert.ok(N8N_SUBMISSION.includes(fact), `missing observed fact: ${fact}`);
    }
    assert.ok(
      /Setup time and cost per run have not been measured/i.test(N8N_SUBMISSION),
      'the packet must decline to publish an unmeasured figure'
    );
  });

  test('presents workflow 01 alone as the submission', () => {
    assert.ok(/covers \*\*workflow 01\*\* only/i.test(N8N_SUBMISSION));
    assert.ok(/Not part of this submission/i.test(N8N_SUBMISSION), 'companions must be excluded explicitly');
  });
});

describe('the release checklist separates gates from accepted limitations', () => {
  test('names both classes of item', () => {
    assert.match(RELEASE_CHECKLIST, /^\*\*Release gates\*\*/m);
    assert.match(RELEASE_CHECKLIST, /^\*\*Accepted limitations\*\*/m);
  });

  test('keeps every security and scan item a gate that cannot be waived', () => {
    assert.ok(
      /Every security, privacy,\s*import, source-policy, and secret-scan item is a gate/i.test(RELEASE_CHECKLIST),
      'the checklist must say those items are gates'
    );
    assert.ok(
      /None of them may be\s*waived/i.test(RELEASE_CHECKLIST),
      'the checklist must refuse waivers on gates'
    );
  });

  test('lists the accepted limitations explicitly and requires disclosure', () => {
    const section = RELEASE_CHECKLIST.split(/^## 7\. /m)[1] ?? '';
    for (const item of ['digest email', 'Workflow 04', 'Editor UI', 'Cost per run']) {
      assert.ok(section.includes(item), `accepted limitations must list: ${item}`);
    }
    assert.ok(
      /Marking any of these as done requires actually doing the thing/i.test(RELEASE_CHECKLIST),
      'the checklist must block waiving a limitation by relabelling it'
    );
  });
});

describe('every relative link in the docs resolves', () => {
  test('no markdown link points at a missing file', async () => {
    const { access } = await import('node:fs/promises');
    const problems = [];
    for (const [name, text] of Object.entries(ALL_DOCS)) {
      const dir = path.dirname(path.join(ROOT, name));
      for (const m of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
        const target = m[1].split('#')[0].trim();
        if (!target || /^(https?:|mailto:)/i.test(target)) continue;
        try {
          await access(path.resolve(dir, target));
        } catch {
          problems.push(`${name} -> ${target}`);
        }
      }
    }
    assert.deepEqual(problems, [], `broken relative links:\n  ${problems.join('\n  ')}`);
  });
});

/* ================================================================== */
/* Request-budget language                                             */
/* ================================================================== */

describe('the docs describe the request budget accurately', () => {
  // maxPostsPerFeed and batchSize limit logical items, not API calls. The
  // shipped model nodes carry retryOnFail with maxTries 3, so one item can cost
  // three attempts. Task 9's six-request ceiling held only because retries were
  // switched off in the disposable copy, which is not how the template ships.

  test('the shipped nodes really do retry, so the caution is warranted', () => {
    // If the retry policy ever changes, this test forces the wording to be
    // revisited rather than left describing a product that no longer exists.
    const nodes = [
      ['workflows/core/01-hubspot-community-signals.json', 'Classify (Claude)'],
      ['workflows/core/02-manual-signal-intake.json', 'Classify (Claude)'],
      ['workflows/extensions/05-draft-backfill.json', 'Draft (Claude)']
    ];
    for (const [file, name] of nodes) {
      const node = WORKFLOWS[file].nodes.find((n) => n.name === name);
      assert.equal(node.retryOnFail, true, `${file} / ${name} should still retry`);
      assert.equal(node.maxTries, 3, `${file} / ${name} should still allow three attempts`);
    }
  });

  test('no document calls an input cap a spend or cost ceiling', () => {
    for (const [name, text] of Object.entries(ALL_DOCS)) {
      for (const pattern of [/spend ceiling/i, /cost ceiling/i, /spending ceiling/i, /billing ceiling(?! )/i]) {
        const lines = text.split('\n').filter((l) => pattern.test(l));
        for (const line of lines) {
          assert.ok(
            /not a billing ceiling|without guaranteeing a billing ceiling|do not guarantee a billing ceiling|does not guarantee a billing ceiling/i.test(line),
            `${name} calls a cap a ceiling: ${line.trim()}`
          );
        }
      }
    }
  });

  test('no document promises an exact request count from maxPostsPerFeed', () => {
    // Checked per line with a denial guard, because the accurate wording has to
    // be able to say "it does not guarantee only three API attempts".
    const DENIAL = /\b(not|never|no|none|nothing|cannot|does not|do not|rather than|instead of)\b/i;
    const CLAIMS = [
      /caps the[^.\n]*at three (model|Anthropic|API) requests/i,
      /only three (model|Anthropic|API) (requests|calls)/i,
      /exactly (three|one) (model|Anthropic|API) (requests|calls|attempts)/i,
      /guarantees? (only )?three/i
    ];
    for (const [name, text] of Object.entries(ALL_DOCS)) {
      // Sentences, not lines: markdown hard-wraps, so a denial and the phrase it
      // denies routinely land on different lines.
      const sentences = text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/);
      for (const sentence of sentences) {
        if (DENIAL.test(sentence)) continue;
        for (const pattern of CLAIMS) {
          assert.ok(!pattern.test(sentence), `${name} promises an exact request count: ${sentence.trim()}`);
        }
      }
    }
  });

  test('wherever a cap is framed as a cost control, retries are mentioned', () => {
    // Only prose that ties a cap to money needs the caveat. Merely listing
    // maxPostsPerFeed as an adjustable setting does not.
    const CAP = /\b(maxPostsPerFeed|batchSize)\b/g;
    const MONEY = /\b(cost|costs|spend|spending|billing|billed|charge|charged|ceiling|cheap|price)\b/i;
    const RETRY = /retr(y|ies|ying)|maxTries|three attempts|up to three/i;
    for (const [name, text] of Object.entries(ALL_DOCS)) {
      const flat = text.replace(/\s+/g, ' ');
      for (const match of flat.matchAll(CAP)) {
        // Two windows on purpose. A tight one decides whether this mention is
        // actually framed as a cost control, so a plain settings list is not
        // flagged. A wider one looks for the caveat, which may sit a paragraph
        // away in the same section.
        const claim = flat.slice(Math.max(0, match.index - 250), match.index + 250);
        if (!MONEY.test(claim)) continue;
        const window = flat.slice(Math.max(0, match.index - 900), match.index + 900);
        assert.ok(
          RETRY.test(window),
          `${name} ties ${match[0]} to cost without mentioning retries:\n  ...${window.slice(700, 1100)}...`
        );
      }
    }
  });

  test('the docs point at a provider-side limit as the real guard', () => {
    const README_AND_SETUP = [['README.md', README], ['docs/setup.md', SETUP]];
    for (const [name, text] of README_AND_SETUP) {
      assert.ok(
        /usage limit|spend alert/i.test(text),
        `${name} must name the provider-side guard rather than implying the cap is one`
      );
    }
  });

  test('live-verification explains why the Task 9 ceiling was enforceable', () => {
    assert.ok(
      /retryOnFail.{0,80}(switched off|disabled)|(switched off|disabled).{0,80}retr/is.test(LIVE_VERIFICATION),
      'the record must say retries were disabled, or the six-request ceiling reads as a product guarantee'
    );
  });
});

/* ================================================================== */
/* Live-run data provenance                                            */
/* ================================================================== */

describe('the verification record states where its two rows came from', () => {
  // An earlier version of live-verification.md said every test record was
  // fictional. That was wrong. Workflow 01 read real public HubSpot Community
  // RSS and wrote a row built from a real person's forum post; only workflow
  // 02's row was invented. The distinction matters because one row is evidence
  // that may not be reused as illustration, and the other is safe to show.
  //
  // Nothing in this suite quotes the real row. These tests assert the shape of
  // the claim, never its content.

  test('names one real public-source row from workflow 01', () => {
    assert.match(
      LIVE_VERIFICATION,
      /\*\*one real public-source row\*\*/,
      'the record must say workflow 01 produced a real public-source row'
    );
    assert.match(
      LIVE_VERIFICATION,
      /Workflow 01 read real\s+public HubSpot Community RSS content/,
      'the record must say the RSS content workflow 01 read was real'
    );
  });

  test('names one synthetic manual-intake row from workflow 02', () => {
    assert.match(
      LIVE_VERIFICATION,
      /\*\*one synthetic manual-intake row\*\*/,
      'the record must say workflow 02 produced a synthetic row'
    );
    assert.match(LIVE_VERIFICATION, /\*\*one synthetic manual submission\*\*/);
  });

  test('keeps the zero-row baseline', () => {
    assert.match(
      LIVE_VERIFICATION,
      /database held zero rows before the run/,
      'the baseline is what makes the two created rows attributable'
    );
  });

  test('carries none of the superseded blanket phrases', () => {
    // Checked as whole phrases, not words: the page may still explain that the
    // old wording was wrong, and must be able to name it to do so.
    const SUPERSEDED = [
      /Every test record is fictional/i,
      /the two fictional rows/i,
      /the same fictional rows/i,
      /both rows (are|were) fictional/i
    ];
    for (const phrase of SUPERSEDED) {
      const flat = LIVE_VERIFICATION.replace(/\s+/g, ' ');
      const hit = flat.match(phrase);
      if (!hit) continue;
      const at = flat.indexOf(hit[0]);
      const context = flat.slice(Math.max(0, at - 120), at + hit[0].length);
      assert.ok(
        /wrongly|incorrect|superseded|earlier version|no longer|was what the check caught/i.test(context),
        `live-verification.md still asserts "${hit[0]}" as current fact`
      );
    }
  });

  test('forbids reusing the real-source content anywhere public', () => {
    const section = LIVE_VERIFICATION.split(/^### Provenance and the reuse boundary$/m)[1];
    assert.ok(section, 'the page needs a provenance and reuse boundary section');
    const boundary = section.split(/^### /m)[0];
    for (const surface of ['screenshot', 'portfolio asset', 'test fixture', 'example file', 'quoted text']) {
      assert.ok(
        boundary.includes(surface),
        `the reuse boundary must name ${surface} as off limits`
      );
    }
    assert.match(
      boundary,
      /Redacting parts of it does not\s+make the rest reusable/,
      'partial redaction must be ruled out explicitly'
    );
    assert.match(
      boundary.replace(/\s+/g, ' '),
      /no screenshot, no temporary copy, and no candidate image was ever created/,
      'the record must state that the capture was stopped before anything existed'
    );
  });

  test('the measured verification facts are unchanged by this correction', () => {
    // Correcting provenance must not soften what was actually measured.
    for (const fact of [
      '**Five requests were used.**',
      '2484 input tokens, 636',
      '| Workflow 01, HubSpot Community Signals | 2 | 1304 | 264 | 1 row created |',
      '| Workflow 02, Manual Signal Intake | 1 | 405 | 193 | 1 row created |',
      '| Workflow 05, Draft Backfill | 2 | 775 | 179 | 2 rows patched |'
    ]) {
      assert.ok(LIVE_VERIFICATION.includes(fact), `the correction dropped a measured fact: ${fact}`);
    }
    assert.match(LIVE_VERIFICATION, /\| Email delivery \|[^\n]*\*\*Not done\*\*/);
    assert.match(LIVE_VERIFICATION, /\| Gmail trigger \|[^\n]*\*\*Not done\*\*/);
  });

  test('this suite quotes no value from the real public-source row', () => {
    // A guard on the guard. The tests describe the real row only through the
    // two agreed public-safe labels, and must never start carrying a sample of
    // it "for realism".
    const self = readFileSync(new URL(import.meta.url), 'utf8');
    const body = self.split('/* Live-run data provenance')[1] ?? '';
    assert.ok(
      !/community\.hubspot\.com\/t\//.test(body),
      'no real topic URL may appear in this suite'
    );
    assert.ok(
      /real public-source row/.test(body) && /synthetic manual-intake row/.test(body),
      'the suite should refer to the rows only by their public-safe labels'
    );
  });
});

/* ================================================================== */
/* Shipped public defaults                                             */
/* ================================================================== */

describe('the shipped defaults are the conservative ones', () => {
  // v0.1 ships 5 rather than 25 for both item caps. Five is a conservative
  // shipping choice, not a verified volume: the one live run used
  // maxPostsPerFeed 1 and batchSize 2, so nothing has been observed at 5, and
  // neither number is a billing ceiling because the model nodes retry.
  const setupValue = (file, key) =>
    WORKFLOWS[file].nodes
      .find((n) => n.name === 'Scout Setup')
      .parameters.assignments.assignments.find((a) => a.name === key);

  test('workflow 01 ships maxPostsPerFeed 5', () => {
    const a = setupValue('workflows/core/01-hubspot-community-signals.json', 'maxPostsPerFeed');
    assert.equal(a.value, 5);
    assert.equal(a.type, 'number');
  });

  test('workflow 05 ships batchSize 5', () => {
    const a = setupValue('workflows/extensions/05-draft-backfill.json', 'batchSize');
    assert.equal(a.value, 5);
    assert.equal(a.type, 'number');
  });

  test('both defaults stay inside the validators own accepted range', () => {
    // Validate Setup rejects maxPostsPerFeed outside 1 to 100 and batchSize
    // outside 1 to 50. A default the workflow would refuse to run is worse
    // than a large one.
    const max = setupValue('workflows/core/01-hubspot-community-signals.json', 'maxPostsPerFeed').value;
    const batch = setupValue('workflows/extensions/05-draft-backfill.json', 'batchSize').value;
    assert.ok(Number.isInteger(max) && max >= 1 && max <= 100);
    assert.ok(Number.isInteger(batch) && batch >= 1 && batch <= 50);
  });

  test('the docs call five conservative, not verified', () => {
    for (const [name, text] of [['docs/setup.md', SETUP], ['docs/workflow-reference.md', WORKFLOW_REFERENCE]]) {
      assert.ok(
        /conservative shipping default/i.test(text),
        `${name} must describe the default as a conservative shipping choice`
      );
      assert.ok(
        !/verified at (five|5)|proven at (five|5)|tested at (five|5)/i.test(text),
        `${name} must not claim the default was verified at that volume`
      );
    }
  });

  test('the safe first run still recommends smaller numbers than the defaults', () => {
    // Whitespace-normalised: these documents hard-wrap, so a phrase routinely
    // straddles a line break and the assertion should test meaning, not layout.
    const flat = (t) => t.replace(/\s+/g, ' ');
    for (const [name, text] of [['docs/n8n-submission.md', N8N_SUBMISSION], ['docs/setup.md', SETUP]]) {
      assert.match(flat(text), /`maxPostsPerFeed` to `1`/i, `${name} must recommend maxPostsPerFeed 1 first`);
      assert.match(flat(text), /`batchSize` to `2`/i, `${name} must recommend batchSize 2 first`);
    }
  });
});

/* ================================================================== */
/* Scope and extension                                                 */
/* ================================================================== */

describe('the README bounds the scope before describing the pattern', () => {
  // The section exists so the reusable idea has a home without implying Scout
  // is already configurable. Both halves have to stay: the pattern is the
  // interesting part, and the disclaimer is what keeps it honest.
  const section = () =>
    README.split(/^## Scope and extension$/m)[1]?.split(/^## /m)[0] ?? '';

  test('the section exists and precedes the verification status', () => {
    const scope = README.indexOf('## Scope and extension');
    const verification = README.indexOf('## Verification status');
    assert.ok(scope !== -1, 'the README needs a Scope and extension section');
    assert.ok(scope < verification, 'scope should be stated before verification claims');
  });

  test('it disclaims being a generic scraper', () => {
    const flat = section().replace(/\s+/g, ' ');
    assert.match(flat, /not a generic scraper/i);
    assert.match(flat, /does not claim support for arbitrary communities/i);
  });

  test('it names the pattern as a shape, not as implemented capability', () => {
    const flat = section().replace(/\s+/g, ' ');
    for (const step of ['intake', 'qualification', 'signal mapping', 'human-reviewed action']) {
      assert.ok(flat.includes(step), `the pattern must name: ${step}`);
    }
    assert.match(flat, /the shape of the system, not its code/i,
      'what carries over is the shape, not the implementation');
    assert.match(flat, /would need its own/i,
      'another source must read as work to be done, not a setting to flip');
    assert.ok(
      !/(supports|works with|compatible with) (github|reddit|linkedin|discourse|slack)/i.test(flat),
      'no other source may be described as supported'
    );
  });

  test('it requires per-source review rather than implying configurability', () => {
    const flat = section().replace(/\s+/g, ' ');
    assert.match(flat, /access-policy review/i);
    // Comma-tolerant: the sentence reads "its own parsing and validation".
    assert.match(flat, /parsing,? and\s*validation/i);
    assert.match(flat, /None of that exists here/i,
      'the section must say the support is absent, not merely unimplemented');
  });

  test('the claim that another feed is rejected matches the shipped validator', () => {
    // The section tells readers a foreign feed is refused before the first
    // request. That has to be true of the code, not just the prose.
    const code = WORKFLOWS['workflows/core/01-hubspot-community-signals.json']
      .nodes.find((n) => n.name === 'Validate Setup').parameters.jsCode;
    assert.ok(code.includes("FEED_HOST = 'community.hubspot.com'"), 'the host is pinned in code');
    assert.ok(/must be hosted on/.test(code), 'a foreign host produces an error');
    assert.ok(/throw new Error/.test(code), 'validation failure stops the run');
  });
});

/* ================================================================== */
/* Source-policy scope statement                                       */
/* ================================================================== */

describe('the source policy states scope before extension', () => {
  const section = () =>
    SOURCE_POLICY.split(/^### Scope, and what could carry over$/m)[1]?.split(/^#{2,3} /m)[0] ?? '';

  test('the section exists under the adding-a-source material', () => {
    const adding = SOURCE_POLICY.indexOf('## Adding a source later');
    const scope = SOURCE_POLICY.indexOf('### Scope, and what could carry over');
    assert.ok(scope !== -1, 'source-policy.md needs the scope section');
    assert.ok(adding !== -1 && adding < scope, 'it belongs under the adding-a-source material');
  });

  test('it disclaims generality and keeps other sources hypothetical', () => {
    const flat = section().replace(/\s+/g, ' ');
    assert.match(flat, /not a generic scraper/i);
    assert.match(flat, /does not claim support for other communities/i);
    assert.match(flat, /the shape of the system,\s*not its code/i);
    assert.match(flat, /would need its own/i, 'a new source must be described as work, not a setting');
  });

  test('Scout is never described as source-agnostic or adapter-based', () => {
    for (const [name, text] of Object.entries(ALL_DOCS)) {
      for (const claim of [
        /source[- ]agnostic/i,
        /source[- ]adapter (interface|system|layer)/i,
        /configurable across (arbitrary|any) (communities|sources)/i,
        /pluggable sources?/i
      ]) {
        assert.ok(!claim.test(text), `${name} implies configurability that does not exist: ${claim}`);
      }
    }
  });

  test('the README carries its own summary and also points at the canonical text', () => {
    // The README states the scope itself, in its own section, and links to the
    // fuller statement in the source policy. Both are true, and an earlier
    // version of this test claimed the README only pointed.
    assert.ok(
      README.includes('## Scope and extension'),
      'the README states the scope in its own section'
    );
    assert.ok(
      README.includes('docs/source-policy.md#scope-and-what-could-carry-over'),
      'and links to the canonical statement in the source policy'
    );
    // The two must agree on the load-bearing sentence.
    const shared = 'the shape of the system, not its code';
    assert.ok(README.replace(/\s+/g, ' ').includes(shared), 'README must carry the shared framing');
    assert.ok(SOURCE_POLICY.replace(/\s+/g, ' ').includes(shared), 'source policy must carry it too');
  });

  test('the submission packet stays scoped to HubSpot Community RSS', () => {
    // The n8n submission is deliberately narrower than the repository.
    assert.ok(
      !/(github issues|n8n community discussions)/i.test(N8N_SUBMISSION),
      'the submission must not advertise sources Scout does not read'
    );
  });
});
