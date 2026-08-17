#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { TextDecoder } from 'node:util';

import {
  GLOBAL_REVIEW_DIMENSIONS,
  calculateExecutionReceiptBindings,
  calculateSemanticPlanBindings,
  canonicalSha256,
  createSemanticValidationReceipt,
  deriveSourceId,
  validateSemanticPlan
} from '../../skills/explain-my-stars/scripts/semantic-contract.mjs';

const ANALYSIS_PATH = join(import.meta.dirname, 'synthetic-analysis.json');
const COLLECTOR_STARTED_AT = '2026-08-10T23:59:59Z';
const ASSESSMENT_STARTED_AT = '2026-08-11T00:00:01Z';
const ASSESSMENT_COMPLETED_AT = '2026-08-11T00:00:02Z';
const TAXONOMY_STARTED_AT = '2026-08-11T00:00:02Z';
const TAXONOMY_COMPLETED_AT = '2026-08-11T00:00:03Z';
const REVIEW_STARTED_AT = '2026-08-11T00:00:03Z';
const REVIEW_COMPLETED_AT = '2026-08-11T00:00:04Z';

// This is deliberately fictional source evidence for the fictional public demo.
// It is explicit and independent of synthetic-analysis.json so this materializer
// cannot turn an arbitrary analysis into self-declared semantic proof.
const DEMO_EVIDENCE = Object.freeze({
  'sample-labs/orbit-agent': {
    primary: 'Orbit Agent coordinates research and publishing agents in a visual workspace.',
    outcomes: {
      'agent-workflows': 'The workspace runs a multi-step research-to-publication process across coordinated agents.',
      'developer-tools': 'The visual graph editor lets developers inspect and refine executable agent workflows.'
    },
    retentionSignal: 'This maintained synthetic project retains distinct workflow and graph-editing outcomes.'
  },
  'sample-labs/toolsmith': {
    primary: 'Toolsmith packages small capabilities for reuse by agents.',
    outcomes: {
      'agent-skills': 'It exposes focused capabilities through a reusable agent-facing interface.',
      'developer-tools': 'It supplies authoring and validation commands for capability developers.'
    },
    retentionSignal: 'This maintained synthetic toolkit remains useful for authoring reusable capabilities.'
  },
  'sample-labs/vector-canvas': {
    primary: 'Vector Canvas is a programmable editor for vector scenes and parametric geometry.',
    outcomes: {
      'design-and-3d': 'It produces editable visual scenes and parametric geometric designs.',
      'developer-tools': 'Its scripting API embeds the editor in custom development pipelines.'
    },
    retentionSignal: 'This maintained synthetic editor retains distinct design and scripting outcomes.'
  },
  'sample-labs/knowledge-map': {
    primary: 'Knowledge Map explores concepts, sources, and semantic relationships.',
    outcomes: {
      'data-and-knowledge': 'It turns structured concepts and provenance into a browsable knowledge model.'
    },
    retentionSignal: 'This maintained synthetic explorer remains useful for source-linked knowledge browsing.'
  },
  'sample-labs/safe-scan': {
    primary: 'Safe Scan inspects untrusted project artifacts and produces defensive findings.',
    outcomes: {
      'security-and-testing': 'It detects risky content and produces a defensive inspection report.',
      'agent-skills': 'Agents can invoke the scanner as a bounded reusable review capability.'
    },
    retentionSignal: 'This maintained synthetic scanner retains a distinct defensive review outcome.'
  },
  'sample-labs/research-swarm': {
    primary: 'Research Swarm coordinates collection, comparison, and citation of research sources.',
    outcomes: {
      'agent-workflows': 'It coordinates distinct research roles into one cited investigation workflow.',
      'data-and-knowledge': 'It produces a durable source-linked body of structured research knowledge.'
    },
    retentionSignal: 'This maintained synthetic workflow remains useful for cited multi-agent research.'
  },
  'sample-labs/schema-studio': {
    primary: 'Schema Studio designs and validates structured data contracts in a browser.',
    outcomes: {
      'data-and-knowledge': 'It models structured data meaning and relationships between fields.',
      'developer-tools': 'It gives developers an interactive workflow for testing schema compatibility.'
    },
    retentionSignal: 'This maintained synthetic studio retains distinct modeling and compatibility-testing outcomes.'
  },
  'sample-labs/pixel-forge': {
    primary: 'Pixel Forge creates icons, sprites, and small reusable visual systems.',
    outcomes: {
      'design-and-3d': 'It provides a focused visual-design workflow for reusable pixel assets.'
    },
    retentionSignal: 'This maintained synthetic workspace remains useful for focused pixel-asset design.'
  },
  'sample-labs/legacy-runner': {
    primary: 'Legacy Runner executes an early form of a coordinated agent workflow.',
    outcomes: {
      'agent-workflows': 'It remains an executable multi-step agent workflow despite its legacy status.'
    },
    retentionSignal: 'A maintained successor preserves the same useful workflow with clearer operation and support.'
  },
  'sample-labs/duplicate-shell': {
    primary: 'Duplicate Shell provides a narrow command-line convenience for software work.',
    outcomes: {
      'developer-tools': 'It supplies a small terminal helper used during software development.'
    },
    retentionSignal: 'Several stronger maintained tools in this synthetic collection already cover its only practical capability.'
  },
  'sample-labs/abandoned-widget': {
    primary: 'Abandoned Widget is a proof-of-concept widget without a reusable outcome.',
    outcomes: {},
    retentionSignal: 'The prototype has no durable practical, learning, reference, or distinctive value to keep.'
  },
  'sample-labs/unclear-prototype': {
    primary: 'Unclear Prototype is an intentionally ambiguous synthetic project with insufficient evidence for a durable browsing outcome.',
    outcomes: {},
    retentionSignal: 'Insufficient evidence prevents a removal recommendation as well as a useful classification.'
  }
});

