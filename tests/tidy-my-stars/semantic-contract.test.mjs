import assert from 'node:assert/strict';
import {
  cpSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync,
  statSync, symlinkSync, writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  GLOBAL_REVIEW_DIMENSIONS,
  LIKELY_UNSTAR_SENSITIVITY_POLICY,
  OFFLINE_VALIDATION_LIMITATIONS,
  SEMANTIC_STAGE_CONTRACTS,
  calculateExecutionReceiptBindings,
  calculateSemanticPlanBindings,
  canonicalSha256,
  createSemanticStageContextPacket,
  deriveSourceId,
  gitBlobSha1,
  validateSemanticPlan
} from '../../skills/tidy-my-stars/scripts/semantic-contract.mjs';

const root = resolve(import.meta.dirname, '../..');
const fixtureRoot = join(import.meta.dirname, 'fixtures/semantic-plan');
const script = join(root, 'skills/tidy-my-stars/scripts/validate-semantic-plan.mjs');
const FETCHED_AT = '2026-08-12T00:00:00Z';
const COLLECTOR_STARTED_AT = '2026-08-11T23:59:59Z';
const ASSESSMENT_STARTED_AT = '2026-08-12T00:00:01Z';
const ASSESSMENT_COMPLETED_AT = '2026-08-12T00:00:02Z';
const TAXONOMY_STARTED_AT = '2026-08-12T00:00:02Z';
const TAXONOMY_COMPLETED_AT = '2026-08-12T00:00:03Z';
const REVIEW_STARTED_AT = '2026-08-12T00:00:03Z';
const REVIEW_COMPLETED_AT = '2026-08-12T00:00:04Z';
const ATLAS_COMMIT = '0123456789abcdef0123456789abcdef01234567';
const QUIET_COMMIT = '89abcdef0123456789abcdef0123456789abcdef';
const REPOSITORIES = {
  atlas: { full_name: 'example/atlas-forge', repository_id: 101, commit: ATLAS_COMMIT, source_path: 'README.md' },
  quiet: { full_name: 'example/quiet-index', repository_id: 102, commit: QUIET_COMMIT, source_path: 'docs/README.md' }
};

function clone(value) {
  return structuredClone(value);
}

function githubFileSource(identity, bytes, type = 'github-readme') {
  const source = {
    type,
    repository_id: identity.repository_id,
    commit_sha: identity.commit,
    source_path: identity.source_path
  };
  const sourceId = deriveSourceId(identity.full_name, identity.repository_id, source);
  const encodedPath = identity.source_path.split('/').map(encodeURIComponent).join('/');
  return {
    source_id: sourceId,
    type,
    repository_id: identity.repository_id,
    local_path: `sources/${sourceId}.bin`,
    retrieved_at: FETCHED_AT,
    http_status: 200,
    content_type: 'text/plain; charset=utf-8',
    bytes: bytes.length,
    sha256: canonicalSha256(bytes),
    api_url: type === 'github-readme'
      ? `https://api.github.com/repos/${identity.full_name}/readme?ref=${identity.commit}`
      : `https://api.github.com/repos/${identity.full_name}/contents/${encodedPath}?ref=${identity.commit}`,
    commit_sha: identity.commit,
    source_path: identity.source_path,
    git_blob_sha1: gitBlobSha1(bytes)
  };
}

function remoteSource(identity, bytes, type, url, accept) {
  const source = {
    type,
    repository_id: identity.repository_id,
    request: { method: 'GET', url, accept }
  };
  const sourceId = deriveSourceId(identity.full_name, identity.repository_id, source);
  return {
    source_id: sourceId,
    type,
    repository_id: identity.repository_id,
    local_path: `sources/${sourceId}.bin`,
    retrieved_at: FETCHED_AT,
    http_status: 200,
    content_type: type === 'web-page' ? 'text/html' : 'application/json',
    bytes: bytes.length,
    sha256: canonicalSha256(bytes),
    request: source.request
  };
}

function sourceBytes(source) {
  return Buffer.from(readFileSync(join(fixtureRoot, source.local_path)));
}

function anchor(source, bytes, textOrRange) {
  let start;
  let end;
  if (typeof textOrRange === 'string') {
    const needle = Buffer.from(textOrRange, 'utf8');
    start = bytes.indexOf(needle);
    assert.notEqual(start, -1, `fixture must contain ${textOrRange}`);
    end = start + needle.length;
  } else {
    ({ start, end } = textOrRange);
  }
  return {
    source_id: source.source_id,
    byte_start: start,
    byte_end: end,
    sha256: canonicalSha256(bytes.subarray(start, end))
  };
}

function evidenceUnit(repository, source, bytes, start = 0, end = bytes.length) {
  const identity = {
    repository,
    source_id: source.source_id,
    byte_start: start,
    byte_end: end,
    sha256: canonicalSha256(bytes.subarray(start, end))
  };
  return { id: canonicalSha256(identity), ...identity };
}

function partitionEvidenceUnits(repository, source, bytes, anchors) {
  const boundaries = new Set([0, bytes.length]);
  for (const item of anchors) {
    boundaries.add(item.byte_start);
    boundaries.add(item.byte_end);
  }
  const sorted = [...boundaries].sort((left, right) => left - right);
  return sorted.slice(0, -1)
    .filter((start, index) => sorted[index + 1] > start)
    .map((start, index) => evidenceUnit(repository, source, bytes, start, sorted[index + 1]));
}

function taggedContent(bytes) {
  try {
    const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (Buffer.from(content, 'utf8').equals(bytes)) return { content_encoding: 'utf-8', content };
  } catch {
    // Preserve invalid UTF-8 losslessly below.
  }
  return { content_encoding: 'base64', content: bytes.toString('base64') };
}

function refreshReviewEvidence(plan, baseDirectory = fixtureRoot) {
  const anchors = new Map();
  const remember = (items) => {
    for (const item of items ?? []) anchors.set(canonicalSha256(item), item);
  };
  for (const assessment of plan.assessments) {
    remember(assessment.primary_purpose_evidence);
    for (const intent of assessment.browse_intents ?? []) remember(intent.evidence);
    for (const signal of assessment.retention_signals ?? []) remember(signal.evidence);
  }
  const sources = new Map();
  for (const repository of plan.manifest.repositories) {
    for (const source of repository.sources) {
      sources.set(source.source_id, readFileSync(join(baseDirectory, source.local_path)));
    }
  }
  plan.review_evidence = {
    items: [...anchors.entries()].map(([id, item]) => ({
      id, anchor: clone(item),
      ...taggedContent(sources.get(item.source_id).subarray(item.byte_start, item.byte_end))
    }))
  };
}

function chunk(id, repository, source, bytes, start, end) {
  return {
    id,
    repository,
    source_id: source.source_id,
    byte_start: start,
    byte_end: end,
    sha256: canonicalSha256(bytes.subarray(start, end))
  };
}

function missingReadme(identity, commitSha = identity.commit) {
  return {
    status: 'missing',
    api_url: commitSha === null
      ? `https://api.github.com/repos/${identity.full_name}/readme`
      : `https://api.github.com/repos/${identity.full_name}/readme?ref=${commitSha}`,
    commit_sha: commitSha,
    retrieved_at: FETCHED_AT,
    http_status: 404
  };
}

function executionReceipt(plan, stage, identity, contextId, repositories, startedAt, completedAt, baseDirectory = fixtureRoot) {
  return {
    stage,
    execution_id: `${identity}-execution`,
    context_id: contextId,
    runner_id: `orchestrator-${stage}-${identity}`,
    author_id: identity,
    repositories: [...repositories].sort(),
    started_at: startedAt,
    completed_at: completedAt,
    exit_status: 'completed',
    ...calculateExecutionReceiptBindings(plan, stage, repositories, { baseDirectory })
  };
}

function externalArtifacts(plan) {
  return {
    collectionReceipt: plan.collectionReceipt,
    executionReceipts: plan.executionReceipts
  };
}

function bind(plan, { syncCollection = true, baseDirectory = fixtureRoot } = {}) {
  if (syncCollection) plan.collectionReceipt.manifest = clone(plan.manifest);
  plan.collectionReceipt.manifest_sha256 = canonicalSha256(plan.collectionReceipt.manifest);
  plan.collection_receipt_sha256 = canonicalSha256(plan.collectionReceipt);
  const bindings = calculateSemanticPlanBindings(plan);
  plan.taxonomy.input_manifest_sha256 = bindings.manifest_sha256;
  plan.taxonomy.input_assessments_sha256 = bindings.assessments_sha256;
  plan.taxonomy.candidate_sha256 = bindings.taxonomy_candidate_sha256;
  plan.global_review.repository_set_sha256 = bindings.repository_set_sha256;
  plan.global_review.manifest_sha256 = bindings.manifest_sha256;
  plan.global_review.assessments_sha256 = bindings.assessments_sha256;
  plan.global_review.review_evidence_sha256 = bindings.review_evidence_sha256;
  plan.global_review.taxonomy_candidate_sha256 = bindings.taxonomy_candidate_sha256;
  plan.global_review.stars_analysis_sha256 = bindings.stars_analysis_sha256;
  const all = plan.manifest.repositories.map((repository) => repository.full_name);
  plan.executionReceipts.schema_version = '1.0';
  plan.executionReceipts.semantic_plan_sha256 = canonicalSha256(plan);
  plan.executionReceipts.collection_receipt_sha256 = canonicalSha256(plan.collectionReceipt);
  plan.executionReceipts.receipts = [
    executionReceipt(plan, 'assessment', 'worker-atlas', 'assessment-atlas-context', [REPOSITORIES.atlas.full_name], ASSESSMENT_STARTED_AT, ASSESSMENT_COMPLETED_AT, baseDirectory),
    executionReceipt(plan, 'assessment', 'worker-quiet', 'assessment-quiet-context', [REPOSITORIES.quiet.full_name], ASSESSMENT_STARTED_AT, ASSESSMENT_COMPLETED_AT, baseDirectory),
    executionReceipt(plan, 'taxonomy', 'taxonomy-author', 'taxonomy-context', all, TAXONOMY_STARTED_AT, TAXONOMY_COMPLETED_AT, baseDirectory),
    executionReceipt(plan, 'global-review', 'fresh-global-reviewer', 'fresh-review-context', all, REVIEW_STARTED_AT, REVIEW_COMPLETED_AT, baseDirectory)
  ];
  return plan;
}

