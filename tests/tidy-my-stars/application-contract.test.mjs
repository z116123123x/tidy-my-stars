import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync, linkSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  APPLICATION_PREFLIGHT_LIMITATIONS,
  APPLICATION_RECEIPT_LIMITATIONS,
  createApplicationPreflightValidationReceipt,
  createApplicationValidationReceipt,
  deriveDesiredProjection,
  validateApplicationPreflight,
  validateApplicationReceipt
} from '../../skills/tidy-my-stars/scripts/application-contract.mjs';
import { canonicalSha256 } from '../../skills/tidy-my-stars/scripts/semantic-contract.mjs';
import { materializeSemanticRun } from './semantic-fixture.mjs';

const root = resolve(import.meta.dirname, '../..');
const cli = join(root, 'skills/tidy-my-stars/scripts/validate-application-receipt.mjs');
const preflightCli = join(root, 'skills/tidy-my-stars/scripts/validate-application-preflight.mjs');

function clone(value) {
  return structuredClone(value);
}

function buildApplicationArtifacts(directory) {
  const semantic = materializeSemanticRun(directory);
  const candidate = semantic.plan.candidate;
  const semanticValidationReceipt = JSON.parse(readFileSync(join(directory, 'semantic-validation.json'), 'utf8'));
  const desired = deriveDesiredProjection(candidate);
  const preWrite = {
    star_count: candidate.repositories.length,
    starred_repositories: candidate.repositories.map((repository) => repository.full_name).sort(),
    lists: [{
      list_id: 'old-list-1',
      name: 'Old List',
      description: 'The complete pre-write List snapshot.',
      repositories: [candidate.repositories[0].full_name]
    }]
  };
  const exactDiff = {
    schema_version: '1.0',
    account_login: candidate.account.login,
    generated_at: '2026-08-12T00:00:05Z',
    planned_candidate_sha256: canonicalSha256(candidate),
    pre_write_state_sha256: canonicalSha256(preWrite),
    desired_projection_sha256: canonicalSha256(desired),
    remove_lists: clone(preWrite.lists),
    create_lists: desired.lists.map(({ planned_list_id, name, description, kind }) => ({
      planned_list_id, name, description, kind
    })),
    restore_memberships: desired.lists.flatMap((list) => list.repositories.map((repository) => ({
      repository, planned_list_id: list.planned_list_id
    })))
  };
  const operations = [
    { operation: 'delete-list', target: 'old-list-1', created_list_id: null },
    ...desired.lists.map((list, index) => ({
      operation: 'create-list', target: list.planned_list_id, created_list_id: `new-list-${index + 1}`
    })),
    ...exactDiff.restore_memberships.map((membership) => ({
      operation: 'restore-membership',
      target: `${membership.repository}#${membership.planned_list_id}`,
      created_list_id: null
    })),
    { operation: 'verify-final', target: candidate.account.login, created_list_id: null }
  ];
  const recoveryArtifact = {
    schema_version: '1.0',
    account_login: candidate.account.login,
    captured_at: '2026-08-12T00:00:06Z',
    phase: 'completed',
    planned_candidate_sha256: canonicalSha256(candidate),
    exact_diff_sha256: canonicalSha256(exactDiff),
    pre_write: preWrite,
    desired_projection_sha256: canonicalSha256(desired),
    operation_journal: operations.map((operation, index) => ({
      sequence: index + 1,
      occurred_at: index === operations.length - 1 ? '2026-08-12T00:00:10Z' : '2026-08-12T00:00:09Z',
      operation_id: `operation-${index + 1}`,
      ...operation,
      outcome: 'completed'
    }))
  };
  const finalState = {
    schema_version: '1.0',
    account_login: candidate.account.login,
    verified_at: '2026-08-12T00:00:10Z',
    star_count: candidate.repositories.length,
    starred_repositories: candidate.repositories.map((repository) => repository.full_name).sort(),
    lists: desired.lists.map((list, index) => ({
      list_id: `new-list-${index + 1}`,
      name: list.name,
      description: list.description,
      repositories: [...list.repositories]
    }))
  };
  const currentPreWriteState = {
    schema_version: '1.0',
    account_login: candidate.account.login,
    captured_at: '2026-08-12T00:00:06Z',
    ...clone(preWrite)
  };
  const preparedRecoveryArtifact = {
    ...clone(recoveryArtifact),
    phase: 'prepared',
    operation_journal: []
  };
  const preflightResult = validateApplicationPreflight({
    plannedCandidate: candidate,
    semanticValidationReceipt,
    exactDiff,
    recoveryArtifact: preparedRecoveryArtifact,
    currentPreWriteState
  });
  assert.equal(preflightResult.valid, true, preflightResult.errors.join('\n'));
  const applicationPreflightValidation = createApplicationPreflightValidationReceipt(preflightResult);
  const receipt = {
    schema_version: '1.0',
    application_id: 'application-1',
    account_login: candidate.account.login,
    started_at: '2026-08-12T00:00:08Z',
    completed_at: '2026-08-12T00:00:11Z',
    status: 'applied',
    authorization: {
      scope: 'github-star-lists-full-rebuild',
      confirmed_at: '2026-08-12T00:00:07Z'
    },
    bindings: {},
    operation_summary: {
      deleted_lists: exactDiff.remove_lists.length,
      created_lists: exactDiff.create_lists.length,
      restored_memberships: exactDiff.restore_memberships.length
    },
    final_state: {
      verified_at: finalState.verified_at,
      projection_sha256: canonicalSha256(desired)
    },
    limitations: [...APPLICATION_RECEIPT_LIMITATIONS]
  };
  const artifacts = {
    candidate, semanticValidationReceipt, exactDiff, recoveryArtifact,
    currentPreWriteState, applicationPreflightValidation, finalState, receipt
  };
  rebind(artifacts);
  return { ...artifacts, semantic };
}

