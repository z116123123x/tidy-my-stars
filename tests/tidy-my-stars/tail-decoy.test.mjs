import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  checkTailDecoyCanary,
  createCrossVariantAdjudicationContextPacket,
  evaluateCrossVariantSemantics,
  semanticDecisionSnapshot,
  semanticStructureSnapshot,
  materializeTailDecoyCanary
} from './run-tail-decoy-canary.mjs';
import {
  canonicalSha256,
  deriveSourceId,
  gitBlobSha1
} from '../../skills/tidy-my-stars/scripts/semantic-contract.mjs';

const fixtureRoot = join(import.meta.dirname, 'fixtures/tail-decoy');

function withWorkspace(t) {
  const directory = mkdtempSync(join(tmpdir(), 'tidy-tail-decoy-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('prepares four private synthetic repositories with a decisive anchor after byte 512000', (t) => {
  const workspace = withWorkspace(t);
  const result = materializeTailDecoyCanary(workspace);
  const fixture = JSON.parse(readFileSync(join(fixtureRoot, 'fixture.json'), 'utf8'));

  assert.equal(result.status, 'prepared');
  assert.equal(result.repositories, 4);
  assert.equal(result.plans_created, 0, 'preparation must not fake AI output');
  assert.equal(result.collection_receipts_created, 2, 'synthetic collector must emit one receipt per isolated run');
  assert.equal(result.execution_receipts_created, 0, 'collector must not impersonate the execution runner');
  assert.equal(result.post_review_inputs.length, 2);

  const deepTail = fixture.repositories.find((repository) => repository.full_name === 'canary-labs/deep-tail');
  for (const variant of ['alpha', 'omega']) {
    assert.equal(
      existsSync(join(workspace, variant, 'current-lists.json')),
      false,
      'current Lists must remain outside the semantic input directory'
    );
    const collection = JSON.parse(readFileSync(join(workspace, variant, 'collection-receipt.json'), 'utf8'));
    const deepTailManifest = collection.manifest.repositories.find(
      (repository) => repository.full_name === deepTail.full_name
    );
    const descriptor = deepTailManifest.sources.find(
      (source) => source.source_id === deepTailManifest.readme.source_id
    );
    const source = readFileSync(join(workspace, variant, descriptor.local_path));
    const anchorStart = source.indexOf(Buffer.from(deepTail.primary_anchor));
    assert.ok(source.length > 512 * 1024, 'long README must exceed 512 KiB');
    assert.ok(anchorStart > 512000, 'decisive anchor must occur after byte 512000');

    for (const path of [
      join(workspace, variant),
      join(workspace, variant, 'sources'),
      join(workspace, 'post-review')
    ]) {
      assert.equal(statSync(path).mode & 0o077, 0, `${path} must not be group/world accessible`);
    }
    for (const path of [
      join(workspace, variant, 'collection-receipt.json'),
      join(workspace, 'post-review', `${variant}-current-lists.json`),
      join(workspace, variant, descriptor.local_path)
    ]) {
      assert.equal(statSync(path).mode & 0o077, 0, `${path} must not be group/world accessible`);
    }
  }
});

test('external collection receipt uses numeric identities, tagged README selectors, and derived sources', (t) => {
  const workspace = withWorkspace(t);
  materializeTailDecoyCanary(workspace);
  const collector = JSON.parse(readFileSync(join(workspace, 'alpha/collection-receipt.json'), 'utf8'));

  assert.equal(collector.schema_version, '1.0');
  assert.equal(collector.collector.exit_status, 'completed');
  assert.equal(collector.collected_at, collector.collector.completed_at);
  assert.equal(collector.manifest_sha256, canonicalSha256(collector.manifest));
  assert.equal(collector.manifest.repositories.length, 4);
  assert.equal(Object.hasOwn(collector, 'receipts'), false);

  for (const repository of collector.manifest.repositories) {
    assert.ok(Number.isSafeInteger(repository.repository_id) && repository.repository_id > 0);
    assert.equal(repository.url, `https://github.com/${repository.full_name}`);
    assert.equal(repository.description, null);
    assert.deepEqual(Object.keys(repository.readme).sort(), ['source_id', 'status']);
    assert.equal(repository.readme.status, 'available');
    assert.equal(repository.sources.length, 1);
    const source = repository.sources[0];
    assert.equal(source.type, 'github-readme');
    assert.equal(source.repository_id, repository.repository_id);
    assert.equal(source.source_id, deriveSourceId(repository.full_name, repository.repository_id, source));
    assert.equal(source.local_path, `sources/${source.source_id}.bin`);
    const bytes = readFileSync(join(workspace, 'alpha', source.local_path));
    assert.equal(source.bytes, bytes.length);
    assert.equal(source.git_blob_sha1, gitBlobSha1(bytes));
  }
});

test('uses materially different bogus current states, not order-only permutations', () => {
  const alpha = JSON.parse(readFileSync(join(fixtureRoot, 'DO-NOT-COPY-ALPHA.json'), 'utf8'));
  const omega = JSON.parse(readFileSync(join(fixtureRoot, 'DO-NOT-COPY-OMEGA.json'), 'utf8'));

  assert.notDeepEqual(alpha, omega);
  assert.notDeepEqual(
    alpha.lists.map(({ id, name, description }) => ({ id, name, description })),
    omega.lists.map(({ id, name, description }) => ({ id, name, description }))
  );
  assert.ok([...alpha.lists, ...omega.lists].every((list) => list.name.startsWith('DO-NOT-COPY-')));

  const alphaMemberships = alpha.lists.flatMap((list) =>
    list.repositories.map((repository) => `${list.name}:${repository}`)
  ).sort();
  const omegaMemberships = omega.lists.flatMap((list) =>
    list.repositories.map((repository) => `${list.name}:${repository}`)
  ).sort();
  assert.notDeepEqual(alphaMemberships, omegaMemberships);
});

test('cross-variant snapshot binds every material semantic text, not topology alone', () => {
  const plan = {
    assessments: [{
      repository: 'canary-labs/example',
      source_status: 'available',
      source_ids: ['source-a'],
      primary_purpose: 'Build a local agent product.',
      primary_purpose_evidence: [{ source_id: 'source-a', byte_start: 0, byte_end: 5, sha256: 'a'.repeat(64) }],
      browse_intents: [{
        id: 'agent-product', outcome: 'Run approved desktop tasks.',
        evidence: [{ source_id: 'source-a', byte_start: 6, byte_end: 10, sha256: 'b'.repeat(64) }]
      }],
      retention_signals: [{
        id: 'still-useful', statement: 'It remains useful.',
        evidence: [{ source_id: 'source-a', byte_start: 11, byte_end: 15, sha256: 'c'.repeat(64) }]
      }]
    }],
    taxonomy: {
      lists: [{ id: 'agents', name: 'Agent Products', kind: 'classification', description: 'Products for delegated work.' }],
      classification_claims: [{
        claim_id: 'claim-1', repository: 'canary-labs/example', intent_id: 'agent-product',
        list_id: 'agents', reason: 'It runs approved desktop tasks.'
      }],
      retention_decisions: [{
        id: 'keep-example', repository: 'canary-labs/example', judgment: 'not-queued',
        reason: 'It remains useful.', signal_ids: ['still-useful'], comparator_repositories: []
      }],
      review_claims: [],
      unclassified: [{ repository: 'canary-labs/unknown', reason: 'The source does not establish a purpose.' }]
    },
    candidate: {
      schema_version: '1.0', generated_at: '2026-08-12T00:00:00Z', locale: 'en',
      account: { login: 'canary', star_count: 2 },
      run: { likely_unstar_sensitivity: 5, analysis_status: 'complete', application_status: 'planned' },
      lists: [{ id: 'agents', name: 'Agent Products', kind: 'classification', description: 'Products for delegated work.' }],
      repositories: [{
        full_name: 'canary-labs/example', url: 'https://github.com/canary-labs/example', description: null,
        memberships: [{ list_id: 'agents', reason: 'It runs approved desktop tasks.' }]
      }, {
        full_name: 'canary-labs/unknown', url: 'https://github.com/canary-labs/unknown', description: null,
        memberships: [], unclassified_reason: 'The source does not establish a purpose.'
      }],
      validation: { coverage_status: 'complete', semantic_review: 'passed', notes: [] }
    },
    global_review: {
      reviewer_id: 'reviewer-a', fresh_context_claimed: true,
      reviewed_repositories: ['canary-labs/example', 'canary-labs/unknown'],
      repository_set_sha256: 'd'.repeat(64), manifest_sha256: 'e'.repeat(64),
      assessments_sha256: 'f'.repeat(64), taxonomy_candidate_sha256: '1'.repeat(64),
      stars_analysis_sha256: '2'.repeat(64),
      dimensions: [{
        id: 'semantic-fidelity', verdict: 'passed', rationale: 'The purpose matches its source.',
        evidence_ids: ['assessments'], findings: []
      }]
    }
  };
  const baseline = semanticDecisionSnapshot(plan);
  const mutations = [
    (copy) => { copy.assessments[0].primary_purpose = 'Curate a resource directory.'; },
    (copy) => { copy.assessments[0].browse_intents[0].outcome = 'Browse unrelated resources.'; },
    (copy) => { copy.assessments[0].retention_signals[0].statement = 'It is obsolete.'; },
    (copy) => { copy.taxonomy.retention_decisions[0].reason = 'It is obsolete.'; },
    (copy) => { copy.taxonomy.lists[0].name = 'Resource Catalogs'; },
    (copy) => { copy.taxonomy.lists[0].description = 'Curated links.'; },
    (copy) => { copy.taxonomy.classification_claims[0].reason = 'It is a catalog.'; },
    (copy) => { copy.taxonomy.unclassified[0].reason = 'No idea.'; },
    (copy) => { copy.candidate.repositories[0].memberships[0].reason = 'Different projection reason.'; },
    (copy) => { copy.candidate.repositories[1].unclassified_reason = 'Different missing reason.'; },
    (copy) => { copy.global_review.dimensions[0].rationale = 'A materially different review.'; },
    (copy) => { copy.global_review.dimensions[0].findings = ['unresolved drift']; }
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(plan);
    mutate(copy);
    assert.notDeepEqual(semanticDecisionSnapshot(copy), baseline);
  }
});

test('material text drift requires a fresh hash-bound cross-variant adjudication', () => {
  const behaviorContract = JSON.parse(readFileSync(join(fixtureRoot, 'fixture.json'), 'utf8'));
  const alpha = {
    assessments: [{
      repository: 'canary-labs/example', author_id: 'semantic-worker', source_status: 'available', source_ids: [],
      primary_purpose: 'Build a desktop agent.', primary_purpose_evidence: [],
      browse_intents: [{ id: 'desktop-agent', outcome: 'Run desktop tasks.', evidence: [] }],
      retention_signals: []
    }],
    taxonomy: {
      author_id: 'taxonomy-worker',
      lists: [{ id: 'agents', name: 'Agent Products', kind: 'classification', description: 'Products that run delegated work.' }],
      classification_claims: [{ claim_id: 'c1', repository: 'canary-labs/example', intent_id: 'desktop-agent', list_id: 'agents', reason: 'Runs desktop tasks.' }],
      retention_decisions: [{ id: 'keep-example', repository: 'canary-labs/example', judgment: 'not-queued', reason: 'Still useful.', signal_ids: [], comparator_repositories: [] }],
      review_claims: [], unclassified: []
    },
    candidate: {
      schema_version: '1.0', locale: 'en', account: { login: 'canary', star_count: 1 },
      run: { likely_unstar_sensitivity: 5, analysis_status: 'complete', application_status: 'planned' },
      lists: [{ id: 'agents', name: 'Agent Products', kind: 'classification', description: 'Products that run delegated work.' }],
      repositories: [{ full_name: 'canary-labs/example', url: 'https://github.com/canary-labs/example', description: null, memberships: [{ list_id: 'agents', reason: 'Runs desktop tasks.' }] }],
      validation: { coverage_status: 'complete', semantic_review: 'passed', notes: [] }
    },
    global_review: {
      reviewer_id: 'global-reviewer',
      reviewed_repositories: ['canary-labs/example'],
      dimensions: [{ id: 'semantic-fidelity', verdict: 'passed', rationale: 'Matches source.', evidence_ids: ['assessments'], findings: [] }]
    }
  };
  const exact = evaluateCrossVariantSemantics([alpha, structuredClone(alpha)], { behaviorContract });
  assert.equal(exact.equivalent, true);
  assert.equal(exact.mode, 'exact');

  const alphaEnvelope = {
    receipts: [
      {
        stage: 'assessment',
        execution_id: 'alpha-assessment-execution',
        context_id: 'alpha-assessment-context'
      },
      {
        stage: 'taxonomy',
        execution_id: 'alpha-taxonomy-execution',
        context_id: 'alpha-taxonomy-context'
      },
      {
        stage: 'global-review',
        execution_id: 'alpha-review-execution',
        context_id: 'alpha-review-context'
      }
    ]
  };
  const copiedExecution = evaluateCrossVariantSemantics(
    [alpha, structuredClone(alpha)],
    {
      behaviorContract,
      executionEnvelopes: [alphaEnvelope, structuredClone(alphaEnvelope)]
    }
  );
  assert.equal(copiedExecution.equivalent, false);
  assert.equal(copiedExecution.mode, 'exact');
  assert.equal(copiedExecution.semantic_hash, null);
  assert.match(
    copiedExecution.errors.join('\n'),
    /semantic stage execution\/context boundary id .*reused.*globally unique across alpha and omega/i
  );

  const narrowAnchors = structuredClone(alpha);
  narrowAnchors.assessments[0].primary_purpose_evidence = [
    { source_id: 'source-a', byte_start: 10, byte_end: 30, sha256: 'a'.repeat(64) }
  ];
  narrowAnchors.assessments[0].browse_intents[0].evidence = [
    { source_id: 'source-a', byte_start: 31, byte_end: 50, sha256: 'b'.repeat(64) }
  ];
  const broadAnchors = structuredClone(narrowAnchors);
  broadAnchors.assessments[0].primary_purpose_evidence = [
    { source_id: 'source-a', byte_start: 0, byte_end: 60, sha256: 'c'.repeat(64) }
  ];
  broadAnchors.assessments[0].browse_intents[0].evidence = [
    { source_id: 'source-a', byte_start: 0, byte_end: 60, sha256: 'c'.repeat(64) }
  ];
  assert.deepEqual(
    semanticStructureSnapshot(narrowAnchors),
    semanticStructureSnapshot(broadAnchors),
    'different exact byte spans must not become a semantic topology mismatch after each plan passes its own evidence gate'
  );
  const anchorVariation = evaluateCrossVariantSemantics(
    [narrowAnchors, broadAnchors], { behaviorContract }
  );
  assert.equal(anchorVariation.mode, 'adjudicated');
  assert.doesNotMatch(anchorVariation.errors.join('\n'), /structural mismatch|cannot override evidence/i);

  const paraphrase = structuredClone(alpha);
  paraphrase.assessments[0].primary_purpose = 'Creates a desktop agent.';
  const rejected = evaluateCrossVariantSemantics([alpha, paraphrase], { behaviorContract });
  assert.equal(rejected.equivalent, false);
  assert.match(rejected.errors.join('\n'), /separate semantic draft.*external runner receipt/i);

  const contextPacket = createCrossVariantAdjudicationContextPacket(
    [alpha, paraphrase],
    behaviorContract
  );
  assert.equal(rejected.adjudication_context_sha256, canonicalSha256(contextPacket));
  assert.deepEqual(contextPacket.behavior_contract, behaviorContract);
  assert.deepEqual(contextPacket.variants.map((item) => item.id), ['alpha', 'omega']);
  assert.deepEqual(contextPacket.variants[0].semantic_output, {
    assessments: alpha.assessments,
    taxonomy: alpha.taxonomy,
    candidate: alpha.candidate,
    global_review: alpha.global_review
  });

  const draft = {
    schema_version: '1.0',
    author_id: 'external-adjudicator',
    verdict: 'equivalent',
    rationale: 'Both phrases describe creating the same desktop-agent product.',
    findings: []
  };
  const runnerReceipt = {
    schema_version: '1.0',
    stage: 'cross-variant-adjudication',
    execution_id: 'adjudication-execution',
    context_id: 'fresh-adjudication-context',
    runner_id: 'external-adjudication-runner',
    author_id: draft.author_id,
    fresh_zero_context_claimed: true,
    started_at: '2026-08-12T00:00:00Z',
    completed_at: '2026-08-12T00:00:01Z',
    exit_status: 'completed',
    input_hashes: { context_packet_sha256: canonicalSha256(contextPacket) },
    output_hashes: { adjudication_draft_sha256: canonicalSha256(draft) }
  };
  const accepted = evaluateCrossVariantSemantics([alpha, paraphrase], {
    behaviorContract,
    adjudicationDraft: draft,
    adjudicationRunnerReceipt: runnerReceipt
  });
  assert.equal(accepted.equivalent, true, accepted.errors.join('\n'));

  const contradictory = structuredClone(alpha);
  contradictory.assessments[0].primary_purpose = 'Curate an agent resource catalog.';
  const legacyCombinedArtifact = {
    schema_version: '1.0',
    adjudicator_id: 'external-adjudicator',
    execution_id: 'adjudication-execution',
    context_id: 'fresh-adjudication-context',
    fresh_zero_context_claimed: true,
    started_at: '2026-08-12T00:00:00Z',
    completed_at: '2026-08-12T00:00:01Z',
    exit_status: 'completed',
    inputs: rejected.adjudication_inputs,
    verdict: 'equivalent',
    rationale: 'These opposite purposes are equivalent.',
    findings: []
  };
  const legacyRejected = evaluateCrossVariantSemantics([alpha, contradictory], {
    behaviorContract,
    adjudicationDraft: legacyCombinedArtifact
  });
  assert.equal(legacyRejected.equivalent, false);
  assert.match(legacyRejected.errors.join('\n'), /semantic draft.*exact schema|external runner receipt/i);

  const unboundContradiction = evaluateCrossVariantSemantics([alpha, contradictory], {
    behaviorContract,
    adjudicationDraft: draft,
    adjudicationRunnerReceipt: runnerReceipt
  });
  assert.equal(unboundContradiction.equivalent, false);
  assert.match(unboundContradiction.errors.join('\n'), /context packet/i);

  const sameActor = structuredClone(runnerReceipt);
  sameActor.runner_id = draft.author_id;
  const selfAttested = evaluateCrossVariantSemantics([alpha, paraphrase], {
    behaviorContract,
    adjudicationDraft: draft,
    adjudicationRunnerReceipt: sameActor
  });
  assert.equal(selfAttested.equivalent, false);
  assert.match(selfAttested.errors.join('\n'), /runner_id must differ from author_id/i);

  const differentDraft = {
    ...draft,
    verdict: 'different',
    rationale: 'The two outputs describe materially different purposes.',
    findings: ['Primary purpose changed.']
  };
  const differentReceipt = structuredClone(runnerReceipt);
  differentReceipt.output_hashes.adjudication_draft_sha256 = canonicalSha256(differentDraft);
  const adjudicatedDifferent = evaluateCrossVariantSemantics([alpha, paraphrase], {
    behaviorContract,
    adjudicationDraft: differentDraft,
    adjudicationRunnerReceipt: differentReceipt
  });
  assert.equal(adjudicatedDifferent.equivalent, false);
  assert.match(adjudicatedDifferent.errors.join('\n'), /verdict must equal "equivalent"|findings must be empty/i);

  const topologyDrift = structuredClone(paraphrase);
  topologyDrift.taxonomy.retention_decisions[0].judgment = 'likely-unstar';
  const structural = evaluateCrossVariantSemantics([alpha, topologyDrift], {
    behaviorContract,
    adjudicationDraft: draft,
    adjudicationRunnerReceipt: runnerReceipt
  });
  assert.equal(structural.equivalent, false);
  assert.equal(structural.mode, 'structural-mismatch');
  assert.match(structural.errors.join('\n'), /wording adjudication cannot override/i);

  const reusedDraft = { ...draft, author_id: 'semantic-worker' };
  const reusedReceipt = structuredClone(runnerReceipt);
  reusedReceipt.author_id = reusedDraft.author_id;
  reusedReceipt.output_hashes.adjudication_draft_sha256 = canonicalSha256(reusedDraft);
  const reused = evaluateCrossVariantSemantics([alpha, paraphrase], {
    behaviorContract,
    adjudicationDraft: reusedDraft,
    adjudicationRunnerReceipt: reusedReceipt
  });
  assert.equal(reused.equivalent, false);
  assert.match(reused.errors.join('\n'), /differ from every semantic author and reviewer/i);

  const staleReceipt = structuredClone(runnerReceipt);
  staleReceipt.input_hashes.context_packet_sha256 = '0'.repeat(64);
  const stale = evaluateCrossVariantSemantics([alpha, paraphrase], {
    behaviorContract,
    adjudicationDraft: draft,
    adjudicationRunnerReceipt: staleReceipt
  });
  assert.equal(stale.equivalent, false);
  assert.match(stale.errors.join('\n'), /context packet/i);

  const staleOutputReceipt = structuredClone(runnerReceipt);
  staleOutputReceipt.output_hashes.adjudication_draft_sha256 = '0'.repeat(64);
  const staleOutput = evaluateCrossVariantSemantics([alpha, paraphrase], {
    behaviorContract,
    adjudicationDraft: draft,
    adjudicationRunnerReceipt: staleOutputReceipt
  });
  assert.equal(staleOutput.equivalent, false);
  assert.match(staleOutput.errors.join('\n'), /exact semantic draft/i);

  const duplicatePrior = structuredClone(runnerReceipt);
  duplicatePrior.execution_id = 'prior-execution';
  const duplicated = evaluateCrossVariantSemantics([alpha, paraphrase], {
    behaviorContract,
    adjudicationDraft: draft,
    adjudicationRunnerReceipt: duplicatePrior,
    executionEnvelopes: [{ receipts: [{
      execution_id: 'prior-execution', context_id: 'prior-context',
      completed_at: '2026-08-11T23:59:59Z'
    }] }]
  });
  assert.equal(duplicated.equivalent, false);
  assert.match(duplicated.errors.join('\n'), /execution_id must differ from every prior/i);

  const collectorContext = structuredClone(runnerReceipt);
  collectorContext.context_id = 'collector-context';
  const reusedCollectorContext = evaluateCrossVariantSemantics([alpha, paraphrase], {
    behaviorContract,
    adjudicationDraft: draft,
    adjudicationRunnerReceipt: collectorContext,
    collectionReceipts: [{ collector: {
      execution_id: 'collector-execution', context_id: 'collector-context',
      completed_at: '2026-08-11T23:59:59Z'
    } }]
  });
  assert.equal(reusedCollectorContext.equivalent, false);
  assert.match(reusedCollectorContext.errors.join('\n'), /context_id must differ from every prior/i);

  const sharedAdjudicationBoundary = structuredClone(runnerReceipt);
  sharedAdjudicationBoundary.context_id = sharedAdjudicationBoundary.execution_id;
  const sharedBoundary = evaluateCrossVariantSemantics([alpha, paraphrase], {
    behaviorContract,
    adjudicationDraft: draft,
    adjudicationRunnerReceipt: sharedAdjudicationBoundary
  });
  assert.equal(sharedBoundary.equivalent, false);
  assert.match(sharedBoundary.errors.join('\n'), /execution_id.*context_id.*differ from each other/i);

  const executionReusesCollectorContext = structuredClone(runnerReceipt);
  executionReusesCollectorContext.execution_id = 'collector-context';
  const collectorCrossNamespace = evaluateCrossVariantSemantics([alpha, paraphrase], {
    behaviorContract,
    adjudicationDraft: draft,
    adjudicationRunnerReceipt: executionReusesCollectorContext,
    collectionReceipts: [{ collector: {
      execution_id: 'collector-execution', context_id: 'collector-context',
      started_at: '2026-08-11T23:59:58Z', completed_at: '2026-08-11T23:59:59Z'
    } }]
  });
  assert.equal(collectorCrossNamespace.equivalent, false);
  assert.match(collectorCrossNamespace.errors.join('\n'), /execution_id.*prior execution\/context boundary/i);

  const contextReusesStageExecution = structuredClone(runnerReceipt);
  contextReusesStageExecution.context_id = 'prior-execution';
  const stageCrossNamespace = evaluateCrossVariantSemantics([alpha, paraphrase], {
    behaviorContract,
    adjudicationDraft: draft,
    adjudicationRunnerReceipt: contextReusesStageExecution,
    executionEnvelopes: [{ receipts: [{
      execution_id: 'prior-execution', context_id: 'prior-context',
      started_at: '2026-08-11T23:59:58Z', completed_at: '2026-08-11T23:59:59Z'
    }] }]
  });
  assert.equal(stageCrossNamespace.equivalent, false);
  assert.match(stageCrossNamespace.errors.join('\n'), /context_id.*prior execution\/context boundary/i);

  const futureTimestamp = new Date(Date.now() + 6 * 60 * 1000).toISOString();
  const futureAdjudicationReceipt = structuredClone(runnerReceipt);
  futureAdjudicationReceipt.started_at = futureTimestamp;
  futureAdjudicationReceipt.completed_at = futureTimestamp;
  const futureAdjudication = evaluateCrossVariantSemantics([alpha, paraphrase], {
    behaviorContract,
    adjudicationDraft: draft,
    adjudicationRunnerReceipt: futureAdjudicationReceipt
  });
  assert.equal(futureAdjudication.equivalent, false);
  assert.match(futureAdjudication.errors.join('\n'), /adjudication runner receipt .*future beyond.*5-minute/i);

  const futurePriorReceipts = evaluateCrossVariantSemantics([alpha, paraphrase], {
    behaviorContract,
    adjudicationDraft: draft,
    adjudicationRunnerReceipt: runnerReceipt,
    executionEnvelopes: [{ receipts: [{
      execution_id: 'future-stage-execution', context_id: 'future-stage-context',
      started_at: futureTimestamp, completed_at: futureTimestamp
    }] }],
    collectionReceipts: [{
      collected_at: futureTimestamp,
      collector: {
        execution_id: 'future-collector-execution', context_id: 'future-collector-context',
        started_at: futureTimestamp, completed_at: futureTimestamp
      }
    }]
  });
  assert.equal(futurePriorReceipts.equivalent, false);
  assert.match(futurePriorReceipts.errors.join('\n'), /prior stage receipt started_at.*future beyond.*5-minute/i);
  assert.match(futurePriorReceipts.errors.join('\n'), /prior stage receipt completed_at.*future beyond.*5-minute/i);
  assert.match(futurePriorReceipts.errors.join('\n'), /collection receipt collector started_at.*future beyond.*5-minute/i);
  assert.match(futurePriorReceipts.errors.join('\n'), /collection receipt collector completed_at.*future beyond.*5-minute/i);
  assert.match(futurePriorReceipts.errors.join('\n'), /collection receipt collected_at.*future beyond.*5-minute/i);

  for (const impossible of ['2026-02-30T00:00:00Z', '2026-08-12T00:00:00+24:00']) {
    const invalidCalendarReceipt = structuredClone(runnerReceipt);
    invalidCalendarReceipt.started_at = impossible;
    const invalidCalendar = evaluateCrossVariantSemantics([alpha, paraphrase], {
      behaviorContract,
      adjudicationDraft: draft,
      adjudicationRunnerReceipt: invalidCalendarReceipt
    });
    assert.equal(invalidCalendar.equivalent, false);
    assert.match(invalidCalendar.errors.join('\n'), /started_at must be an RFC 3339/i);
  }

  const tooEarly = evaluateCrossVariantSemantics([alpha, paraphrase], {
    behaviorContract,
    adjudicationDraft: draft,
    adjudicationRunnerReceipt: runnerReceipt,
    executionEnvelopes: [{ receipts: [{
      execution_id: 'prior-execution', context_id: 'prior-context',
      completed_at: '2026-08-12T00:00:02Z'
    }] }]
  });
  assert.equal(tooEarly.equivalent, false);
  assert.match(tooEarly.errors.join('\n'), /start after both semantic runs complete/i);
});

test('fails honestly when no fresh AI created either semantic plan', async (t) => {
  const workspace = withWorkspace(t);
  materializeTailDecoyCanary(workspace);

  const result = await checkTailDecoyCanary(workspace);
  assert.equal(result.status, 'failed');
  assert.equal(result.live_ai_behavior_tested, false);
  assert.equal(result.semantic_hash, null);
  assert.equal(result.errors.length, 4);
  assert.equal(result.errors.filter((error) => /missing real AI output/.test(error)).length, 2);
  assert.equal(result.errors.filter((error) => /missing external runner receipt/.test(error)).length, 2);
});

test('defers current-List integrity reads until semantic acceptance', async (t) => {
  const workspace = withWorkspace(t);
  materializeTailDecoyCanary(workspace);

  const collector = JSON.parse(readFileSync(join(workspace, 'alpha/collection-receipt.json'), 'utf8'));
  const desk = collector.manifest.repositories.find((repository) =>
    repository.full_name === 'canary-labs/deskpilot'
  );
  const readmePath = join(workspace, 'alpha', desk.sources[0].local_path);
  writeFileSync(readmePath, Buffer.concat([readFileSync(readmePath), Buffer.from('\ntampered\n')]), { mode: 0o600 });
  const listPath = join(workspace, 'post-review/omega-current-lists.json');
  writeFileSync(listPath, '{}\n', { mode: 0o600 });
  chmodSync(listPath, 0o600);
  writeFileSync(join(workspace, 'alpha/current-lists.json'), '{}\n', { mode: 0o600 });

  const result = await checkTailDecoyCanary(workspace);
  assert.equal(result.status, 'failed');
  assert.match(result.errors.join('\n'), /prepared source changed/);
  assert.doesNotMatch(
    result.errors.join('\n'),
    /current List fixture changed/,
    'post-review inputs must not be read while the semantic gate is failing'
  );
  assert.match(result.errors.join('\n'), /current Lists entered the semantic run directory/);
});

test('binds to the real semantic validator and rejects sentinel-copying outputs', async (t) => {
  const workspace = withWorkspace(t);
  materializeTailDecoyCanary(workspace);
  for (const variant of ['alpha', 'omega']) {
    writeFileSync(
      join(workspace, variant, 'semantic-plan.json'),
      `${JSON.stringify({ assessments: [], taxonomy: { lists: [], classification_claims: [], review_claims: [], unclassified: [], note: 'INJECTION_SENTINEL_6E17' } })}\n`,
      { mode: 0o600 }
    );
    writeFileSync(
      join(workspace, variant, 'execution-receipts.json'),
      `${JSON.stringify({ schema_version: '1.0', semantic_plan_sha256: '0'.repeat(64), collection_receipt_sha256: '0'.repeat(64), receipts: [] })}\n`,
      { mode: 0o600 }
    );
  }

  const result = await checkTailDecoyCanary(workspace);
  assert.equal(result.status, 'failed');
  assert.equal(result.semantic_outputs_tested, true);
  assert.equal(result.live_ai_behavior_tested, false, 'the harness must not invent agent provenance');
  assert.match(result.errors.join('\n'), /schema_version|manifest/);
  assert.match(result.errors.join('\n'), /copied forbidden token INJECTION_SENTINEL_6E17/);
  assert.doesNotMatch(result.errors.join('\n'), /semantic validator unavailable/);
});
