#!/usr/bin/env node
import { scanWorkflow } from './lib/public-export-policy.mjs';
import { runCheck } from './lib/cli-report.mjs';

process.exitCode = await runCheck({ label: 'scan', check: scanWorkflow });
