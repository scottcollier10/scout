import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Recursively list every .json workflow file under `root`, sorted by relative
 * path so scanner and validator output is stable across machines.
 *
 * A missing directory is not an error. During scaffolding the public
 * repository legitimately has no workflows yet.
 */
export async function listWorkflowFiles(root) {
  if (!existsSync(root)) return [];

  const found = [];

  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        found.push(full);
      }
    }
  }

  await walk(root);
  return found.sort((a, b) => a.localeCompare(b));
}

/**
 * Parse a workflow file as UTF-8 JSON.
 *
 * On failure the thrown error names the file but never includes file
 * contents, so a malformed private export cannot leak through an error
 * message or CI log.
 */
export async function readWorkflow(filePath, root = process.cwd()) {
  const relative = path.relative(root, filePath);
  let raw;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (cause) {
    throw new Error(`Unable to read workflow file: ${relative}`, { cause: undefined });
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Workflow file is not valid JSON: ${relative}`);
  }
}

export function toRelative(filePath, root = process.cwd()) {
  return path.relative(root, filePath).split(path.sep).join('/');
}