function buildValidPlan() {
  const atlasTemplate = githubFileSource(REPOSITORIES.atlas, Buffer.alloc(0));
  const quietTemplate = githubFileSource(REPOSITORIES.quiet, Buffer.alloc(0));
  const atlasBytes = sourceBytes(atlasTemplate);
  const quietBytes = sourceBytes(quietTemplate);
  const atlas = githubFileSource(REPOSITORIES.atlas, atlasBytes);
  const quiet = githubFileSource(REPOSITORIES.quiet, quietBytes);
  const split = atlasBytes.indexOf(Buffer.from('The command API'));
  const chunks = [
    chunk('atlas-1', REPOSITORIES.atlas.full_name, atlas, atlasBytes, 0, split),
    chunk('atlas-2', REPOSITORIES.atlas.full_name, atlas, atlasBytes, split, atlasBytes.length),
    chunk('quiet-1', REPOSITORIES.quiet.full_name, quiet, quietBytes, 0, quietBytes.length)
  ];
  const plan = {
    schema_version: '1.3',
    collection_receipt_sha256: '',
    manifest: {
      repositories: [
        {
          full_name: REPOSITORIES.atlas.full_name,
          repository_id: REPOSITORIES.atlas.repository_id,
          url: `https://github.com/${REPOSITORIES.atlas.full_name}`,
          description: 'Agent workflows with an independently useful CAD output.',
          readme: { status: 'available', source_id: atlas.source_id },
          sources: [atlas]
        },
        {
          full_name: REPOSITORIES.quiet.full_name,
          repository_id: REPOSITORIES.quiet.repository_id,
          url: `https://github.com/${REPOSITORIES.quiet.full_name}`,
          description: null,
          readme: { status: 'available', source_id: quiet.source_id },
          sources: [quiet]
        }
      ]
    },
    chunks,
    deliveries: chunks.map((item) => ({
      ...item,
      status: 'delivered',
      execution_id: item.repository === REPOSITORIES.atlas.full_name
        ? 'worker-atlas-execution'
        : 'worker-quiet-execution'
    })),
    evidence_units: [],
    assessments: [
      {
        repository: REPOSITORIES.atlas.full_name,
        author_id: 'worker-atlas',
        source_status: 'available',
        source_ids: [atlas.source_id],
        primary_purpose: 'Turns natural-language briefs into an installable agent workflow.',
        primary_purpose_evidence: [anchor(atlas, atlasBytes, 'Atlas Forge turns natural-language briefs into reusable agent workflows.')],
        browse_intents: [
          {
            id: 'agent-workflow',
            outcome: 'Install and reuse a command API as an agent capability.',
            evidence: [anchor(atlas, atlasBytes, 'The command API can be installed as an independent capability in other agents.')]
          },
          {
            id: 'cad-output',
            outcome: 'Produce editable CAD models for downstream design.',
            evidence: [anchor(atlas, atlasBytes, 'It also exports editable CAD models for downstream design tools.')]
          }
        ],
        retention_signals: [{
          id: 'archived-successor',
          statement: 'The repository is archived and explicitly points to a maintained successor.',
          evidence: [anchor(atlas, atlasBytes, 'This repository is archived; its maintained successor is Example/Atlas-Next.\n')]
        }]
      },
      {
        repository: REPOSITORIES.quiet.full_name,
        author_id: 'worker-quiet',
        source_status: 'available',
        source_ids: [quiet.source_id],
        primary_purpose: 'Builds a local semantic index for technical documentation.',
        primary_purpose_evidence: [anchor(quiet, quietBytes, 'Quiet Index builds a local semantic index over technical documentation.')],
        browse_intents: [
          {
            id: 'knowledge-exploration',
            outcome: 'Query technical documentation with source-linked answers.',
            evidence: [anchor(quiet, quietBytes, 'Its query API returns source-linked answers for knowledge exploration.')]
          }
        ],
        retention_signals: [{
          id: 'active-useful',
          statement: 'The project is actively maintained and remains independently useful.',
          evidence: [anchor(quiet, quietBytes, 'The project is actively maintained and remains independently useful.')]
        }]
      }
    ],
    taxonomy: {
      author_id: 'taxonomy-author',
      input_manifest_sha256: '', input_assessments_sha256: '', candidate_sha256: '',
      lists: [
        { id: 'agent-tools', name: 'Agent Tools', kind: 'classification', description: 'Installable agent systems and capabilities.' },
        { id: 'cad-and-3d', name: 'CAD & 3D', kind: 'classification', description: 'Tools that create editable geometry and 3D outputs.' },
        { id: 'knowledge-tools', name: 'Knowledge Tools', kind: 'classification', description: 'Tools for indexing and exploring structured knowledge.' },
        { id: 'likely-unstar', name: 'Likely Unstar', kind: 'review-queue', description: 'AI suggestions for the user to review before deciding.' }
      ],
      classification_claims: [
        { claim_id: 'atlas-agent', repository: REPOSITORIES.atlas.full_name, intent_id: 'agent-workflow', list_id: 'agent-tools', reason: 'Its installable command API makes the project reusable as an agent capability.' },
        { claim_id: 'atlas-cad', repository: REPOSITORIES.atlas.full_name, intent_id: 'cad-output', list_id: 'cad-and-3d', reason: 'Its editable model export gives the project a separate CAD browsing value.' },
        { claim_id: 'quiet-knowledge', repository: REPOSITORIES.quiet.full_name, intent_id: 'knowledge-exploration', list_id: 'knowledge-tools', reason: 'Its source-linked query outcome makes it useful when browsing knowledge tools.' }
      ],
      review_claims: [
        { claim_id: 'atlas-retention', repository: REPOSITORIES.atlas.full_name, retention_decision_id: 'atlas-decision', list_id: 'likely-unstar', reason: 'It is archived and redirects users to a maintained successor, so it merits human unstar review.' }
      ],
      retention_decisions: [
        { id: 'atlas-decision', repository: REPOSITORIES.atlas.full_name, judgment: 'likely-unstar', reason: 'It is archived and redirects users to a maintained successor, so it merits human unstar review.', signal_ids: ['archived-successor'], comparator_repositories: [] },
        { id: 'quiet-decision', repository: REPOSITORIES.quiet.full_name, judgment: 'not-queued', reason: 'The actively maintained local index remains independently useful.', signal_ids: ['active-useful'], comparator_repositories: [] }
      ],
      unclassified: []
    },
    candidate: {
      schema_version: '1.0', generated_at: FETCHED_AT, locale: 'en',
      account: { login: 'example-user', star_count: 2 },
      run: { likely_unstar_sensitivity: 5, analysis_status: 'complete', application_status: 'planned' },
      lists: [],
      repositories: [
        { full_name: REPOSITORIES.atlas.full_name, url: `https://github.com/${REPOSITORIES.atlas.full_name}`, description: 'Agent workflows with an independently useful CAD output.', memberships: [] },
        { full_name: REPOSITORIES.quiet.full_name, url: `https://github.com/${REPOSITORIES.quiet.full_name}`, description: null, memberships: [] }
      ],
      validation: { coverage_status: 'complete', semantic_review: 'passed', notes: [] }
    },
    global_review: {
      reviewer_id: 'fresh-global-reviewer', fresh_context_claimed: true,
      reviewed_repositories: [REPOSITORIES.atlas.full_name, REPOSITORIES.quiet.full_name],
      repository_set_sha256: '', manifest_sha256: '', assessments_sha256: '',
      taxonomy_candidate_sha256: '', review_evidence_sha256: '', stars_analysis_sha256: '',
      dimensions: [
        { id: 'coverage', verdict: 'passed', rationale: 'The manifest and review set match.', evidence_ids: ['manifest'], findings: [] },
        { id: 'evidence-integrity', verdict: 'passed', rationale: 'Frozen bytes and anchors are bound.', evidence_ids: [`source:${atlas.source_id}`], findings: [] },
        { id: 'semantic-fidelity', verdict: 'passed', rationale: 'Outcomes have exact source evidence.', evidence_ids: [`intent:${REPOSITORIES.atlas.full_name}#agent-workflow`], findings: [] },
        { id: 'taxonomy-clarity', verdict: 'passed', rationale: 'Lists have clear browsing purposes.', evidence_ids: ['taxonomy'], findings: [] },
        { id: 'overlap-completeness', verdict: 'passed', rationale: 'Independent outcomes overlap when useful.', evidence_ids: ['claim:atlas-agent', 'claim:atlas-cad'], findings: [] },
        { id: 'retention-judgment', verdict: 'passed', rationale: 'Queue advice remains evidence-backed.', evidence_ids: ['claim:atlas-retention'], findings: [] },
        { id: 'projection-integrity', verdict: 'passed', rationale: 'Candidate preserves claims exactly.', evidence_ids: ['candidate'], findings: [] }
      ]
    }
  };
  plan.evidence_units = [
    ...partitionEvidenceUnits(REPOSITORIES.atlas.full_name, atlas, atlasBytes, [
      ...plan.assessments[0].primary_purpose_evidence,
      ...plan.assessments[0].browse_intents.flatMap((item) => item.evidence),
      ...plan.assessments[0].retention_signals.flatMap((item) => item.evidence)
    ]),
    ...partitionEvidenceUnits(REPOSITORIES.quiet.full_name, quiet, quietBytes, [
      ...plan.assessments[1].primary_purpose_evidence,
      ...plan.assessments[1].browse_intents.flatMap((item) => item.evidence),
      ...plan.assessments[1].retention_signals.flatMap((item) => item.evidence)
    ])
  ];
  refreshReviewEvidence(plan);
  const packetAnchorId = plan.review_evidence.items[0].id;
  for (const dimension of plan.global_review.dimensions) {
    if (['evidence-integrity', 'semantic-fidelity', 'retention-judgment'].includes(dimension.id)) {
      dimension.evidence_ids.push(`anchor:${packetAnchorId}`);
    }
  }
  const collectionReceipt = {
    schema_version: '1.0',
    collector: {
      execution_id: 'collector-execution',
      context_id: 'collector-context',
      runner_id: 'collector-runner',
      started_at: COLLECTOR_STARTED_AT,
      completed_at: FETCHED_AT,
      exit_status: 'completed'
    },
    collected_at: FETCHED_AT,
    account: { login: 'example-user', star_count: 2 },
    manifest: clone(plan.manifest),
    manifest_sha256: ''
  };
  Object.defineProperties(plan, {
    collectionReceipt: { value: collectionReceipt, writable: true },
    executionReceipts: {
      value: {
        schema_version: '1.0',
        semantic_plan_sha256: '',
        collection_receipt_sha256: '',
        receipts: []
      },
      writable: true
    }
  });
  plan.candidate.lists = clone(plan.taxonomy.lists);
  for (const claim of [...plan.taxonomy.classification_claims, ...plan.taxonomy.review_claims]) {
    plan.candidate.repositories.find((repository) => repository.full_name === claim.repository)
      .memberships.push({ list_id: claim.list_id, reason: claim.reason });
  }
  return bind(plan);
}

