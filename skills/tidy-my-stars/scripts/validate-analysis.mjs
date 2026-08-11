#!/usr/bin/env node

import { createValidationReceipt, loadAndValidateAnalysis } from './analysis-contract.mjs';

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

const [inputPath, ...extraArguments] = process.argv.slice(2);

if (!inputPath || extraArguments.length > 0) {
  fail('Usage: node validate-analysis.mjs <stars-analysis.json>');
} else {
  try {
    const { analysis, counts } = loadAndValidateAnalysis(inputPath);
    process.stdout.write(
      `${JSON.stringify(createValidationReceipt(analysis, { valid: true, counts }), null, 2)}\n`
    );
  } catch (error) {
    fail(error.message);
  }
}
