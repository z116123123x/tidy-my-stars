// Bundled with explain-my-stars so its applied-state handoff remains standalone.
import { validateAnalysis } from './analysis-contract.mjs';
import { canonicalSha256 } from './semantic-contract.mjs';

export const APPLICATION_PREFLIGHT_LIMITATIONS = Object.freeze([
  'Offline validation does not authenticate the claimed account or GitHub pre-write read, or prove that the read is fresh.',
  'Offline validation does not prove that remote state remained unchanged between this gate and the first deletion.',
  'The deterministic receipt proves the exact frozen gate conditions when rederived, but not that the preflight validator actually ran before the first mutation.',
  'Offline validation verifies frozen artifacts and hashes; it does not prove that the user granted the authorization claimed by the runner or that external actions occurred.'
]);

// Final validation inherits every unresolved preflight boundary. It may add
// post-write boundaries, but must never narrow or paraphrase away the exact
// disclosures that governed the destructive transition.
export const APPLICATION_RECEIPT_LIMITATIONS = Object.freeze([
  ...APPLICATION_PREFLIGHT_LIMITATIONS,
  'Offline validation does not authenticate GitHub final-state reads or mutation responses.'
]);

const SHA256 = /^[a-f0-9]{64}$/u;
const FULL_NAME = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/u;
const JOURNAL_OPERATIONS = new Set(['delete-list', 'create-list', 'restore-membership', 'verify-final']);
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonblank(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validTimestamp(value) {
  if (!nonblank(value)) return false;
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/u
  );
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysByMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > daysByMonth[month - 1]) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (offsetHourText !== undefined && (Number(offsetHourText) > 23 || Number(offsetMinuteText) > 59)) return false;
  return Number.isFinite(Date.parse(value));
}

function rejectFutureTimestamp(value, path, errors) {
  if (validTimestamp(value) && Date.parse(value) > Date.now() + CLOCK_SKEW_TOLERANCE_MS) {
    errors.push(`${path}: must not be in the future beyond the five-minute clock-skew tolerance`);
  }
}

function exactKeys(value, allowed, path, errors) {
  if (!isRecord(value)) return;
  for (const key of Object.keys(value)) if (!allowed.includes(key)) errors.push(`${path}.${key}: unexpected field`);
  for (const key of allowed) if (!(key in value)) errors.push(`${path}.${key}: required field is missing`);
}

function sameCanonical(left, right) {
  return canonicalSha256(left) === canonicalSha256(right);
}

function uniqueStrings(values, path, errors, pattern) {
  if (!Array.isArray(values)) {
    errors.push(`${path}: must be an array`);
    return [];
  }
  const seen = new Set();
  for (const [index, value] of values.entries()) {
    if (!nonblank(value) || (pattern && !pattern.test(value))) errors.push(`${path}[${index}]: invalid value`);
    if (seen.has(value)) errors.push(`${path}[${index}]: duplicate value`);
    seen.add(value);
  }
  return values;
}

function normalizedList(list, repositories, idField = 'planned_list_id') {
  return {
    planned_list_id: list?.[idField],
    name: list?.name,
    description: list?.description,
    kind: list?.kind,
    repositories: [...repositories].sort()
  };
}

/** Canonical semantic state that an authorized full rebuild is expected to create. */
export function deriveDesiredProjection(candidate) {
  const repositories = Array.isArray(candidate?.repositories) ? candidate.repositories : [];
  const membershipsByList = new Map((candidate?.lists ?? []).map((list) => [list.id, []]));
  for (const repository of repositories) {
    for (const membership of repository?.memberships ?? []) {
      membershipsByList.get(membership?.list_id)?.push(repository.full_name);
    }
  }
  return {
    account_login: candidate?.account?.login,
    starred_repositories: repositories.map((repository) => repository?.full_name).sort(),
    lists: (candidate?.lists ?? []).map((list) => normalizedList(
      { ...list, planned_list_id: list?.id },
      membershipsByList.get(list?.id) ?? []
    )).sort((left, right) => String(left.planned_list_id).localeCompare(String(right.planned_list_id)))
  };
}

