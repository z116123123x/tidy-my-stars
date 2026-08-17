import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { dirname, join } from 'node:path';

import {
  GLOBAL_REVIEW_DIMENSIONS,
  calculateExecutionReceiptBindings,
  calculateSemanticPlanBindings,
  canonicalSha256,
  createSemanticValidationReceipt,
  deriveSourceId,
  gitBlobSha1,
  validateSemanticPlan
} from '../../skills/tidy-my-stars/scripts/semantic-contract.mjs';

const FIXTURE_ROOT = join(import.meta.dirname, 'fixtures/semantic-plan');
const COLLECTED_AT = '2026-08-12T00:00:00Z';
const REPOSITORIES = [
  {
    full_name: 'example/atlas-forge',
    repository_id: 101,
    commit_sha: '0123456789abcdef0123456789abcdef01234567',
    source_path: 'README.md',
    description: 'Agent workflows with an independently useful CAD output.',
    author_id: 'worker-atlas',
    execution_id: 'worker-atlas-execution',
    context_id: 'assessment-atlas-context'
  },
  {
    full_name: 'example/quiet-index',
    repository_id: 102,
    commit_sha: '89abcdef0123456789abcdef0123456789abcdef',
    source_path: 'docs/README.md',
    description: null,
    author_id: 'worker-quiet',
    execution_id: 'worker-quiet-execution',
    context_id: 'assessment-quiet-context'
  }
];

function clone(value) {
  return structuredClone(value);
}

function sourceTemplate(repository) {
  return {
    type: 'github-readme',
    repository_id: repository.repository_id,
    commit_sha: repository.commit_sha,
    source_path: repository.source_path
  };
}

function sourceDescriptor(repository) {
  const template = sourceTemplate(repository);
  const sourceId = deriveSourceId(repository.full_name, repository.repository_id, template);
  const localPath = `sources/${sourceId}.bin`;
  const bytes = readFileSync(join(FIXTURE_ROOT, localPath));
  return {
    bytes,
    descriptor: {
      source_id: sourceId,
      ...template,
      local_path: localPath,
      retrieved_at: COLLECTED_AT,
      http_status: 200,
      content_type: 'text/plain; charset=utf-8',
      bytes: bytes.length,
      sha256: canonicalSha256(bytes),
      api_url: `https://api.github.com/repos/${repository.full_name}/readme?ref=${repository.commit_sha}`,
      git_blob_sha1: gitBlobSha1(bytes)
    }
  };
}

function byteAnchor(source, text) {
  const needle = Buffer.from(text, 'utf8');
  const byteStart = source.bytes.indexOf(needle);
  if (byteStart < 0) throw new Error(`Semantic fixture source does not contain: ${text}`);
  const byteEnd = byteStart + needle.length;
  return {
    source_id: source.descriptor.source_id,
    byte_start: byteStart,
    byte_end: byteEnd,
    sha256: canonicalSha256(source.bytes.subarray(byteStart, byteEnd))
  };
}

function evidenceUnit(repository, source, byteStart = 0, byteEnd = source.bytes.length) {
  const identity = {
    repository: repository.full_name,
    source_id: source.descriptor.source_id,
    byte_start: byteStart,
    byte_end: byteEnd,
    sha256: canonicalSha256(source.bytes.subarray(byteStart, byteEnd))
  };
  return { id: canonicalSha256(identity), ...identity };
}