function assertRejected(plan, pattern, baseDirectory = fixtureRoot) {
  const result = validateSemanticPlan(plan, { baseDirectory, ...externalArtifacts(plan) });
  assert.equal(result.valid, false, 'tampered plan must fail');
  assert.match(result.errors.join('\n'), pattern);
}

function writeRun(directory, plan) {
  writeFileSync(join(directory, 'semantic-plan.json'), `${JSON.stringify(plan, null, 2)}\n`);
  writeFileSync(join(directory, 'collection-receipt.json'), `${JSON.stringify(plan.collectionReceipt, null, 2)}\n`);
  writeFileSync(join(directory, 'execution-receipts.json'), `${JSON.stringify(plan.executionReceipts, null, 2)}\n`);
}

function makeSourceUnavailable(plan, readme, sources = []) {
  const name = REPOSITORIES.quiet.full_name;
  plan.manifest.repositories[1].readme = readme;
  plan.manifest.repositories[1].sources = sources;
  plan.chunks = plan.chunks.filter((item) => item.repository !== name);
  plan.deliveries = plan.deliveries.filter((item) => item.repository !== name);
  plan.evidence_units = plan.evidence_units.filter((item) => item.repository !== name);
  plan.assessments[1] = {
    repository: name, author_id: 'worker-quiet', source_status: 'source-unavailable',
    source_ids: sources.map((source) => source.source_id), primary_purpose: null,
    primary_purpose_evidence: [], browse_intents: [], retention_signals: []
  };
  plan.taxonomy.classification_claims = plan.taxonomy.classification_claims.filter((claim) => claim.repository !== name);
  plan.taxonomy.review_claims = plan.taxonomy.review_claims.filter((claim) => claim.repository !== name);
  const decision = plan.taxonomy.retention_decisions.find((item) => item.repository === name);
  Object.assign(decision, {
    judgment: 'unresolved', reason: 'No usable nonempty source evidence was available.',
    signal_ids: [], comparator_repositories: []
  });
  plan.taxonomy.unclassified = [{ repository: name, reason: 'No browse intent can be established without usable source evidence.' }];
  const candidate = plan.candidate.repositories.find((repository) => repository.full_name === name);
  candidate.memberships = [];
  candidate.unclassified_reason = plan.taxonomy.unclassified[0].reason;
  refreshReviewEvidence(plan);
  return bind(plan);
}

function makeEvidenceExhaustedUnclassified(plan) {
  const name = REPOSITORIES.quiet.full_name;
  const assessment = plan.assessments.find((item) => item.repository === name);
  assessment.browse_intents = [];
  const decision = plan.taxonomy.retention_decisions.find((item) => item.repository === name);
  decision.judgment = 'unresolved';
  decision.reason = 'The collection-wide judgment remains unresolved despite the available evidence.';
  plan.taxonomy.classification_claims = plan.taxonomy.classification_claims
    .filter((claim) => claim.repository !== name);
  plan.taxonomy.review_claims = plan.taxonomy.review_claims
    .filter((claim) => claim.repository !== name);
  plan.taxonomy.unclassified = [{ repository: name, reason: 'The complete evidence establishes no stable browse-worthy outcome.' }];
  const candidate = plan.candidate.repositories.find((repository) => repository.full_name === name);
  candidate.memberships = [];
  candidate.unclassified_reason = plan.taxonomy.unclassified[0].reason;
  refreshReviewEvidence(plan);
  return bind(plan);
}

function makeAvailableNoPurposeLikelyUnstar(plan) {
  const name = REPOSITORIES.quiet.full_name;
  const assessment = plan.assessments.find((item) => item.repository === name);
  assessment.primary_purpose = null;
  assessment.browse_intents = [];
  const decision = plan.taxonomy.retention_decisions.find((item) => item.repository === name);
  decision.judgment = 'likely-unstar';
  decision.reason = 'Complete evidence supports no stable project purpose or independently useful outcome.';
  plan.taxonomy.classification_claims = plan.taxonomy.classification_claims
    .filter((claim) => claim.repository !== name);
  plan.taxonomy.review_claims.push({
    claim_id: 'quiet-retention', repository: name, retention_decision_id: decision.id,
    list_id: 'likely-unstar', reason: decision.reason
  });
  plan.taxonomy.unclassified = [{
    repository: name,
    reason: 'The complete evidence establishes no stable browse-worthy project purpose.'
  }];
  const candidate = plan.candidate.repositories.find((repository) => repository.full_name === name);
  candidate.memberships = [{ list_id: 'likely-unstar', reason: decision.reason }];
  candidate.unclassified_reason = plan.taxonomy.unclassified[0].reason;
  refreshReviewEvidence(plan);
  return bind(plan);
}

test('RED shortcut with only self-declared semantic_review is rejected', () => {
  const shortcut = JSON.parse(readFileSync(join(fixtureRoot, 'observed-shortcut.json'), 'utf8'));
  assertRejected(shortcut, /manifest|semantic plan bundle/i);
});

test('accepts a source-aware overlapping plan and a tail anchor through EOF', () => {
  const plan = buildValidPlan();
  const result = validateSemanticPlan(plan, { baseDirectory: fixtureRoot, ...externalArtifacts(plan) });
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.equal(result.bindings.collection_receipt_sha256, canonicalSha256(plan.collectionReceipt));
  assert.equal(result.bindings.execution_receipts_sha256, canonicalSha256(plan.executionReceipts));
  assert.equal(plan.assessments[0].retention_signals[0].evidence[0].byte_end, plan.manifest.repositories[0].sources[0].bytes);
  assert.deepEqual(result.counts, {
    repositories: 2, sources: 2, chunks: 3, assessments: 2,
    evidence_units: 15, review_evidence_items: 7, retention_decisions: 2,
    classification_lists: 3, review_queues: 1,
    classification_memberships: 3, review_memberships: 1, unclassified: 0
  });
});

