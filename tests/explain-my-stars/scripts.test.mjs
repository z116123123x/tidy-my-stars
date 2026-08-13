import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { validateAnalysis } from '../../skills/explain-my-stars/scripts/analysis-contract.mjs';
import { buildSiteFromSnapshot, loadVerifiedRuntimeDependencies } from '../../skills/explain-my-stars/scripts/build-site.mjs';
import { OFFLINE_VALIDATION_LIMITATIONS } from '../../skills/explain-my-stars/scripts/semantic-contract.mjs';
import { loadSemanticHandoff } from '../../skills/explain-my-stars/scripts/semantic-handoff.mjs';
import { materializeSemanticRun } from '../tidy-my-stars/semantic-fixture.mjs';

const root = resolve(import.meta.dirname, '../..');
const scripts = join(root, 'skills/explain-my-stars/scripts');
const fixtureRoot = mkdtempSync(join(tmpdir(), 'explain-stars-semantic-fixture-'));
const fixtureRun = materializeSemanticRun(join(fixtureRoot, 'semantic-run'), { locale: 'zh-TW' });
const fixture = fixtureRun.analysisPath;
const semanticRun = fixtureRun.directory;
process.on('exit', () => rmSync(fixtureRoot, { recursive: true, force: true }));

function withSemanticRun(script, args) {
  if (!['validate-analysis.mjs', 'build-site.mjs', 'verify-site.mjs'].includes(script)
      || args.includes('--semantic-run')) return args;
  return [...args, '--semantic-run', semanticRun];
}

function run(script, args) {
  return spawnSync(process.execPath, [join(scripts, script), ...withSemanticRun(script, args)], {
    cwd: root,
    encoding: 'utf8'
  });
}

function runFrom(scriptDirectory, script, args) {
  return spawnSync(process.execPath, [join(scriptDirectory, script), ...withSemanticRun(script, args)], {
    cwd: root,
    encoding: 'utf8'
  });
}

function runWithoutSemanticRun(script, args) {
  return spawnSync(process.execPath, [join(scripts, script), ...args], { cwd: root, encoding: 'utf8' });
}

function temporaryDirectory(t, prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function assertPrivateTree(directory) {
  assert.equal(statSync(directory).mode & 0o777, 0o700, `${directory} must use mode 0700`);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      assertPrivateTree(path);
    } else {
      assert.equal(statSync(path).mode & 0o777, 0o600, `${path} must use mode 0600`);
    }
  }
}

