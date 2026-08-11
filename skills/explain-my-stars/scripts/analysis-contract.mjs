import { readFileSync } from 'node:fs';
import { TextDecoder } from 'node:util';

const CLASSIFICATION_KIND = 'classification';
const REVIEW_QUEUE_KIND = 'review-queue';
const LIST_KINDS = new Set([CLASSIFICATION_KIND, REVIEW_QUEUE_KIND]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isWellFormedString(value) {
  if (typeof value !== 'string') return false;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function isNonblankString(value) {
  return isWellFormedString(value) && value.trim().length > 0;
}

function normalizedIdentity(value) {
  return typeof value === 'string'
    ? value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
    : '';
}

function validTimestamp(value) {
  if (!isNonblankString(value)) return false;
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/
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
  if (offsetHourText !== undefined && (Number(offsetHourText) > 23 || Number(offsetMinuteText) > 59)) {
    return false;
  }
  return Number.isFinite(Date.parse(value));
}

function validLocale(value) {
  if (!isNonblankString(value)) return false;
  try {
    const locale = new Intl.Locale(value);
    return locale.toString().length > 0;
  } catch {
    return false;
  }
}

function validListId(value) {
  return isWellFormedString(value) && /^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/.test(value);
}

function validRepositoryFullName(value) {
  if (typeof value !== 'string') return false;
  const match = /^([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9._-]+)$/.exec(value);
  if (!match) return false;
  const [, owner, repository] = match;
  return owner.length <= 39 && !owner.endsWith('-') && repository.length <= 100;
}

function validRepositoryUrl(value, fullName) {
  if (!isNonblankString(value) || !validRepositoryFullName(fullName)) return false;
  if (value !== `https://github.com/${fullName}`) return false;
  try {
    const url = new URL(value);
    const expectedPath = `/${fullName.trim()}`;
    return (
      url.protocol === 'https:' &&
      url.hostname.toLocaleLowerCase('en-US') === 'github.com' &&
      url.port === '' &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === '' &&
      url.pathname === expectedPath
    );
  } catch {
    return false;
  }
}

function normalizedUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    url.search = '';
    url.hostname = url.hostname.toLocaleLowerCase('en-US');
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString().toLocaleLowerCase('en-US');
  } catch {
    return normalizedIdentity(value);
  }
}

function pushDuplicateErrors(values, label, errors, normalize = normalizedIdentity) {
  const seen = new Map();
  for (const { value, path } of values) {
    if (!isNonblankString(value)) continue;
    const normalized = normalize(value);
    const previous = seen.get(normalized);
    if (previous) {
      errors.push(`${path}: duplicate ${label} "${value}" (first used at ${previous})`);
    } else {
      seen.set(normalized, path);
    }
  }
}

/**
 * Validate one frozen tidy-my-stars semantic analysis.
 *
 * The function deliberately accumulates independent errors so callers can repair
 * one malformed document in a single pass. It never reads files or performs I/O.
 */