test('requires external collection and execution receipts instead of inline runner claims', () => {
  const plan = buildValidPlan();
  const missingBoth = validateSemanticPlan(plan, { baseDirectory: fixtureRoot });
  assert.equal(missingBoth.valid, false);
  assert.match(missingBoth.errors.join('\n'), /collection receipt.*required|execution receipts.*required/i);

  const inline = buildValidPlan();
  inline.execution_receipts = clone(inline.executionReceipts.receipts);
  assertRejected(inline, /execution_receipts.*unexpected field/i);

  const mismatchedCollection = buildValidPlan();
  mismatchedCollection.collectionReceipt.manifest.repositories[0].description = 'Changed outside the semantic plan.';
  bind(mismatchedCollection, { syncCollection: false });
  assertRejected(mismatchedCollection, /manifest.*exact|collection receipt.*manifest/i);

  const staleExecutionEnvelope = buildValidPlan();
  staleExecutionEnvelope.executionReceipts.semantic_plan_sha256 = '0'.repeat(64);
  assertRejected(staleExecutionEnvelope, /semantic_plan_sha256.*exact/i);
});

test('binds candidate inventory fields exactly to the frozen collection receipt', () => {
  const cases = [
    [(plan) => { plan.candidate.account.login = 'other-user'; }, /candidate\.account\.login.*collection/i],
    [(plan) => { plan.candidate.account.star_count = 1; }, /candidate\.account\.star_count.*collection|coverage mismatch/i],
    [(plan) => { plan.candidate.generated_at = '2026-08-12T00:00:01Z'; }, /candidate\.generated_at.*collected_at/i],
    [(plan) => { plan.candidate.repositories[0].url = 'https://github.com/example/other'; }, /candidate.*url.*collection/i],
    [(plan) => { plan.candidate.repositories[0].description = 'Changed'; }, /candidate.*description.*collection/i],
    [(plan) => { plan.candidate.run.application_status = 'applied'; }, /application_status.*planned/i]
  ];
  for (const [mutate, pattern] of cases) {
    const plan = buildValidPlan();
    mutate(plan);
    bind(plan);
    assertRejected(plan, pattern);
  }
});

test('validates collector inventory count, time bounds, and future snapshot rejection', () => {
  const count = buildValidPlan();
  count.collectionReceipt.account.star_count = 3;
  count.candidate.account.star_count = 3;
  bind(count, { syncCollection: false });
  assertRejected(count, /star_count.*manifest/i);

  const outside = buildValidPlan();
  outside.collectionReceipt.collected_at = '2026-08-12T00:00:01Z';
  outside.candidate.generated_at = outside.collectionReceipt.collected_at;
  bind(outside, { syncCollection: false });
  assertRejected(outside, /collected_at.*collector.*interval/i);

  const future = buildValidPlan();
  future.collectionReceipt.collector.started_at = '2999-01-01T00:00:00Z';
  future.collectionReceipt.collector.completed_at = '2999-01-01T00:00:02Z';
  future.collectionReceipt.collected_at = '2999-01-01T00:00:01Z';
  future.candidate.generated_at = future.collectionReceipt.collected_at;
  bind(future, { syncCollection: false });
  assertRejected(future, /collected_at.*future/i);
});

test('requires collector, assessment, taxonomy, and review chronology', () => {
  const cases = [
    [(plan) => { plan.executionReceipts.receipts[0].started_at = '2026-08-11T23:59:59Z'; }, /collector.*completed.*assessment.*started/i],
    [(plan) => { plan.executionReceipts.receipts[0].completed_at = '2026-08-12T00:00:03Z'; }, /assessment.*completed.*taxonomy.*started/i],
    [(plan) => { plan.executionReceipts.receipts[2].completed_at = '2026-08-12T00:00:04Z'; }, /taxonomy.*completed.*global.*started/i],
    [(plan) => { plan.executionReceipts.receipts[1].context_id = plan.executionReceipts.receipts[0].context_id; }, /duplicate context id/i],
    [(plan) => { plan.executionReceipts.receipts[2].context_id = plan.executionReceipts.receipts[0].context_id; }, /taxonomy context_id.*assessment context_id|duplicate.*boundary/i],
    [(plan) => { plan.executionReceipts.receipts[2].execution_id = plan.collectionReceipt.collector.context_id; }, /duplicate execution\/context boundary id/i],
    [(plan) => { plan.executionReceipts.receipts[2].context_id = plan.executionReceipts.receipts[2].execution_id; }, /duplicate execution\/context boundary id/i],
    [(plan) => { plan.executionReceipts.receipts[3].completed_at = '2999-01-01T00:00:00Z'; }, /completed_at.*future/i],
    [(plan) => { plan.executionReceipts.receipts[0].started_at = '2026-02-30T00:00:00Z'; }, /started_at.*RFC 3339/i],
    [(plan) => { plan.executionReceipts.receipts[0].started_at = '2026-08-12T00:00:01+24:00'; }, /started_at.*RFC 3339/i]
  ];
  for (const [mutate, pattern] of cases) {
    const plan = buildValidPlan();
    mutate(plan);
    assertRejected(plan, pattern);
  }
});

test('enforces source identity, provenance, same-repository fields, and unique local paths', () => {
  const cases = [
    [(plan) => { plan.manifest.repositories[0].sources[0].source_id = '0'.repeat(64); }, /source_id.*derived/i],
    [(plan) => { plan.manifest.repositories[0].sources[0].local_path = 'sources/human.bin'; }, /local_path.*source_id/i],
    [(plan) => { plan.manifest.repositories[0].sources[0].repository_id = 102; }, /repository_id.*parent/i],
    [(plan) => { plan.manifest.repositories[0].sources[0].api_url = `https://api.github.com/repos/example/other/readme?ref=${ATLAS_COMMIT}`; }, /api_url.*same repository/i],
    [(plan) => { plan.manifest.repositories[0].sources[0].commit_sha = 'main'; }, /commit_sha.*40/i],
    [(plan) => { plan.manifest.repositories[0].sources[0].source_path = '../README.md'; }, /source_path.*relative/i],
    [(plan) => { plan.manifest.repositories[0].sources[0].git_blob_sha1 = '0'.repeat(40); }, /Git blob SHA-1.*bytes/i],
    [(plan) => { plan.manifest.repositories[0].sources[0].retrieved_at = 'yesterday'; }, /retrieved_at.*RFC 3339/i],
    [(plan) => { plan.manifest.repositories[0].sources[0].http_status = 429; }, /http_status.*200/i],
    [(plan) => { plan.manifest.repositories[1].sources[0].local_path = plan.manifest.repositories[0].sources[0].local_path; }, /duplicate source local path/i],
    [(plan) => { plan.manifest.repositories[0].sources[0].retrieved_at = '2026-08-12T00:00:01Z'; }, /retrieved_at.*collector execution interval/i]
  ];
  for (const [mutate, pattern] of cases) {
    const plan = buildValidPlan(); mutate(plan); bind(plan); assertRejected(plan, pattern);
  }
});

test('validates github-api and web-page request provenance and source-aware anchors', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'tidy-supplemental-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  cpSync(fixtureRoot, directory, { recursive: true });
  const plan = buildValidPlan();
  const bytes = Buffer.from('<main>Quiet Index provides source-linked semantic search.</main>');
  const source = remoteSource(REPOSITORIES.quiet, bytes, 'web-page', 'https://quiet-index.example/docs', 'text/html');
  writeFileSync(join(directory, source.local_path), bytes);
  plan.manifest.repositories[1].readme = missingReadme(REPOSITORIES.quiet);
  plan.manifest.repositories[1].sources = [source];
  plan.chunks = plan.chunks.filter((item) => item.repository !== REPOSITORIES.quiet.full_name);
  plan.deliveries = plan.deliveries.filter((item) => item.repository !== REPOSITORIES.quiet.full_name);
  const item = chunk('quiet-web', REPOSITORIES.quiet.full_name, source, bytes, 0, bytes.length);
  plan.chunks.push(item);
  plan.deliveries.push({ ...item, status: 'delivered', execution_id: 'worker-quiet-execution' });
  const evidence = [anchor(source, bytes, 'Quiet Index provides source-linked semantic search.')];
  plan.assessments[1].source_ids = [source.source_id];
  plan.assessments[1].primary_purpose_evidence = evidence;
  plan.assessments[1].browse_intents[0].evidence = evidence;
  plan.assessments[1].retention_signals[0].evidence = evidence;
  plan.evidence_units = [
    ...plan.evidence_units.filter((unit) => unit.repository !== REPOSITORIES.quiet.full_name),
    ...partitionEvidenceUnits(REPOSITORIES.quiet.full_name, source, bytes, evidence)
  ];
  refreshReviewEvidence(plan, directory);
  bind(plan, { baseDirectory: directory });
  const accepted = validateSemanticPlan(plan, { baseDirectory: directory, ...externalArtifacts(plan) });
  assert.equal(accepted.valid, true, accepted.errors.join('\n'));

  plan.manifest.repositories[1].sources[0].request.url = 'http://quiet-index.example/docs';
  bind(plan, { baseDirectory: directory });
  assertRejected(plan, /canonical HTTPS URL/i, directory);

  const apiPlan = buildValidPlan();
  const apiBytes = Buffer.from('{"summary":"source-linked semantic search"}');
  const apiSource = remoteSource(
    REPOSITORIES.quiet,
    apiBytes,
    'github-api',
    'https://api.github.com/repos/example/quiet-index/releases?per_page=100',
    'application/vnd.github+json'
  );
  writeFileSync(join(directory, apiSource.local_path), apiBytes);
  apiPlan.manifest.repositories[1].readme = missingReadme(REPOSITORIES.quiet);
  apiPlan.manifest.repositories[1].sources = [apiSource];
  apiPlan.chunks = apiPlan.chunks.filter((item) => item.repository !== REPOSITORIES.quiet.full_name);
  apiPlan.deliveries = apiPlan.deliveries.filter((item) => item.repository !== REPOSITORIES.quiet.full_name);
  const apiChunk = chunk('quiet-api', REPOSITORIES.quiet.full_name, apiSource, apiBytes, 0, apiBytes.length);
  apiPlan.chunks.push(apiChunk);
  apiPlan.deliveries.push({ ...apiChunk, status: 'delivered', execution_id: 'worker-quiet-execution' });
  const apiEvidence = [anchor(apiSource, apiBytes, 'source-linked semantic search')];
  apiPlan.assessments[1].source_ids = [apiSource.source_id];
  apiPlan.assessments[1].primary_purpose_evidence = apiEvidence;
  apiPlan.assessments[1].browse_intents[0].evidence = apiEvidence;
  apiPlan.assessments[1].retention_signals[0].evidence = apiEvidence;
  apiPlan.evidence_units = [
    ...apiPlan.evidence_units.filter((unit) => unit.repository !== REPOSITORIES.quiet.full_name),
    ...partitionEvidenceUnits(REPOSITORIES.quiet.full_name, apiSource, apiBytes, apiEvidence)
  ];
  refreshReviewEvidence(apiPlan, directory);
  bind(apiPlan, { baseDirectory: directory });
  const apiAccepted = validateSemanticPlan(apiPlan, { baseDirectory: directory, ...externalArtifacts(apiPlan) });
  assert.equal(apiAccepted.valid, true, apiAccepted.errors.join('\n'));

  apiPlan.manifest.repositories[1].sources[0].request.url = 'https://api.github.com/repos/example/other/releases?per_page=100';
  bind(apiPlan, { baseDirectory: directory });
  assertRejected(apiPlan, /github-api source must target the same repository/i, directory);
});

