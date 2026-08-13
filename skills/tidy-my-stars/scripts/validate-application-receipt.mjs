#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import {
  closeSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual, TextDecoder } from 'node:util';

import {
  createApplicationValidationReceipt,
  validateApplicationReceipt
} from './application-contract.mjs';
import {
  createSemanticValidationReceipt,
  validateSemanticPlan
} from './semantic-contract.mjs';

const INPUT_FILES = Object.freeze([
  'semantic-plan.json',
  'collection-receipt.json',
  'execution-receipts.json',
  'semantic-validation.json',
  'stars-analysis.json',
  'stars-lists-diff.json',
  'stars-rebuild-recovery.json',
  'stars-current-pre-write-state.json',
  'application-preflight-validation.json',
  'stars-final-state.json',
  'application-receipt.json'
]);
const OUTPUT_FILE = 'application-validation.json';

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function fileIdentity(path) {
  const status = lstatSync(path);
  if (status.isSymbolicLink() || !status.isFile()) {
    throw new Error(`${basename(path)} must be a regular, non-symbolic-link file`);
  }
  const resolved = statSync(path);
  return `${resolved.dev}:${resolved.ino}`;
}

function loadExactJson(path) {
  fileIdentity(path);
  const bytes = readFileSync(path);
  const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  if (!Buffer.from(source, 'utf8').equals(bytes)) {
    throw new Error(`${basename(path)} UTF-8 decoding did not preserve exact source bytes`);
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`${basename(path)} is not valid JSON: ${error.message}`);
  }
}

function removeRegularOutput(path) {
  try {
    const status = lstatSync(path);
    if (status.isSymbolicLink() || !status.isFile()) {
      throw new Error(`${OUTPUT_FILE} must be a regular, non-symbolic-link file when it already exists`);
    }
    rmSync(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function atomicPrivateJson(path, value) {
  const temporary = join(dirname(path), `.application-validation.${process.pid}.${randomBytes(8).toString('hex')}.tmp`);
  let descriptor;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, path);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
  }
}

const [directoryArgument, ...extra] = process.argv.slice(2);
if (!directoryArgument || extra.length > 0) {
  fail('Usage: node validate-application-receipt.mjs <semantic-and-application-run-directory>');
} else {
  let outputPath;
  let outputCanBeRemoved = false;
  try {
    const requested = resolve(directoryArgument);
    if (lstatSync(requested).isSymbolicLink()) throw new Error('application run directory must not be a symbolic link');
    const directory = realpathSync(requested);
    if (!statSync(directory).isDirectory()) throw new Error('application run path must be a directory');
    outputPath = join(directory, OUTPUT_FILE);

    let outputIdentity;
    try {
      outputIdentity = fileIdentity(outputPath);
      outputCanBeRemoved = true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const identities = new Map();
    for (const name of INPUT_FILES) {
      const path = join(directory, name);
      const identity = fileIdentity(path);
      if (identities.has(identity)) throw new Error(`${name} and ${identities.get(identity)} must be distinct files and must not alias the same file`);
      identities.set(identity, name);
    }
    if (outputIdentity && identities.has(outputIdentity)) {
      rmSync(outputPath);
      outputCanBeRemoved = false;
      throw new Error(`${OUTPUT_FILE} and ${identities.get(outputIdentity)} must be distinct files and must not alias the same file`);
    }
    if (outputCanBeRemoved) {
      rmSync(outputPath);
      outputCanBeRemoved = false;
    }

    const plan = loadExactJson(join(directory, 'semantic-plan.json'));
    const collectionReceipt = loadExactJson(join(directory, 'collection-receipt.json'));
    const executionReceipts = loadExactJson(join(directory, 'execution-receipts.json'));
    const semanticValidationReceipt = loadExactJson(join(directory, 'semantic-validation.json'));
    const plannedCandidate = loadExactJson(join(directory, 'stars-analysis.json'));
    const exactDiff = loadExactJson(join(directory, 'stars-lists-diff.json'));
    const recoveryArtifact = loadExactJson(join(directory, 'stars-rebuild-recovery.json'));
    const currentPreWriteState = loadExactJson(join(directory, 'stars-current-pre-write-state.json'));
    const applicationPreflightValidation = loadExactJson(join(directory, 'application-preflight-validation.json'));
    const finalState = loadExactJson(join(directory, 'stars-final-state.json'));
    const applicationReceipt = loadExactJson(join(directory, 'application-receipt.json'));

    const semanticResult = validateSemanticPlan(plan, {
      baseDirectory: directory,
      collectionReceipt,
      executionReceipts
    });
    if (!semanticResult.valid) {
      throw new Error(`Semantic plan validation failed:\n- ${semanticResult.errors.join('\n- ')}`);
    }
    const derivedSemanticReceipt = createSemanticValidationReceipt(plan, semanticResult);
    if (!isDeepStrictEqual(semanticValidationReceipt, derivedSemanticReceipt)) {
      throw new Error('semantic-validation.json does not exactly match the independently derived passing receipt');
    }
    if (!isDeepStrictEqual(plannedCandidate, plan.candidate)) {
      throw new Error('stars-analysis.json is not exactly the immutable planned semantic candidate');
    }

    const result = validateApplicationReceipt(applicationReceipt, {
      plannedCandidate,
      semanticValidationReceipt: derivedSemanticReceipt,
      exactDiff,
      recoveryArtifact,
      currentPreWriteState,
      applicationPreflightValidation,
      finalState
    });
    if (!result.valid) {
      throw new Error(`Application receipt validation failed with ${result.errors.length} error(s):\n- ${result.errors.join('\n- ')}`);
    }
    const validationReceipt = createApplicationValidationReceipt(applicationReceipt, result);
    atomicPrivateJson(outputPath, validationReceipt);
    process.stdout.write(`${JSON.stringify(validationReceipt, null, 2)}\n`);
  } catch (error) {
    if (outputCanBeRemoved && outputPath) {
      try { removeRegularOutput(outputPath); } catch { /* Preserve the primary failure. */ }
    }
    fail(error.message);
  }
}
