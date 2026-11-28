#!/usr/bin/env node
// Fails unless every given Vitest JSON report ran at least one test and
// skipped none. The folio-render and raw-decode e2e suites skip themselves
// when their binary, pdfium or the RAW fixture is missing; CI provides all
// three, so a skip there means the setup regressed and must not pass quietly.
//
// Usage: node tooling/ci/assert-vitest-ran.mjs <report.json>...
import { readFileSync } from 'node:fs';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: assert-vitest-ran.mjs <vitest-json-report>...');
  process.exit(2);
}

let failed = false;
for (const file of files) {
  const report = JSON.parse(readFileSync(file, 'utf8'));
  const skipped = [];
  for (const suite of report.testResults ?? []) {
    for (const test of suite.assertionResults ?? []) {
      if (test.status !== 'passed' && test.status !== 'failed') skipped.push(`${test.fullName} (${test.status})`);
    }
  }
  const { numPassedTests = 0, numFailedTests = 0, numPendingTests = 0, numTodoTests = 0 } = report;
  const ok = numPassedTests > 0 && numFailedTests === 0 && numPendingTests === 0 && numTodoTests === 0 && skipped.length === 0;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${file}: ${numPassedTests} passed, ${numFailedTests} failed, ${numPendingTests} skipped, ${numTodoTests} todo`);
  for (const name of skipped) console.log(`     not run: ${name}`);
  if (!ok) failed = true;
}
process.exit(failed ? 1 : 0);
