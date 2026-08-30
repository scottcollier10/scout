#!/usr/bin/env node
import { validateWorkflow } from './lib/public-export-policy.mjs';
import { runCheck } from './lib/cli-report.mjs';

process.exitCode = await runCheck({ label: 'validate', check: validateWorkflow });
