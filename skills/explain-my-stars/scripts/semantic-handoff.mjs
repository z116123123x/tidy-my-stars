import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual, TextDecoder } from 'node:util';

import { parseAndValidateAnalysisSource } from './analysis-contract.mjs';
import {
  createApplicationValidationReceipt,
  validateApplicationReceipt
} from './application-contract.mjs';
import {
  canonicalSha256,
  createSemanticValidationReceipt,
  validateSemanticPlan
} from './semantic-contract.mjs';

const semanticSnapshots = new WeakMap();

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function loadExactFile(path, label) {
  const entry = lstatSync(path);
  if (entry.isSymbolicLink() || !statSync(path).isFile()) {
    throw new Error(`${label} must be a regular, non-symbolic-link file`);
  }
  const status = statSync(path);
  const bytes = readFileSync(path);
  const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  if (!Buffer.from(source, 'utf8').equals(bytes)) {
    throw new Error(`${label} UTF-8 decoding did not preserve exact source bytes`);
  }
  return { bytes, source, identity: `${status.dev}:${status.ino}` };
}

function loadExactJson(path, label = basename(path)) {
  const loaded = loadExactFile(path, label);
  try {
    return { ...loaded, value: JSON.parse(loaded.source) };
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function loadSemanticRunDirectory(path) {
  const requested = resolve(path);
  if (lstatSync(requested).isSymbolicLink()) {
    throw new Error('semantic run directory must not be a symbolic link');
  }
  const directory = realpathSync(requested);
  if (!statSync(directory).isDirectory()) throw new Error('semantic run path must be a directory');
  return directory;
}

export function assertSemanticSnapshot(snapshot) {
  if (!semanticSnapshots.has(snapshot)) throw new Error('A validated semantic handoff snapshot is required.');
}

export function readSemanticSnapshot(snapshot) {
  assertSemanticSnapshot(snapshot);
  const value = semanticSnapshots.get(snapshot);
  return {
    input_path: value.input_path,
    semantic_run_path: value.semantic_run_path,
    source: value.source,
    bytes: Buffer.from(value.bytes),
    input_sha256: value.input_sha256,
    analysis: structuredClone(value.analysis),
    counts: structuredClone(value.counts),
    application: Object.freeze({
      ...value.application,
      limitations: Object.freeze([...value.application.limitations])
    }),
    semantic: Object.freeze({
      ...value.semantic,
      limitations: Object.freeze([...value.semantic.limitations])
    })
  };
}

export function loadSemanticHandoff({ inputPath, semanticRunPath, applicationReceiptPath }) {
  if (!inputPath || !semanticRunPath) {
    throw new Error('Both stars-analysis.json and a semantic run directory are required.');
  }
  const input = resolve(inputPath);
  const inputFile = loadExactFile(input, basename(input));
  const parsed = parseAndValidateAnalysisSource(inputFile.source);
  const directory = loadSemanticRunDirectory(semanticRunPath);
  const planFile = loadExactJson(join(directory, 'semantic-plan.json'));
  const collectionFile = loadExactJson(join(directory, 'collection-receipt.json'));
  const executionFile = loadExactJson(join(directory, 'execution-receipts.json'));
  const receiptFile = loadExactJson(join(directory, 'semantic-validation.json'));
  const semanticFiles = [
    ['semantic-plan.json', planFile],
    ['collection-receipt.json', collectionFile],
    ['execution-receipts.json', executionFile],
    ['semantic-validation.json', receiptFile]
  ];
  const identities = new Map([[inputFile.identity, basename(input)]]);
  for (const [name, file] of semanticFiles) {
    if (identities.has(file.identity)) {
      throw new Error(`${name} and ${identities.get(file.identity)} must be distinct files and must not alias the same file`);
    }
    identities.set(file.identity, name);
  }
  const result = validateSemanticPlan(planFile.value, {
    baseDirectory: directory,
    collectionReceipt: collectionFile.value,
    executionReceipts: executionFile.value
  });
  if (!result.valid) {
    throw new Error(
      `Semantic plan validation failed with ${result.errors.length} error(s):\n- ${result.errors.join('\n- ')}`
    );
  }
  const derivedReceipt = createSemanticValidationReceipt(planFile.value, result);
  if (!isDeepStrictEqual(receiptFile.value, derivedReceipt)) {
    throw new Error('semantic-validation.json does not exactly match the independently derived passing receipt');
  }
  if (!isDeepStrictEqual(parsed.analysis, planFile.value.candidate)) {
    throw new Error('stars-analysis.json is not exactly the validated semantic plan candidate');
  }
  const candidateSha256 = canonicalSha256(parsed.analysis);
  if (candidateSha256 !== result.bindings.stars_analysis_sha256) {
    throw new Error('stars-analysis.json canonical hash does not match the validated semantic candidate hash');
  }
  if (parsed.analysis.run?.application_status !== 'planned') {
    throw new Error('The semantic handoff accepts only a pre-write candidate with application_status "planned"');
  }

  let application = Object.freeze({
    status: 'planned',
    receipt_sha256: null,
    validation_receipt_sha256: null,
    final_state_sha256: null,
    limitations: Object.freeze([])
  });
  if (applicationReceiptPath) {
    const receiptPath = resolve(applicationReceiptPath);
    if (basename(receiptPath) !== 'application-receipt.json') {
      throw new Error('The application receipt path must name application-receipt.json');
    }
    const applicationDirectory = loadSemanticRunDirectory(dirname(receiptPath));
    const applicationFiles = [
      ['application-receipt.json', loadExactJson(receiptPath)],
      ['application-validation.json', loadExactJson(join(applicationDirectory, 'application-validation.json'))],
      ['stars-lists-diff.json', loadExactJson(join(applicationDirectory, 'stars-lists-diff.json'))],
      ['stars-rebuild-recovery.json', loadExactJson(join(applicationDirectory, 'stars-rebuild-recovery.json'))],
      ['stars-current-pre-write-state.json', loadExactJson(join(applicationDirectory, 'stars-current-pre-write-state.json'))],
      ['application-preflight-validation.json', loadExactJson(join(applicationDirectory, 'application-preflight-validation.json'))],
      ['stars-final-state.json', loadExactJson(join(applicationDirectory, 'stars-final-state.json'))]
    ];
    for (const [name, file] of applicationFiles) {
      if (identities.has(file.identity)) {
        throw new Error(`${name} and ${identities.get(file.identity)} must be distinct files and must not alias the same file`);
      }
      identities.set(file.identity, name);
    }
    const byName = new Map(applicationFiles.map(([name, file]) => [name, file]));
    const applicationResult = validateApplicationReceipt(byName.get('application-receipt.json').value, {
      plannedCandidate: parsed.analysis,
      semanticValidationReceipt: derivedReceipt,
      exactDiff: byName.get('stars-lists-diff.json').value,
      recoveryArtifact: byName.get('stars-rebuild-recovery.json').value,
      currentPreWriteState: byName.get('stars-current-pre-write-state.json').value,
      applicationPreflightValidation: byName.get('application-preflight-validation.json').value,
      finalState: byName.get('stars-final-state.json').value
    });
    if (!applicationResult.valid) {
      throw new Error(
        `Application receipt validation failed with ${applicationResult.errors.length} error(s):\n- ${applicationResult.errors.join('\n- ')}`
      );
    }
    const derivedApplicationValidation = createApplicationValidationReceipt(
      byName.get('application-receipt.json').value,
      applicationResult
    );
    if (!isDeepStrictEqual(byName.get('application-validation.json').value, derivedApplicationValidation)) {
      throw new Error('application-validation.json does not exactly match the independently derived passing receipt');
    }
    application = Object.freeze({
      status: 'applied',
      receipt_sha256: canonicalSha256(byName.get('application-receipt.json').value),
      validation_receipt_sha256: canonicalSha256(derivedApplicationValidation),
      final_state_sha256: applicationResult.bindings.final_state_sha256,
      limitations: Object.freeze([...derivedApplicationValidation.limitations])
    });
  }

  const value = {
    input_path: input,
    semantic_run_path: directory,
    source: inputFile.source,
    bytes: inputFile.bytes,
    input_sha256: sha256(inputFile.bytes),
    analysis: parsed.analysis,
    counts: parsed.counts,
    application,
    semantic: Object.freeze({
      candidate_sha256: candidateSha256,
      receipt_sha256: canonicalSha256(derivedReceipt),
      plan_sha256: canonicalSha256(planFile.value),
      collection_receipt_sha256: result.bindings.collection_receipt_sha256,
      execution_receipts_sha256: result.bindings.execution_receipts_sha256,
      limitations: Object.freeze([...derivedReceipt.limitations])
    })
  };
  const snapshot = Object.freeze({});
  semanticSnapshots.set(snapshot, value);
  return snapshot;
}