function rebind(artifacts) {
  const desired = deriveDesiredProjection(artifacts.candidate);
  Object.assign(artifacts.receipt.bindings, {
    planned_candidate_sha256: canonicalSha256(artifacts.candidate),
    semantic_validation_receipt_sha256: canonicalSha256(artifacts.semanticValidationReceipt),
    exact_diff_sha256: canonicalSha256(artifacts.exactDiff),
    recovery_artifact_sha256: canonicalSha256(artifacts.recoveryArtifact),
    current_pre_write_state_sha256: canonicalSha256(artifacts.currentPreWriteState),
    application_preflight_validation_sha256: canonicalSha256(artifacts.applicationPreflightValidation),
    final_state_sha256: canonicalSha256(artifacts.finalState),
    desired_projection_sha256: canonicalSha256(desired)
  });
}

function validate(artifacts) {
  return validateApplicationReceipt(artifacts.receipt, {
    plannedCandidate: artifacts.candidate,
    semanticValidationReceipt: artifacts.semanticValidationReceipt,
    exactDiff: artifacts.exactDiff,
    recoveryArtifact: artifacts.recoveryArtifact,
    currentPreWriteState: artifacts.currentPreWriteState,
    applicationPreflightValidation: artifacts.applicationPreflightValidation,
    finalState: artifacts.finalState
  });
}

function preparedArtifacts(directory) {
  const artifacts = buildApplicationArtifacts(directory);
  artifacts.recoveryArtifact.phase = 'prepared';
  artifacts.recoveryArtifact.operation_journal = [];
  const result = validatePreflight(artifacts);
  assert.equal(result.valid, true, result.errors.join('\n'));
  artifacts.applicationPreflightValidation = createApplicationPreflightValidationReceipt(result);
  rebind(artifacts);
  return artifacts;
}

function validatePreflight(artifacts) {
  return validateApplicationPreflight({
    plannedCandidate: artifacts.candidate,
    semanticValidationReceipt: artifacts.semanticValidationReceipt,
    exactDiff: artifacts.exactDiff,
    recoveryArtifact: artifacts.recoveryArtifact,
    currentPreWriteState: artifacts.currentPreWriteState
  });
}