function buildFixture(t, prefix = 'explain-stars-site-') {
  const directory = temporaryDirectory(t, prefix);
  const site = join(directory, 'stars-site');
  const result = run('build-site.mjs', ['--input', fixture, '--output', site]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return { directory, site, result: JSON.parse(result.stdout) };
}

function isolatedSemanticFixture(t, prefix = 'explain-stars-semantic-run-') {
  const directory = temporaryDirectory(t, prefix);
  return materializeSemanticRun(join(directory, 'semantic-run'), { locale: 'zh-TW' });
}

function runtimeDependencyFixture(t) {
  const directory = temporaryDirectory(t, 'explain-stars-runtime-dependency-');
  const dependencyDirectory = join(directory, 'node_modules', '@example', 'runtime');
  mkdirSync(dependencyDirectory, { recursive: true });
  const rootManifest = {
    name: 'runtime-integrity-fixture',
    version: '1.0.0',
    dependencies: { '@example/runtime': '2.3.4' }
  };
  const dependencyManifest = {
    name: '@example/runtime',
    version: '2.3.4'
  };
  writeFileSync(join(directory, 'package.json'), JSON.stringify(rootManifest));
  writeFileSync(join(directory, 'package-lock.json'), JSON.stringify({
    name: rootManifest.name,
    version: rootManifest.version,
    lockfileVersion: 3,
    packages: {
      '': rootManifest,
      'node_modules/@example/runtime': {
        version: dependencyManifest.version
      }
    }
  }));
  const dependencyManifestPath = join(dependencyDirectory, 'package.json');
  writeFileSync(dependencyManifestPath, JSON.stringify(dependencyManifest));
  return { directory, dependencyManifest, dependencyManifestPath };
}

function completeBrowserEvidence(receipt) {
  return {
    input_sha256: receipt.input.sha256,
    site_sha256: receipt.site.sha256,
    browser: {
      status: 'passed',
      method: 'Inspected the final React build in an isolated browser.',
      evidence: {
        viewports: ['1440x900', '390x844'],
        console_errors: 0,
        external_runtime_requests: 0,
        search: 'passed',
        deep_links: 'passed',
        back_forward: 'passed',
        review_decision: 'passed',
        keyboard_navigation: 'passed'
      },
      limitations: []
    },
    visual: {
      status: 'passed',
      method: 'Inspected desktop, mobile, site-map, and print views.',
      evidence: {
        overflow_or_clipping: 0,
        mobile_navigation: 'passed',
        site_map: 'passed',
        print_static: 'passed'
      },
      limitations: []
    },
    accessibility: {
      status: 'passed',
      method: 'Inspected focus, names, contrast, and user preferences.',
      evidence: {
        focus_order: 'passed',
        accessible_names: 'passed',
        contrast: 'passed',
        forced_colors: 'passed',
        reduced_motion: 'passed'
      },
      limitations: ['No claim of full WCAG conformance.']
    }
  };
}

test('validator accepts one complete semantic analysis and reports exact counts', () => {
  const result = run('validate-analysis.mjs', [fixture]);
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.deepEqual(receipt.counts, {
    repositories: 2,
    classification_lists: 3,
    review_queues: 1,
    classification_memberships: 3,
    review_queue_memberships: 1,
    unclassified: 0
  });
  assert.match(receipt.semantic_validation.plan_sha256, /^[a-f0-9]{64}$/);
  assert.match(receipt.semantic_validation.receipt_sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(receipt.semantic_validation.limitations, [...OFFLINE_VALIDATION_LIMITATIONS]);
});

test('validator rejects unexpected fields at every stars-analysis object boundary', () => {
  const baseline = JSON.parse(readFileSync(fixture, 'utf8'));
  const baselineResult = validateAnalysis(baseline);
  assert.equal(baselineResult.valid, true, baselineResult.errors.join('\n'));

  const cases = [
    ['root current Lists', (analysis) => { analysis.current_lists = []; }, '$: unexpected field "current_lists"'],
    ['account extra', (analysis) => { analysis.account.display_name = 'Untrusted'; }, 'account: unexpected field "display_name"'],
    ['run current memberships', (analysis) => { analysis.run.current_memberships = []; }, 'run: unexpected field "current_memberships"'],
    ['List extra', (analysis) => { analysis.lists[0].color = 'blue'; }, 'lists[0]: unexpected field "color"'],
    ['repository current Lists', (analysis) => { analysis.repositories[0].current_lists = []; }, 'repositories[0]: unexpected field "current_lists"'],
    ['membership extra', (analysis) => { analysis.repositories[0].memberships[0].confidence = 1; }, 'repositories[0].memberships[0]: unexpected field "confidence"'],
    ['validation current memberships', (analysis) => { analysis.validation.current_memberships = []; }, 'validation: unexpected field "current_memberships"']
  ];

  for (const [label, mutate, expectedError] of cases) {
    const analysis = structuredClone(baseline);
    mutate(analysis);
    const result = validateAnalysis(analysis);
    assert.equal(result.valid, false, label);
    assert.ok(result.errors.includes(expectedError), `${label}: ${result.errors.join('\n')}`);
  }
});

test('all public report CLIs require an explicit semantic run', () => {
  assert.match(runWithoutSemanticRun('validate-analysis.mjs', [fixture]).stderr, /--semantic-run/);
  assert.match(runWithoutSemanticRun('build-site.mjs', ['--input', fixture, '--output', 'unused']).stderr, /--semantic-run/);
  assert.match(runWithoutSemanticRun('verify-site.mjs', ['--input', fixture, '--site', 'unused', '--output', 'unused.json']).stderr, /--semantic-run/);
});

test('standalone explain bundle carries the exact semantic validator implementation', () => {
  assert.deepEqual(
    readFileSync(join(scripts, 'semantic-contract.mjs')),
    readFileSync(join(root, 'skills/tidy-my-stars/scripts/semantic-contract.mjs'))
  );
});

test('standalone validator works without a tidy-my-stars sibling installation', (t) => {
  const directory = temporaryDirectory(t, 'explain-stars-standalone-');
  const installedScripts = join(directory, 'explain-my-stars', 'scripts');
  cpSync(scripts, installedScripts, { recursive: true });
  const result = runFrom(installedScripts, 'validate-analysis.mjs', [
    fixture, '--semantic-run', semanticRun
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('handoff rejects a valid but different analysis and a self-declared sidecar', (t) => {
  const semanticFixture = isolatedSemanticFixture(t, 'explain-stars-handoff-tamper-');
  const different = structuredClone(semanticFixture.plan.candidate);
  different.locale = 'en';
  const differentPath = join(semanticFixture.directory, '..', 'different-analysis.json');
  writeFileSync(differentPath, `${JSON.stringify(different, null, 2)}\n`);
  const mismatched = run('validate-analysis.mjs', [
    differentPath, '--semantic-run', semanticFixture.directory
  ]);
  assert.notEqual(mismatched.status, 0);
  assert.match(mismatched.stderr, /not exactly the validated semantic plan candidate/i);

  const receiptPath = join(semanticFixture.directory, 'semantic-validation.json');
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  receipt.status = 'passed';
  receipt.hashes.stars_analysis_sha256 = '0'.repeat(64);
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  const selfDeclared = run('validate-analysis.mjs', [
    semanticFixture.analysisPath, '--semantic-run', semanticFixture.directory
  ]);
  assert.notEqual(selfDeclared.status, 0);
  assert.match(selfDeclared.stderr, /does not exactly match.*derived passing receipt/i);
});

test('validated snapshot is unforgeable and immune to post-validation file mutation', (t) => {
  const semanticFixture = isolatedSemanticFixture(t, 'explain-stars-snapshot-');
  const originalBytes = readFileSync(semanticFixture.analysisPath);
  const snapshot = loadSemanticHandoff({
    inputPath: semanticFixture.analysisPath,
    semanticRunPath: semanticFixture.directory
  });
  assert.throws(
    () => buildSiteFromSnapshot({ snapshot: {}, outputPath: join(semanticFixture.directory, '..', 'forged-site') }),
    /validated semantic handoff snapshot is required/i
  );

  const mutated = structuredClone(semanticFixture.plan.candidate);
  mutated.locale = 'en';
  writeFileSync(semanticFixture.analysisPath, `${JSON.stringify(mutated, null, 2)}\n`);
  writeFileSync(join(semanticFixture.directory, 'semantic-validation.json'), '{}\n');
  const site = join(semanticFixture.directory, '..', 'snapshot-site');
  buildSiteFromSnapshot({ snapshot, outputPath: site });
  assert.deepEqual(readFileSync(join(site, 'data', 'stars-analysis.json')), originalBytes);
});

test('analysis loading rejects invalid UTF-8 instead of hashing replacement text', () => {
  const directory = mkdtempSync(join(tmpdir(), 'explain-stars-invalid-utf8-'));
  const input = join(directory, 'analysis.json');
  const bytes = Buffer.from(readFileSync(fixture));
  const marker = bytes.indexOf(Buffer.from('example-user'));
  assert.notEqual(marker, -1);
  bytes[marker + 3] = 0x80;
  writeFileSync(input, bytes);

  const result = run('validate-analysis.mjs', [input]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /UTF-8|encoding/i);
});

test('validator rejects unpaired Unicode surrogates before routing or storage-key encoding', () => {
  const directory = mkdtempSync(join(tmpdir(), 'explain-stars-invalid-unicode-'));
  const invalid = JSON.parse(readFileSync(fixture, 'utf8'));
  invalid.account.login = '\ud800';
  invalid.lists[0].id = '\udc00';
  invalid.repositories[0].memberships[0].list_id = '\udc00';
  invalid.repositories[0].description = 'broken \ud800 text';
  const input = join(directory, 'invalid-unicode.json');
  writeFileSync(input, JSON.stringify(invalid));

  const result = run('validate-analysis.mjs', [input]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /account\.login/i);
  assert.match(result.stderr, /lists\[0\]\.id/i);
  assert.match(result.stderr, /well-formed Unicode string/i);
});

test('validator rejects duplicate Lists, unknown memberships, and missing reasons', () => {
  const directory = mkdtempSync(join(tmpdir(), 'explain-stars-invalid-'));
  const invalid = JSON.parse(readFileSync(fixture, 'utf8'));
  invalid.lists.push({ ...invalid.lists[0] });
  invalid.repositories[0].memberships[0].list_id = 'missing-list';
  invalid.repositories[0].memberships[0].reason = ' ';
  const input = join(directory, 'invalid.json');
  writeFileSync(input, JSON.stringify(invalid));

  const result = run('validate-analysis.mjs', [input]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /duplicate list id/i);
  assert.match(result.stderr, /exactly match a declared List ID/i);
  assert.match(result.stderr, /reason/i);
});

test('validator rejects repository URLs that are not the exact canonical GitHub identity', () => {
  const directory = mkdtempSync(join(tmpdir(), 'explain-stars-url-'));
  const invalid = JSON.parse(readFileSync(fixture, 'utf8'));
  invalid.repositories[0].url = 'http://example.com/bytedance/deer-flow';
  const input = join(directory, 'invalid-url.json');
  writeFileSync(input, JSON.stringify(invalid));

  const result = run('validate-analysis.mjs', [input]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /canonical HTTPS GitHub URL/i);

  invalid.repositories[0].url = 'https://github.com/BYTEDANCE/DEER-FLOW';
  writeFileSync(input, JSON.stringify(invalid));
  const wrongCase = run('validate-analysis.mjs', [input]);
  assert.notEqual(wrongCase.status, 0);
  assert.match(wrongCase.stderr, /canonical HTTPS GitHub URL/i);

  for (const url of [
    'https://github.com/bytedance/a/../deer-flow',
    'https://github.com:443/bytedance/deer-flow',
    ' https://github.com/bytedance/deer-flow ',
    'https://github.com/bytedance\\deer-flow'
  ]) {
    invalid.repositories[0].url = url;
    writeFileSync(input, JSON.stringify(invalid));
    const noncanonical = run('validate-analysis.mjs', [input]);
    assert.notEqual(noncanonical.status, 0, url);
    assert.match(noncanonical.stderr, /canonical HTTPS GitHub URL/i);
  }

  invalid.repositories[0].full_name = 'bytedance/deer%66low';
  invalid.repositories[0].url = 'https://github.com/bytedance/deer%66low';
  writeFileSync(input, JSON.stringify(invalid));
  const encodedIdentity = run('validate-analysis.mjs', [input]);
  assert.notEqual(encodedIdentity.status, 0);
  assert.match(encodedIdentity.stderr, /canonical HTTPS GitHub URL|owner\/repository/i);
});

test('validator requires membership List IDs to match declared IDs exactly', () => {
  const directory = mkdtempSync(join(tmpdir(), 'explain-stars-list-id-'));
  const invalid = JSON.parse(readFileSync(fixture, 'utf8'));
  invalid.repositories[0].memberships[0].list_id = ' AGENT-WORKFLOWS ';
  const input = join(directory, 'invalid-list-id.json');
  writeFileSync(input, JSON.stringify(invalid));

  const result = run('validate-analysis.mjs', [input]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exact|unknown List/i);
});

test('distinct case-sensitive List IDs are not treated as duplicates', () => {
  const directory = mkdtempSync(join(tmpdir(), 'explain-stars-exact-list-ids-'));
  const analysis = JSON.parse(readFileSync(fixture, 'utf8'));
  analysis.lists.push({
    id: 'AGENT-WORKFLOWS',
    name: 'Uppercase ID Example',
    kind: 'classification',
    description: 'A separate List whose exact identifier differs by case.'
  });
  const input = join(directory, 'analysis.json');
  writeFileSync(input, JSON.stringify(analysis));

  const result = validateAnalysis(analysis);
  assert.equal(result.valid, true, result.errors.join('\n'));
});

test('validator rejects List IDs that React Router cannot preserve as one path segment', () => {
  const directory = mkdtempSync(join(tmpdir(), 'explain-stars-route-list-ids-'));
  for (const [index, invalidId] of ['.', '..', '%2F', 'a/b'].entries()) {
    const analysis = JSON.parse(readFileSync(fixture, 'utf8'));
    const originalId = analysis.lists[0].id;
    analysis.lists[0].id = invalidId;
    for (const repository of analysis.repositories) {
      for (const membership of repository.memberships) {
        if (membership.list_id === originalId) membership.list_id = invalidId;
      }
    }
    const input = join(directory, `invalid-list-route-${index}.json`);
    writeFileSync(input, JSON.stringify(analysis));
    const result = run('validate-analysis.mjs', [input]);
    assert.notEqual(result.status, 0, invalidId);
    assert.match(result.stderr, /route-safe identifier/i);
  }
});

test('validator rejects padded repository identities', () => {
  const directory = mkdtempSync(join(tmpdir(), 'explain-stars-padded-identity-'));
  const invalid = JSON.parse(readFileSync(fixture, 'utf8'));
  invalid.repositories[0].full_name = ' bytedance/deer-flow ';
  const input = join(directory, 'invalid-identity.json');
  writeFileSync(input, JSON.stringify(invalid));

  const result = run('validate-analysis.mjs', [input]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /whitespace|exact|owner\/repository/i);
});

test('validator accepts maximum GitHub identity lengths and rejects longer identities', () => {
  const directory = mkdtempSync(join(tmpdir(), 'explain-stars-identity-length-'));
  const analysis = JSON.parse(readFileSync(fixture, 'utf8'));
  const owner = 'o'.repeat(39);
  const repository = 'r'.repeat(100);
  analysis.repositories[0].full_name = `${owner}/${repository}`;
  analysis.repositories[0].url = `https://github.com/${owner}/${repository}`;
  const input = join(directory, 'analysis.json');
  writeFileSync(input, JSON.stringify(analysis));
  assert.equal(validateAnalysis(analysis).valid, true);

  analysis.repositories[0].full_name = `${owner}x/${repository}`;
  analysis.repositories[0].url = `https://github.com/${owner}x/${repository}`;
  writeFileSync(input, JSON.stringify(analysis));
  assert.equal(validateAnalysis(analysis).valid, false);

  analysis.repositories[0].full_name = `${owner}/${repository}x`;
  analysis.repositories[0].url = `https://github.com/${owner}/${repository}x`;
  writeFileSync(input, JSON.stringify(analysis));
  assert.equal(validateAnalysis(analysis).valid, false);
});

test('builder preserves the exact frozen data and emits the complete localized React site contract', (t) => {
  const { site, result } = buildFixture(t);
  const inputBytes = readFileSync(fixture);
  const generatedBytes = readFileSync(join(site, 'data', 'stars-analysis.json'));
  assert.deepEqual(generatedBytes, inputBytes);
  assert.equal(result.input_sha256, createHash('sha256').update(inputBytes).digest('hex'));
  assert.deepEqual(result.counts, {
    repositories: 2,
    classification_lists: 3,
    review_queues: 1,
    classification_memberships: 3,
    review_queue_memberships: 1,
    unclassified: 0
  });

  const buildInfo = JSON.parse(readFileSync(join(site, 'build-info.json'), 'utf8'));
  const provenance = JSON.parse(readFileSync(join(site, 'data', 'report-provenance.json'), 'utf8'));
  assert.equal(existsSync(join(site, 'data', 'application-state.json')), false);
  assert.equal(provenance.schema_version, '1.0');
  assert.equal(provenance.source.account_login, fixtureRun.plan.candidate.account.login);
  assert.equal(provenance.source.generated_at, fixtureRun.plan.candidate.generated_at);
  assert.equal(provenance.source.stars_analysis_bytes_sha256, result.input_sha256);
  assert.equal(provenance.semantic.validation_status, 'passed');
  assert.deepEqual(provenance.semantic.limitations, [...OFFLINE_VALIDATION_LIMITATIONS]);
  assert.equal(provenance.application.status, 'planned');
  assert.equal(provenance.application.claim_basis, 'no-application-receipt');
  assert.deepEqual(provenance.application.limitations, []);
  assert.equal(
    buildInfo.input.report_provenance_sha256,
    createHash('sha256').update(readFileSync(join(site, 'data', 'report-provenance.json'))).digest('hex')
  );
  assert.equal(buildInfo.input.sha256, result.input_sha256);
  assert.equal(buildInfo.input.repositories, 2);
  assert.equal(buildInfo.input.lists, 4);
  assert.equal(buildInfo.input.memberships, 4);
  assert.equal(buildInfo.input.review_queue_memberships, 1);
  for (const field of [
    'semantic_candidate_sha256', 'semantic_plan_sha256',
    'semantic_collection_receipt_sha256', 'semantic_execution_receipts_sha256',
    'semantic_validation_receipt_sha256'
  ]) assert.match(buildInfo.input[field], /^[a-f0-9]{64}$/);
  assert.equal(buildInfo.app.generator, 'explain-my-stars');
  assert.equal(buildInfo.app.implementation_id, 'bundled-react-v1');
  assert.equal(buildInfo.app.framework, 'React');
  assert.equal(buildInfo.app.ui_locale, 'zh-TW');
  assert.deepEqual(buildInfo.app.routes, [
    '#/', '#/search', '#/repositories', '#/repositories/:owner/:name',
    '#/lists', '#/lists/:listId', '#/review', '#/review/:owner/:name',
    '#/sitemap', '#/methods', '#/print'
  ]);

  const index = readFileSync(join(site, 'index.html'), 'utf8');
  assert.match(index, /<html lang="zh-TW">/i);
  assert.match(index, /<meta[^>]+http-equiv="Content-Security-Policy"/i);
  assert.match(index, /GitHub Stars 資料庫/);

  assert.equal(existsSync(join(site, 'third-party-runtime.json')), false);
  assert.equal(existsSync(join(site, 'THIRD_PARTY_LICENSES.txt')), false);
  assert.equal(existsSync(join(site, 'THIRD_PARTY_NOTICES.md')), false);
  assert.equal('runtime_dependencies' in buildInfo.app, false);
});

test('builder and verifier execute through a symlinked skill directory', (t) => {
  const directory = temporaryDirectory(t, 'explain-stars-symlinked-skill-');
  const skillAlias = join(directory, 'explain-my-stars');
  const skillDirectory = join(root, 'skills/explain-my-stars');
  symlinkSync(skillDirectory, skillAlias, process.platform === 'win32' ? 'junction' : 'dir');

  const aliasedScripts = join(skillAlias, 'scripts');
  const site = join(directory, 'stars-site');
  const buildResult = runFrom(aliasedScripts, 'build-site.mjs', [
    '--input', fixture,
    '--output', site
  ]);
  assert.equal(buildResult.status, 0, buildResult.stderr || buildResult.stdout);
  assert.equal(JSON.parse(buildResult.stdout).output, site);
  assert.ok(existsSync(join(site, 'build-info.json')));

  const receiptPath = join(directory, 'site-verification.json');
  const verifyResult = runFrom(aliasedScripts, 'verify-site.mjs', [
    '--input', fixture,
    '--site', site,
    '--output', receiptPath
  ]);
  assert.equal(verifyResult.status, 0, verifyResult.stderr || verifyResult.stdout);
  assert.equal(JSON.parse(verifyResult.stdout).status, 'passed-with-limitations');
  assert.equal(JSON.parse(readFileSync(receiptPath, 'utf8')).status, 'passed-with-limitations');
});

test('generated site and verification receipt use private POSIX permissions', {
  skip: process.platform === 'win32'
}, (t) => {
  const { directory, site } = buildFixture(t, 'explain-stars-private-output-');
  assertPrivateTree(site);

  const receiptPath = join(directory, 'site-verification.json');
  const result = run('verify-site.mjs', [
    '--input', fixture,
    '--site', site,
    '--output', receiptPath
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assertPrivateTree(site);
  assert.equal(statSync(receiptPath).mode & 0o777, 0o600);
});

test('runtime dependency verification checks installed identity and version without requiring license metadata', (t) => {
  const { directory, dependencyManifest, dependencyManifestPath } = runtimeDependencyFixture(t);
  const verified = loadVerifiedRuntimeDependencies(directory);
  assert.deepEqual(verified.map(({ name, version, lock_path: lockPath }) => ({ name, version, lockPath })), [{
    name: '@example/runtime',
    version: '2.3.4',
    lockPath: 'node_modules/@example/runtime'
  }]);

  writeFileSync(dependencyManifestPath, JSON.stringify({ ...dependencyManifest, name: '@example/impostor' }));
  assert.throws(
    () => loadVerifiedRuntimeDependencies(directory),
    /identity does not match package-lock\.json/i
  );

  writeFileSync(dependencyManifestPath, JSON.stringify({ ...dependencyManifest, version: '9.9.9' }));
  assert.throws(
    () => loadVerifiedRuntimeDependencies(directory),
    /version does not match package-lock\.json/i
  );
});

test('runtime dependency verification rejects drift between package.json and the lock root', (t) => {
  const { directory } = runtimeDependencyFixture(t);
  const manifestPath = join(directory, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.dependencies['@example/runtime'] = '2.3.5';
  writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(
    () => loadVerifiedRuntimeDependencies(directory),
    /production dependencies.*do not exactly match package-lock\.json/i
  );
});

test('verification rejects an unexpected file added to the generated site', (t) => {
  const { directory, site } = buildFixture(t, 'explain-stars-site-tamper-');
  writeFileSync(join(site, 'unexpected.txt'), 'tampered\n');

  const output = join(directory, 'site-verification.json');
  const result = run('verify-site.mjs', ['--input', fixture, '--site', site, '--output', output]);
  assert.notEqual(result.status, 0);
  const receipt = JSON.parse(readFileSync(output, 'utf8'));
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.checks.react_projection.status, 'failed');
  assert.match(receipt.checks.app_structure.evidence.failures.join('\n'), /fresh build|generated site differs/i);
});

test('verification rejects provenance that hides a semantic limitation', (t) => {
  const { directory, site } = buildFixture(t, 'explain-stars-provenance-tamper-');
  const provenancePath = join(site, 'data', 'report-provenance.json');
  const provenance = JSON.parse(readFileSync(provenancePath, 'utf8'));
  provenance.semantic.limitations.pop();
  writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);

  const output = join(directory, 'site-verification.json');
  const result = run('verify-site.mjs', ['--input', fixture, '--site', site, '--output', output]);
  assert.notEqual(result.status, 0);
  const receipt = JSON.parse(readFileSync(output, 'utf8'));
  assert.equal(receipt.checks.provenance_identity.status, 'failed');
  assert.match(receipt.checks.app_structure.evidence.failures.join('\n'), /report provenance differs/i);
});

test('verification passes deterministic site checks with explicit browser limitations', (t) => {
  const { directory, site } = buildFixture(t, 'explain-stars-verify-site-');
  const output = join(directory, 'site-verification.json');
  const verified = run('verify-site.mjs', [
    '--input', fixture,
    '--site', site,
    '--output', output
  ]);
  assert.equal(verified.status, 0, verified.stderr || verified.stdout);

  const receipt = JSON.parse(readFileSync(output, 'utf8'));
  assert.equal(receipt.status, 'passed-with-limitations');
  assert.deepEqual(receipt.implementation, {
    id: 'bundled-react-v1',
    framework: 'React',
    builder: 'build-site.mjs'
  });
  assert.equal(receipt.checks.schema.status, 'passed');
  assert.equal(receipt.checks.semantic_validation.status, 'passed');
  assert.deepEqual(receipt.checks.semantic_validation.limitations, [...OFFLINE_VALIDATION_LIMITATIONS]);
  for (const limitation of OFFLINE_VALIDATION_LIMITATIONS) assert.ok(receipt.limitations.includes(limitation));
  assert.equal(receipt.checks.data_identity.status, 'passed');
  assert.equal(receipt.checks.app_structure.status, 'passed');
  assert.equal(receipt.checks.browser.status, 'not-run');
  assert.equal(receipt.checks.visual.status, 'not-run');
  assert.equal(receipt.checks.accessibility.status, 'not-run');
  assert.match(receipt.limitations.join(' '), /browser QA/i);
});

test('builder refuses an unmarked nonempty output directory without disturbing its contents', (t) => {
  const directory = temporaryDirectory(t, 'explain-stars-output-guard-');
  const site = join(directory, 'stars-site');
  const sentinel = join(site, 'keep-me.txt');
  mkdirSync(site);
  writeFileSync(sentinel, 'user-owned sentinel\n');

  const result = run('build-site.mjs', ['--input', fixture, '--output', site]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /refusing to replace a nonempty directory|not generated/i);
  assert.equal(readFileSync(sentinel, 'utf8'), 'user-owned sentinel\n');
  assert.deepEqual(readFileSync(join(site, 'keep-me.txt')), Buffer.from('user-owned sentinel\n'));
});

test('builder rejects forged legacy markers and symlinked inputs inside the output', (t) => {
  const forgedRoot = temporaryDirectory(t, 'explain-stars-forged-output-');
  const forgedSite = join(forgedRoot, 'stars-site');
  mkdirSync(forgedSite);
  writeFileSync(join(forgedSite, 'build-info.json'), JSON.stringify({ app: { framework: 'React', routes: ['#/sitemap'] } }));
  writeFileSync(join(forgedSite, 'sentinel.txt'), 'foreign directory\n');
  const forgedResult = run('build-site.mjs', ['--input', fixture, '--output', forgedSite]);
  assert.notEqual(forgedResult.status, 0);
  assert.match(forgedResult.stderr, /not generated by explain-my-stars/i);
  assert.equal(readFileSync(join(forgedSite, 'sentinel.txt'), 'utf8'), 'foreign directory\n');

  const { site: otherImplementationSite } = buildFixture(t, 'explain-stars-other-implementation-');
  const otherBuildInfoPath = join(otherImplementationSite, 'build-info.json');
  const otherBuildInfo = JSON.parse(readFileSync(otherBuildInfoPath, 'utf8'));
  otherBuildInfo.app.implementation_id = 'another-react-system';
  writeFileSync(otherBuildInfoPath, JSON.stringify(otherBuildInfo));
  const otherSentinel = join(otherImplementationSite, 'other-implementation.txt');
  writeFileSync(otherSentinel, 'must survive\n');
  const otherResult = run('build-site.mjs', ['--input', fixture, '--output', otherImplementationSite]);
  assert.notEqual(otherResult.status, 0);
  assert.match(otherResult.stderr, /not generated by explain-my-stars/i);
  assert.equal(readFileSync(otherSentinel, 'utf8'), 'must survive\n');

  const { directory, site } = buildFixture(t, 'explain-stars-symlink-input-');
  const generatedInput = join(site, 'data', 'stars-analysis.json');
  const originalBytes = readFileSync(generatedInput);
  const inputAlias = join(directory, 'input-alias.json');
  symlinkSync(generatedInput, inputAlias);
  const aliasResult = run('build-site.mjs', ['--input', inputAlias, '--output', site]);
  assert.notEqual(aliasResult.status, 0);
  assert.match(aliasResult.stderr, /regular, non-symbolic-link file|cannot contain the semantic input/i);
  assert.deepEqual(readFileSync(generatedInput), originalBytes);
});

test('verification fails when an asset named by the Vite manifest is missing', (t) => {
  const { directory, site } = buildFixture(t, 'explain-stars-missing-asset-');
  const manifest = JSON.parse(readFileSync(join(site, '.vite', 'manifest.json'), 'utf8'));
  const asset = Object.values(manifest).flatMap((entry) => [entry.file, ...(entry.css ?? []), ...(entry.assets ?? [])]).find(Boolean);
  assert.ok(asset, 'fixture build must contain at least one manifest asset');
  unlinkSync(join(site, asset));

  const output = join(directory, 'site-verification.json');
  const result = run('verify-site.mjs', [
    '--input', fixture,
    '--site', site,
    '--output', output
  ]);
  assert.notEqual(result.status, 0);
  const receipt = JSON.parse(readFileSync(output, 'utf8'));
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.checks.app_structure.status, 'failed');
  assert.match(receipt.checks.app_structure.evidence.failures.join('\n'), /missing (?:manifest|generated) asset/i);
});

test('verification rejects a relaxed or incomplete Content Security Policy', (t) => {
  const { directory, site } = buildFixture(t, 'explain-stars-csp-');
  const indexPath = join(site, 'index.html');
  const index = readFileSync(indexPath, 'utf8').replace("script-src 'self'", "script-src 'self' 'unsafe-inline'");
  writeFileSync(indexPath, index);
  const output = join(directory, 'site-verification.json');
  const result = run('verify-site.mjs', ['--input', fixture, '--site', site, '--output', output]);
  assert.notEqual(result.status, 0);
  const receipt = JSON.parse(readFileSync(output, 'utf8'));
  assert.equal(receipt.status, 'failed');
  assert.match(receipt.checks.app_structure.evidence.failures.join('\n'), /Content Security Policy script-src must be exactly/i);
});

test('verification accepts hash-bound browser evidence and rejects stale input or site evidence', (t) => {
  const { directory, site } = buildFixture(t, 'explain-stars-browser-evidence-');
  const baselinePath = join(directory, 'baseline-verification.json');
  const baseline = run('verify-site.mjs', [
    '--input', fixture,
    '--site', site,
    '--output', baselinePath
  ]);
  assert.equal(baseline.status, 0, baseline.stderr || baseline.stdout);
  const receipt = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const evidencePath = join(directory, 'browser-evidence.json');
  const verifiedPath = join(directory, 'verified-with-browser.json');
  const evidence = completeBrowserEvidence(receipt);
  writeFileSync(evidencePath, JSON.stringify(evidence));

  const accepted = run('verify-site.mjs', [
    '--input', fixture,
    '--site', site,
    '--output', verifiedPath,
    '--browser-evidence', evidencePath
  ]);
  assert.equal(accepted.status, 0, accepted.stderr || accepted.stdout);
  assert.equal(JSON.parse(readFileSync(verifiedPath, 'utf8')).status, 'passed');

  const staleSite = structuredClone(evidence);
  staleSite.site_sha256 = '0'.repeat(64);
  writeFileSync(evidencePath, JSON.stringify(staleSite));
  const staleSiteResult = run('verify-site.mjs', [
    '--input', fixture,
    '--site', site,
    '--output', verifiedPath,
    '--browser-evidence', evidencePath
  ]);
  assert.notEqual(staleSiteResult.status, 0);
  assert.match(staleSiteResult.stderr, /site_sha256 does not match/i);
  assert.equal(existsSync(verifiedPath), false, 'a failed rerun must invalidate the older passing receipt');

  const mismatchedInput = structuredClone(evidence);
  mismatchedInput.input_sha256 = 'f'.repeat(64);
  writeFileSync(evidencePath, JSON.stringify(mismatchedInput));
  const mismatchedInputResult = run('verify-site.mjs', [
    '--input', fixture,
    '--site', site,
    '--output', verifiedPath,
    '--browser-evidence', evidencePath
  ]);
  assert.notEqual(mismatchedInputResult.status, 0);
  assert.match(mismatchedInputResult.stderr, /input_sha256 does not match/i);

  const invalidShapes = [
    (value) => { delete value.browser.method; },
    (value) => { value.browser.method = ' '; },
    (value) => { delete value.visual.limitations; },
    (value) => { value.accessibility.limitations = 'none'; },
    (value) => { value.browser.evidence = []; },
    (value) => { value.browser.status = 'unknown'; }
  ];
  invalidShapes.forEach((mutate, index) => {
    const malformed = structuredClone(evidence);
    mutate(malformed);
    writeFileSync(evidencePath, JSON.stringify(malformed));
    const malformedOutput = join(directory, `malformed-${index}.json`);
    const malformedResult = run('verify-site.mjs', [
      '--input', fixture,
      '--site', site,
      '--output', malformedOutput,
      '--browser-evidence', evidencePath
    ]);
    assert.notEqual(malformedResult.status, 0, `invalid browser evidence shape ${index}`);
    assert.match(malformedResult.stderr, /Browser evidence validation failed/i);
    assert.equal(existsSync(malformedOutput), false);
  });

  writeFileSync(evidencePath, 'null');
  const nullOutput = join(directory, 'null-evidence.json');
  const nullResult = run('verify-site.mjs', [
    '--input', fixture, '--site', site, '--output', nullOutput, '--browser-evidence', evidencePath
  ]);
  assert.notEqual(nullResult.status, 0);
  assert.match(nullResult.stderr, /evidence document must be an object/i);
  assert.equal(existsSync(nullOutput), false);
});

test('verification records honest runtime failures and unavailable capabilities', (t) => {
  const { directory, site } = buildFixture(t, 'explain-stars-runtime-status-');
  const baselinePath = join(directory, 'baseline.json');
  const baselineResult = run('verify-site.mjs', [
    '--input', fixture, '--site', site, '--output', baselinePath
  ]);
  assert.equal(baselineResult.status, 0, baselineResult.stderr || baselineResult.stdout);
  const evidence = completeBrowserEvidence(JSON.parse(readFileSync(baselinePath, 'utf8')));
  evidence.browser = {
    status: 'failed',
    method: 'Observed the final site in a browser.',
    evidence: { defect: 'Search navigation did not reach the selected repository.' },
    limitations: []
  };
  evidence.visual = {
    status: 'not-run',
    method: 'Visual capture was unavailable in this environment.',
    evidence: {},
    limitations: ['No screenshot capability was available.']
  };
  const evidencePath = join(directory, 'mixed-evidence.json');
  const output = join(directory, 'mixed-receipt.json');
  writeFileSync(evidencePath, JSON.stringify(evidence));

  const result = run('verify-site.mjs', [
    '--input', fixture, '--site', site, '--output', output, '--browser-evidence', evidencePath
  ]);
  assert.notEqual(result.status, 0, 'an observed runtime defect must fail the release');
  const receipt = JSON.parse(readFileSync(output, 'utf8'));
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.checks.browser.status, 'failed');
  assert.equal(receipt.checks.visual.status, 'not-run');
  assert.equal(receipt.checks.accessibility.status, 'passed');

  const invalidFailed = structuredClone(evidence);
  invalidFailed.browser.evidence = {};
  writeFileSync(evidencePath, JSON.stringify(invalidFailed));
  const invalidFailedOutput = join(directory, 'invalid-failed.json');
  const invalidFailedResult = run('verify-site.mjs', [
    '--input', fixture, '--site', site, '--output', invalidFailedOutput, '--browser-evidence', evidencePath
  ]);
  assert.notEqual(invalidFailedResult.status, 0);
  assert.match(invalidFailedResult.stderr, /failed status must include defect evidence/i);

  const invalidNotRun = structuredClone(evidence);
  invalidNotRun.visual.limitations = [];
  writeFileSync(evidencePath, JSON.stringify(invalidNotRun));
  const invalidNotRunOutput = join(directory, 'invalid-not-run.json');
  const invalidNotRunResult = run('verify-site.mjs', [
    '--input', fixture, '--site', site, '--output', invalidNotRunOutput, '--browser-evidence', evidencePath
  ]);
  assert.notEqual(invalidNotRunResult.status, 0);
  assert.match(invalidNotRunResult.stderr, /not-run status must explain/i);
});

test('verification preserves foreign outputs and rejects receipt path aliases', (t) => {
  const { directory, site } = buildFixture(t, 'explain-stars-safe-receipt-');
  const foreignOutput = join(directory, 'foreign.txt');
  writeFileSync(foreignOutput, 'user-owned output\n');
  const foreignResult = run('verify-site.mjs', ['--input', fixture, '--site', site, '--output', foreignOutput]);
  assert.notEqual(foreignResult.status, 0);
  assert.match(foreignResult.stderr, /non-receipt/i);
  assert.equal(readFileSync(foreignOutput, 'utf8'), 'user-owned output\n');

  const baselinePath = join(directory, 'baseline.json');
  assert.equal(run('verify-site.mjs', ['--input', fixture, '--site', site, '--output', baselinePath]).status, 0);
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const evidencePath = join(directory, 'browser-evidence.json');
  writeFileSync(evidencePath, JSON.stringify(completeBrowserEvidence(baseline)));
  const evidenceBytes = readFileSync(evidencePath);
  const collision = run('verify-site.mjs', [
    '--input', fixture, '--site', site, '--output', evidencePath, '--browser-evidence', evidencePath
  ]);
  assert.notEqual(collision.status, 0);
  assert.match(collision.stderr, /cannot overwrite browser evidence/i);
  assert.deepEqual(readFileSync(evidencePath), evidenceBytes);

  const receiptLink = join(directory, 'receipt-link.json');
  symlinkSync(fixture, receiptLink);
  const inputBytes = readFileSync(fixture);
  const linkedOutput = run('verify-site.mjs', ['--input', fixture, '--site', site, '--output', receiptLink]);
  assert.notEqual(linkedOutput.status, 0);
  assert.match(linkedOutput.stderr, /symbolic link/i);
  assert.deepEqual(readFileSync(fixture), inputBytes);

  const siteAlias = join(directory, 'site-alias');
  symlinkSync(site, siteAlias);
  const aliasedInsideSite = run('verify-site.mjs', [
    '--input', fixture, '--site', site, '--output', join(siteAlias, 'receipt.json')
  ]);
  assert.notEqual(aliasedInsideSite.status, 0);
  assert.match(aliasedInsideSite.stderr, /generated site/i);
  assert.equal(existsSync(join(site, 'receipt.json')), false);
});
