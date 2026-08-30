import path from 'node:path';
import { listWorkflowFiles, readWorkflow, toRelative } from './workflow-files.mjs';

/**
 * Shared driver for the scan and validate CLIs.
 *
 * Both walk every public workflow, print one finding per line, print a final
 * count, and exit 1 when any error exists. An empty `workflows/` directory is
 * success, which keeps the harness usable during scaffolding.
 */
export async function runCheck({ label, check, root = process.cwd() }) {
  const workflowsDir = path.join(root, 'workflows');
  const files = await listWorkflowFiles(workflowsDir);

  const findings = [];
  for (const file of files) {
    const relative = toRelative(file, root);
    const workflow = await readWorkflow(file, root);
    findings.push(...check(workflow, relative));
  }

  for (const f of findings) {
    process.stdout.write(
      `${f.severity.toUpperCase()} ${f.code} ${f.workflow} :: ${f.location} :: ${f.message}\n`
    );
  }

  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.length - errors;
  process.stdout.write(
    `${label}: ${files.length} workflow(s), ${errors} error(s), ${warnings} warning(s)\n`
  );

  return errors === 0 ? 0 : 1;
}