test('supports raw non-UTF-8 source bytes because evidence is byte-ranged', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'tidy-raw-source-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  cpSync(fixtureRoot, directory, { recursive: true });
  const plan = buildValidPlan();
  const bytes = Buffer.from([0xff, 0xfe, 0x00, 0x61]);
  const source = githubFileSource(REPOSITORIES.quiet, bytes);
  writeFileSync(join(directory, source.local_path), bytes);
  plan.manifest.repositories[1].sources = [source];
  plan.manifest.repositories[1].readme = { status: 'available', source_id: source.source_id };
  plan.chunks = plan.chunks.filter((item) => item.repository !== REPOSITORIES.quiet.full_name);
  plan.deliveries = plan.deliveries.filter((item) => item.repository !== REPOSITORIES.quiet.full_name);
  const item = chunk('quiet-raw', REPOSITORIES.quiet.full_name, source, bytes, 0, bytes.length);
  plan.chunks.push(item);
  plan.deliveries.push({ ...item, status: 'delivered', execution_id: 'worker-quiet-execution' });
  const evidence = [anchor(source, bytes, { start: 0, end: bytes.length })];
  const assessment = plan.assessments[1];
  assessment.source_ids = [source.source_id];
  assessment.primary_purpose_evidence = evidence;
  assessment.browse_intents[0].evidence = evidence;
  assessment.retention_signals[0].evidence = evidence;
  plan.evidence_units = [
    ...plan.evidence_units.filter((unit) => unit.repository !== REPOSITORIES.quiet.full_name),
    evidenceUnit(REPOSITORIES.quiet.full_name, source, bytes)
  ];
  refreshReviewEvidence(plan, directory);
  bind(plan, { baseDirectory: directory });
  const result = validateSemanticPlan(plan, { baseDirectory: directory, ...externalArtifacts(plan) });
  assert.equal(result.valid, true, result.errors.join('\n'));
  const assessmentPacket = createSemanticStageContextPacket(
    plan, 'assessment', [REPOSITORIES.quiet.full_name], { baseDirectory: directory }
  );
  const rawUnit = assessmentPacket.evidence_units_with_content
    .find((unit) => unit.source_id === source.source_id);
  assert.equal(rawUnit.content_encoding, 'base64');
  assert.deepEqual(Buffer.from(rawUnit.content, 'base64'), bytes);
  assert.equal('content_base64' in rawUnit, false);
  const rawReviewItem = plan.review_evidence.items.find((entry) => entry.anchor.source_id === source.source_id);
  assert.equal(rawReviewItem.content_encoding, 'base64');
  assert.deepEqual(Buffer.from(rawReviewItem.content, 'base64'), bytes);

  rawReviewItem.content_encoding = 'utf-8';
  rawReviewItem.content = '\ufffd\ufffd\u0000a';
  bind(plan, { baseDirectory: directory });
  assertRejected(plan, /invalid UTF-8 source bytes must use base64/i, directory);

  rawReviewItem.content_encoding = 'base64';
  rawReviewItem.content = '***';
  bind(plan, { baseDirectory: directory });
  assertRejected(plan, /canonical base64/i, directory);
});

test('keeps BOM-prefixed valid UTF-8 directly readable and byte-exact', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'tidy-bom-source-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  cpSync(fixtureRoot, directory, { recursive: true });
  const plan = buildValidPlan();
  const bytes = Buffer.from('\ufeff多語 README tail remains readable.\n', 'utf8');
  const source = githubFileSource(REPOSITORIES.quiet, bytes);
  writeFileSync(join(directory, source.local_path), bytes);
  plan.manifest.repositories[1].sources = [source];
  plan.manifest.repositories[1].readme = { status: 'available', source_id: source.source_id };
  plan.chunks = plan.chunks.filter((item) => item.repository !== REPOSITORIES.quiet.full_name);
  plan.deliveries = plan.deliveries.filter((item) => item.repository !== REPOSITORIES.quiet.full_name);
  const item = chunk('quiet-bom', REPOSITORIES.quiet.full_name, source, bytes, 0, bytes.length);
  plan.chunks.push(item);
  plan.deliveries.push({ ...item, status: 'delivered', execution_id: 'worker-quiet-execution' });
  const evidence = [anchor(source, bytes, { start: 0, end: bytes.length })];
  const assessment = plan.assessments[1];
  assessment.source_ids = [source.source_id];
  assessment.primary_purpose_evidence = evidence;
  assessment.browse_intents[0].evidence = evidence;
  assessment.retention_signals[0].evidence = evidence;
  plan.evidence_units = [
    ...plan.evidence_units.filter((unit) => unit.repository !== REPOSITORIES.quiet.full_name),
    evidenceUnit(REPOSITORIES.quiet.full_name, source, bytes)
  ];
  refreshReviewEvidence(plan, directory);
  bind(plan, { baseDirectory: directory });
  const result = validateSemanticPlan(plan, { baseDirectory: directory, ...externalArtifacts(plan) });
  assert.equal(result.valid, true, result.errors.join('\n'));
  const packet = createSemanticStageContextPacket(
    plan, 'assessment', [REPOSITORIES.quiet.full_name], { baseDirectory: directory }
  );
  const unit = packet.evidence_units_with_content.find((entry) => entry.source_id === source.source_id);
  assert.equal(unit.content_encoding, 'utf-8');
  assert.equal(unit.content.codePointAt(0), 0xfeff);
  assert.deepEqual(Buffer.from(unit.content, 'utf8'), bytes);

  plan.evidence_units = [
    ...plan.evidence_units.filter((entry) => entry.repository !== REPOSITORIES.quiet.full_name),
    evidenceUnit(REPOSITORIES.quiet.full_name, source, bytes, 0, 4),
    evidenceUnit(REPOSITORIES.quiet.full_name, source, bytes, 4, bytes.length)
  ];
  bind(plan, { baseDirectory: directory });
  assertRejected(plan, /UTF-8 source evidence-unit boundaries must preserve complete code points/i, directory);
});

test('accepts missing README with null or pinned commit, and blocks non-404 missing states', () => {
  for (const commit of [QUIET_COMMIT, null]) {
    const plan = makeSourceUnavailable(buildValidPlan(), missingReadme(REPOSITORIES.quiet, commit));
    const result = validateSemanticPlan(plan, { baseDirectory: fixtureRoot, ...externalArtifacts(plan) });
    assert.equal(result.valid, true, result.errors.join('\n'));
  }
  const blocked = makeSourceUnavailable(buildValidPlan(), missingReadme(REPOSITORIES.quiet));
  blocked.manifest.repositories[1].readme.http_status = 403;
  bind(blocked);
  assertRejected(blocked, /missing README.*404|http_status.*404/i);

  const contradictory = buildValidPlan();
  contradictory.manifest.repositories[1].readme = missingReadme(REPOSITORIES.quiet);
  bind(contradictory);
  assertRejected(contradictory, /missing README requires zero github-readme sources/i);

  const ambiguous = buildValidPlan();
  ambiguous.manifest.repositories[0].sources.push(clone(ambiguous.manifest.repositories[1].sources[0]));
  bind(ambiguous);
  assertRejected(ambiguous, /available README requires exactly one github-readme source/i);
});

