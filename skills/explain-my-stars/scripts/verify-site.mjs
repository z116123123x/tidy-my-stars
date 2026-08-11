#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { loadAndValidateAnalysis } from './analysis-contract.mjs';
import { buildSite } from './build-site.mjs';

function usage() {
  return 'Usage: node verify-site.mjs --input <stars-analysis.json> --site <stars-site-directory> --output <site-verification.json> [--browser-evidence <browser-evidence.json>]';
}

function parseArguments(arguments_) {
  const values = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (!['--input', '--site', '--output', '--browser-evidence'].includes(key) || !value) throw new Error(usage());
    values[key.slice(2)] = value;
  }
  if (!values.input || !values.site || !values.output) throw new Error(usage());
  return values;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isInside(parent, candidate) {
  const path = relative(parent, candidate);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function canonicalizePath(path) {
  let existing = resolve(path);
  const suffix = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break;
    suffix.unshift(basename(existing));
    existing = parent;
  }
  return suffix.reduce((base, segment) => join(base, segment), realpathSync(existing));
}

function assertSafeReceiptPaths({ input, site, output, evidence }) {
  const outputEntry = lstatSync(output, { throwIfNoEntry: false });
  if (outputEntry?.isSymbolicLink()) throw new Error('Verification output cannot be a symbolic link.');
  if (outputEntry?.isDirectory()) throw new Error('Verification output cannot be a directory.');
  const canonicalOutput = canonicalizePath(output);
  const canonicalInput = canonicalizePath(input);
  const canonicalSite = canonicalizePath(site);
  if (canonicalOutput === canonicalInput) throw new Error('Verification output cannot overwrite the input.');
  if (isInside(canonicalSite, canonicalOutput) || isInside(canonicalOutput, canonicalSite)) {
    throw new Error('Verification output cannot overwrite or contain the generated site.');
  }
  if (evidence && canonicalOutput === canonicalizePath(evidence)) {
    throw new Error('Verification output cannot overwrite browser evidence.');
  }
}

function invalidatePreviousReceipt(output) {
  if (!existsSync(output)) return;
  let previous;
  try {
    previous = JSON.parse(readFileSync(output, 'utf8'));
  } catch {
    throw new Error('Refusing to overwrite a non-receipt verification output.');
  }
  if (previous?.schema_version !== '2.0' || typeof previous?.status !== 'string' || !previous?.site?.sha256) {
    throw new Error('Refusing to overwrite a non-receipt verification output.');
  }
  rmSync(output);
}

function writeReceiptAtomically(output, receipt) {
  const temporaryDirectory = mkdtempSync(join(dirname(output), '.site-verification-'));
  const temporaryPath = join(temporaryDirectory, basename(output));
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporaryPath, output);
    if (process.platform !== 'win32') chmodSync(output, 0o600);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function collectFiles(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolutePath = join(directory, entry.name);
      return entry.isDirectory() ? collectFiles(absolutePath, relativePath) : [relativePath];
    })
    .sort();
}

function siteInventory(siteDirectory) {
  const files = collectFiles(siteDirectory);
  const entries = files.map((path) => {
    const bytes = readFileSync(join(siteDirectory, path));
    return { path, bytes: bytes.length, sha256: sha256(bytes) };
  });
  return { files: entries, sha256: sha256(entries.map((entry) => `${entry.path}\0${entry.sha256}`).join('\n')) };
}