function finalProjection(finalState, candidate, errors) {
  const desired = deriveDesiredProjection(candidate);
  const desiredByName = new Map(desired.lists.map((list) => [list.name, list]));
  const actualLists = Array.isArray(finalState?.lists) ? finalState.lists : [];
  const projected = [];
  const seenNames = new Set();
  for (const [index, list] of actualLists.entries()) {
    const path = `final_state.lists[${index}]`;
    if (!isRecord(list)) { errors.push(`${path}: must be an object`); continue; }
    exactKeys(list, ['list_id', 'name', 'description', 'repositories'], path, errors);
    if (!nonblank(list.list_id)) errors.push(`${path}.list_id: must be nonblank`);
    if (!nonblank(list.name)) errors.push(`${path}.name: must be nonblank`);
    if (typeof list.description !== 'string') errors.push(`${path}.description: must be a string`);
    const repositories = uniqueStrings(list.repositories, `${path}.repositories`, errors, FULL_NAME);
    if (seenNames.has(list.name)) errors.push(`${path}.name: duplicate final List name`);
    seenNames.add(list.name);
    const planned = desiredByName.get(list.name);
    if (!planned) {
      errors.push(`${path}.name: final List is absent from the planned candidate`);
      continue;
    }
    if (list.description !== planned.description) errors.push(`${path}.description: differs from the planned candidate`);
    projected.push(normalizedList(planned, repositories));
  }
  return {
    account_login: finalState?.account_login,
    starred_repositories: [...(finalState?.starred_repositories ?? [])].sort(),
    lists: projected.sort((left, right) => String(left.planned_list_id).localeCompare(String(right.planned_list_id)))
  };
}

function validateDiff(diff, candidate, desired, recovery, errors) {
  if (!isRecord(diff)) {
    errors.push('exact_diff: must be an object');
    return;
  }
  exactKeys(diff, [
    'schema_version', 'account_login', 'generated_at', 'planned_candidate_sha256',
    'pre_write_state_sha256', 'desired_projection_sha256', 'remove_lists',
    'create_lists', 'restore_memberships'
  ], 'exact_diff', errors);
  if (diff.schema_version !== '1.0') errors.push('exact_diff.schema_version: must equal "1.0"');
  if (diff.account_login !== candidate?.account?.login) errors.push('exact_diff.account_login: must match the planned candidate');
  if (!validTimestamp(diff.generated_at)) errors.push('exact_diff.generated_at: must be an RFC 3339 timestamp');
  rejectFutureTimestamp(diff.generated_at, 'exact_diff.generated_at', errors);
  if (diff.planned_candidate_sha256 !== canonicalSha256(candidate)) errors.push('exact_diff.planned_candidate_sha256: binding mismatch');
  if (diff.pre_write_state_sha256 !== canonicalSha256(recovery?.pre_write)) errors.push('exact_diff.pre_write_state_sha256: binding mismatch');
  if (diff.desired_projection_sha256 !== canonicalSha256(desired)) errors.push('exact_diff.desired_projection_sha256: binding mismatch');

  const removeLists = Array.isArray(diff.remove_lists) ? diff.remove_lists : [];
  if (!Array.isArray(diff.remove_lists)) errors.push('exact_diff.remove_lists: must be an array');
  for (const [index, list] of removeLists.entries()) {
    const path = `exact_diff.remove_lists[${index}]`;
    if (!isRecord(list)) { errors.push(`${path}: must be an object`); continue; }
    exactKeys(list, ['list_id', 'name', 'description', 'repositories'], path, errors);
    if (![list.list_id, list.name].every(nonblank)) errors.push(`${path}: list_id and name must be nonblank`);
    if (typeof list.description !== 'string') errors.push(`${path}.description: must be a string`);
    uniqueStrings(list.repositories, `${path}.repositories`, errors, FULL_NAME);
  }
  if (!sameCanonical(removeLists, recovery?.pre_write?.lists)) {
    errors.push('exact_diff.remove_lists: must exactly equal the recovery pre-write List snapshot');
  }

  const createLists = Array.isArray(diff.create_lists) ? diff.create_lists : [];
  if (!Array.isArray(diff.create_lists)) errors.push('exact_diff.create_lists: must be an array');
  const createdById = new Map();
  for (const [index, list] of createLists.entries()) {
    const path = `exact_diff.create_lists[${index}]`;
    if (!isRecord(list)) { errors.push(`${path}: must be an object`); continue; }
    exactKeys(list, ['planned_list_id', 'name', 'description', 'kind'], path, errors);
    if (![list.planned_list_id, list.name, list.description].every(nonblank)) errors.push(`${path}: identifiers and text must be nonblank`);
    if (!['classification', 'review-queue'].includes(list.kind)) errors.push(`${path}.kind: invalid kind`);
    if (createdById.has(list.planned_list_id)) errors.push(`${path}.planned_list_id: duplicate`);
    createdById.set(list.planned_list_id, list);
  }
  const restore = Array.isArray(diff.restore_memberships) ? diff.restore_memberships : [];
  if (!Array.isArray(diff.restore_memberships)) errors.push('exact_diff.restore_memberships: must be an array');
  const memberKeys = new Set();
  const membersByList = new Map(createLists.map((list) => [list?.planned_list_id, []]));
  for (const [index, membership] of restore.entries()) {
    const path = `exact_diff.restore_memberships[${index}]`;
    if (!isRecord(membership)) { errors.push(`${path}: must be an object`); continue; }
    exactKeys(membership, ['repository', 'planned_list_id'], path, errors);
    if (!FULL_NAME.test(membership.repository ?? '')) errors.push(`${path}.repository: invalid repository`);
    if (!createdById.has(membership.planned_list_id)) errors.push(`${path}.planned_list_id: unknown planned List`);
    const key = `${membership.repository}\0${membership.planned_list_id}`;
    if (memberKeys.has(key)) errors.push(`${path}: duplicate membership`);
    memberKeys.add(key);
    membersByList.get(membership.planned_list_id)?.push(membership.repository);
  }
  const reconstructed = {
    account_login: diff.account_login,
    starred_repositories: [...desired.starred_repositories],
    lists: createLists.map((list) => normalizedList(list, membersByList.get(list.planned_list_id) ?? []))
      .sort((left, right) => String(left.planned_list_id).localeCompare(String(right.planned_list_id)))
  };
  if (!sameCanonical(reconstructed, desired)) errors.push('exact_diff: create Lists and memberships do not exactly project the planned candidate');
}