test('source-unavailable must be unresolved, claim-free, and exactly unclassified', () => {
  const cases = [
    [(plan) => { plan.assessments[1].primary_purpose = 'Fabricated'; }, /source-unavailable.*null/i],
    [(plan) => { plan.taxonomy.retention_decisions[1].judgment = 'not-queued'; }, /source-unavailable.*unresolved/i],
    [(plan) => { plan.taxonomy.retention_decisions[1].signal_ids = ['fabricated']; }, /source-unavailable.*signal_ids|unknown retention signal/i],
    [(plan) => { plan.taxonomy.review_claims.push({ claim_id: 'bad', repository: REPOSITORIES.quiet.full_name, retention_decision_id: 'quiet-decision', list_id: 'likely-unstar', reason: 'Fabricated queue.' }); }, /only likely-unstar|queue projection/i]
  ];
  for (const [mutate, pattern] of cases) {
    const plan = makeSourceUnavailable(buildValidPlan(), missingReadme(REPOSITORIES.quiet));
    mutate(plan); bind(plan); assertRejected(plan, pattern);
  }
});

test('available assessments always provide an evidence-backed retention signal', () => {
  const plan = buildValidPlan();
  plan.assessments[1].retention_signals = [];
  plan.taxonomy.retention_decisions[1].signal_ids = [];
  refreshReviewEvidence(plan);
  bind(plan);
  assertRejected(plan, /available assessment requires at least one source-grounded signal/i);
});

test('evidence-exhausted available source may remain unresolved and exactly unclassified', () => {
  const plan = makeEvidenceExhaustedUnclassified(buildValidPlan());
  const result = validateSemanticPlan(plan, { baseDirectory: fixtureRoot, ...externalArtifacts(plan) });
  assert.equal(result.valid, true, result.errors.join('\n'));

  const cases = [
    [(item) => { item.taxonomy.retention_decisions[1].signal_ids = []; }, /requires at least one valid retention signal/i],
    [(item) => { item.assessments[1].browse_intents = clone(buildValidPlan().assessments[1].browse_intents); }, /missing projection|classified xor unclassified|classification.*browse intents/i],
    [(item) => { item.taxonomy.classification_claims.push(clone(buildValidPlan().taxonomy.classification_claims[2])); }, /browse intent may project exactly once|classified xor unclassified/i],
    [(item) => { item.taxonomy.review_claims.push({ claim_id: 'bad-review', repository: REPOSITORIES.quiet.full_name, retention_decision_id: 'quiet-decision', list_id: 'likely-unstar', reason: 'Uncertainty alone is not an unstar recommendation.' }); }, /only likely-unstar|queue projection/i]
  ];
  for (const [mutate, pattern] of cases) {
    const item = makeEvidenceExhaustedUnclassified(buildValidPlan());
    mutate(item); bind(item); assertRejected(item, pattern);
  }
});

test('available evidence may establish no stable purpose while supporting Likely Unstar', () => {
  const plan = makeAvailableNoPurposeLikelyUnstar(buildValidPlan());
  const result = validateSemanticPlan(plan, { baseDirectory: fixtureRoot, ...externalArtifacts(plan) });
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.equal(result.counts.unclassified, 1);
  assert.equal(result.counts.review_memberships, 2);

  const cases = [
    [(item) => { item.assessments[1].primary_purpose_evidence = []; }, /primary_purpose_evidence.*at least one/i],
    [(item) => { item.assessments[1].browse_intents = clone(buildValidPlan().assessments[1].browse_intents); }, /null primary purpose.*zero browse intents/i],
    [(item) => { item.taxonomy.unclassified = []; delete item.candidate.repositories[1].unclassified_reason; }, /classified xor unclassified/i],
    [(item) => { item.taxonomy.review_claims = item.taxonomy.review_claims.filter((claim) => claim.repository !== REPOSITORIES.quiet.full_name); item.candidate.repositories[1].memberships = []; }, /queue projection/i]
  ];
  for (const [mutate, pattern] of cases) {
    const item = makeAvailableNoPurposeLikelyUnstar(buildValidPlan());
    mutate(item); bind(item); assertRejected(item, pattern);
  }
});

test('retention judgments are independent of classified versus unclassified projection', () => {
  for (const judgment of ['not-queued', 'likely-unstar', 'unresolved']) {
    const classified = buildValidPlan();
    const decision = classified.taxonomy.retention_decisions[0];
    decision.judgment = judgment;
    if (judgment === 'likely-unstar') {
      classified.taxonomy.review_claims[0].reason = decision.reason;
      classified.candidate.repositories[0].memberships.find((item) => item.list_id === 'likely-unstar').reason = decision.reason;
    } else {
      classified.taxonomy.review_claims = [];
      classified.candidate.repositories[0].memberships = classified.candidate.repositories[0].memberships
        .filter((item) => item.list_id !== 'likely-unstar');
      classified.global_review.dimensions.find((item) => item.id === 'retention-judgment').evidence_ids = [
        `retention-decision:${decision.id}`,
        `anchor:${classified.review_evidence.items[0].id}`
      ];
    }
    bind(classified);
    const result = validateSemanticPlan(classified, { baseDirectory: fixtureRoot, ...externalArtifacts(classified) });
    assert.equal(result.valid, true, `${judgment} + classified:\n${result.errors.join('\n')}`);

    const unclassified = makeAvailableNoPurposeLikelyUnstar(buildValidPlan());
    const unclassifiedDecision = unclassified.taxonomy.retention_decisions[1];
    unclassifiedDecision.judgment = judgment;
    if (judgment !== 'likely-unstar') {
      unclassified.taxonomy.review_claims = unclassified.taxonomy.review_claims
        .filter((claim) => claim.repository !== REPOSITORIES.quiet.full_name);
      unclassified.candidate.repositories[1].memberships = [];
      unclassified.global_review.dimensions.find((item) => item.id === 'retention-judgment').evidence_ids = [
        `retention-decision:${unclassifiedDecision.id}`,
        `anchor:${unclassified.review_evidence.items[0].id}`
      ];
    }
    bind(unclassified);
    const unclassifiedResult = validateSemanticPlan(unclassified, { baseDirectory: fixtureRoot, ...externalArtifacts(unclassified) });
    assert.equal(unclassifiedResult.valid, true, `${judgment} + unclassified:\n${unclassifiedResult.errors.join('\n')}`);
  }
});

test('requires exact evidence-backed collection-wide retention decisions', () => {
  const cases = [
    [(plan) => { plan.taxonomy.retention_decisions.pop(); }, /exactly one decision|required|repository set/i],
    [(plan) => { plan.taxonomy.retention_decisions[1].id = plan.taxonomy.retention_decisions[0].id; }, /duplicate retention decision id/i],
    [(plan) => { plan.taxonomy.retention_decisions[0].signal_ids = ['missing']; }, /unknown retention signal/i],
    [(plan) => { plan.taxonomy.retention_decisions[0].signal_ids = []; }, /requires at least one valid retention signal/i],
    [(plan) => { plan.taxonomy.retention_decisions[0].comparator_repositories = ['unknown/repo']; }, /comparator_repositories.*unknown/i],
    [(plan) => { plan.taxonomy.retention_decisions[0].comparator_repositories = [REPOSITORIES.atlas.full_name]; }, /cannot compare to itself/i],
    [(plan) => { plan.taxonomy.review_claims[0].reason = 'A paraphrase is not an exact projection.'; }, /exactly preserve the retention decision reason/i]
  ];
  for (const [mutate, pattern] of cases) {
    const plan = buildValidPlan(); mutate(plan); bind(plan); assertRejected(plan, pattern);
  }
});

test('review evidence exactly covers assessment anchors and replays frozen bytes', () => {
  const cases = [
    [(plan) => { plan.review_evidence.items.pop(); }, /missing assessment anchor|exactly cover/i],
    [(plan) => { plan.review_evidence.items.push(clone(plan.review_evidence.items[0])); }, /duplicate review evidence|extra item|exactly cover/i],
    [(plan) => { plan.review_evidence.items[0].id = '0'.repeat(64); }, /canonical SHA-256 of anchor|missing assessment anchor/i],
    [(plan) => { plan.review_evidence.items[0].content_encoding = 'base64'; plan.review_evidence.items[0].content = Buffer.from(plan.review_evidence.items[0].content).toString('base64'); }, /valid UTF-8.*must use utf-8/i],
    [(plan) => { plan.review_evidence.items[0].content += ' changed'; }, /decoded bytes.*frozen source slice/i]
  ];
  for (const [mutate, pattern] of cases) {
    const plan = buildValidPlan(); mutate(plan); bind(plan); assertRejected(plan, pattern);
  }
});

test('zero-byte available README is source-unavailable unless supplemental evidence is nonempty', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'tidy-zero-source-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  cpSync(fixtureRoot, directory, { recursive: true });
  const empty = githubFileSource(REPOSITORIES.quiet, Buffer.alloc(0));
  writeFileSync(join(directory, empty.local_path), Buffer.alloc(0));
  const plan = makeSourceUnavailable(buildValidPlan(), { status: 'available', source_id: empty.source_id }, [empty]);
  const result = validateSemanticPlan(plan, { baseDirectory: directory, ...externalArtifacts(plan) });
  assert.equal(result.valid, true, result.errors.join('\n'));
});

