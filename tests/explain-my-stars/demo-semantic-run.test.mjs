import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { materializeDemoSemanticRun } from '../../docs/demo/materialize-semantic-run.mjs';
import {
  loadSemanticHandoff,
  readSemanticSnapshot
} from '../../skills/explain-my-stars/scripts/semantic-handoff.mjs';

const root = resolve(import.meta.dirname, '../..');
const analysisPath = join(root, 'docs/demo/synthetic-analysis.json');
const pagesPath = join(root, '.github/workflows/pages.yml');

function temporaryDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), 'explain-stars-demo-semantic-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function tree(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      return entry.isDirectory() ? tree(join(directory, entry.name), relativePath) : [relativePath];
    })
    .sort();
}

test('public synthetic demo materializes one deterministic exact semantic handoff', (t) => {
  const directory = temporaryDirectory(t);
  const first = join(directory, 'first');
  const second = join(directory, 'second');
  materializeDemoSemanticRun(first);
  materializeDemoSemanticRun(second);

  const expectedFiles = [
    'collection-receipt.json',
    'execution-receipts.json',
    'semantic-plan.json',
    'semantic-validation.json'
  ];
  const firstFiles = tree(first);
  for (const path of expectedFiles) assert.ok(firstFiles.includes(path));
  assert.equal(firstFiles.filter((path) => path.startsWith('sources/')).length, 12);
  assert.deepEqual(firstFiles, tree(second));
  for (const path of firstFiles) {
    assert.deepEqual(readFileSync(join(first, path)), readFileSync(join(second, path)), path);
  }

  const plan = JSON.parse(readFileSync(join(first, 'semantic-plan.json'), 'utf8'));
  assert.equal(plan.schema_version, '1.3');
  assert.equal(plan.taxonomy.retention_decisions.length, 12);
  assert.ok(plan.assessments.every((assessment) => !('retention' in assessment)));
  assert.ok(plan.assessments.every((assessment) => assessment.retention_signals.length === 1));
  assert.ok(plan.evidence_units.length >= plan.review_evidence.items.length);
  assert.ok(plan.review_evidence.items.length > 0);
  assert.ok(plan.review_evidence.items.every((item) => item.content_encoding === 'utf-8'));
  assert.ok(plan.review_evidence.items.every((item) => typeof item.content === 'string' && item.content.length > 0));
  assert.ok(plan.review_evidence.items.every((item) => (
    JSON.stringify(Object.keys(item).sort()) === JSON.stringify(['anchor', 'content', 'content_encoding', 'id'])
  )));
  assert.match(plan.global_review.review_evidence_sha256, /^[a-f0-9]{64}$/u);
  const semanticReceipt = JSON.parse(readFileSync(join(first, 'semantic-validation.json'), 'utf8'));
  assert.equal(semanticReceipt.hashes.review_evidence_sha256, plan.global_review.review_evidence_sha256);

  const snapshot = readSemanticSnapshot(loadSemanticHandoff({
    inputPath: analysisPath,
    semanticRunPath: first
  }));
  assert.deepEqual(snapshot.analysis, JSON.parse(readFileSync(analysisPath, 'utf8')));
  assert.equal(snapshot.counts.repositories, 12);
  assert.equal(snapshot.counts.classification_memberships, 16);
  assert.equal(snapshot.counts.review_queue_memberships, 3);
  assert.equal(snapshot.analysis.run.application_status, 'planned');
});

test('explain handoff fails closed when exact embedded review evidence is tampered', (t) => {
  const directory = temporaryDirectory(t);
  const semanticRun = join(directory, 'semantic-run');
  materializeDemoSemanticRun(semanticRun);
  const planPath = join(semanticRun, 'semantic-plan.json');
  const plan = JSON.parse(readFileSync(planPath, 'utf8'));
  assert.equal(plan.review_evidence.items[0].content_encoding, 'utf-8');
  plan.review_evidence.items[0].content = 'tampered review bytes';
  writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);

  assert.throws(
    () => loadSemanticHandoff({ inputPath: analysisPath, semanticRunPath: semanticRun }),
    /review_evidence|decoded bytes|semantic plan validation/i
  );
});

test('Pages mechanically materializes and passes the semantic run to every report CLI', () => {
  const workflow = readFileSync(pagesPath, 'utf8');
  assert.match(workflow, /materialize-semantic-run\.mjs "\$RUNNER_TEMP\/demo-semantic-run"/);
  for (const script of ['validate-analysis', 'build-site', 'verify-site']) {
    assert.match(
      workflow,
      new RegExp(`${script}\\.mjs[\\s\\S]*?--semantic-run "\\$RUNNER_TEMP/demo-semantic-run"`)
    );
  }
  assert.match(workflow, /\.checks\.semantic_validation\.status/);
  assert.match(workflow, /npm run browser-qa/);
  assert.match(workflow, /--browser-evidence "\$RUNNER_TEMP\/browser-evidence\.json"/);
  assert.match(workflow, /\(\.status == "passed"\)/);
  assert.doesNotMatch(workflow, /passed-with-limitations/);
  for (const runtimeCheck of ['browser', 'visual', 'accessibility']) {
    assert.match(workflow, new RegExp(`\\.checks\\.${runtimeCheck}\\.status`));
  }
  assert.doesNotMatch(workflow, /--application-receipt/);
});

test('browser QA code makes every screenshot private before hashing it', () => {
  const source = readFileSync(join(root, 'skills/explain-my-stars/site/scripts/browser-qa.mjs'), 'utf8');
  assert.match(source, /await page\.screenshot\(\{ path, fullPage: true \}\);\s+if \(process\.platform !== 'win32'\) chmodSync\(path, 0o600\);/);
});