function writePreflightArtifacts(directory, artifacts, currentStatePath = join(directory, 'stars-current-pre-write-state.json')) {
  for (const [name, value] of Object.entries({
    'stars-lists-diff.json': artifacts.exactDiff,
    'stars-rebuild-recovery.json': artifacts.recoveryArtifact
  })) {
    writeFileSync(join(directory, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  }
  writeFileSync(currentStatePath, `${JSON.stringify(artifacts.currentPreWriteState, null, 2)}\n`, { mode: 0o600 });
  return currentStatePath;
}

function writeArtifacts(directory, artifacts) {
  const files = {
    'stars-lists-diff.json': artifacts.exactDiff,
    'stars-rebuild-recovery.json': artifacts.recoveryArtifact,
    'stars-current-pre-write-state.json': artifacts.currentPreWriteState,
    'application-preflight-validation.json': artifacts.applicationPreflightValidation,
    'stars-final-state.json': artifacts.finalState,
    'application-receipt.json': artifacts.receipt
  };
  for (const [name, value] of Object.entries(files)) {
    writeFileSync(join(directory, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  }
}

function temporaryArtifacts(t) {
  const directory = mkdtempSync(join(tmpdir(), 'tidy-application-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { directory, artifacts: buildApplicationArtifacts(directory) };
}

test('accepts one exact applied-state receipt while leaving the semantic candidate planned', (t) => {
  const { artifacts } = temporaryArtifacts(t);
  const result = validate(artifacts);
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.equal(artifacts.candidate.run.application_status, 'planned');
  assert.equal(result.effective_application_status, 'applied');
  const validation = createApplicationValidationReceipt(artifacts.receipt, result);
  assert.equal(validation.status, 'passed');
  assert.deepEqual(validation.limitations, APPLICATION_RECEIPT_LIMITATIONS);
});

test('rejects a relabeled semantic candidate and every stale external binding', (t) => {
  const { artifacts } = temporaryArtifacts(t);
  artifacts.candidate.run.application_status = 'applied';
  rebind(artifacts);
  assert.match(validate(artifacts).errors.join('\n'), /must remain "planned"/i);

  for (const field of Object.keys(artifacts.receipt.bindings)) {
    const { artifacts: item } = temporaryArtifacts(t);
    item.receipt.bindings[field] = '0'.repeat(64);
    const result = validate(item);
    assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), new RegExp(field));
  }
});

test('rejects drift in exact diff, recovery phase, final projection, Stars, and account', (t) => {
  const cases = [
    [(item) => { item.exactDiff.restore_memberships.pop(); }, /do not exactly project|restored_memberships.*exact diff/i],
    [(item) => { item.recoveryArtifact.phase = 'critical-partial'; }, /phase.*completed/i],
    [(item) => { item.finalState.lists[0].repositories = []; }, /final_state.*planned projection/i],
    [(item) => { item.finalState.starred_repositories.pop(); item.finalState.star_count -= 1; }, /unstar is not permitted/i],
    [(item) => { item.finalState.account_login = 'other'; }, /account_login.*planned candidate/i]
  ];
  for (const [mutate, pattern] of cases) {
    const { artifacts } = temporaryArtifacts(t);
    mutate(artifacts);
    rebind(artifacts);
    assert.match(validate(artifacts).errors.join('\n'), pattern);
  }
});

test('binds each created remote List ID to its exact planned List identity', (t) => {
  const { artifacts } = temporaryArtifacts(t);
  assert.ok(artifacts.finalState.lists.length >= 2, 'fixture requires at least two Lists');
  [artifacts.finalState.lists[0].list_id, artifacts.finalState.lists[1].list_id] =
    [artifacts.finalState.lists[1].list_id, artifacts.finalState.lists[0].list_id];
  rebind(artifacts);
  assert.match(validate(artifacts).errors.join('\n'), /list_id.*created ID.*planned List/i);
});

test('rejects unstar journal entries, operation-count drift, and dishonest chronology', (t) => {
  const { artifacts: unstar } = temporaryArtifacts(t);
  unstar.recoveryArtifact.operation_journal[0].operation = 'unstar';
  rebind(unstar);
  assert.match(validate(unstar).errors.join('\n'), /unstar is never permitted|invalid operation/i);

  const { artifacts: count } = temporaryArtifacts(t);
  count.receipt.operation_summary.created_lists += 1;
  assert.match(validate(count).errors.join('\n'), /created_lists.*journal|created_lists.*exact diff/i);

  const { artifacts: chronology } = temporaryArtifacts(t);
  chronology.receipt.authorization.confirmed_at = '2026-08-12T00:00:09Z';
  assert.match(validate(chronology).errors.join('\n'), /started_at.*authorization\.confirmed_at/i);

  const { artifacts: prematureCompletion } = temporaryArtifacts(t);
  prematureCompletion.receipt.completed_at = '2026-08-12T00:00:09Z';
  assert.match(validate(prematureCompletion).errors.join('\n'), /completed_at.*final_state\.verified_at/i);

  const { artifacts: phaseOrder } = temporaryArtifacts(t);
  const firstCreate = phaseOrder.recoveryArtifact.operation_journal
    .findIndex((entry) => entry.operation === 'create-list');
  [phaseOrder.recoveryArtifact.operation_journal[0], phaseOrder.recoveryArtifact.operation_journal[firstCreate]] =
    [phaseOrder.recoveryArtifact.operation_journal[firstCreate], phaseOrder.recoveryArtifact.operation_journal[0]];
  phaseOrder.recoveryArtifact.operation_journal.forEach((entry, index) => { entry.sequence = index + 1; });
  rebind(phaseOrder);
  assert.match(validate(phaseOrder).errors.join('\n'), /operation order.*delete-list.*create-list/i);
});

test('preflight rejects every timestamp beyond the five-minute clock-skew allowance', (t) => {
  const future = new Date(Date.now() + 6 * 60 * 1000).toISOString();
  const cases = [
    ['exact_diff.generated_at', (item) => { item.exactDiff.generated_at = future; }],
    ['recovery_artifact.captured_at', (item) => { item.recoveryArtifact.captured_at = future; }],
    ['current_pre_write_state.captured_at', (item) => { item.currentPreWriteState.captured_at = future; }]
  ];

  for (const [path, mutate] of cases) {
    const directory = mkdtempSync(join(tmpdir(), 'tidy-preflight-future-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const artifacts = preparedArtifacts(directory);
    mutate(artifacts);
    const result = validatePreflight(artifacts);
    assert.equal(result.valid, false, path);
    assert.match(
      result.errors.join('\n'),
      new RegExp(`${path.replaceAll('.', '\\.')}.*future.*five-minute`, 'i'),
      path
    );
  }
});

test('preflight rejects impossible calendar dates and invalid RFC 3339 offsets', (t) => {
  const cases = [
    ['2026-02-30T00:00:05Z', 'exact_diff.generated_at'],
    ['2026-08-12T00:00:06+24:00', 'recovery_artifact.captured_at']
  ];
  for (const [timestamp, path] of cases) {
    const directory = mkdtempSync(join(tmpdir(), 'tidy-preflight-invalid-time-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const artifacts = preparedArtifacts(directory);
    if (path === 'exact_diff.generated_at') artifacts.exactDiff.generated_at = timestamp;
    else artifacts.recoveryArtifact.captured_at = timestamp;
    const result = validatePreflight(artifacts);
    assert.equal(result.valid, false, path);
    assert.match(result.errors.join('\n'), new RegExp(`${path.replaceAll('.', '\\.')}.*RFC 3339`, 'i'));
  }
});

test('final validation rejects every application timestamp beyond the five-minute clock-skew allowance', (t) => {
  const future = new Date(Date.now() + 6 * 60 * 1000).toISOString();
  const cases = [
    ['exact_diff.generated_at', (item) => { item.exactDiff.generated_at = future; }],
    ['recovery_artifact.captured_at', (item) => { item.recoveryArtifact.captured_at = future; }],
    ['recovery_artifact.operation_journal[0].occurred_at', (item) => {
      item.recoveryArtifact.operation_journal[0].occurred_at = future;
    }],
    ['current_pre_write_state.captured_at', (item) => { item.currentPreWriteState.captured_at = future; }],
    ['authorization.confirmed_at', (item) => { item.receipt.authorization.confirmed_at = future; }],
    ['started_at', (item) => { item.receipt.started_at = future; }],
    ['final_state.verified_at', (item) => { item.finalState.verified_at = future; }],
    ['receipt.final_state.verified_at', (item) => { item.receipt.final_state.verified_at = future; }],
    ['completed_at', (item) => { item.receipt.completed_at = future; }]
  ];

  for (const [path, mutate] of cases) {
    const { artifacts } = temporaryArtifacts(t);
    mutate(artifacts);
    rebind(artifacts);
    const result = validate(artifacts);
    assert.equal(result.valid, false, path);
    assert.ok(
      result.errors.some((error) => error.includes(`${path}:`) && /future.*five-minute/i.test(error)),
      `${path}: ${result.errors.join('\n')}`
    );
  }
});

test('final validation rejects impossible calendar dates and invalid RFC 3339 offsets', (t) => {
  const cases = [
    ['2026-02-30T00:00:08Z', 'started_at', (item, timestamp) => { item.receipt.started_at = timestamp; }],
    ['2026-08-12T00:00:10+24:00', 'final_state.verified_at', (item, timestamp) => {
      item.finalState.verified_at = timestamp;
      item.receipt.final_state.verified_at = timestamp;
    }]
  ];
  for (const [timestamp, path, mutate] of cases) {
    const { artifacts } = temporaryArtifacts(t);
    mutate(artifacts, timestamp);
    rebind(artifacts);
    const result = validate(artifacts);
    assert.equal(result.valid, false, path);
    assert.match(result.errors.join('\n'), new RegExp(`${path.replaceAll('.', '\\.')}.*RFC 3339`, 'i'));
  }
});

test('rejects duplicate identities in the complete pre-write List snapshot', (t) => {
  for (const field of ['list_id', 'name']) {
    const { artifacts } = temporaryArtifacts(t);
    artifacts.recoveryArtifact.pre_write.lists.push({
      ...clone(artifacts.recoveryArtifact.pre_write.lists[0]),
      list_id: field === 'list_id' ? artifacts.recoveryArtifact.pre_write.lists[0].list_id : 'old-list-2',
      name: field === 'name' ? artifacts.recoveryArtifact.pre_write.lists[0].name : 'Another Old List'
    });
    artifacts.exactDiff.remove_lists = clone(artifacts.recoveryArtifact.pre_write.lists);
    artifacts.exactDiff.pre_write_state_sha256 = canonicalSha256(artifacts.recoveryArtifact.pre_write);
    artifacts.recoveryArtifact.exact_diff_sha256 = canonicalSha256(artifacts.exactDiff);
    rebind(artifacts);
    assert.match(validate(artifacts).errors.join('\n'), new RegExp(`pre_write\\.lists.*duplicate ${field}`));
  }
});

test('requires exact honest offline limitations and treats claimed authorization only as a claim', (t) => {
  const { artifacts } = temporaryArtifacts(t);
  artifacts.receipt.limitations.pop();
  const result = validate(artifacts);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /limitations.*exactly disclose/i);
  assert.match(APPLICATION_RECEIPT_LIMITATIONS.join(' '), /does not prove.*authorization/i);
  assert.match(APPLICATION_RECEIPT_LIMITATIONS.join(' '), /not that the preflight validator actually ran before the first mutation/i);
  assert.match(APPLICATION_PREFLIGHT_LIMITATIONS.join(' '), /not that the preflight validator actually ran before the first mutation/i);
});

test('final application limitations preserve every preflight limitation without duplicates', () => {
  assert.equal(
    new Set(APPLICATION_RECEIPT_LIMITATIONS).size,
    APPLICATION_RECEIPT_LIMITATIONS.length,
    'final limitations must not repeat canonical disclosures'
  );
  for (const limitation of APPLICATION_PREFLIGHT_LIMITATIONS) {
    assert.ok(
      APPLICATION_RECEIPT_LIMITATIONS.includes(limitation),
      `final limitations omitted preflight disclosure: ${limitation}`
    );
  }
});

test('preflight validates the exact prepared delete-first boundary and fresh current state', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'tidy-preflight-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const artifacts = preparedArtifacts(directory);
  const result = validatePreflight(artifacts);
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.deepEqual(result.limitations, APPLICATION_PREFLIGHT_LIMITATIONS);
  const receipt = createApplicationPreflightValidationReceipt(result);
  assert.equal(receipt.status, 'passed');
  assert.equal(receipt.counts.repositories, artifacts.candidate.repositories.length);
  assert.equal(receipt.bindings.current_pre_write_state_sha256, canonicalSha256(artifacts.currentPreWriteState));
});

test('preflight and post-write validators reject phase substitution and stale state', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'tidy-preflight-phase-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const prepared = preparedArtifacts(directory);
  assert.match(validate(prepared).errors.join('\n'), /phase.*completed|verify-final/i);

  const completed = buildApplicationArtifacts(directory);
  completed.currentPreWriteState = clone(completed.recoveryArtifact.pre_write);
  assert.match(validatePreflight(completed).errors.join('\n'), /phase.*prepared|must be empty/i);

  const stale = preparedArtifacts(directory);
  stale.currentPreWriteState.lists[0].repositories = [];
  assert.match(validatePreflight(stale).errors.join('\n'), /must exactly equal recovery_artifact\.pre_write/i);

  const missingStar = preparedArtifacts(directory);
  missingStar.currentPreWriteState.starred_repositories.pop();
  missingStar.currentPreWriteState.star_count -= 1;
  assert.match(validatePreflight(missingStar).errors.join('\n'), /planned Stars inventory|must exactly equal/i);
});

test('preflight rejects diff, recovery, and complete-state identity drift', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'tidy-preflight-drift-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const cases = [
    [(item) => { item.exactDiff.create_lists.pop(); }, /exact diff|project the planned candidate|exact_diff_sha256/i],
    [(item) => { item.recoveryArtifact.desired_projection_sha256 = '0'.repeat(64); }, /desired_projection_sha256.*binding mismatch/i],
    [(item) => {
      item.recoveryArtifact.pre_write.lists.push(clone(item.recoveryArtifact.pre_write.lists[0]));
      item.currentPreWriteState.star_count = item.recoveryArtifact.pre_write.star_count;
      item.currentPreWriteState.starred_repositories = clone(item.recoveryArtifact.pre_write.starred_repositories);
      item.currentPreWriteState.lists = clone(item.recoveryArtifact.pre_write.lists);
    }, /duplicate list_id|duplicate name/i],
    [(item) => { item.currentPreWriteState.lists[0].repositories.push(item.currentPreWriteState.lists[0].repositories[0]); }, /duplicate value|duplicate/i]
  ];
  for (const [mutate, pattern] of cases) {
    const artifacts = preparedArtifacts(directory);
    mutate(artifacts);
    assert.match(validatePreflight(artifacts).errors.join('\n'), pattern);
  }
});

test('preflight CLI binds the semantic candidate, writes privately, and removes stale success', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'tidy-preflight-cli-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const artifacts = preparedArtifacts(directory);
  const currentStatePath = writePreflightArtifacts(directory, artifacts);
  const passed = spawnSync(process.execPath, [preflightCli, directory, currentStatePath], { cwd: root, encoding: 'utf8' });
  assert.equal(passed.status, 0, passed.stderr);
  const outputPath = join(directory, 'application-preflight-validation.json');
  assert.equal(statSync(outputPath).mode & 0o777, 0o600);

  const differentCandidate = clone(artifacts.candidate);
  differentCandidate.locale = differentCandidate.locale === 'en' ? 'zh-TW' : 'en';
  writeFileSync(join(directory, 'stars-analysis.json'), `${JSON.stringify(differentCandidate, null, 2)}\n`, { mode: 0o600 });
  const failed = spawnSync(process.execPath, [preflightCli, directory, currentStatePath], { cwd: root, encoding: 'utf8' });
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /not exactly the immutable planned semantic candidate/i);
  assert.equal(existsSync(outputPath), false);
});

test('preflight CLI rejects missing, symlinked, and hardlink-aliased fresh state', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'tidy-preflight-paths-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const artifacts = preparedArtifacts(directory);
  const currentStatePath = writePreflightArtifacts(directory, artifacts);

  rmSync(currentStatePath);
  const missing = spawnSync(process.execPath, [preflightCli, directory, currentStatePath], { cwd: root, encoding: 'utf8' });
  assert.notEqual(missing.status, 0);

  symlinkSync(join(directory, 'stars-lists-diff.json'), currentStatePath);
  const symlinked = spawnSync(process.execPath, [preflightCli, directory, currentStatePath], { cwd: root, encoding: 'utf8' });
  assert.notEqual(symlinked.status, 0);
  assert.match(symlinked.stderr, /symbolic/i);

  rmSync(currentStatePath);
  linkSync(join(directory, 'stars-lists-diff.json'), currentStatePath);
  const aliased = spawnSync(process.execPath, [preflightCli, directory, currentStatePath], { cwd: root, encoding: 'utf8' });
  assert.notEqual(aliased.status, 0);
  assert.match(aliased.stderr, /distinct|alias/i);
});