// These are fixed collection-wide taxonomy decisions, separate from the
// repository-local facts above. Queue reasons intentionally equal the immutable
// candidate reasons; non-queued reasons remain private semantic provenance.
const DEMO_RETENTION_DECISIONS = Object.freeze({
  'sample-labs/orbit-agent': {
    judgment: 'not-queued',
    reason: 'This maintained synthetic project retains distinct workflow and graph-editing outcomes.',
    comparatorRepositories: []
  },
  'sample-labs/toolsmith': {
    judgment: 'not-queued',
    reason: 'This maintained synthetic toolkit remains useful for authoring reusable capabilities.',
    comparatorRepositories: []
  },
  'sample-labs/vector-canvas': {
    judgment: 'not-queued',
    reason: 'This maintained synthetic editor retains distinct design and scripting outcomes.',
    comparatorRepositories: []
  },
  'sample-labs/knowledge-map': {
    judgment: 'not-queued',
    reason: 'This maintained synthetic explorer remains useful for source-linked knowledge browsing.',
    comparatorRepositories: []
  },
  'sample-labs/safe-scan': {
    judgment: 'not-queued',
    reason: 'This maintained synthetic scanner retains a distinct defensive review outcome.',
    comparatorRepositories: []
  },
  'sample-labs/research-swarm': {
    judgment: 'not-queued',
    reason: 'This maintained synthetic workflow remains useful for cited multi-agent research.',
    comparatorRepositories: []
  },
  'sample-labs/schema-studio': {
    judgment: 'not-queued',
    reason: 'This maintained synthetic studio retains distinct modeling and compatibility-testing outcomes.',
    comparatorRepositories: []
  },
  'sample-labs/pixel-forge': {
    judgment: 'not-queued',
    reason: 'This maintained synthetic workspace remains useful for focused pixel-asset design.',
    comparatorRepositories: []
  },
  'sample-labs/legacy-runner': {
    judgment: 'likely-unstar',
    reason: 'The maintained successor preserves the useful workflow with clearer operation and support.',
    comparatorRepositories: ['sample-labs/orbit-agent']
  },
  'sample-labs/duplicate-shell': {
    judgment: 'likely-unstar',
    reason: 'Its only practical capability is already covered by several stronger maintained tools in the collection.',
    comparatorRepositories: ['sample-labs/schema-studio', 'sample-labs/toolsmith']
  },
  'sample-labs/abandoned-widget': {
    judgment: 'likely-unstar',
    reason: 'The prototype offers no durable practical, learning, reference, or distinctive value to keep.',
    comparatorRepositories: []
  },
  'sample-labs/unclear-prototype': {
    judgment: 'not-queued',
    reason: 'Insufficient evidence prevents a removal recommendation as well as a useful classification.',
    comparatorRepositories: []
  }
});