function validatePreWriteState(preWrite, desired, path, errors) {
  if (!isRecord(preWrite)) {
    errors.push(`${path}: must be an object`);
    return { stars: [], lists: [], memberships: 0 };
  }
  exactKeys(preWrite, ['star_count', 'starred_repositories', 'lists'], path, errors);
  if (!Number.isInteger(preWrite.star_count) || preWrite.star_count < 0) {
    errors.push(`${path}.star_count: must be nonnegative`);
  }
  const preStars = uniqueStrings(
    preWrite.starred_repositories,
    `${path}.starred_repositories`,
    errors,
    FULL_NAME
  );
  if (Number.isInteger(preWrite.star_count) && preWrite.star_count !== preStars.length) {
    errors.push(`${path}.star_count: coverage mismatch`);
  }
  if (!sameCanonical([...preStars].sort(), desired.starred_repositories)) {
    errors.push(`${path}.starred_repositories: must exactly match the planned Stars inventory`);
  }
  const preLists = Array.isArray(preWrite.lists) ? preWrite.lists : [];
  if (!Array.isArray(preWrite.lists)) errors.push(`${path}.lists: must be an array`);
  const preListIds = new Set();
  const preListNames = new Set();
  let memberships = 0;
  for (const [index, list] of preLists.entries()) {
    const listPath = `${path}.lists[${index}]`;
    if (!isRecord(list)) { errors.push(`${listPath}: must be an object`); continue; }
    exactKeys(list, ['list_id', 'name', 'description', 'repositories'], listPath, errors);
    if (![list.list_id, list.name].every(nonblank)) errors.push(`${listPath}: list_id and name must be nonblank`);
    if (preListIds.has(list.list_id)) errors.push(`${path}.lists: duplicate list_id "${list.list_id}"`);
    else if (nonblank(list.list_id)) preListIds.add(list.list_id);
    if (preListNames.has(list.name)) errors.push(`${path}.lists: duplicate name "${list.name}"`);
    else if (nonblank(list.name)) preListNames.add(list.name);
    if (typeof list.description !== 'string') errors.push(`${listPath}.description: must be a string`);
    const members = uniqueStrings(list.repositories, `${listPath}.repositories`, errors, FULL_NAME);
    memberships += members.length;
    for (const repository of members) {
      if (!preStars.includes(repository)) {
        errors.push(`${listPath}.repositories: contains a repository absent from the pre-write Stars inventory`);
      }
    }
  }
  return { stars: preStars, lists: preLists, memberships };
}

