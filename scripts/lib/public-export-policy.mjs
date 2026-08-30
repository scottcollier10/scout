import { createHash } from 'node:crypto';

/**
 * Public export safety and structural policy for Scout workflows.
 *
 * Two independent gates run over every file in `workflows/`:
 *
 *   scanWorkflow()     - safety. Would publishing this leak anything private?
 *   validateWorkflow() - structure. Will this import and run for a stranger?
 *
 * Rule for the whole module: a finding may name a *location* but never the
 * matched value. Findings end up in CI logs, so echoing the match would
 * defeat the purpose of scanning.
 */

export const APPROVED_HOSTS = new Set([
  'community.hubspot.com',
  'api.anthropic.com',
  'api.notion.com'
]);

/** Exact `Scout Setup` keys each public workflow must expose, in order. */
export const SETUP_KEY_CONTRACT = {
  '01-hubspot-community-signals.json': [
    'notionDatabaseId',
    'anthropicModel',
    'hubspotCommunityFeeds',
    'lookbackHours',
    'maxPostsPerFeed'
  ],
  '02-manual-signal-intake.json': ['notionDatabaseId', 'anthropicModel'],
  '03-stale-signal-nudge.json': [
    'notionDatabaseId',
    'recipientEmail',
    'staleDaysByAction'
  ],
  '04-community-engagement-sync.json': ['notionDatabaseId'],
  '05-draft-backfill.json': ['notionDatabaseId', 'anthropicModel', 'batchSize'],
  '06-weekly-scorecard.json': [
    'notionDatabaseId',
    'recipientEmail',
    'weeklyTargets'
  ]
};

const STICKY_NOTE_TYPE = 'n8n-nodes-base.stickyNote';
const SETUP_NODE_NAME = 'Scout Setup';

const BUILTIN_NODE_PREFIXES = ['n8n-nodes-base.', '@n8n/n8n-nodes-langchain.'];

const ALLOWED_ROOT_KEYS = new Set([
  'name',
  'nodes',
  'connections',
  'active',
  'settings',
  'pinData',
  'tags'
]);

const EXTRA_TRIGGER_TYPES = new Set([
  'n8n-nodes-base.webhook',
  'n8n-nodes-base.cron',
  'n8n-nodes-base.interval',
  'n8n-nodes-base.start'
]);

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const HEX32_RE = /\b[0-9a-f]{32}\b/i;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]*[A-Za-z]\b/;
const URL_RE = /https?:\/\/[^\s"'`<>)\]}\\]+/gi;
const NODE_REFERENCE_RE = /\$\(\s*(['"])([^'"]+)\1\s*\)/g;
const HIGH_ENTROPY_TOKEN_RE = /[A-Za-z0-9+/=_-]{32,}/g;

const KNOWN_SECRET_PREFIX_RE = new RegExp(
  [
    'sk-[A-Za-z0-9_-]{16,}',
    'xox[baprs]-[A-Za-z0-9-]{10,}',
    'ghp_[A-Za-z0-9]{20,}',
    'github_pat_[A-Za-z0-9_]{20,}',
    'secret_[A-Za-z0-9]{32,}',
    'ntn_[A-Za-z0-9]{30,}',
    'AKIA[0-9A-Z]{16}',
    'AIza[0-9A-Za-z_-]{20,}',
    'eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}'
  ].join('|')
);

/**
 * Deterministic, public, reproducible UUID for template identifiers.
 *
 * Anyone can regenerate these from the workflow and node names alone, which
 * is exactly why they are safe to publish: they carry no information about
 * Scott's n8n instance.
 */
export function stableTemplateId(seed) {
  const digest = createHash('sha256').update(String(seed), 'utf8').digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32)
  ].join('-');
}

/**
 * Every identifier the sanitizer is allowed to have produced for this
 * workflow. The scanner treats these as public template values rather than
 * leaked private identifiers, which keeps sanitizer and scanner in lockstep.
 */
export function deterministicIdAllowlist(workflow) {
  const allow = new Set();
  const name = workflow?.name ?? '';
  for (const node of workflow?.nodes ?? []) {
    if (!node?.name) continue;
    allow.add(stableTemplateId(`${name}:${node.name}`));
    allow.add(stableTemplateId(`${name}:webhook:${node.name}`));
    for (const assignment of node?.parameters?.assignments?.assignments ?? []) {
      if (assignment?.name) {
        allow.add(stableTemplateId(`${name}:${node.name}:${assignment.name}`));
      }
    }
  }
  return allow;
}

function joinPath(base, key) {
  if (typeof key === 'number') return `${base}[${key}]`;
  return base ? `${base}.${key}` : String(key);
}

function walkStrings(value, basePath, visit, skipKeys = new Set()) {
  if (typeof value === 'string') {
    visit(value, basePath);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      walkStrings(item, joinPath(basePath, index), visit, skipKeys)
    );
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (skipKeys.has(key)) continue;
      walkStrings(child, joinPath(basePath, key), visit, skipKeys);
    }
  }
}