function clone(value) {
  return structuredClone(value);
}

const FATAL_UTF8_DECODER = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function taggedContent(bytes) {
  try {
    const content = FATAL_UTF8_DECODER.decode(bytes);
    if (Buffer.from(content, 'utf8').equals(bytes)) {
      return { content_encoding: 'utf-8', content };
    }
  } catch {
    // Preserve invalid UTF-8 losslessly below.
  }
  return { content_encoding: 'base64', content: bytes.toString('base64') };
}

function exactAnchor(source, text) {
  const needle = Buffer.from(text, 'utf8');
  const byteStart = source.bytes.indexOf(needle);
  if (byteStart < 0) throw new Error(`Synthetic evidence source is missing an exact statement: ${text}`);
  const byteEnd = byteStart + needle.length;
  return {
    source_id: source.descriptor.source_id,
    byte_start: byteStart,
    byte_end: byteEnd,
    sha256: canonicalSha256(source.bytes.subarray(byteStart, byteEnd))
  };
}

function evidenceUnit(repository, source, byteStart, byteEnd) {
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
  const ordered = [...boundaries].sort((left, right) => left - right);
  return ordered.slice(0, -1)
    .filter((start, index) => ordered[index + 1] > start)
    .map((start, index) => evidenceUnit(repository, source, start, ordered[index + 1]));
}

function reviewEvidenceItems(plan, sources) {
  const anchors = new Map();
  const remember = (evidence) => {
    for (const anchor of evidence ?? []) anchors.set(canonicalSha256(anchor), anchor);
  };
  for (const assessment of plan.assessments) {
    remember(assessment.primary_purpose_evidence);
    for (const intent of assessment.browse_intents) remember(intent.evidence);
    for (const signal of assessment.retention_signals) remember(signal.evidence);
  }
  const sourceBytes = new Map(sources.map((source) => [source.descriptor.source_id, source.bytes]));
  return [...anchors.entries()].map(([id, anchor]) => ({
    id,
    anchor: clone(anchor),
    ...taggedContent(sourceBytes.get(anchor.source_id)
      .subarray(anchor.byte_start, anchor.byte_end))
  }));
}

function makeSource(repository, repositoryId, evidence, collectedAt) {
  const lines = [
    `Synthetic evidence for ${repository.full_name}.`,
    'These statements describe fictional public-demo data and do not claim a live GitHub observation.',
    `Primary purpose: ${evidence.primary}`,
    ...Object.entries(evidence.outcomes).map(([id, text]) => `Outcome ${id}: ${text}`),
    `Retention signal: ${evidence.retentionSignal}`,
    ''
  ];
  const bytes = Buffer.from(lines.join('\n'), 'utf8');
  const request = {
    method: 'GET',
    url: `https://example.invalid/tidy-my-stars/synthetic/${repository.full_name}.txt`,
    accept: 'text/plain'
  };
  const template = { type: 'web-page', repository_id: repositoryId, request };
  const sourceId = deriveSourceId(repository.full_name, repositoryId, template);
  return {
    bytes,
    primaryText: evidence.primary,
    outcomeTexts: evidence.outcomes,
    retentionSignalText: evidence.retentionSignal,
    descriptor: {
      source_id: sourceId,
      ...template,
      local_path: `sources/${sourceId}.bin`,
      retrieved_at: collectedAt,
      http_status: 200,
      content_type: 'text/plain; charset=utf-8',
      bytes: bytes.length,
      sha256: canonicalSha256(bytes)
    }
  };
}