function validateRecovery(recovery, candidate, diff, desired, errors, { requiredPhase = 'completed' } = {}) {
  if (!isRecord(recovery)) {
    errors.push('recovery_artifact: must be an object');
    return { counts: {} };
  }
  exactKeys(recovery, [
    'schema_version', 'account_login', 'captured_at', 'phase', 'planned_candidate_sha256',
    'exact_diff_sha256', 'pre_write', 'desired_projection_sha256', 'operation_journal'
  ], 'recovery_artifact', errors);
  if (recovery.schema_version !== '1.0') errors.push('recovery_artifact.schema_version: must equal "1.0"');
  if (recovery.account_login !== candidate?.account?.login) errors.push('recovery_artifact.account_login: must match the planned candidate');
  if (!validTimestamp(recovery.captured_at)) errors.push('recovery_artifact.captured_at: must be an RFC 3339 timestamp');
  rejectFutureTimestamp(recovery.captured_at, 'recovery_artifact.captured_at', errors);
  if (recovery.phase !== requiredPhase) errors.push(`recovery_artifact.phase: must equal "${requiredPhase}"`);
  if (recovery.planned_candidate_sha256 !== canonicalSha256(candidate)) errors.push('recovery_artifact.planned_candidate_sha256: binding mismatch');
  if (recovery.exact_diff_sha256 !== canonicalSha256(diff)) errors.push('recovery_artifact.exact_diff_sha256: binding mismatch');
  if (recovery.desired_projection_sha256 !== canonicalSha256(desired)) errors.push('recovery_artifact.desired_projection_sha256: binding mismatch');

  const preWrite = isRecord(recovery.pre_write) ? recovery.pre_write : {};
  validatePreWriteState(recovery.pre_write, desired, 'recovery_artifact.pre_write', errors);

  const journal = Array.isArray(recovery.operation_journal) ? recovery.operation_journal : [];
  if (!Array.isArray(recovery.operation_journal)) errors.push('recovery_artifact.operation_journal: must be an array');
  if (requiredPhase === 'prepared') {
    if (journal.length !== 0) errors.push('recovery_artifact.operation_journal: prepared recovery must be empty before the first deletion');
    return {
      counts: { deleted_lists: 0, created_lists: 0, restored_memberships: 0 },
      journal,
      createdListIds: [],
      createdListIdByPlannedId: new Map()
    };
  }
  const operationIds = new Set();
  const counts = { deleted_lists: 0, created_lists: 0, restored_memberships: 0 };
  let verifyFinal = 0;
  let previousJournalTime;
  let previousOperationRank = -1;
  const operationRanks = new Map([
    ['delete-list', 0], ['create-list', 1], ['restore-membership', 2], ['verify-final', 3]
  ]);
  const completedTargets = {
    'delete-list': [], 'create-list': [], 'restore-membership': [], 'verify-final': []
  };
  const createdListIds = [];
  const createdListIdByPlannedId = new Map();
  for (const [index, entry] of journal.entries()) {
    const path = `recovery_artifact.operation_journal[${index}]`;
    if (!isRecord(entry)) { errors.push(`${path}: must be an object`); continue; }
    exactKeys(entry, [
      'sequence', 'occurred_at', 'operation_id', 'operation', 'target', 'outcome', 'created_list_id'
    ], path, errors);
    if (entry.sequence !== index + 1) errors.push(`${path}.sequence: journal sequence must be contiguous from 1`);
    if (!validTimestamp(entry.occurred_at)) errors.push(`${path}.occurred_at: must be an RFC 3339 timestamp`);
    rejectFutureTimestamp(entry.occurred_at, `${path}.occurred_at`, errors);
    if (validTimestamp(entry.occurred_at) && previousJournalTime
        && Date.parse(entry.occurred_at) < Date.parse(previousJournalTime)) {
      errors.push(`${path}.occurred_at: operation journal timestamps must be nondecreasing`);
    }
    if (validTimestamp(entry.occurred_at)) previousJournalTime = entry.occurred_at;
    if (!nonblank(entry.operation_id)) errors.push(`${path}.operation_id: must be nonblank`);
    if (operationIds.has(entry.operation_id)) errors.push(`${path}.operation_id: duplicate`);
    operationIds.add(entry.operation_id);
    if (!JOURNAL_OPERATIONS.has(entry.operation)) errors.push(`${path}.operation: invalid operation; unstar is never permitted`);
    const operationRank = operationRanks.get(entry.operation);
    if (operationRank !== undefined && operationRank < previousOperationRank) {
      errors.push('recovery_artifact.operation_journal: operation order must be delete-list, then create-list, then restore-membership, then verify-final');
    }
    if (operationRank !== undefined) previousOperationRank = Math.max(previousOperationRank, operationRank);
    if (!nonblank(entry.target)) errors.push(`${path}.target: must be nonblank`);
    if (JOURNAL_OPERATIONS.has(entry.operation)) completedTargets[entry.operation].push(entry.target);
    if (entry.outcome !== 'completed') errors.push(`${path}.outcome: completed recovery may contain only completed operations`);
    if (entry.operation === 'create-list') {
      counts.created_lists += 1;
      if (!nonblank(entry.created_list_id)) errors.push(`${path}.created_list_id: create-list must record the new List ID`);
      else {
        createdListIds.push(entry.created_list_id);
        if (nonblank(entry.target)) createdListIdByPlannedId.set(entry.target, entry.created_list_id);
      }
    } else {
      if (entry.created_list_id !== null) errors.push(`${path}.created_list_id: must be null unless operation is create-list`);
      if (entry.operation === 'delete-list') counts.deleted_lists += 1;
      if (entry.operation === 'restore-membership') counts.restored_memberships += 1;
      if (entry.operation === 'verify-final') verifyFinal += 1;
    }
  }
  if (verifyFinal !== 1) errors.push('recovery_artifact.operation_journal: exactly one completed verify-final operation is required');
  const expectedTargets = {
    'delete-list': (diff?.remove_lists ?? []).map((list) => list?.list_id).sort(),
    'create-list': (diff?.create_lists ?? []).map((list) => list?.planned_list_id).sort(),
    'restore-membership': (diff?.restore_memberships ?? [])
      .map((membership) => `${membership?.repository}#${membership?.planned_list_id}`).sort(),
    'verify-final': [candidate?.account?.login]
  };
  for (const operation of JOURNAL_OPERATIONS) {
    if (!sameCanonical(completedTargets[operation].sort(), expectedTargets[operation])) {
      errors.push(`recovery_artifact.operation_journal: ${operation} targets must exactly match the frozen plan`);
    }
  }
  if (new Set(createdListIds).size !== createdListIds.length) {
    errors.push('recovery_artifact.operation_journal: created List IDs must be unique');
  }
  return { counts, journal, createdListIds, createdListIdByPlannedId };
}