function shannonEntropy(text) {
  const counts = new Map();
  for (const char of text) counts.set(char, (counts.get(char) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / text.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function looksLikeSecret(text) {
  if (KNOWN_SECRET_PREFIX_RE.test(text)) return true;
  for (const token of text.match(HIGH_ENTROPY_TOKEN_RE) ?? []) {
    const hasLetter = /[A-Za-z]/.test(token);
    const hasDigit = /[0-9]/.test(token);
    if (!hasLetter || !hasDigit) continue;
    if (shannonEntropy(token) >= 4.2) return true;
  }
  return false;
}

function finding(severity, code, workflow, location, message) {
  return { severity, code, workflow, location, message };
}

function isSticky(node) {
  return node?.type === STICKY_NOTE_TYPE;
}

function isTrigger(node) {
  const type = node?.type ?? '';
  return /Trigger$/.test(type) || EXTRA_TRIGGER_TYPES.has(type);
}

function hasCredentials(node) {
  return Boolean(node?.credentials) && Object.keys(node.credentials).length > 0;
}

/* ------------------------------------------------------------------ */
/* Safety scanning                                                      */
/* ------------------------------------------------------------------ */

export function scanWorkflow(workflow, workflowPath) {
  const findings = [];
  const add = (code, location, message) =>
    findings.push(finding('error', code, workflowPath, location, message));

  if (workflow?.id !== undefined) {
    add('ROOT_ID', 'id', 'Root workflow id must be removed from a public export.');
  }
  if (workflow?.versionId !== undefined) {
    add(
      'VERSION_ID',
      'versionId',
      'Root versionId ties the export to a private instance and must be removed.'
    );
  }
  if (workflow?.meta !== undefined) {
    add(
      'INSTANCE_META',
      'meta',
      'Workflow meta carries instance identifiers and must be removed.'
    );
  }
  if (workflow?.active !== false) {
    add(
      'ACTIVE_WORKFLOW',
      'active',
      'Public exports must ship inactive so importing cannot start a schedule.'
    );
  }

  const allowlist = deterministicIdAllowlist(workflow);
  const nodes = workflow?.nodes ?? [];

  nodes.forEach((node, index) => {
    const nodeBase = `nodes[${index}]`;
    if (hasCredentials(node)) {
      add(
        'CREDENTIAL_BINDING',
        `${nodeBase}.credentials`,
        'Node binds a credential. Public exports must leave credential slots unbound.'
      );
    }

    walkStrings(
      node,
      nodeBase,
      (text, location) => {
        if (allowlist.has(text)) return;

        if (EMAIL_RE.test(text)) {
          add(
            'LITERAL_EMAIL',
            location,
            'Value contains a literal email address. Move it to Scout Setup and default it to an empty string.'
          );
        }
        if (UUID_RE.test(text) || HEX32_RE.test(text)) {
          add(
            'PRIVATE_IDENTIFIER',
            location,
            'Value embeds an identifier that is not a deterministic public template id.'
          );
        }
        if (looksLikeSecret(text)) {
          add(
            'SECRET_PATTERN',
            location,
            'Value looks like a credential. Secrets belong in the n8n credential store.'
          );
        }
        for (const match of text.match(URL_RE) ?? []) {
          let host;
          try {
            host = new URL(match).hostname.toLowerCase();
          } catch {
            continue;
          }
          if (!APPROVED_HOSTS.has(host)) {
            add(
              'UNAPPROVED_HOST',
              location,
              'URL targets a host outside the approved set (community.hubspot.com, api.anthropic.com, api.notion.com).'
            );
          }
        }
      },
      new Set(['credentials'])
    );
  });

  return findings;
}

/* ------------------------------------------------------------------ */
/* Structural validation                                                */
/* ------------------------------------------------------------------ */

export function validateWorkflow(workflow, workflowPath) {
  const findings = [];
  const add = (code, location, message) =>
    findings.push(finding('error', code, workflowPath, location, message));

  const nodes = workflow?.nodes ?? [];
  const connections = workflow?.connections ?? {};
  const nodeNames = new Set(nodes.map((n) => n?.name).filter(Boolean));
  const executable = nodes.filter((n) => !isSticky(n));

  if (!workflow?.name || String(workflow.name).trim() === '') {
    add('MISSING_NAME', 'name', 'Public workflow name must not be empty.');
  }
  if (workflow?.active !== false) {
    add('ACTIVE_WORKFLOW', 'active', 'Public workflow must be inactive.');
  }

  for (const key of Object.keys(workflow ?? {})) {
    if (!ALLOWED_ROOT_KEYS.has(key)) {
      add(
        'UNKNOWN_ROOT_KEY',
        key,
        'Unexpected root key in a public export. Allowed keys are name, nodes, connections, active, settings, pinData, tags.'
      );
    }
  }

  if (workflow?.pinData && Object.keys(workflow.pinData).length > 0) {
    add('PIN_DATA', 'pinData', 'Public exports must not ship pinned execution data.');
  }

  if (workflow?.settings?.executionOrder !== 'v1') {
    add(
      'EXECUTION_ORDER',
      'settings.executionOrder',
      'Workflow must use connection-based execution order ("v1").'
    );
  }

  // Node types and credential bindings.
  nodes.forEach((node, index) => {
    const type = node?.type ?? '';
    if (!BUILTIN_NODE_PREFIXES.some((prefix) => type.startsWith(prefix))) {
      add(
        'NON_BUILTIN_NODE',
        `nodes[${index}].type`,
        'Only n8n built-in node types are allowed in v0.1. No community nodes.'
      );
    }
    if (hasCredentials(node)) {
      add(
        'CREDENTIAL_BINDING',
        `nodes[${index}].credentials`,
        'Node binds a credential. Public exports must leave credential slots unbound.'
      );
    }
  });

  // Exactly one executable trigger, with Scout Setup wired directly after it.
  const triggers = executable.filter(isTrigger);
  if (triggers.length !== 1) {
    add(
      'TRIGGER_COUNT',
      'nodes',
      `Workflow must declare exactly one executable trigger, found ${triggers.length}.`
    );
  }

  const setupNode = nodes.find((n) => n?.name === SETUP_NODE_NAME);
  if (!setupNode) {
    add('SETUP_MISSING', 'nodes', `Workflow must contain a node named "${SETUP_NODE_NAME}".`);
  } else {
    if (setupNode.parameters?.includeOtherFields !== true) {
      add(
        'SETUP_DROPS_FIELDS',
        'Scout Setup.parameters.includeOtherFields',
        'Scout Setup must keep incoming fields so trigger payloads survive the setup step.'
      );
    }

    const expected = SETUP_KEY_CONTRACT[basename(workflowPath)];
    if (!expected) {
      add(
        'UNKNOWN_WORKFLOW_FILE',
        workflowPath,
        'Workflow filename has no entry in the Scout Setup key contract.'
      );
    } else {
      const actual = (setupNode.parameters?.assignments?.assignments ?? [])
        .map((a) => a?.name)
        .filter(Boolean);
      const missing = expected.filter((k) => !actual.includes(k));
      const extra = actual.filter((k) => !expected.includes(k));
      if (missing.length > 0 || extra.length > 0) {
        add(
          'SETUP_KEYS',
          'Scout Setup.parameters.assignments',
          `Scout Setup keys do not match the contract. Missing: [${missing.join(', ')}]. Unexpected: [${extra.join(', ')}].`
        );
      }
    }
  }

  if (triggers.length === 1 && setupNode) {
    const triggerName = triggers[0].name;
    const firstTargets = (connections[triggerName]?.main?.[0] ?? []).map((c) => c?.node);
    if (!firstTargets.includes(SETUP_NODE_NAME)) {
      add(
        'SETUP_NOT_AFTER_TRIGGER',
        `connections.${triggerName}`,
        `"${SETUP_NODE_NAME}" must be connected immediately after the trigger.`
      );
    }
  }

  // Connection integrity and connectivity.
  const connected = new Set();
  for (const [source, outputs] of Object.entries(connections)) {
    if (!nodeNames.has(source)) {
      add(
        'BROKEN_CONNECTION',
        `connections.${source}`,
        'Connection source refers to a node that does not exist.'
      );
      continue;
    }
    connected.add(source);
    for (const branches of Object.values(outputs ?? {})) {
      for (const branch of branches ?? []) {
        for (const link of branch ?? []) {
          const target = link?.node;
          if (!target || !nodeNames.has(target)) {
            add(
              'BROKEN_CONNECTION',
              `connections.${source}`,
              'Connection target refers to a node that does not exist.'
            );
            continue;
          }
          connected.add(target);
        }
      }
    }
  }

  for (const node of executable) {
    if (!connected.has(node.name)) {
      add(
        'DISCONNECTED_NODE',
        `nodes.${node.name}`,
        'Executable node is not connected to the workflow graph.'
      );
    }
  }

  // Cross-node expression references.
  for (const [index, node] of nodes.entries()) {
    walkStrings(
      node,
      `nodes[${index}]`,
      (text, location) => {
        NODE_REFERENCE_RE.lastIndex = 0;
        let match;
        while ((match = NODE_REFERENCE_RE.exec(text)) !== null) {
          const referenced = match[2];
          if (!nodeNames.has(referenced)) {
            add(
              'MISSING_NODE_REFERENCE',
              location,
              `Expression references node "${referenced}", which does not exist in this workflow.`
            );
          }
        }
      },
      new Set(['credentials'])
    );
  }

  return findings;
}

function basename(filePath) {
  return String(filePath).split('/').pop();
}
