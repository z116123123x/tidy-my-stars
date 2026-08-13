#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import {
  closeSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { TextDecoder } from 'node:util';

import {
  createSemanticValidationReceipt,
  validateSemanticPlan
} from './semantic-contract.mjs';

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function safeRemoveReceipt(path) {
  try {
    const status = lstatSync(path);
    if (status.isDirectory()) throw new Error('semantic-validation.json must not be a directory');
    rmSync(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function regularFileIdentity(path) {
  const status = lstatSync(path);
  if (status.isSymbolicLink() || !status.isFile()) {
    throw new Error(`${basename(path)} must be a regular, non-symbolic-link file`);
  }
  const resolved = statSync(path);
  return `${resolved.dev}:${resolved.ino}`;
}

function assertDistinctFiles(entries) {
  const identities = new Map();
  for (const [label, path] of entries) {
    const identity = regularFileIdentity(path);
    const previous = identities.get(identity);
    if (previous) throw new Error(`${label} and ${previous} must be distinct files and must not alias the same file`);
    identities.set(identity, label);
  }
  return identities;
}

function loadExactJson(path) {
  regularFileIdentity(path);
  const source = readFileSync(path);
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(source);
  if (!Buffer.from(text, 'utf8').equals(source)) {
    throw new Error(`${basename(path)} UTF-8 decoding did not preserve exact source bytes`);
  }
  return JSON.parse(text);
}

function atomicPrivateJson(path, value) {
  const temporary = join(
    dirname(path),
    `.semantic-validation.${process.pid}.${randomBytes(8).toString('hex')}.tmp`
  );
  let descriptor;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8' });
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, path);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
  }
}

const [runDirectoryArgument, ...extra] = process.argv.slice(2);
if (!runDirectoryArgument || extra.length > 0) {
  fail('Usage: node validate-semantic-plan.mjs <semantic-run-directory>');
} else {
  try {
    const requested = resolve(runDirectoryArgument);
    if (lstatSync(requested).isSymbolicLink()) throw new Error('semantic run directory must not be a symbolic link');
    const runDirectory = realpathSync(requested);
    if (!statSync(runDirectory).isDirectory()) throw new Error('semantic run path must be a directory');
    const semanticPlanPath = join(runDirectory, 'semantic-plan.json');
    const collectionReceiptPath = join(runDirectory, 'collection-receipt.json');
    const executionReceiptsPath = join(runDirectory, 'execution-receipts.json');
    const receiptPath = join(runDirectory, 'semantic-validation.json');
    const inputEntries = [
      ['semantic-plan.json', semanticPlanPath],
      ['collection-receipt.json', collectionReceiptPath],
      ['execution-receipts.json', executionReceiptsPath]
    ];
    let outputIdentity;
    try {
      const outputStatus = lstatSync(receiptPath);
      if (outputStatus.isSymbolicLink() || !outputStatus.isFile()) {
        throw new Error('semantic-validation.json must be a regular, non-symbolic-link file when it already exists');
      }
      outputIdentity = regularFileIdentity(receiptPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    let identities;
    try {
      identities = assertDistinctFiles(inputEntries);
      if (outputIdentity && identities.has(outputIdentity)) {
        throw new Error(`semantic-validation.json and ${identities.get(outputIdentity)} must be distinct files and must not alias the same file`);
      }
    } catch (error) {
      if (outputIdentity) safeRemoveReceipt(receiptPath);
      throw error;
    }
    safeRemoveReceipt(receiptPath);
    const plan = loadExactJson(semanticPlanPath);
    const collectionReceipt = loadExactJson(collectionReceiptPath);
    const executionReceipts = loadExactJson(executionReceiptsPath);
    const result = validateSemanticPlan(plan, {
      baseDirectory: runDirectory,
      collectionReceipt,
      executionReceipts
    });
    if (!result.valid) {
      throw new Error(
        `Semantic plan validation failed with ${result.errors.length} error(s):\n- ${result.errors.join('\n- ')}`
      );
    }
    const receipt = createSemanticValidationReceipt(plan, result);
    atomicPrivateJson(receiptPath, receipt);
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  } catch (error) {
    fail(error.message);
  }
}