function validatePlannedInputs(plannedCandidate, semanticValidationReceipt, errors) {
  const analysis = validateAnalysis(plannedCandidate);
  if (!analysis.valid) errors.push(...analysis.errors.map((error) => `planned_candidate.${error}`));
  if (plannedCandidate?.run?.application_status !== 'planned') {
    errors.push('planned_candidate.run.application_status: must remain "planned"');
  }
  if (!isRecord(semanticValidationReceipt) || semanticValidationReceipt.status !== 'passed') {
    errors.push('semantic_validation_receipt: independently derived passing receipt is required');
  }
  if (semanticValidationReceipt?.hashes?.stars_analysis_sha256 !== canonicalSha256(plannedCandidate)) {
    errors.push('semantic_validation_receipt.hashes.stars_analysis_sha256: planned candidate binding mismatch');
  }
}

/**
 * Validate the exact delete-first boundary before any GitHub List mutation.
 * The caller must supply a freshly reread complete pre-write state.
 */
export function validateApplicationPreflight({
  plannedCandidate,
  semanticValidationReceipt,
  exactDiff,
  recoveryArtifact,
  currentPreWriteState
} = {}) {
  const errors = [];
  validatePlannedInputs(plannedCandidate, semanticValidationReceipt, errors);
  const desired = deriveDesiredProjection(plannedCandidate);
  validateRecovery(
    recoveryArtifact,
    plannedCandidate,
    exactDiff,
    desired,
    errors,
    { requiredPhase: 'prepared' }
  );
  validateDiff(exactDiff, plannedCandidate, desired, recoveryArtifact, errors);
  const currentEnvelope = isRecord(currentPreWriteState) ? currentPreWriteState : {};
  if (!isRecord(currentPreWriteState)) errors.push('current_pre_write_state: must be an object');
  exactKeys(currentEnvelope, [
    'schema_version', 'account_login', 'captured_at', 'star_count',
    'starred_repositories', 'lists'
  ], 'current_pre_write_state', errors);
  if (currentEnvelope.schema_version !== '1.0') {
    errors.push('current_pre_write_state.schema_version: must equal "1.0"');
  }
  if (currentEnvelope.account_login !== plannedCandidate?.account?.login) {
    errors.push('current_pre_write_state.account_login: must match the planned candidate');
  }
  if (!validTimestamp(currentEnvelope.captured_at)) {
    errors.push('current_pre_write_state.captured_at: must be an RFC 3339 timestamp');
  }
  rejectFutureTimestamp(
    currentEnvelope.captured_at,
    'current_pre_write_state.captured_at',
    errors
  );
  const currentProjection = {
    star_count: currentEnvelope.star_count,
    starred_repositories: currentEnvelope.starred_repositories,
    lists: currentEnvelope.lists
  };
  const current = validatePreWriteState(
    currentProjection,
    desired,
    'current_pre_write_state',
    errors
  );
  if (!sameCanonical(currentProjection, recoveryArtifact?.pre_write)) {
    errors.push('current_pre_write_state: state projection must exactly equal recovery_artifact.pre_write immediately before deletion');
  }
  if (validTimestamp(exactDiff?.generated_at) && validTimestamp(recoveryArtifact?.captured_at)
      && Date.parse(recoveryArtifact.captured_at) < Date.parse(exactDiff.generated_at)) {
    errors.push('recovery_artifact.captured_at: must not precede exact_diff.generated_at');
  }
  if (validTimestamp(recoveryArtifact?.captured_at) && validTimestamp(currentEnvelope.captured_at)
      && Date.parse(currentEnvelope.captured_at) < Date.parse(recoveryArtifact.captured_at)) {
    errors.push('current_pre_write_state.captured_at: must not precede recovery_artifact.captured_at');
  }
  const bindings = {
    planned_candidate_sha256: canonicalSha256(plannedCandidate),
    semantic_validation_receipt_sha256: canonicalSha256(semanticValidationReceipt),
    exact_diff_sha256: canonicalSha256(exactDiff),
    recovery_artifact_sha256: canonicalSha256(recoveryArtifact),
    current_pre_write_state_sha256: canonicalSha256(currentPreWriteState),
    desired_projection_sha256: canonicalSha256(desired)
  };
  return {
    valid: errors.length === 0,
    errors,
    bindings,
    counts: {
      repositories: desired.starred_repositories.length,
      pre_write_lists: current.lists.length,
      pre_write_memberships: current.memberships,
      planned_lists: desired.lists.length,
      planned_memberships: desired.lists.reduce((sum, list) => sum + list.repositories.length, 0)
    },
    limitations: [...APPLICATION_PREFLIGHT_LIMITATIONS]
  };
}