export function validateAnalysis(analysis) {
  const errors = [];

  if (!isRecord(analysis)) {
    return { valid: false, errors: ['$: analysis must be a JSON object'] };
  }

  if (analysis.schema_version !== '1.0') {
    errors.push('schema_version: must equal "1.0"');
  }
  if (!validTimestamp(analysis.generated_at)) {
    errors.push('generated_at: must be a valid RFC 3339 timestamp');
  }
  if (!validLocale(analysis.locale)) {
    errors.push('locale: must be a valid locale identifier');
  }

  if (!isRecord(analysis.account)) {
    errors.push('account: must be an object');
  } else {
    if (!isNonblankString(analysis.account.login)) {
      errors.push('account.login: must be a nonblank string');
    }
    if (!Number.isInteger(analysis.account.star_count) || analysis.account.star_count < 0) {
      errors.push('account.star_count: must be a nonnegative integer');
    }
  }

  if (!isRecord(analysis.run)) {
    errors.push('run: must be an object');
  } else {
    const sensitivity = analysis.run.likely_unstar_sensitivity;
    if (!Number.isInteger(sensitivity) || sensitivity < 1 || sensitivity > 10) {
      errors.push('run.likely_unstar_sensitivity: must be an integer from 1 through 10');
    }
    if (analysis.run.analysis_status !== 'complete') {
      errors.push('run.analysis_status: must equal "complete"');
    }
    if (!['planned', 'applied'].includes(analysis.run.application_status)) {
      errors.push('run.application_status: must equal "planned" or "applied"');
    }
  }

  const lists = Array.isArray(analysis.lists) ? analysis.lists : [];
  if (!Array.isArray(analysis.lists)) {
    errors.push('lists: must be an array');
  }

  const listIds = [];
  const listNames = [];
  const knownLists = new Map();
  let classificationLists = 0;
  let reviewQueues = 0;

  for (const [index, list] of lists.entries()) {
    const path = `lists[${index}]`;
    if (!isRecord(list)) {
      errors.push(`${path}: must be an object`);
      continue;
    }

    if (!isNonblankString(list.id)) {
      errors.push(`${path}.id: must be a nonblank string`);
    } else if (!validListId(list.id)) {
      errors.push(`${path}.id: must be a route-safe identifier made of letters or digits separated by ., _, or -`);
    }
    if (!isNonblankString(list.name)) errors.push(`${path}.name: must be a nonblank string`);
    if (!isNonblankString(list.description)) {
      errors.push(`${path}.description: must be a nonblank string`);
    }
    if (!LIST_KINDS.has(list.kind)) {
      errors.push(`${path}.kind: must equal "classification" or "review-queue"`);
    } else if (list.kind === CLASSIFICATION_KIND) {
      classificationLists += 1;
    } else {
      reviewQueues += 1;
    }

    listIds.push({ value: list.id, path: `${path}.id` });
    listNames.push({ value: list.name, path: `${path}.name` });
    if (isNonblankString(list.id) && !knownLists.has(list.id)) {
      knownLists.set(list.id, list);
    }
  }

  pushDuplicateErrors(listIds, 'list id', errors, (value) => value);
  pushDuplicateErrors(listNames, 'list name', errors);
  if (classificationLists > 31) {
    errors.push(`lists: at most 31 classification Lists are allowed; found ${classificationLists}`);
  }
  if (reviewQueues !== 1) {
    errors.push(`lists: exactly one review-queue List is required; found ${reviewQueues}`);
  }

  const repositories = Array.isArray(analysis.repositories) ? analysis.repositories : [];
  if (!Array.isArray(analysis.repositories)) {
    errors.push('repositories: must be an array');
  }

  const repositoryNames = [];
  const repositoryUrls = [];
  let classificationMemberships = 0;
  let reviewQueueMemberships = 0;
  let unclassified = 0;
  const allMembershipReasons = [];

  for (const [repositoryIndex, repository] of repositories.entries()) {
    const path = `repositories[${repositoryIndex}]`;
    if (!isRecord(repository)) {
      errors.push(`${path}: must be an object`);
      continue;
    }

    if (!isNonblankString(repository.full_name)) {
      errors.push(`${path}.full_name: must be a nonblank string`);
    } else if (repository.full_name !== repository.full_name.trim()) {
      errors.push(`${path}.full_name: must not have leading or trailing whitespace`);
    } else if (!validRepositoryFullName(repository.full_name)) {
      errors.push(`${path}.full_name: must use the owner/repository form`);
    }
    if (!validRepositoryUrl(repository.url, repository.full_name)) {
      errors.push(`${path}.url: must be the exact canonical HTTPS GitHub URL for full_name`);
    }
    if (repository.description !== null && !isWellFormedString(repository.description)) {
      errors.push(`${path}.description: must be a well-formed Unicode string or null`);
    }

    repositoryNames.push({ value: repository.full_name, path: `${path}.full_name` });
    repositoryUrls.push({ value: repository.url, path: `${path}.url` });

    const memberships = Array.isArray(repository.memberships) ? repository.memberships : [];
    if (!Array.isArray(repository.memberships)) {
      errors.push(`${path}.memberships: must be an array`);
    }

    const membershipListIds = [];
    let repositoryClassificationMemberships = 0;
    for (const [membershipIndex, membership] of memberships.entries()) {
      const membershipPath = `${path}.memberships[${membershipIndex}]`;
      if (!isRecord(membership)) {
        errors.push(`${membershipPath}: must be an object`);
        continue;
      }

      if (!isNonblankString(membership.list_id)) {
        errors.push(`${membershipPath}.list_id: must be a nonblank string`);
      }
      if (!isNonblankString(membership.reason)) {
        errors.push(`${membershipPath}.reason: must be a nonblank, membership-specific reason`);
      }

      membershipListIds.push({ value: membership.list_id, path: `${membershipPath}.list_id` });
      allMembershipReasons.push({ value: membership.reason, path: `${membershipPath}.reason` });

      const list = knownLists.get(membership.list_id);
      if (isNonblankString(membership.list_id) && !list) {
        errors.push(`${membershipPath}.list_id: must exactly match a declared List ID; found "${membership.list_id}"`);
      } else if (list?.kind === CLASSIFICATION_KIND) {
        classificationMemberships += 1;
        repositoryClassificationMemberships += 1;
      } else if (list?.kind === REVIEW_QUEUE_KIND) {
        reviewQueueMemberships += 1;
      }
    }
    pushDuplicateErrors(membershipListIds, 'membership list id', errors, (value) => value);

    if (repositoryClassificationMemberships === 0) {
      unclassified += 1;
      if (!isNonblankString(repository.unclassified_reason)) {
        errors.push(
          `${path}.unclassified_reason: a nonblank reason is required when no classification membership is present`
        );
      }
    } else if (repository.unclassified_reason !== undefined && repository.unclassified_reason !== null) {
      errors.push(
        `${path}.unclassified_reason: must be omitted when a classification membership is present`
      );
    }
  }

  pushDuplicateErrors(repositoryNames, 'repository full_name', errors);
  pushDuplicateErrors(allMembershipReasons, 'membership reason', errors);

  const seenUrls = new Map();
  for (const { value, path } of repositoryUrls) {
    if (!isNonblankString(value)) continue;
    const normalized = normalizedUrl(value);
    const previous = seenUrls.get(normalized);
    if (previous) {
      errors.push(`${path}: duplicate repository URL "${value}" (first used at ${previous})`);
    } else {
      seenUrls.set(normalized, path);
    }
  }

  if (
    isRecord(analysis.account) &&
    Number.isInteger(analysis.account.star_count) &&
    analysis.account.star_count !== repositories.length
  ) {
    errors.push(
      `account.star_count: coverage mismatch; expected ${analysis.account.star_count} repositories but found ${repositories.length}`
    );
  }

  if (!isRecord(analysis.validation)) {
    errors.push('validation: must be an object');
  } else {
    if (analysis.validation.coverage_status !== 'complete') {
      errors.push('validation.coverage_status: must equal "complete"');
    }
    if (analysis.validation.semantic_review !== 'passed') {
      errors.push('validation.semantic_review: must equal "passed"');
    }
    if (!Array.isArray(analysis.validation.notes)) {
      errors.push('validation.notes: must be an array');
    } else {
      for (const [index, note] of analysis.validation.notes.entries()) {
        if (!isNonblankString(note)) {
          errors.push(`validation.notes[${index}]: must be a nonblank string`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    counts: {
      repositories: repositories.length,
      classification_lists: classificationLists,
      review_queues: reviewQueues,
      classification_memberships: classificationMemberships,
      review_queue_memberships: reviewQueueMemberships,
      unclassified
    }
  };
}

export function createValidationReceipt(analysis, validationResult = validateAnalysis(analysis)) {
  if (!validationResult.valid) {
    throw new Error('Cannot create a passing receipt for invalid analysis');
  }

  return {
    status: 'passed',
    schema_version: analysis.schema_version,
    counts: validationResult.counts
  };
}

/**
 * Read, parse, and validate an analysis file for deterministic downstream tools.
 * Returns the original data plus the trusted counts derived by this validator.
 */
export function parseAndValidateAnalysisSource(source) {
  if (typeof source !== 'string') {
    throw new Error('Analysis source must be a UTF-8 string');
  }
  let analysis;
  try {
    analysis = JSON.parse(source);
  } catch (error) {
    throw new Error(`Analysis is not valid JSON: ${error.message}`);
  }

  const result = validateAnalysis(analysis);
  if (!result.valid) {
    throw new Error(
      `Analysis validation failed with ${result.errors.length} error(s):\n- ${result.errors.join('\n- ')}`
    );
  }

  return { source, analysis, counts: result.counts };
}

export function loadAndValidateAnalysis(inputPath) {
  let bytes;
  try {
    bytes = readFileSync(inputPath);
  } catch (error) {
    throw new Error(`Could not read analysis file: ${error.message}`);
  }

  let source;
  try {
    source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch (error) {
    throw new Error(`Analysis file must contain valid UTF-8 bytes: ${error.message}`);
  }
  if (!Buffer.from(source, 'utf8').equals(bytes)) {
    throw new Error('Analysis file UTF-8 decoding did not preserve the exact source bytes');
  }

  return parseAndValidateAnalysisSource(source);
}