function executionReceipt(
  plan,
  stage,
  authorId,
  executionId,
  contextId,
  repositories,
  startedAt,
  completedAt,
  baseDirectory
) {
  return {
    stage,
    execution_id: executionId,
    context_id: contextId,
    runner_id: `synthetic-demo-orchestrator-${stage}-${authorId}`,
    author_id: authorId,
    repositories: [...repositories].sort(),
    started_at: startedAt,
    completed_at: completedAt,
    exit_status: 'completed',
    ...calculateExecutionReceiptBindings(plan, stage, repositories, { baseDirectory })
  };
}

function buildDemoBundle(candidate) {
  const expectedNames = Object.keys(DEMO_EVIDENCE);
  const actualNames = candidate.repositories.map((repository) => repository.full_name);
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new Error('Synthetic analysis repository inventory does not exactly match the explicit demo evidence table.');
  }
  if (JSON.stringify(Object.keys(DEMO_RETENTION_DECISIONS)) !== JSON.stringify(expectedNames)) {
    throw new Error('Synthetic collection-wide retention decisions must exactly cover the demo evidence inventory.');
  }
  if (candidate.validation?.notes?.every((note) => !/synthetic|fictional/i.test(note)) !== false) {
    throw new Error('Synthetic analysis must explicitly identify itself as fictional demo data.');
  }
  if (candidate.run?.application_status !== 'planned') {
    throw new Error('Synthetic demo candidate must remain a pre-write planned analysis.');
  }

  const classificationIds = new Set(candidate.lists.filter((list) => list.kind === 'classification').map((list) => list.id));
  const reviewQueue = candidate.lists.find((list) => list.kind === 'review-queue');
  const sources = candidate.repositories.map((repository, index) => {
    const evidence = DEMO_EVIDENCE[repository.full_name];
    const decision = DEMO_RETENTION_DECISIONS[repository.full_name];
    const expectedOutcomes = repository.memberships
      .filter((membership) => classificationIds.has(membership.list_id))
      .map((membership) => membership.list_id)
      .sort();
    if (JSON.stringify(Object.keys(evidence.outcomes).sort()) !== JSON.stringify(expectedOutcomes)) {
      throw new Error(`${repository.full_name}: explicit evidence outcomes do not exactly cover classification memberships.`);
    }
    const reviewMembership = repository.memberships.find((membership) => membership.list_id === reviewQueue?.id);
    if (Boolean(reviewMembership) !== (decision.judgment === 'likely-unstar')) {
      throw new Error(`${repository.full_name}: collection-wide retention decision does not match review-queue membership.`);
    }
    if (reviewMembership && reviewMembership.reason !== decision.reason) {
      throw new Error(`${repository.full_name}: collection-wide retention decision does not exactly preserve the candidate queue reason.`);
    }
    return makeSource(repository, 10_001 + index, evidence, candidate.generated_at);
  });

  const manifest = {
    repositories: candidate.repositories.map((repository, index) => ({
      full_name: repository.full_name,
      repository_id: 10_001 + index,
      url: repository.url,
      description: repository.description,
      readme: {
        status: 'missing',
        api_url: `https://api.github.com/repos/${repository.full_name}/readme`,
        commit_sha: null,
        retrieved_at: candidate.generated_at,
        http_status: 404
      },
      sources: [sources[index].descriptor]
    }))
  };
  const chunks = candidate.repositories.map((repository, index) => ({
    id: `synthetic-source-${index + 1}`,
    repository: repository.full_name,
    source_id: sources[index].descriptor.source_id,
    byte_start: 0,
    byte_end: sources[index].bytes.length,
    sha256: canonicalSha256(sources[index].bytes)
  }));
  const assessments = candidate.repositories.map((repository, index) => {
    const source = sources[index];
    const evidence = DEMO_EVIDENCE[repository.full_name];
    return {
      repository: repository.full_name,
      author_id: `synthetic-demo-assessor-${index + 1}`,
      source_status: 'available',
      source_ids: [source.descriptor.source_id],
      primary_purpose: evidence.primary,
      primary_purpose_evidence: [exactAnchor(source, evidence.primary)],
      browse_intents: Object.entries(evidence.outcomes).map(([listId, text]) => ({
        id: `intent-${listId}`,
        outcome: text,
        evidence: [exactAnchor(source, text)]
      })),
      retention_signals: [{
        id: 'source-retention',
        statement: evidence.retentionSignal,
        evidence: [exactAnchor(source, evidence.retentionSignal)]
      }]
    };
  });
  const retentionDecisions = candidate.repositories.map((repository, repositoryIndex) => {
    const decision = DEMO_RETENTION_DECISIONS[repository.full_name];
    return {
      id: `synthetic-retention-decision-${repositoryIndex + 1}`,
      repository: repository.full_name,
      judgment: decision.judgment,
      reason: decision.reason,
      signal_ids: ['source-retention'],
      comparator_repositories: [...decision.comparatorRepositories]
    };
  });
  const classificationClaims = [];
  const reviewClaims = [];
  candidate.repositories.forEach((repository, repositoryIndex) => {
    repository.memberships.forEach((membership, membershipIndex) => {
      if (classificationIds.has(membership.list_id)) {
        classificationClaims.push({
          claim_id: `synthetic-classification-${repositoryIndex + 1}-${membershipIndex + 1}`,
          repository: repository.full_name,
          intent_id: `intent-${membership.list_id}`,
          list_id: membership.list_id,
          reason: membership.reason
        });
      } else if (membership.list_id === reviewQueue?.id) {
        reviewClaims.push({
          claim_id: `synthetic-retention-${repositoryIndex + 1}`,
          repository: repository.full_name,
          retention_decision_id: retentionDecisions[repositoryIndex].id,
          list_id: membership.list_id,
          reason: membership.reason
        });
      }
    });
  });
  const unclassified = candidate.repositories
    .filter((repository) => repository.unclassified_reason !== undefined)
    .map((repository) => ({ repository: repository.full_name, reason: repository.unclassified_reason }));

  const plan = {
    schema_version: '1.3',
    collection_receipt_sha256: '',
    manifest,
    chunks,
    deliveries: chunks.map((chunk, index) => ({
      ...chunk,
      status: 'delivered',
      execution_id: `synthetic-demo-assessment-${index + 1}-execution`
    })),
    evidence_units: [],
    assessments,
    review_evidence: { items: [] },
    taxonomy: {
      author_id: 'synthetic-demo-taxonomy-author',
      input_manifest_sha256: '',
      input_assessments_sha256: '',
      candidate_sha256: '',
      lists: clone(candidate.lists),
      classification_claims: classificationClaims,
      retention_decisions: retentionDecisions,
      review_claims: reviewClaims,
      unclassified
    },
    candidate: clone(candidate),
    global_review: {
      reviewer_id: 'synthetic-demo-global-reviewer',
      fresh_context_claimed: true,
      reviewed_repositories: [...actualNames],
      repository_set_sha256: '',
      manifest_sha256: '',
      assessments_sha256: '',
      review_evidence_sha256: '',
      taxonomy_candidate_sha256: '',
      stars_analysis_sha256: '',
      dimensions: GLOBAL_REVIEW_DIMENSIONS.map((id) => ({
        id,
        verdict: 'passed',
        rationale: `The explicit fictional evidence and exact candidate projection pass the synthetic ${id} demo check.`,
        evidence_ids: id === 'evidence-integrity'
          ? [`source:${sources[0].descriptor.source_id}`]
          : ['candidate'],
        findings: []
      }))
    }
  };
  plan.evidence_units = candidate.repositories.flatMap((repository, index) => {
    const assessment = assessments[index];
    return partitionEvidenceUnits(repository, sources[index], [
      ...assessment.primary_purpose_evidence,
      ...assessment.browse_intents.flatMap((intent) => intent.evidence),
      ...assessment.retention_signals.flatMap((signal) => signal.evidence)
    ]);
  });
  plan.review_evidence = { items: reviewEvidenceItems(plan, sources) };
  const packetAnchorId = plan.review_evidence.items[0]?.id;
  if (!packetAnchorId) throw new Error('Synthetic review evidence packet must contain exact source anchors.');
  for (const dimension of plan.global_review.dimensions) {
    if (['evidence-integrity', 'semantic-fidelity', 'retention-judgment'].includes(dimension.id)) {
      dimension.evidence_ids.push(`anchor:${packetAnchorId}`);
    }
  }
  const collectionReceipt = {
    schema_version: '1.0',
    collector: {
      execution_id: 'synthetic-demo-collector-execution',
      context_id: 'synthetic-demo-collector-context',
      runner_id: 'synthetic-demo-collector',
      started_at: COLLECTOR_STARTED_AT,
      completed_at: candidate.generated_at,
      exit_status: 'completed'
    },
    collected_at: candidate.generated_at,
    account: clone(candidate.account),
    manifest: clone(manifest),
    manifest_sha256: canonicalSha256(manifest)
  };
  plan.collection_receipt_sha256 = canonicalSha256(collectionReceipt);
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

  return { plan, collectionReceipt, sources };
}