function partitionEvidenceUnits(repository, source, anchors) {
  const boundaries = new Set([0, source.bytes.length]);
  for (const anchor of anchors) {
    boundaries.add(anchor.byte_start);
    boundaries.add(anchor.byte_end);
  }
  const sorted = [...boundaries].sort((left, right) => left - right);
  return sorted.slice(0, -1)
    .filter((start, index) => sorted[index + 1] > start)
    .map((start, index) => evidenceUnit(repository, source, start, sorted[index + 1]));
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

function packetItems(plan) {
  const seen = new Map();
  const remember = (items) => {
    for (const anchor of items ?? []) seen.set(canonicalSha256(anchor), anchor);
  };
  for (const assessment of plan.assessments) {
    remember(assessment.primary_purpose_evidence);
    for (const intent of assessment.browse_intents) remember(intent.evidence);
    for (const signal of assessment.retention_signals) remember(signal.evidence);
  }
  const sources = new Map();
  for (const repository of plan.manifest.repositories) {
    for (const source of repository.sources) {
      sources.set(source.source_id, readFileSync(join(FIXTURE_ROOT, source.local_path)));
    }
  }
  return [...seen.entries()].map(([id, anchor]) => ({
    id,
    anchor: clone(anchor),
    ...taggedContent(sources.get(anchor.source_id).subarray(anchor.byte_start, anchor.byte_end))
  }));
}

function sourceChunk(id, repository, source, byteStart, byteEnd) {
  return {
    id,
    repository: repository.full_name,
    source_id: source.descriptor.source_id,
    byte_start: byteStart,
    byte_end: byteEnd,
    sha256: canonicalSha256(source.bytes.subarray(byteStart, byteEnd))
  };
}

function executionReceipt(plan, stage, authorId, contextId, repositories, startedAt, completedAt) {
  return {
    stage,
    execution_id: `${authorId}-execution`,
    context_id: contextId,
    runner_id: `orchestrator-${stage}-${authorId}`,
    author_id: authorId,
    repositories: [...repositories].sort(),
    started_at: startedAt,
    completed_at: completedAt,
    exit_status: 'completed',
    ...calculateExecutionReceiptBindings(plan, stage, repositories, { baseDirectory: FIXTURE_ROOT })
  };
}

function bind(plan) {
  plan.collectionReceipt.manifest = clone(plan.manifest);
  plan.collectionReceipt.manifest_sha256 = canonicalSha256(plan.collectionReceipt.manifest);
  plan.collection_receipt_sha256 = canonicalSha256(plan.collectionReceipt);
  const bindings = calculateSemanticPlanBindings(plan);
  Object.assign(plan.taxonomy, {
    input_manifest_sha256: bindings.manifest_sha256,
    input_assessments_sha256: bindings.assessments_sha256,
    candidate_sha256: bindings.taxonomy_candidate_sha256
  });
  Object.assign(plan.global_review, {
    repository_set_sha256: bindings.repository_set_sha256,
    manifest_sha256: bindings.manifest_sha256,
    assessments_sha256: bindings.assessments_sha256,
    review_evidence_sha256: bindings.review_evidence_sha256,
    taxonomy_candidate_sha256: bindings.taxonomy_candidate_sha256,
    stars_analysis_sha256: bindings.stars_analysis_sha256
  });
  const names = REPOSITORIES.map((repository) => repository.full_name);
  plan.executionReceipts.semantic_plan_sha256 = canonicalSha256(plan);
  plan.executionReceipts.collection_receipt_sha256 = canonicalSha256(plan.collectionReceipt);
  plan.executionReceipts.receipts = [
    executionReceipt(plan, 'assessment', 'worker-atlas', 'assessment-atlas-context', [names[0]], '2026-08-12T00:00:01Z', '2026-08-12T00:00:02Z'),
    executionReceipt(plan, 'assessment', 'worker-quiet', 'assessment-quiet-context', [names[1]], '2026-08-12T00:00:01Z', '2026-08-12T00:00:02Z'),
    executionReceipt(plan, 'taxonomy', 'taxonomy-author', 'taxonomy-context', names, '2026-08-12T00:00:02Z', '2026-08-12T00:00:03Z'),
    executionReceipt(plan, 'global-review', 'fresh-global-reviewer', 'fresh-review-context', names, '2026-08-12T00:00:03Z', '2026-08-12T00:00:04Z')
  ];
  return plan;
}

export function externalArtifacts(plan) {
  return {
    collectionReceipt: plan.collectionReceipt,
    executionReceipts: plan.executionReceipts
  };
}

export function buildValidPlan({ locale = 'en' } = {}) {
  const atlas = sourceDescriptor(REPOSITORIES[0]);
  const quiet = sourceDescriptor(REPOSITORIES[1]);
  const split = atlas.bytes.indexOf(Buffer.from('The command API', 'utf8'));
  const chunks = [
    sourceChunk('atlas-1', REPOSITORIES[0], atlas, 0, split),
    sourceChunk('atlas-2', REPOSITORIES[0], atlas, split, atlas.bytes.length),
    sourceChunk('quiet-1', REPOSITORIES[1], quiet, 0, quiet.bytes.length)
  ];
  const lists = [
    { id: 'agent-tools', name: 'Agent Tools', kind: 'classification', description: 'Installable agent systems and capabilities.' },
    { id: 'cad-and-3d', name: 'CAD & 3D', kind: 'classification', description: 'Tools that create editable geometry and 3D outputs.' },
    { id: 'knowledge-tools', name: 'Knowledge Tools', kind: 'classification', description: 'Tools for indexing and exploring structured knowledge.' },
    { id: 'likely-unstar', name: 'Star Review', kind: 'review-queue', description: 'Repositories worth another look before you decide what still belongs in your Stars.' }
  ];
  const claims = [
    { claim_id: 'atlas-agent', repository: REPOSITORIES[0].full_name, intent_id: 'agent-workflow', list_id: 'agent-tools', reason: 'Its installable command API makes the project reusable as an agent capability.' },
    { claim_id: 'atlas-cad', repository: REPOSITORIES[0].full_name, intent_id: 'cad-output', list_id: 'cad-and-3d', reason: 'Its editable model export gives the project a separate CAD browsing value.' },
    { claim_id: 'quiet-knowledge', repository: REPOSITORIES[1].full_name, intent_id: 'knowledge-exploration', list_id: 'knowledge-tools', reason: 'Its source-linked query outcome makes it useful when browsing knowledge tools.' }
  ];
  const reviewClaim = {
    claim_id: 'atlas-retention', repository: REPOSITORIES[0].full_name,
    retention_decision_id: 'atlas-decision', list_id: 'likely-unstar',
    reason: 'It is archived and redirects users to a maintained successor, so it merits human unstar review.'
  };
  const plan = {
    schema_version: '1.3',
    collection_receipt_sha256: '',
    manifest: {
      repositories: REPOSITORIES.map((repository, index) => ({
        full_name: repository.full_name,
        repository_id: repository.repository_id,
        url: `https://github.com/${repository.full_name}`,
        description: repository.description,
        readme: { status: 'available', source_id: [atlas, quiet][index].descriptor.source_id },
        sources: [[atlas, quiet][index].descriptor]
      }))
    },
    chunks,
    deliveries: chunks.map((item) => ({
      ...item,
      status: 'delivered',
      execution_id: item.repository === REPOSITORIES[0].full_name
        ? REPOSITORIES[0].execution_id : REPOSITORIES[1].execution_id
    })),
    evidence_units: [],
    assessments: [
      {
        repository: REPOSITORIES[0].full_name,
        author_id: REPOSITORIES[0].author_id,
        source_status: 'available',
        source_ids: [atlas.descriptor.source_id],
        primary_purpose: 'Turns natural-language briefs into an installable agent workflow.',
        primary_purpose_evidence: [byteAnchor(atlas, 'Atlas Forge turns natural-language briefs into reusable agent workflows.')],
        browse_intents: [
          { id: 'agent-workflow', outcome: 'Install and reuse a command API as an agent capability.', evidence: [byteAnchor(atlas, 'The command API can be installed as an independent capability in other agents.')] },
          { id: 'cad-output', outcome: 'Produce editable CAD models for downstream design.', evidence: [byteAnchor(atlas, 'It also exports editable CAD models for downstream design tools.')] }
        ],
        retention_signals: [{
          id: 'archived-successor',
          statement: 'The repository is archived and explicitly points to a maintained successor.',
          evidence: [byteAnchor(atlas, 'This repository is archived; its maintained successor is Example/Atlas-Next.\n')]
        }]
      },
      {
        repository: REPOSITORIES[1].full_name,
        author_id: REPOSITORIES[1].author_id,
        source_status: 'available',
        source_ids: [quiet.descriptor.source_id],
        primary_purpose: 'Builds a local semantic index for technical documentation.',
        primary_purpose_evidence: [byteAnchor(quiet, 'Quiet Index builds a local semantic index over technical documentation.')],
        browse_intents: [{
          id: 'knowledge-exploration',
          outcome: 'Query technical documentation with source-linked answers.',
          evidence: [byteAnchor(quiet, 'Its query API returns source-linked answers for knowledge exploration.')]
        }],
        retention_signals: [{
          id: 'active-useful',
          statement: 'The project is actively maintained and remains independently useful.',
          evidence: [byteAnchor(quiet, 'The project is actively maintained and remains independently useful.')]
        }]
      }
    ],
    taxonomy: {
      author_id: 'taxonomy-author', input_manifest_sha256: '', input_assessments_sha256: '', candidate_sha256: '',
      lists, classification_claims: claims,
      retention_decisions: [
        { id: 'atlas-decision', repository: REPOSITORIES[0].full_name, judgment: 'likely-unstar', reason: reviewClaim.reason, signal_ids: ['archived-successor'], comparator_repositories: [] },
        { id: 'quiet-decision', repository: REPOSITORIES[1].full_name, judgment: 'not-queued', reason: 'The actively maintained local index remains independently useful.', signal_ids: ['active-useful'], comparator_repositories: [] }
      ],
      review_claims: [reviewClaim], unclassified: []
    },
    candidate: {
      schema_version: '1.0', generated_at: COLLECTED_AT, locale,
      account: { login: 'example-user', star_count: 2 },
      run: { likely_unstar_sensitivity: 5, analysis_status: 'complete', application_status: 'planned' },
      lists: clone(lists),
      repositories: REPOSITORIES.map((repository) => ({
        full_name: repository.full_name,
        url: `https://github.com/${repository.full_name}`,
        description: repository.description,
        memberships: [...claims, reviewClaim]
          .filter((claim) => claim.repository === repository.full_name)
          .map((claim) => ({ list_id: claim.list_id, reason: claim.reason }))
      })),
      validation: { coverage_status: 'complete', semantic_review: 'passed', notes: [] }
    },
    global_review: {
      reviewer_id: 'fresh-global-reviewer', fresh_context_claimed: true,
      reviewed_repositories: REPOSITORIES.map((repository) => repository.full_name),
      repository_set_sha256: '', manifest_sha256: '', assessments_sha256: '',
      taxonomy_candidate_sha256: '', review_evidence_sha256: '', stars_analysis_sha256: '',
      dimensions: GLOBAL_REVIEW_DIMENSIONS.map((id) => ({
        id, verdict: 'passed', rationale: `The coherent fixture passes ${id}.`,
        evidence_ids: id === 'overlap-completeness' ? ['claim:atlas-agent', 'claim:atlas-cad'] : ['candidate'],
        findings: []
      }))
    }
  };
  plan.evidence_units = [
    ...partitionEvidenceUnits(REPOSITORIES[0], atlas, [
      ...plan.assessments[0].primary_purpose_evidence,
      ...plan.assessments[0].browse_intents.flatMap((item) => item.evidence),
      ...plan.assessments[0].retention_signals.flatMap((item) => item.evidence)
    ]),
    ...partitionEvidenceUnits(REPOSITORIES[1], quiet, [
      ...plan.assessments[1].primary_purpose_evidence,
      ...plan.assessments[1].browse_intents.flatMap((item) => item.evidence),
      ...plan.assessments[1].retention_signals.flatMap((item) => item.evidence)
    ])
  ];
  plan.review_evidence = { items: packetItems(plan) };
  const packetAnchorId = plan.review_evidence.items[0].id;
  for (const dimension of plan.global_review.dimensions) {
    if (['evidence-integrity', 'semantic-fidelity', 'retention-judgment'].includes(dimension.id)) {
      dimension.evidence_ids.push(`anchor:${packetAnchorId}`);
    }
  }
  Object.defineProperties(plan, {
    collectionReceipt: {
      value: {
        schema_version: '1.0',
        collector: {
          execution_id: 'collector-execution', context_id: 'collector-context', runner_id: 'collector-runner',
          started_at: '2026-08-11T23:59:59Z', completed_at: COLLECTED_AT, exit_status: 'completed'
        },
        collected_at: COLLECTED_AT,
        account: { login: 'example-user', star_count: 2 },
        manifest: clone(plan.manifest), manifest_sha256: ''
      },
      writable: true
    },
    executionReceipts: {
      value: { schema_version: '1.0', semantic_plan_sha256: '', collection_receipt_sha256: '', receipts: [] },
      writable: true
    }
  });
  return bind(plan);
}

function writePrivateJson(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const source = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(path, source, { encoding: 'utf8', mode: 0o600 });
  return source;
}

export function writeSemanticRun(directory, plan) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (const repository of plan.manifest.repositories) {
    for (const source of repository.sources) {
      const target = join(directory, source.local_path);
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      copyFileSync(join(FIXTURE_ROOT, source.local_path), target);
    }
  }
  writePrivateJson(join(directory, 'semantic-plan.json'), plan);
  writePrivateJson(join(directory, 'collection-receipt.json'), plan.collectionReceipt);
  writePrivateJson(join(directory, 'execution-receipts.json'), plan.executionReceipts);
  const result = validateSemanticPlan(plan, { baseDirectory: directory, ...externalArtifacts(plan) });
  if (!result.valid) throw new Error(`Invalid shared semantic fixture:\n${result.errors.join('\n')}`);
  writePrivateJson(join(directory, 'semantic-validation.json'), createSemanticValidationReceipt(plan, result));
  const analysisSource = writePrivateJson(join(directory, 'stars-analysis.json'), plan.candidate);
  return { directory, plan, result, analysisSource, analysisPath: join(directory, 'stars-analysis.json') };
}

export function materializeSemanticRun(directory, options = {}) {
  return writeSemanticRun(directory, buildValidPlan(options));
}