function inspectContentSecurityPolicy(index) {
  const meta = index.match(/<meta\b[^>]*http-equiv="Content-Security-Policy"[^>]*>/i)?.[0];
  const content = meta?.match(/\bcontent="([^"]*)"/i)?.[1];
  if (!content) return ['index.html has no Content Security Policy'];
  const directives = new Map(content.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const [name, ...values] = part.split(/\s+/);
    return [name.toLowerCase(), values];
  }));
  const required = new Map([
    ['default-src', ["'self'"]],
    ['script-src', ["'self'"]],
    ['style-src', ["'self'"]],
    ['img-src', ["'self'", 'data:']],
    ['connect-src', ["'self'"]],
    ['font-src', ["'self'"]],
    ['object-src', ["'none'"]],
    ['frame-src', ["'none'"]],
    ['worker-src', ["'none'"]],
    ['media-src', ["'none'"]],
    ['manifest-src', ["'none'"]],
    ['base-uri', ["'none'"]],
    ['form-action', ["'none'"]]
  ]);
  const failures = [];
  for (const [name, expected] of required) {
    const actual = directives.get(name);
    if (!actual || actual.length !== expected.length || expected.some((value) => !actual.includes(value))) {
      failures.push(`Content Security Policy ${name} must be exactly: ${expected.join(' ')}`);
    }
  }
  return failures;
}

function checkBrowserEvidence(evidence, inputSha256, siteSha256) {
  if (evidence === undefined) {
    return Object.fromEntries(['browser', 'visual', 'accessibility'].map((name) => [name, {
      status: 'not-run', method: 'No final rendered browser evidence was supplied.', evidence: {}, limitations: ['Rendered QA is pending.']
    }]));
  }
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new Error('Browser evidence validation failed:\n- evidence document must be an object');
  }
  const errors = [];
  if (evidence.input_sha256 !== inputSha256) errors.push('browser evidence input_sha256 does not match');
  if (evidence.site_sha256 !== siteSha256) errors.push('browser evidence site_sha256 does not match');
  const allowedStatuses = new Set(['passed', 'failed', 'not-run']);
  for (const name of ['browser', 'visual', 'accessibility']) {
    const check = evidence[name];
    if (!check || typeof check !== 'object' || Array.isArray(check)) {
      errors.push(`${name} check must be an object`);
      continue;
    }
    if (!allowedStatuses.has(check.status)) errors.push(`${name} status must be passed, failed, or not-run`);
    if (typeof check.method !== 'string' || !check.method.trim()) errors.push(`${name} method must be a nonblank string`);
    if (!check.evidence || typeof check.evidence !== 'object' || Array.isArray(check.evidence)) errors.push(`${name} evidence must be an object`);
    if (!Array.isArray(check.limitations) || check.limitations.some((item) => typeof item !== 'string' || !item.trim())) {
      errors.push(`${name} limitations must be an array of nonblank strings`);
    }
    if (check.status === 'failed' && check.evidence && !Array.isArray(check.evidence) && Object.keys(check.evidence).length === 0) {
      errors.push(`${name} failed status must include defect evidence`);
    }
    if (check.status === 'not-run' && Array.isArray(check.limitations) && check.limitations.length === 0) {
      errors.push(`${name} not-run status must explain the unavailable capability`);
    }
  }
  if (evidence.browser?.status === 'passed') {
    const browser = evidence.browser.evidence ?? {};
    if (!Array.isArray(browser.viewports) || !browser.viewports.includes('1440x900') || !browser.viewports.includes('390x844')) errors.push('browser evidence must include desktop and mobile viewports');
    if (browser.console_errors !== 0) errors.push('console_errors must be 0');
    if (browser.external_runtime_requests !== 0) errors.push('external_runtime_requests must be 0');
    for (const name of ['search', 'deep_links', 'back_forward', 'review_decision', 'keyboard_navigation']) {
      if (browser[name] !== 'passed') errors.push(`${name} must be passed`);
    }
  }
  if (evidence.visual?.status === 'passed') {
    const visual = evidence.visual.evidence ?? {};
    if (visual.overflow_or_clipping !== 0 || visual.mobile_navigation !== 'passed' || visual.site_map !== 'passed' || visual.print_static !== 'passed') errors.push('visual evidence is incomplete');
  }
  if (evidence.accessibility?.status === 'passed') {
    const accessibility = evidence.accessibility.evidence ?? {};
    if (accessibility.focus_order !== 'passed' || accessibility.accessible_names !== 'passed' || accessibility.contrast !== 'passed' || accessibility.forced_colors !== 'passed' || accessibility.reduced_motion !== 'passed') errors.push('accessibility evidence is incomplete');
  }
  if (errors.length) throw new Error(`Browser evidence validation failed:\n- ${errors.join('\n- ')}`);
  return { browser: evidence.browser, visual: evidence.visual, accessibility: evidence.accessibility };
}