test('rejects chunk, receipt, anchor, taxonomy, and exact projection tampering', () => {
  const cases = [
    [(plan) => { plan.chunks[1].byte_start += 1; }, /contiguous/i],
    [(plan) => { plan.deliveries.pop(); }, /exactly one delivery/i],
    [(plan) => { plan.deliveries[0].status = 'read'; }, /status.*delivered/i],
    [(plan) => { plan.deliveries[0].execution_id = 'wrong-execution'; }, /must bind its assessment execution_id/i],
    [(plan) => { plan.assessments[0].browse_intents[0].evidence[0].sha256 = '0'.repeat(64); }, /anchor SHA-256/i],
    [(plan) => { plan.assessments[0].primary_purpose += ' changed'; }, /input_assessments_sha256|binding mismatch/i, false],
    [(plan) => { plan.candidate.repositories[0].memberships[0].reason += ' changed'; }, /projection mismatch/i]
  ];
  for (const [mutate, pattern, rebind = true] of cases) {
    const plan = buildValidPlan(); mutate(plan); if (rebind) bind(plan); assertRejected(plan, pattern);
  }
});

test('rejects current List data before taxonomy and entity-blind reason templates', () => {
  const leaked = buildValidPlan();
  leaked.assessments[0].current_lists = ['Copied'];
  bind(leaked);
  assertRejected(leaked, /forbidden before taxonomy/i);

  const generic = buildValidPlan();
  for (const claim of [generic.taxonomy.classification_claims[0], generic.taxonomy.classification_claims[2]]) {
    const list = generic.taxonomy.lists.find((item) => item.id === claim.list_id);
    claim.reason = `${claim.repository} belongs in ${list.name} because its complete README demonstrates ${list.description} [${claim.repository} -> ${claim.list_id}].`;
    generic.candidate.repositories.find((item) => item.full_name === claim.repository)
      .memberships.find((item) => item.list_id === claim.list_id).reason = claim.reason;
  }
  bind(generic);
  assertRejected(generic, /entity-blind membership reason template/i);
});

test('execution receipts hash exact stage inputs/outputs and bind fresh review boundaries', () => {
  const cases = [
    [(plan) => { plan.executionReceipts.receipts[0].input_hashes.source_subset_sha256 = '0'.repeat(64); }, /input_hashes.*exact stage inputs/i, false],
    [(plan) => { plan.executionReceipts.receipts[0].repositories.push(REPOSITORIES.quiet.full_name); }, /assessment repository sets.*partition|runner must match/i, false],
    [(plan) => { plan.executionReceipts.receipts.pop(); }, /global-review receipt required/i, false],
    [(plan) => { plan.executionReceipts.receipts[3].context_id = plan.executionReceipts.receipts[2].context_id; }, /global review.*context_id.*differ/i, false],
    [(plan) => { plan.executionReceipts.receipts[3].execution_id = plan.executionReceipts.receipts[0].execution_id; }, /duplicate execution id|global review.*execution_id/i, false],
    [(plan) => { plan.executionReceipts.receipts[0].repositories = {}; }, /repositories.*unique array|partition/i, false],
    [(plan) => { plan.executionReceipts.receipts[0].started_at = 'not-a-time'; }, /started_at.*RFC 3339/i, false],
    [(plan) => { plan.executionReceipts.receipts[0].completed_at = '2026-08-11T23:59:59Z'; }, /completed_at must not precede started_at/i, false],
    [(plan) => { plan.executionReceipts.receipts[0].exit_status = 'failed'; }, /exit_status.*completed/i, false],
    [(plan) => { plan.executionReceipts.receipts[0].runner_id = plan.executionReceipts.receipts[0].author_id; }, /runner_id must differ from author_id/i, false],
    [(plan) => { plan.executionReceipts.receipts[0].author_id = 'wrong-author'; }, /assessment author_id must match/i, false],
    [(plan) => { plan.executionReceipts.receipts[2].author_id = 'wrong-author'; }, /taxonomy author_id must match/i, false],
    [(plan) => { plan.executionReceipts.receipts[3].author_id = 'wrong-author'; }, /global-review author_id must match/i, false],
    [(plan) => { plan.executionReceipts.receipts[2].execution_id = plan.collectionReceipt.collector.execution_id; }, /duplicate execution id/i, false],
    [(plan) => { plan.executionReceipts.receipts[3].context_id = plan.collectionReceipt.collector.context_id; }, /duplicate context id/i, false],
    [(plan) => { plan.executionReceipts.receipts[3].input_hashes.review_evidence_sha256 = '0'.repeat(64); }, /input_hashes.*exact stage inputs/i, false],
    [(plan) => { plan.global_review.fresh = true; delete plan.global_review.fresh_context_claimed; }, /fresh_context_claimed|unexpected field/i]
  ];
  for (const [mutate, pattern, rebind = true] of cases) {
    const plan = buildValidPlan(); mutate(plan); if (rebind) bind(plan); assertRejected(plan, pattern);
  }
});