test('CLI validates canonical files, writes a private receipt, and fails closed', (t) => {
  const { directory, artifacts } = temporaryArtifacts(t);
  writeArtifacts(directory, artifacts);
  const passed = spawnSync(process.execPath, [cli, directory], { cwd: root, encoding: 'utf8' });
  assert.equal(passed.status, 0, passed.stderr);
  assert.equal(statSync(join(directory, 'application-validation.json')).mode & 0o777, 0o600);

  artifacts.finalState.lists[0].repositories = [];
  rebind(artifacts);
  writeArtifacts(directory, artifacts);
  const failed = spawnSync(process.execPath, [cli, directory], { cwd: root, encoding: 'utf8' });
  assert.notEqual(failed.status, 0);
  assert.equal(existsSync(join(directory, 'application-validation.json')), false);
});

test('CLI rejects missing, symlinked, and hardlink-aliased application artifacts', (t) => {
  const { directory, artifacts } = temporaryArtifacts(t);
  writeArtifacts(directory, artifacts);
  rmSync(join(directory, 'stars-final-state.json'));
  const missing = spawnSync(process.execPath, [cli, directory], { cwd: root, encoding: 'utf8' });
  assert.notEqual(missing.status, 0);

  writeArtifacts(directory, artifacts);
  rmSync(join(directory, 'application-receipt.json'));
  symlinkSync(join(directory, 'stars-lists-diff.json'), join(directory, 'application-receipt.json'));
  const symlinked = spawnSync(process.execPath, [cli, directory], { cwd: root, encoding: 'utf8' });
  assert.notEqual(symlinked.status, 0);
  assert.match(symlinked.stderr, /symbolic/i);

  rmSync(join(directory, 'application-receipt.json'));
  linkSync(join(directory, 'stars-lists-diff.json'), join(directory, 'application-receipt.json'));
  const aliased = spawnSync(process.execPath, [cli, directory], { cwd: root, encoding: 'utf8' });
  assert.notEqual(aliased.status, 0);
  assert.match(aliased.stderr, /distinct|alias/i);
});