function buildExecutionReceipts(plan, collectionReceipt, baseDirectory) {
  const repositoryNames = plan.manifest.repositories.map((repository) => repository.full_name);
  return {
    schema_version: '1.0',
    semantic_plan_sha256: canonicalSha256(plan),
    collection_receipt_sha256: canonicalSha256(collectionReceipt),
    receipts: [
      ...plan.assessments.map((assessment, index) => executionReceipt(
        plan,
        'assessment',
        assessment.author_id,
        `synthetic-demo-assessment-${index + 1}-execution`,
        `synthetic-demo-assessment-${index + 1}-context`,
        [assessment.repository],
        ASSESSMENT_STARTED_AT,
        ASSESSMENT_COMPLETED_AT,
        baseDirectory
      )),
      executionReceipt(
        plan, 'taxonomy', 'synthetic-demo-taxonomy-author',
        'synthetic-demo-taxonomy-execution', 'synthetic-demo-taxonomy-context',
        repositoryNames, TAXONOMY_STARTED_AT, TAXONOMY_COMPLETED_AT, baseDirectory
      ),
      executionReceipt(
        plan, 'global-review', 'synthetic-demo-global-reviewer',
        'synthetic-demo-review-execution', 'synthetic-demo-review-context',
        repositoryNames, REVIEW_STARTED_AT, REVIEW_COMPLETED_AT, baseDirectory
      )
    ]
  };
}

