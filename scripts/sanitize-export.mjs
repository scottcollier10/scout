#!/usr/bin/env node
import { readFile, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  stableTemplateId,
  scanWorkflow,
  validateWorkflow
} from './lib/public-export-policy.mjs';

/**
 * Mechanical sanitization of an n8n export.
 *
 * This strips instance-bound metadata and makes every identifier a
 * reproducible function of public names. It deliberately does NOT do semantic
 * work: renaming Notion properties, introducing `Scout Setup`, or removing
 * unsupported claims are editorial decisions made per workflow, not something
 * a regex should guess at.
 */

const PUBLIC_ROOT_KEYS = ['name', 'nodes', 'connections', 'active', 'settings', 'pinData', 'tags'];

/** Node types where n8n needs a webhookId for the node to function. */
const WEBHOOK_REQUIRED_TYPES = new Set([
  'n8n-nodes-base.formTrigger',
  'n8n-nodes-base.webhook',
  'n8n-nodes-base.wait',
  'n8n-nodes-base.chatTrigger'
]);

/**
 * The repository root, derived from this script's own location rather than a
 * hardcoded path or `process.cwd()`. This file lives one directory below the
 * root, so the root is its parent's parent.
 *
 * The previous version pinned an absolute path from one machine, which meant
 * the pre-write safety gate below only ran in that one checkout. Anywhere else
 * it silently did nothing, and unscanned output could be written straight into
 * a working tree.
 */
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PUBLIC_REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');

/**
 * Resolves a path to its canonical form so a symlinked alias of the same
 * checkout cannot slip past the gate. The output file may not exist yet, so
 * only its parent directory is canonicalized and the basename is reattached.
 *
 * Returns null when the parent directory does not exist or cannot be resolved.
 * The caller turns that into a controlled exit rather than a stack trace, and
 * never creates the directory on the user's behalf.
 */
async function canonicalizeOutputPath(target) {
  const absolute = path.resolve(target);
  try {
    const parent = await realpath(path.dirname(absolute));
    return path.join(parent, path.basename(absolute));
  } catch {
    return null;
  }
}

/** True when `candidate` is the root itself or genuinely beneath it. */
function isInside(root, candidate) {
  if (candidate === root) return true;
  const relative = path.relative(root, candidate);
  // A sibling like `scout-oss-copy` produces a relative path starting with
  // `..`, which is how the prefix lookalike is rejected.
  return (
    relative !== '' &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== '..' &&
    !path.isAbsolute(relative)
  );
}

export function sanitizeWorkflow(workflow, publicName) {
  if (!publicName || String(publicName).trim() === '') {
    throw new Error('sanitizeWorkflow requires a non-empty public name.');
  }

  const source = structuredClone(workflow);
  const nodes = (source.nodes ?? []).map((node) => sanitizeNode(node, publicName));

  const settings = { ...(source.settings ?? {}) };
  settings.executionOrder = 'v1';

  return {
    name: publicName,
    nodes,
    connections: source.connections ?? {},
    active: false,
    settings,
    pinData: {},
    tags: []
  };
}

function sanitizeNode(node, publicName) {
  const clean = { ...node };

  delete clean.credentials;
  delete clean.webhookId;

  clean.id = stableTemplateId(`${publicName}:${node.name}`);

  if (WEBHOOK_REQUIRED_TYPES.has(node.type)) {
    clean.webhookId = stableTemplateId(`${publicName}:webhook:${node.name}`);
  }

  const assignments = clean.parameters?.assignments?.assignments;
  if (Array.isArray(assignments)) {
    clean.parameters = {
      ...clean.parameters,
      assignments: {
        ...clean.parameters.assignments,
        assignments: assignments.map((assignment) => ({
          ...assignment,
          id: stableTemplateId(`${publicName}:${node.name}:${assignment.name}`)
        }))
      }
    };
  }

  // Reorder so `id` leads, matching n8n's own export shape.
  const ordered = { id: clean.id };
  for (const [key, value] of Object.entries(clean)) {
    if (key !== 'id') ordered[key] = value;
  }
  return ordered;
}