test('post-write validation cannot pass without the exact bound preflight', (t) => {
  const { directory, artifacts } = temporaryArtifacts(t);
  writeArtifacts(directory, artifacts);
  rmSync(join(directory, 'application-preflight-validation.json'));
  const missing = spawnSync(process.execPath, [cli, directory], { cwd: root, encoding: 'utf8' });
  assert.notEqual(missing.status, 0);

  writeArtifacts(directory, artifacts);
  const forged = clone(artifacts.applicationPreflightValidation);
  forged.counts.pre_write_lists += 1;
  artifacts.applicationPreflightValidation = forged;
  rebind(artifacts);
  writeArtifacts(directory, artifacts);
  const rejected = spawnSync(process.execPath, [cli, directory], { cwd: root, encoding: 'utf8' });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /preflight.*independently derived|preflight.*validation/i);
});

test('explain handoff, React build, and verifier derive applied status without changing candidate bytes', (t) => {
  const { directory, artifacts } = temporaryArtifacts(t);
  writeArtifacts(directory, artifacts);
  const validated = spawnSync(process.execPath, [cli, directory], { cwd: root, encoding: 'utf8' });
  assert.equal(validated.status, 0, validated.stderr);
  const candidatePath = join(directory, 'stars-analysis.json');
  const originalCandidateBytes = readFileSync(candidatePath);
  const applicationReceiptPath = join(directory, 'application-receipt.json');

  const explained = spawnSync(process.execPath, [
    join(root, 'skills/explain-my-stars/scripts/validate-analysis.mjs'),
    candidatePath, '--semantic-run', directory, '--application-receipt', applicationReceiptPath
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(explained.status, 0, explained.stderr);
  const explainedReceipt = JSON.parse(explained.stdout);
  assert.equal(explainedReceipt.application_validation.status, 'applied');
  assert.equal(JSON.parse(originalCandidateBytes).run.application_status, 'planned');

  const reportRoot = mkdtempSync(join(tmpdir(), 'tidy-applied-report-'));
  t.after(() => rmSync(reportRoot, { recursive: true, force: true }));
  const site = join(reportRoot, 'site');
  const built = spawnSync(process.execPath, [
    join(root, 'skills/explain-my-stars/scripts/build-site.mjs'),
    '--input', candidatePath, '--semantic-run', directory,
    '--application-receipt', applicationReceiptPath, '--output', site
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);
  assert.deepEqual(readFileSync(candidatePath), originalCandidateBytes);
  assert.deepEqual(readFileSync(join(site, 'data/stars-analysis.json')), originalCandidateBytes);
  const provenance = JSON.parse(readFileSync(join(site, 'data/report-provenance.json'), 'utf8'));
  assert.equal(provenance.application.status, 'applied');
  assert.equal(provenance.application.claim_basis, 'validated-external-receipt');
  assert.match(provenance.application.receipt_sha256, /^[a-f0-9]{64}$/u);
  assert.deepEqual(provenance.application.limitations, [...APPLICATION_RECEIPT_LIMITATIONS]);

  const verificationPath = join(reportRoot, 'site-verification.json');
  const verified = spawnSync(process.execPath, [
    join(root, 'skills/explain-my-stars/scripts/verify-site.mjs'),
    '--input', candidatePath, '--semantic-run', directory,
    '--application-receipt', applicationReceiptPath,
    '--site', site, '--output', verificationPath
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(verified.status, 0, verified.stderr);
  const verification = JSON.parse(readFileSync(verificationPath, 'utf8'));
  assert.equal(verification.input.effective_application_status, 'applied');
  assert.equal(verification.checks.application_validation.status, 'passed');
  assert.equal(verification.checks.provenance_identity.status, 'passed');
});

test('explain fails closed when a supplied deterministic application validation is forged', (t) => {
  const { directory, artifacts } = temporaryArtifacts(t);
  writeArtifacts(directory, artifacts);
  assert.equal(spawnSync(process.execPath, [cli, directory], { cwd: root }).status, 0);
  const validationPath = join(directory, 'application-validation.json');
  const forged = JSON.parse(readFileSync(validationPath, 'utf8'));
  forged.effective_application_status = 'planned';
  writeFileSync(validationPath, `${JSON.stringify(forged, null, 2)}\n`);
  const explained = spawnSync(process.execPath, [
    join(root, 'skills/explain-my-stars/scripts/validate-analysis.mjs'),
    join(directory, 'stars-analysis.json'), '--semantic-run', directory,
    '--application-receipt', join(directory, 'application-receipt.json')
  ], { cwd: root, encoding: 'utf8' });
  assert.notEqual(explained.status, 0);
  assert.match(explained.stderr, /application-validation\.json.*independently derived/i);
});
