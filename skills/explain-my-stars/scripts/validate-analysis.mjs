#!/usr/bin/env node

import { createValidationReceipt } from './analysis-contract.mjs';
import { loadSemanticHandoff, readSemanticSnapshot } from './semantic-handoff.mjs';

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

const [inputPath, semanticRunFlag, semanticRunPath, applicationFlag, applicationReceiptPath, ...extraArguments] = process.argv.slice(2);
const hasApplicationReceipt = applicationFlag === '--application-receipt' && Boolean(applicationReceiptPath);

if (!inputPath || semanticRunFlag !== '--semantic-run' || !semanticRunPath
    || (applicationFlag !== undefined && !hasApplicationReceipt) || extraArguments.length > 0) {
  fail('Usage: node validate-analysis.mjs <stars-analysis.json> --semantic-run <semantic-run-directory> [--application-receipt <application-receipt.json>]');
} else {
  try {
    const snapshot = readSemanticSnapshot(loadSemanticHandoff({
      inputPath,
      semanticRunPath,
      applicationReceiptPath: hasApplicationReceipt ? applicationReceiptPath : undefined
    }));
    process.stdout.write(
      `${JSON.stringify({
        ...createValidationReceipt(snapshot.analysis, { valid: true, counts: snapshot.counts }),
        semantic_validation: snapshot.semantic,
        application_validation: snapshot.application
      }, null, 2)}\n`
    );
  } catch (error) {
    fail(error.message);
  }
}