/* ------------------------------------------------------------------ */
/* CLI                                                                  */
/* ------------------------------------------------------------------ */

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error(`Malformed argument near "${key}". Expected --flag value pairs.`);
    }
    args[key.slice(2)] = value;
  }
  return args;
}

async function main(argv) {
  const { input, output, name } = parseArgs(argv);

  if (!input || !output || !name) {
    process.stderr.write(
      'Usage: node scripts/sanitize-export.mjs --input <private.json> --output <path> --name "Scout NN | Title"\n'
    );
    return 2;
  }

  const inputPath = path.resolve(input);

  const outputPath = await canonicalizeOutputPath(output);
  if (outputPath === null) {
    process.stderr.write(
      `Output directory does not exist: ${path.dirname(path.resolve(output))}\n` +
        'Create it yourself, then run this again. This tool does not create directories.\n'
    );
    return 1;
  }

  let parsed;
  try {
    parsed = JSON.parse(await readFile(inputPath, 'utf8'));
  } catch {
    process.stderr.write(`Unable to read or parse input file: ${path.basename(inputPath)}\n`);
    return 1;
  }

  const sanitized = sanitizeWorkflow(parsed, name);

  // Writing into the public repository is only allowed for output that
  // already passes the safety gate. Everything else must land in a throwaway
  // directory first so a failed sanitization never reaches Git history.
  // Canonicalized on both sides so a symlinked alias of this checkout is
  // recognised as the same place.
  const canonicalRoot = await realpath(PUBLIC_REPO_ROOT).catch(() => PUBLIC_REPO_ROOT);
  const insidePublicRepo = isInside(canonicalRoot, outputPath);

  if (insidePublicRepo) {
    const relative = path.relative(canonicalRoot, outputPath).split(path.sep).join('/');
    const findings = [
      ...scanWorkflow(sanitized, relative),
      ...validateWorkflow(sanitized, relative).filter((f) => METADATA_CODES.has(f.code))
    ].filter((f) => f.severity === 'error');

    if (findings.length > 0) {
      process.stderr.write(
        'Refusing to write into the public repository. Sanitized output still has findings:\n'
      );
      for (const f of findings) {
        process.stderr.write(`  ${f.code} :: ${f.location} :: ${f.message}\n`);
      }
      process.stderr.write(
        'Write to a throwaway directory, fix the workflow, then copy it in.\n'
      );
      return 1;
    }
  }

  await writeFile(outputPath, `${JSON.stringify(sanitized, null, 2)}\n`, 'utf8');
  process.stdout.write(`Sanitized "${name}" -> ${outputPath}\n`);
  return 0;
}

/**
 * Metadata-only subset of structural validation. The CLI cannot demand full
 * structural validity because semantic refactoring (adding `Scout Setup`)
 * happens after sanitization by design.
 */
const METADATA_CODES = new Set([
  'ACTIVE_WORKFLOW',
  'CREDENTIAL_BINDING',
  'PIN_DATA',
  'UNKNOWN_ROOT_KEY',
  'MISSING_NAME',
  'NON_BUILTIN_NODE'
]);

/**
 * Cross-platform entry detection. Comparing against a hand-built `file://`
 * string breaks on paths containing spaces, on symlinked invocations, and on
 * Windows file URL syntax, and the failure is silent: the script exits 0
 * having done nothing.
 */
const invokedPath = process.argv[1] ? await realpath(process.argv[1]).catch(() => process.argv[1]) : '';
const invokedDirectly = invokedPath !== '' &&
  pathToFileURL(invokedPath).href === pathToFileURL(await realpath(SCRIPT_PATH).catch(() => SCRIPT_PATH)).href;

if (invokedDirectly) {
  process.exitCode = await main(process.argv.slice(2));
}