export function verifySite({ inputPath, sitePath, browserEvidence }) {
  const input = resolve(inputPath);
  const site = resolve(sitePath);
  if (!existsSync(site) || !statSync(site).isDirectory()) throw new Error('Site directory does not exist.');
  const { source, counts } = loadAndValidateAnalysis(input);
  const inputSha256 = sha256(Buffer.from(source, 'utf8'));
  const dataPath = join(site, 'data', 'stars-analysis.json');
  const buildInfoPath = join(site, 'build-info.json');
  const indexPath = join(site, 'index.html');
  for (const required of [
    dataPath,
    buildInfoPath,
    indexPath,
    join(site, '.vite', 'manifest.json')
  ]) {
    if (!existsSync(required)) throw new Error(`Generated site is missing ${relative(site, required)}`);
  }

  const dataBytes = readFileSync(dataPath);
  const dataIdentity = dataBytes.equals(Buffer.from(source, 'utf8'));
  const buildInfo = JSON.parse(readFileSync(buildInfoPath, 'utf8'));
  const manifest = JSON.parse(readFileSync(join(site, '.vite', 'manifest.json'), 'utf8'));
  const index = readFileSync(indexPath, 'utf8');
  const inventory = siteInventory(site);
  const canonicalRoot = mkdtempSync(join(tmpdir(), 'explain-stars-canonical-'));
  let canonicalInventory;
  try {
    const canonicalSite = join(canonicalRoot, 'site');
    buildSite({ inputPath: input, outputPath: canonicalSite });
    canonicalInventory = siteInventory(canonicalSite);
  } finally {
    rmSync(canonicalRoot, { recursive: true, force: true });
  }
  const canonicalIdentity = JSON.stringify(canonicalInventory.files) === JSON.stringify(inventory.files);
  const assetReferences = [...index.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
  const externalAssets = assetReferences.filter((reference) => /^(?:https?:)?\/\//i.test(reference));
  const missingAssets = assetReferences
    .filter((reference) => reference.startsWith('./'))
    .filter((reference) => !existsSync(join(site, reference.slice(2))));
  const manifestEntryErrors = [];
  const manifestAssets = [];
  for (const [key, entry] of Object.entries(manifest)) {
    if (!entry || typeof entry !== 'object') {
      manifestEntryErrors.push(`invalid manifest entry: ${key}`);
      continue;
    }
    for (const reference of [entry.file, ...(entry.css ?? []), ...(entry.assets ?? [])].filter(Boolean)) {
      manifestAssets.push(reference);
      if (!existsSync(join(site, reference))) manifestEntryErrors.push(`missing manifest asset: ${reference}`);
    }
    for (const importedKey of [...(entry.imports ?? []), ...(entry.dynamicImports ?? [])]) {
      if (!manifest[importedKey]) manifestEntryErrors.push(`missing manifest entry: ${importedKey}`);
    }
  }
  const requiredRoutes = ['#/', '#/search', '#/repositories', '#/lists', '#/review', '#/sitemap', '#/methods', '#/print'];
  const routes = buildInfo.app?.routes ?? [];
  const routeErrors = requiredRoutes.filter((route) => !routes.includes(route));

  const deterministicFailures = [];
  if (!dataIdentity) deterministicFailures.push('generated analysis bytes differ from input');
  if (!canonicalIdentity) deterministicFailures.push('generated site differs from a fresh build of the current React source');
  if (buildInfo.input?.sha256 !== inputSha256) deterministicFailures.push('build-info input hash differs from input');
  if (buildInfo.input?.repositories !== counts.repositories) deterministicFailures.push('build-info repository count differs');
  if (buildInfo.input?.lists !== counts.classification_lists + counts.review_queues) deterministicFailures.push('build-info List count differs');
  if (buildInfo.input?.memberships !== counts.classification_memberships + counts.review_queue_memberships) deterministicFailures.push('build-info membership count differs');
  if (externalAssets.length) deterministicFailures.push(`external runtime assets: ${externalAssets.join(', ')}`);
  if (missingAssets.length) deterministicFailures.push(`missing generated assets: ${missingAssets.join(', ')}`);
  if (manifestEntryErrors.length) deterministicFailures.push(...manifestEntryErrors);
  if (routeErrors.length) deterministicFailures.push(`missing routes: ${routeErrors.join(', ')}`);
  deterministicFailures.push(...inspectContentSecurityPolicy(index));

  const runtimeChecks = checkBrowserEvidence(browserEvidence, inputSha256, inventory.sha256);
  const checks = {
    schema: { status: 'passed', method: 'Validated the frozen analysis contract.', evidence: counts, limitations: [] },
    data_identity: { status: dataIdentity ? 'passed' : 'failed', method: 'Compared generated data bytes with the exact input.', evidence: { exact_match: dataIdentity, sha256: inputSha256 }, limitations: [] },
    react_projection: { status: canonicalIdentity ? 'passed' : 'failed', method: 'Rebuilt the React site from the same frozen input and compared every generated file hash.', evidence: { exact_match: canonicalIdentity, expected_site_sha256: canonicalInventory.sha256, actual_site_sha256: inventory.sha256 }, limitations: [] },
    app_structure: { status: deterministicFailures.length ? 'failed' : 'passed', method: 'Inspected React build assets, manifest closure, route inventory, CSP, and local references.', evidence: { files: inventory.files.length, routes, manifest_assets: manifestAssets.length, external_assets: externalAssets, missing_assets: missingAssets, failures: deterministicFailures }, limitations: [] },
    ...runtimeChecks
  };
  const runtimeNotRun = ['browser', 'visual', 'accessibility'].some((name) => checks[name].status === 'not-run');
  const runtimeFailed = ['browser', 'visual', 'accessibility'].some((name) => checks[name].status === 'failed');
  const status = deterministicFailures.length || runtimeFailed ? 'failed' : runtimeNotRun ? 'passed-with-limitations' : 'passed';
  return {
    schema_version: '2.0',
    verified_at: new Date().toISOString(),
    status,
    implementation: { id: 'bundled-react-v1', framework: 'React', builder: 'build-site.mjs' },
    input: { sha256: inputSha256, repositories: counts.repositories, lists: counts.classification_lists + counts.review_queues, memberships: counts.classification_memberships + counts.review_queue_memberships },
    site: { sha256: inventory.sha256, files: inventory.files },
    checks,
    limitations: runtimeNotRun ? ['Rendered browser QA has not been attached.'] : []
  };
}

if (
  process.argv[1] &&
  existsSync(resolve(process.argv[1])) &&
  realpathSync(resolve(process.argv[1])) === realpathSync(import.meta.filename)
) {
  try {
    const arguments_ = parseArguments(process.argv.slice(2));
    const output = resolve(arguments_.output);
    const site = resolve(arguments_.site);
    const input = resolve(arguments_.input);
    const evidencePath = arguments_['browser-evidence'] ? resolve(arguments_['browser-evidence']) : undefined;
    assertSafeReceiptPaths({ input, site, output, evidence: evidencePath });
    invalidatePreviousReceipt(output);
    const evidence = evidencePath ? JSON.parse(readFileSync(evidencePath, 'utf8')) : undefined;
    const receipt = verifySite({ inputPath: arguments_.input, sitePath: site, browserEvidence: evidence });
    writeReceiptAtomically(output, receipt);
    process.stdout.write(`${JSON.stringify({ status: receipt.status, output, site_sha256: receipt.site.sha256 }, null, 2)}\n`);
    if (receipt.status === 'failed') process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