function writePrivate(path, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, bytes, { mode: 0o600 });
}

export function materializeDemoSemanticRun(outputPath) {
  const output = resolve(outputPath);
  if (existsSync(output)) {
    const entries = readdirSync(output);
    if (entries.length) throw new Error('Demo semantic-run output must not already be a nonempty directory.');
    throw new Error('Demo semantic-run output must not already exist.');
  }
  mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
  const temporary = mkdtempSync(join(dirname(output), '.synthetic-semantic-run-'));
  try {
    const candidate = JSON.parse(readFileSync(ANALYSIS_PATH, 'utf8'));
    const bundle = buildDemoBundle(candidate);
    bundle.sources.forEach((source) => writePrivate(join(temporary, source.descriptor.local_path), source.bytes));
    const executionReceipts = buildExecutionReceipts(bundle.plan, bundle.collectionReceipt, temporary);
    const result = validateSemanticPlan(bundle.plan, {
      baseDirectory: temporary,
      collectionReceipt: bundle.collectionReceipt,
      executionReceipts
    });
    if (!result.valid) throw new Error(`Synthetic semantic bundle is invalid:\n- ${result.errors.join('\n- ')}`);
    writePrivate(join(temporary, 'semantic-plan.json'), bundle.plan);
    writePrivate(join(temporary, 'collection-receipt.json'), bundle.collectionReceipt);
    writePrivate(join(temporary, 'execution-receipts.json'), executionReceipts);
    writePrivate(join(temporary, 'semantic-validation.json'), createSemanticValidationReceipt(bundle.plan, result));
    renameSync(temporary, output);
    return { output, status: 'passed', counts: result.counts, hashes: result.bindings };
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const [outputPath, ...extra] = process.argv.slice(2);
  if (!outputPath || extra.length) {
    process.stderr.write('Usage: node docs/demo/materialize-semantic-run.mjs <output-directory>\n');
    process.exitCode = 1;
  } else {
    try {
      process.stdout.write(`${JSON.stringify(materializeDemoSemanticRun(outputPath), null, 2)}\n`);
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    }
  }
}