test('exports complete provider-neutral stage contracts and hashes the exact context packet', () => {
  const serialized = JSON.stringify(SEMANTIC_STAGE_CONTRACTS);
  for (const token of [
    'input_schema', 'output_schema', 'source-unavailable', 'retention_signals',
    'assessment_draft', 'primary_purpose_evidence_unit_ids',
    'taxonomy_draft', 'review_draft',
    'not-queued|likely-unstar|unresolved', 'retention_decision_id',
    'classification|review-queue', 'anchor:<review_evidence_item_id>',
    'coverage,evidence-integrity,semantic-fidelity,taxonomy-clarity,overlap-completeness,retention-judgment,projection-integrity'
  ]) assert.match(serialized, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')));
  assert.equal(JSON.stringify(SEMANTIC_STAGE_CONTRACTS.taxonomy.output_schema).includes('candidate_sha256'), false);
  assert.equal(JSON.stringify(SEMANTIC_STAGE_CONTRACTS.taxonomy.output_schema).includes('input_manifest_sha256'), false);
  assert.equal(
    SEMANTIC_STAGE_CONTRACTS['global-review'].output_schema.review_draft,
    '{reviewer_id,dimensions}'
  );
  const requiredRuleIds = {
    assessment: [
      'assessment.untrusted-full-units', 'assessment.primary-purpose',
      'assessment.independent-browse-outcomes', 'assessment.no-shortcut-signals',
      'assessment.first-class-outcomes-only', 'assessment.evidence-only-retention-signals',
      'assessment.no-current-lists', 'assessment.prompt-injection-not-semantic-evidence',
      'assessment.source-unavailable',
      'assessment.visible-lossless-content', 'assessment.runner-materializes'
    ],
    taxonomy: [
      'taxonomy.complete-collection-first', 'taxonomy.merge-equivalent-outcomes',
      'taxonomy.clear-direct-destinations', 'taxonomy.list-limits',
      'taxonomy.overlap-all-intents', 'taxonomy.singleton-allowed',
      'taxonomy.no-catchall', 'taxonomy.classification-retention-independent',
      'taxonomy.queue-preserves-classifications', 'taxonomy.review-reason-exact',
      'taxonomy.one-retention-decision',
      'taxonomy.user-collection-value', 'taxonomy.sensitivity-scale',
      'taxonomy.evidence-confidence-not-sensitivity', 'taxonomy.no-target-size',
      'taxonomy.no-sole-factor-recommendation',
      'taxonomy.prompt-injection-not-a-semantic-basis', 'taxonomy.comparator-optional',
      'taxonomy.source-unavailable-unresolved', 'taxonomy.runner-materializes'
    ],
    'global-review': [
      'review.fresh-complete-context', 'review.untrusted-packet',
      'review.visible-lossless-content', 'review.anchor-citations',
      'review.prompt-injection-independence',
      ...GLOBAL_REVIEW_DIMENSIONS.map((dimension) => `review.gate.${dimension}`),
      'review.failed-is-valid-draft', 'review.pass-gate', 'review.stop-on-failure',
      'review.offline-honesty', 'review.runner-materializes'
    ]
  };
  for (const [stage, ids] of Object.entries(requiredRuleIds)) {
    const rules = SEMANTIC_STAGE_CONTRACTS[stage].rules;
    assert.deepEqual(rules.map((rule) => rule.id).filter((id) => ids.includes(id)), ids);
    assert.ok(rules.every((rule) => Object.keys(rule).sort().join(',') === 'id,text' && rule.text.trim()));
  }
  assert.match(
    SEMANTIC_STAGE_CONTRACTS.assessment.rules.find((rule) => rule.id === 'assessment.primary-purpose').text,
    /Every available repository MUST cite at least one exact primary_purpose_evidence_unit_id.*primary_purpose is null/
  );

  const plan = buildValidPlan();
  const stages = [
    ['assessment', [REPOSITORIES.atlas.full_name], 0],
    ['taxonomy', Object.values(REPOSITORIES).map((item) => item.full_name), 2],
    ['global-review', Object.values(REPOSITORIES).map((item) => item.full_name), 3]
  ];
  for (const [stage, repositories, receiptIndex] of stages) {
    const packet = createSemanticStageContextPacket(plan, stage, repositories, { baseDirectory: fixtureRoot });
    assert.equal(canonicalSha256(packet), plan.executionReceipts.receipts[receiptIndex].input_hashes.context_packet_sha256);
  }
  const assessmentPacket = createSemanticStageContextPacket(plan, 'assessment', [REPOSITORIES.atlas.full_name], { baseDirectory: fixtureRoot });
  assert.equal('taxonomy' in assessmentPacket, false);
  assert.equal('review_evidence' in assessmentPacket, false);
  assert.ok(assessmentPacket.evidence_units_with_content.every((unit) =>
    unit.content_encoding === 'utf-8'
    && typeof unit.content === 'string'
    && !('content_base64' in unit)));
  const tailSentinel = 'This repository is archived; its maintained successor is Example/Atlas-Next.\n';
  const readableTail = assessmentPacket.evidence_units_with_content
    .find((unit) => unit.content === tailSentinel);
  assert.ok(readableTail, 'the exact tail evidence unit must be directly readable UTF-8');
  const atlasBytes = sourceBytes(plan.manifest.repositories[0].sources[0]);
  assert.deepEqual(
    Buffer.from(readableTail.content, 'utf8'),
    atlasBytes.subarray(readableTail.byte_start, readableTail.byte_end)
  );
  const taxonomyPacket = createSemanticStageContextPacket(plan, 'taxonomy', [], { baseDirectory: fixtureRoot });
  assert.equal('review_evidence' in taxonomyPacket, false);
  assert.equal(JSON.stringify(taxonomyPacket).includes('content_base64'), false);
  const reviewPacket = createSemanticStageContextPacket(plan, 'global-review', [], { baseDirectory: fixtureRoot });
  assert.deepEqual(taxonomyPacket.sensitivity_policy, LIKELY_UNSTAR_SENSITIVITY_POLICY);
  assert.deepEqual(reviewPacket.sensitivity_policy, LIKELY_UNSTAR_SENSITIVITY_POLICY);
  assert.deepEqual(LIKELY_UNSTAR_SENSITIVITY_POLICY.levels.map((item) => item.level), [1,2,3,4,5,6,7,8,9,10]);
  assert.ok(LIKELY_UNSTAR_SENSITIVITY_POLICY.levels.every((item) => item.inclusion_rule.trim()));
  assert.ok(reviewPacket.review_evidence.items.length > 0);
  assert.ok(reviewPacket.review_evidence.items.some((item) =>
    item.content_encoding === 'utf-8' && item.content === tailSentinel));
  assert.ok(reviewPacket.review_evidence.items.every((item) => !('content_base64' in item)));

  const mutated = clone(taxonomyPacket);
  mutated.rules[0].text += ' changed';
  assert.notEqual(canonicalSha256(mutated), canonicalSha256(taxonomyPacket));
  const changedRubric = clone(taxonomyPacket);
  changedRubric.sensitivity_policy.levels[4].inclusion_rule += ' changed';
  assert.notEqual(canonicalSha256(changedRubric), canonicalSha256(taxonomyPacket));
});

test('global review requires exact seven reasoned dimensions and valid source-aware evidence IDs', () => {
  const missing = buildValidPlan();
  missing.global_review.dimensions.pop();
  assertRejected(missing, /exactly seven|IDs mismatch/i);
  const unknown = buildValidPlan();
  unknown.global_review.dimensions[0].evidence_ids = ['source:not-real'];
  assertRejected(unknown, /unknown evidence ID/i);
  const bare = buildValidPlan();
  bare.global_review.dimensions[0].rationale = ' ';
  assertRejected(bare, /rationale.*nonblank/i);

  assert.match(
    SEMANTIC_STAGE_CONTRACTS['global-review'].output_schema.dimension,
    /verdict:passed\|failed/
  );
  const failed = buildValidPlan();
  failed.global_review.dimensions[0].verdict = 'failed';
  failed.global_review.dimensions[0].findings = ['Repository coverage is incomplete.'];
  bind(failed);
  assertRejected(failed, /verdict.*must equal passed/i);
  const finding = buildValidPlan();
  finding.global_review.dimensions[0].findings = ['BLOCKING: repository coverage is incomplete.'];
  bind(finding);
  assertRejected(finding, /findings.*must use \[\]/i);
});

test('CLI writes a private deterministic receipt with honest offline limitations', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'tidy-semantic-cli-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  cpSync(fixtureRoot, directory, { recursive: true });
  writeRun(directory, buildValidPlan());
  const passed = spawnSync(process.execPath, [script, directory], { cwd: root, encoding: 'utf8' });
  assert.equal(passed.status, 0, passed.stderr);
  const receipt = JSON.parse(passed.stdout);
  assert.deepEqual(receipt.limitations, OFFLINE_VALIDATION_LIMITATIONS);
  assert.equal(statSync(join(directory, 'semantic-validation.json')).mode & 0o777, 0o600);

  writeFileSync(join(directory, 'semantic-plan.json'), readFileSync(join(fixtureRoot, 'observed-shortcut.json')));
  const failed = spawnSync(process.execPath, [script, directory], { cwd: root, encoding: 'utf8' });
  assert.notEqual(failed.status, 0);
  assert.equal(existsSync(join(directory, 'semantic-validation.json')), false);
});

test('CLI rejects symlink escapes, including a stale validation receipt symlink', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'tidy-semantic-paths-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  cpSync(fixtureRoot, directory, { recursive: true });
  writeRun(directory, buildValidPlan());
  const alias = `${directory}-alias`;
  symlinkSync(directory, alias);
  t.after(() => rmSync(alias, { force: true }));
  const linkedRun = spawnSync(process.execPath, [script, alias], { cwd: root, encoding: 'utf8' });
  assert.notEqual(linkedRun.status, 0);
  assert.match(linkedRun.stderr, /symbolic link/i);

  const outside = join(tmpdir(), `tidy-semantic-outside-${process.pid}-${Date.now()}`);
  writeFileSync(outside, 'unchanged');
  t.after(() => rmSync(outside, { force: true }));
  symlinkSync(outside, join(directory, 'semantic-validation.json'));
  const safe = spawnSync(process.execPath, [script, directory], { cwd: root, encoding: 'utf8' });
  assert.notEqual(safe.status, 0);
  assert.match(safe.stderr, /semantic-validation\.json.*symbolic/i);
  assert.equal(readFileSync(outside, 'utf8'), 'unchanged');
  assert.equal(lstatSync(join(directory, 'semantic-validation.json')).isSymbolicLink(), true);
  rmSync(join(directory, 'semantic-validation.json'));

  const plan = buildValidPlan();
  const source = plan.manifest.repositories[0].sources[0];
  rmSync(join(directory, source.local_path));
  symlinkSync(outside, join(directory, source.local_path));
  writeRun(directory, plan);
  const linkedSource = spawnSync(process.execPath, [script, directory], { cwd: root, encoding: 'utf8' });
  assert.notEqual(linkedSource.status, 0);
  assert.match(linkedSource.stderr, /symbolic links are not allowed/i);
});

test('CLI fails closed for missing, symlinked, or aliased external receipt files', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'tidy-semantic-external-files-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  cpSync(fixtureRoot, directory, { recursive: true });
  const plan = buildValidPlan();
  writeRun(directory, plan);

  rmSync(join(directory, 'execution-receipts.json'));
  const missing = spawnSync(process.execPath, [script, directory], { cwd: root, encoding: 'utf8' });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /execution-receipts\.json|could not read/i);

  writeRun(directory, plan);
  rmSync(join(directory, 'collection-receipt.json'));
  symlinkSync(join(directory, 'semantic-plan.json'), join(directory, 'collection-receipt.json'));
  const symlinked = spawnSync(process.execPath, [script, directory], { cwd: root, encoding: 'utf8' });
  assert.notEqual(symlinked.status, 0);
  assert.match(symlinked.stderr, /symbolic-link|symbolic link/i);

  rmSync(join(directory, 'collection-receipt.json'));
  linkSync(join(directory, 'semantic-plan.json'), join(directory, 'collection-receipt.json'));
  const aliased = spawnSync(process.execPath, [script, directory], { cwd: root, encoding: 'utf8' });
  assert.notEqual(aliased.status, 0);
  assert.match(aliased.stderr, /alias|same file|distinct/i);
});

test('CLI removes a stale regular receipt when inputs fail and rejects output aliases', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'tidy-semantic-stale-receipt-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  cpSync(fixtureRoot, directory, { recursive: true });
  const plan = buildValidPlan();
  writeRun(directory, plan);
  const first = spawnSync(process.execPath, [script, directory], { cwd: root, encoding: 'utf8' });
  assert.equal(first.status, 0, first.stderr);

  rmSync(join(directory, 'execution-receipts.json'));
  const missing = spawnSync(process.execPath, [script, directory], { cwd: root, encoding: 'utf8' });
  assert.notEqual(missing.status, 0);
  assert.equal(existsSync(join(directory, 'semantic-validation.json')), false);

  writeRun(directory, plan);
  linkSync(join(directory, 'semantic-plan.json'), join(directory, 'semantic-validation.json'));
  const aliasedOutput = spawnSync(process.execPath, [script, directory], { cwd: root, encoding: 'utf8' });
  assert.notEqual(aliasedOutput.status, 0);
  assert.match(aliasedOutput.stderr, /semantic-validation\.json.*distinct|alias/i);
  assert.equal(existsSync(join(directory, 'semantic-plan.json')), true);
  assert.equal(existsSync(join(directory, 'semantic-validation.json')), false);
});