export function createApplicationPreflightValidationReceipt(result) {
  if (!result?.valid) throw new Error('Cannot create a passing application preflight receipt for invalid artifacts');
  return {
    status: 'passed',
    schema_version: '1.0',
    bindings: result.bindings,
    counts: result.counts,
    limitations: [...APPLICATION_PREFLIGHT_LIMITATIONS]
  };
}

/**
 * Validate an external runner claim about an authorized GitHub Lists rebuild.
 * This function performs no I/O and does not authenticate GitHub or authorization.
 */
export function validateApplicationReceipt(receipt, {
  plannedCandidate,
  semanticValidationReceipt,
  exactDiff,
  recoveryArtifact,
  finalState,
  applicationPreflightValidation,
  currentPreWriteState
} = {}) {
  const errors = [];
  validatePlannedInputs(plannedCandidate, semanticValidationReceipt, errors);
  const desired = deriveDesiredProjection(plannedCandidate);

  const preparedRecoveryArtifact = isRecord(recoveryArtifact)
    ? { ...recoveryArtifact, phase: 'prepared', operation_journal: [] }
    : recoveryArtifact;
  const preflightResult = validateApplicationPreflight({
    plannedCandidate,
    semanticValidationReceipt,
    exactDiff,
    recoveryArtifact: preparedRecoveryArtifact,
    currentPreWriteState
  });
  if (!preflightResult.valid) {
    errors.push(...preflightResult.errors.map((error) => `application_preflight.${error}`));
  }
  let derivedPreflightValidation;
  if (preflightResult.valid) {
    derivedPreflightValidation = createApplicationPreflightValidationReceipt(preflightResult);
    if (!sameCanonical(applicationPreflightValidation, derivedPreflightValidation)) {
      errors.push('application_preflight_validation: must exactly match the independently derived passing preflight receipt');
    }
  } else if (!isRecord(applicationPreflightValidation)) {
    errors.push('application_preflight_validation: independently derived passing preflight receipt is required');
  }

  const recoveryResult = validateRecovery(recoveryArtifact, plannedCandidate, exactDiff, desired, errors);
  validateDiff(exactDiff, plannedCandidate, desired, recoveryArtifact, errors);

  if (!isRecord(finalState)) errors.push('final_state: must be an object');
  const final = isRecord(finalState) ? finalState : {};
  exactKeys(final, ['schema_version', 'account_login', 'verified_at', 'star_count', 'starred_repositories', 'lists'], 'final_state', errors);
  if (final.schema_version !== '1.0') errors.push('final_state.schema_version: must equal "1.0"');
  if (final.account_login !== plannedCandidate?.account?.login) errors.push('final_state.account_login: must match the planned candidate');
  if (!validTimestamp(final.verified_at)) errors.push('final_state.verified_at: must be an RFC 3339 timestamp');
  rejectFutureTimestamp(final.verified_at, 'final_state.verified_at', errors);
  const finalStars = uniqueStrings(final.starred_repositories, 'final_state.starred_repositories', errors, FULL_NAME);
  if (!Number.isInteger(final.star_count) || final.star_count !== finalStars.length) errors.push('final_state.star_count: must equal final starred repository count');
  if (!sameCanonical([...finalStars].sort(), desired.starred_repositories)) {
    errors.push('final_state.starred_repositories: must exactly match the planned Stars; unstar is not permitted');
  }
  if (!Array.isArray(final.lists)) errors.push('final_state.lists: must be an array');
  const finalSemanticProjection = finalProjection(final, plannedCandidate, errors);
  if (!sameCanonical(finalSemanticProjection, desired)) errors.push('final_state: verified Lists and memberships do not exactly match the planned projection');
  const plannedIdByName = new Map(desired.lists.map((list) => [list.name, list.planned_list_id]));
  for (const [index, list] of (Array.isArray(final.lists) ? final.lists : []).entries()) {
    const plannedListId = plannedIdByName.get(list?.name);
    const createdListId = recoveryResult.createdListIdByPlannedId.get(plannedListId);
    if (plannedListId && list?.list_id !== createdListId) {
      errors.push(`final_state.lists[${index}].list_id: must equal the created ID for planned List "${plannedListId}"`);
    }
  }

  if (!isRecord(receipt)) {
    return { valid: false, errors: [...errors, '$: application receipt must be an object'] };
  }
  exactKeys(receipt, [
    'schema_version', 'application_id', 'account_login', 'started_at', 'completed_at',
    'status', 'authorization', 'bindings', 'operation_summary', 'final_state', 'limitations'
  ], '$', errors);
  if (receipt.schema_version !== '1.0') errors.push('schema_version: must equal "1.0"');
  if (!nonblank(receipt.application_id)) errors.push('application_id: must be nonblank');
  if (receipt.account_login !== plannedCandidate?.account?.login) errors.push('account_login: must match the planned candidate');
  if (!validTimestamp(receipt.started_at)) errors.push('started_at: must be an RFC 3339 timestamp');
  if (!validTimestamp(receipt.completed_at)) errors.push('completed_at: must be an RFC 3339 timestamp');
  rejectFutureTimestamp(receipt.started_at, 'started_at', errors);
  rejectFutureTimestamp(receipt.completed_at, 'completed_at', errors);
  if (receipt.status !== 'applied') errors.push('status: must equal "applied"');

  const authorization = isRecord(receipt.authorization) ? receipt.authorization : {};
  if (!isRecord(receipt.authorization)) errors.push('authorization: must be an object');
  exactKeys(authorization, ['scope', 'confirmed_at'], 'authorization', errors);
  if (authorization.scope !== 'github-star-lists-full-rebuild') errors.push('authorization.scope: invalid scope');
  if (!validTimestamp(authorization.confirmed_at)) errors.push('authorization.confirmed_at: must be an RFC 3339 timestamp');
  rejectFutureTimestamp(authorization.confirmed_at, 'authorization.confirmed_at', errors);

  const bindings = isRecord(receipt.bindings) ? receipt.bindings : {};
  if (!isRecord(receipt.bindings)) errors.push('bindings: must be an object');
  exactKeys(bindings, [
    'planned_candidate_sha256', 'semantic_validation_receipt_sha256', 'exact_diff_sha256',
    'recovery_artifact_sha256', 'current_pre_write_state_sha256',
    'application_preflight_validation_sha256', 'final_state_sha256',
    'desired_projection_sha256'
  ], 'bindings', errors);
  const expectedBindings = {
    planned_candidate_sha256: canonicalSha256(plannedCandidate),
    semantic_validation_receipt_sha256: canonicalSha256(semanticValidationReceipt),
    exact_diff_sha256: canonicalSha256(exactDiff),
    recovery_artifact_sha256: canonicalSha256(recoveryArtifact),
    current_pre_write_state_sha256: canonicalSha256(currentPreWriteState),
    application_preflight_validation_sha256: canonicalSha256(applicationPreflightValidation),
    final_state_sha256: canonicalSha256(finalState),
    desired_projection_sha256: canonicalSha256(desired)
  };
  for (const [field, expected] of Object.entries(expectedBindings)) {
    if (!SHA256.test(bindings[field] ?? '') || bindings[field] !== expected) errors.push(`bindings.${field}: binding mismatch`);
  }

  if (!sameCanonical(
    (final.lists ?? []).map((list) => list?.list_id).sort(),
    [...(recoveryResult.createdListIds ?? [])].sort()
  )) {
    errors.push('final_state.lists: List IDs must exactly match the created List IDs in the recovery journal');
  }
  const summary = isRecord(receipt.operation_summary) ? receipt.operation_summary : {};
  if (!isRecord(receipt.operation_summary)) errors.push('operation_summary: must be an object');
  exactKeys(summary, ['deleted_lists', 'created_lists', 'restored_memberships'], 'operation_summary', errors);
  for (const field of ['deleted_lists', 'created_lists', 'restored_memberships']) {
    if (!Number.isInteger(summary[field]) || summary[field] < 0) errors.push(`operation_summary.${field}: must be a nonnegative integer`);
    if (summary[field] !== recoveryResult.counts[field]) errors.push(`operation_summary.${field}: must match the completed recovery journal`);
  }
  if (summary.deleted_lists !== (exactDiff?.remove_lists?.length ?? -1)) errors.push('operation_summary.deleted_lists: must match the exact diff');
  if (summary.created_lists !== (exactDiff?.create_lists?.length ?? -1)) errors.push('operation_summary.created_lists: must match the exact diff');
  if (summary.restored_memberships !== (exactDiff?.restore_memberships?.length ?? -1)) errors.push('operation_summary.restored_memberships: must match the exact diff');

  const receiptFinal = isRecord(receipt.final_state) ? receipt.final_state : {};
  if (!isRecord(receipt.final_state)) errors.push('receipt.final_state: must be an object');
  exactKeys(receiptFinal, ['verified_at', 'projection_sha256'], 'receipt.final_state', errors);
  if (receiptFinal.verified_at !== final.verified_at) errors.push('receipt.final_state.verified_at: must match final state');
  rejectFutureTimestamp(receiptFinal.verified_at, 'receipt.final_state.verified_at', errors);
  if (receiptFinal.projection_sha256 !== canonicalSha256(finalSemanticProjection)
      || receiptFinal.projection_sha256 !== canonicalSha256(desired)) {
    errors.push('receipt.final_state.projection_sha256: must bind the exact verified planned projection');
  }
  if (!sameCanonical(receipt.limitations, APPLICATION_RECEIPT_LIMITATIONS)) {
    errors.push('limitations: must exactly disclose all offline validation limitations');
  }

  const chronology = [
    ['exact_diff.generated_at', exactDiff?.generated_at],
    ['recovery_artifact.captured_at', recoveryArtifact?.captured_at],
    ['current_pre_write_state.captured_at', currentPreWriteState?.captured_at],
    ['authorization.confirmed_at', authorization.confirmed_at],
    ['started_at', receipt.started_at],
    ['final_state.verified_at', final.verified_at],
    ['completed_at', receipt.completed_at]
  ];
  for (let index = 1; index < chronology.length; index += 1) {
    const [previousLabel, previous] = chronology[index - 1];
    const [label, current] = chronology[index];
    if (validTimestamp(previous) && validTimestamp(current) && Date.parse(current) < Date.parse(previous)) {
      errors.push(`${label}: must not precede ${previousLabel}`);
    }
  }
  for (const [index, entry] of (recoveryResult.journal ?? []).entries()) {
    if (validTimestamp(entry?.occurred_at) && validTimestamp(receipt.started_at)
        && Date.parse(entry.occurred_at) < Date.parse(receipt.started_at)) {
      errors.push(`recovery_artifact.operation_journal[${index}].occurred_at: must not precede application started_at`);
    }
    if (validTimestamp(entry?.occurred_at) && validTimestamp(final.verified_at)
        && Date.parse(entry.occurred_at) > Date.parse(final.verified_at)) {
      errors.push(`recovery_artifact.operation_journal[${index}].occurred_at: must not follow final verification`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    bindings: expectedBindings,
    counts: {
      repositories: desired.starred_repositories.length,
      lists: desired.lists.length,
      memberships: desired.lists.reduce((sum, list) => sum + list.repositories.length, 0),
      ...recoveryResult.counts
    },
    effective_application_status: errors.length === 0 ? 'applied' : 'planned'
  };
}

export function createApplicationValidationReceipt(receipt, result) {
  if (!result?.valid) throw new Error('Cannot create a passing application validation receipt for invalid artifacts');
  return {
    status: 'passed',
    schema_version: receipt.schema_version,
    application_id: receipt.application_id,
    effective_application_status: 'applied',
    bindings: result.bindings,
    counts: result.counts,
    limitations: [...APPLICATION_RECEIPT_LIMITATIONS]
  };
}
