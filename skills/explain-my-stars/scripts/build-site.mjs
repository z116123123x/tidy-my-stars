#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { loadAndValidateAnalysis } from './analysis-contract.mjs';

const skillDirectory = resolve(import.meta.dirname, '..');
const siteDirectory = join(skillDirectory, 'site');

function usage() {
  return 'Usage: node build-site.mjs --input <stars-analysis.json> --output <stars-site-directory>';
}

function parseArguments(arguments_) {
  const values = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (!['--input', '--output'].includes(key) || !value) throw new Error(usage());
    values[key.slice(2)] = value;
  }
  if (!values.input || !values.output) throw new Error(usage());
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

function assertSafeOutput(inputPath, outputPath) {
  const outputEntry = lstatSync(outputPath, { throwIfNoEntry: false });
  if (outputEntry?.isSymbolicLink()) throw new Error('Refusing to replace a symbolic-link output path.');
  const canonicalInput = canonicalizePath(inputPath);
  const canonicalOutput = canonicalizePath(outputPath);
  const canonicalSite = canonicalizePath(siteDirectory);
  if (canonicalOutput === dirname(canonicalOutput)) throw new Error('Refusing to use a filesystem root as output.');
  if (isInside(canonicalOutput, canonicalInput)) throw new Error('Output directory cannot contain the semantic input.');
  if (isInside(canonicalOutput, canonicalSite) || isInside(canonicalSite, canonicalOutput)) {
    throw new Error('Output directory cannot overwrite or contain the React source tree.');
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

function setPrivateOutputPermissions(directory) {
  if (process.platform === 'win32') return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Generated site must not contain symbolic links.');
    if (entry.isDirectory()) {
      setPrivateOutputPermissions(path);
    } else {
      chmodSync(path, 0o600);
    }
  }
  chmodSync(directory, 0o700);
}

function isTraditionalChinese(locale) {
  return /^zh(?:-(?:hant|tw|hk|mo))(?:-|$)/i.test(locale);
}

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function localizeIndex(indexPath, locale) {
  const traditionalChinese = isTraditionalChinese(locale);
  const uiLocale = traditionalChinese ? 'zh-TW' : 'en';
  const title = traditionalChinese ? 'GitHub Stars 資料庫' : 'GitHub Stars Library';
  const description = traditionalChinese
    ? '瀏覽、搜尋並複核結構化的 GitHub Stars 收藏。'
    : 'Browse, search, and review a structured GitHub Stars collection.';
  const noscript = traditionalChinese
    ? '這個 React 網站需要啟用 JavaScript 才能瀏覽與搜尋。'
    : 'This React site requires JavaScript for browsing and search.';
  let html = readFileSync(indexPath, 'utf8');
  html = html.replace(/<html\s+lang="[^"]*">/i, `<html lang="${escapeHtml(uiLocale)}">`);
  html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`);
  html = html.replace(/(<meta\s+name="description"\s+content=")[^"]*("\s*\/?>)/i, `$1${escapeHtml(description)}$2`);
  html = html.replace(/<noscript>[\s\S]*?<\/noscript>/i, `<noscript>${escapeHtml(noscript)}</noscript>`);
  writeFileSync(indexPath, html);
  return uiLocale;
}

function packageIdentityFromLockPath(lockPath, directory) {
  const resolvedDirectory = resolve(directory);
  const resolvedModules = resolve(directory, 'node_modules');
  const packageDirectory = resolve(directory, lockPath);
  const normalizedLockPath = relative(resolvedDirectory, packageDirectory).split(sep).join('/');
  if (!isInside(resolvedModules, packageDirectory) || normalizedLockPath !== lockPath) {
    throw new Error(`Runtime dependency has an invalid package-lock path: ${lockPath}`);
  }

  const segments = lockPath.split('/');
  let cursor = 0;
  let identity;
  while (cursor < segments.length) {
    if (segments[cursor] !== 'node_modules') {
      throw new Error(`Runtime dependency has an invalid package-lock path: ${lockPath}`);
    }
    cursor += 1;
    const first = segments[cursor];
    if (!first || first === '.' || first === '..' || first.includes('\\')) {
      throw new Error(`Runtime dependency has an invalid package-lock path: ${lockPath}`);
    }
    if (first.startsWith('@')) {
      const second = segments[cursor + 1];
      if (!second || second === '.' || second === '..' || second.includes('\\') || second.startsWith('@')) {
        throw new Error(`Runtime dependency has an invalid package-lock path: ${lockPath}`);
      }
      identity = `${first}/${second}`;
      cursor += 2;
    } else {
      identity = first;
      cursor += 1;
    }
  }
  return { identity, packageDirectory };
}

export function loadVerifiedRuntimeDependencies(directory = siteDirectory) {
  const lockPath = join(directory, 'package-lock.json');
  const manifestPath = join(directory, 'package.json');
  if (!existsSync(lockPath) || !existsSync(manifestPath)) {
    throw new Error('React package.json and package-lock.json are required for a deterministic build.');
  }
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  const rootManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const rootLockEntry = lock.packages?.[''];
  if (!rootLockEntry || !isDeepStrictEqual(rootManifest.dependencies ?? {}, rootLockEntry.dependencies ?? {})) {
    throw new Error('Production dependencies in package.json do not exactly match package-lock.json.');
  }
  const packages = [];
  for (const [lockPath, lockEntry] of Object.entries(lock.packages ?? {})) {
    if (!lockPath || lockEntry.dev === true) continue;
    const { identity: pathIdentity, packageDirectory } = packageIdentityFromLockPath(lockPath, directory);
    const packageManifestPath = join(packageDirectory, 'package.json');
    if (!existsSync(packageManifestPath)) throw new Error(`Runtime dependency is not installed: ${lockPath}`);
    const packageManifest = JSON.parse(readFileSync(packageManifestPath, 'utf8'));
    const expectedName = lockEntry.name ?? pathIdentity;
    if (!expectedName || !lockEntry.version) {
      throw new Error(`Runtime dependency has incomplete package-lock metadata: ${lockPath}`);
    }
    if (packageManifest.name !== expectedName) {
      throw new Error(`Installed runtime dependency identity does not match package-lock.json: ${lockPath} expected ${expectedName}`);
    }
    if (packageManifest.version !== lockEntry.version) {
      throw new Error(`Installed runtime dependency version does not match package-lock.json: ${expectedName}`);
    }
    packages.push({
      name: expectedName,
      version: lockEntry.version,
      lock_path: lockPath
    });
  }
  packages.sort((a, b) => a.lock_path.localeCompare(b.lock_path));
  return packages;
}

function assertReplaceableOutput(output) {
  if (!existsSync(output)) return;
  if (lstatSync(output).isSymbolicLink()) throw new Error('Refusing to replace a symbolic-link output path.');
  if (!statSync(output).isDirectory()) throw new Error('Output exists and is not a directory.');
  const entries = readdirSync(output);
  if (!entries.length) return;
  const buildInfoPath = join(output, 'build-info.json');
  if (!existsSync(buildInfoPath)) {
    throw new Error('Refusing to replace a nonempty directory that was not generated by explain-my-stars.');
  }
  let buildInfo;
  try {
    buildInfo = JSON.parse(readFileSync(buildInfoPath, 'utf8'));
  } catch {
    throw new Error('Refusing to replace an output directory with an invalid build-info.json marker.');
  }
  const required = [
    join(output, 'index.html'),
    join(output, '.vite', 'manifest.json'),
    join(output, 'data', 'stars-analysis.json')
  ];
  const dataPath = required[2];
  const hasStrongIdentity =
    buildInfo.schema_version === '1.0' &&
    buildInfo.app?.generator === 'explain-my-stars' &&
    buildInfo.app?.implementation_id === 'bundled-react-v1' &&
    buildInfo.app?.framework === 'React' &&
    Array.isArray(buildInfo.app?.routes) &&
    buildInfo.app.routes.includes('#/sitemap') &&
    required.every((path) => existsSync(path)) &&
    typeof buildInfo.input?.sha256 === 'string' &&
    buildInfo.input.sha256 === sha256(readFileSync(dataPath));
  if (!hasStrongIdentity) {
    throw new Error('Refusing to replace a directory that was not generated by explain-my-stars.');
  }
}

function replaceGeneratedOutput(temporary, output) {
  assertReplaceableOutput(output);
  if (!existsSync(output)) {
    renameSync(temporary, output);
    return;
  }
  const backup = mkdtempSync(join(dirname(output), '.stars-site-backup-'));
  rmSync(backup, { recursive: true });
  renameSync(output, backup);
  try {
    renameSync(temporary, output);
    rmSync(backup, { recursive: true });
  } catch (error) {
    if (!existsSync(output) && existsSync(backup)) renameSync(backup, output);
    throw error;
  }
}

export function buildSite({ inputPath, outputPath }) {
  const input = resolve(inputPath);
  const output = resolve(outputPath);
  assertSafeOutput(input, output);
  assertReplaceableOutput(output);

  const { source, analysis, counts } = loadAndValidateAnalysis(input);
  const inputSha256 = sha256(Buffer.from(source, 'utf8'));
  const packageExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  loadVerifiedRuntimeDependencies();
  if (!existsSync(join(siteDirectory, 'node_modules', '.bin', 'vite'))) {
    throw new Error(`React dependencies are not installed. Run npm install in ${siteDirectory}`);
  }

  mkdirSync(dirname(output), { recursive: true });
  const temporary = mkdtempSync(join(dirname(output), '.stars-site-build-'));
  try {
    const build = spawnSync(
      packageExecutable,
      ['run', 'build', '--', '--outDir', temporary, '--emptyOutDir'],
      { cwd: siteDirectory, encoding: 'utf8' }
    );
    if (build.status !== 0) {
      throw new Error(`React site build failed:\n${build.stdout}${build.stderr}`);
    }

    const dataDirectory = join(temporary, 'data');
    mkdirSync(dataDirectory, { recursive: true });
    writeFileSync(join(dataDirectory, 'stars-analysis.json'), Buffer.from(source, 'utf8'));
    const uiLocale = localizeIndex(join(temporary, 'index.html'), analysis.locale);

    const buildInfo = {
      schema_version: '1.0',
      source_generated_at: analysis.generated_at,
      input: {
        sha256: inputSha256,
        repositories: counts.repositories,
        lists: counts.classification_lists + counts.review_queues,
        memberships: counts.classification_memberships + counts.review_queue_memberships,
        review_queue_memberships: counts.review_queue_memberships
      },
      app: {
        generator: 'explain-my-stars',
        implementation_id: 'bundled-react-v1',
        framework: 'React',
        ui_locale: uiLocale,
        routes: [
          '#/', '#/search', '#/repositories', '#/repositories/:owner/:name',
          '#/lists', '#/lists/:listId', '#/review', '#/review/:owner/:name',
          '#/sitemap', '#/methods', '#/print'
        ]
      }
    };
    writeFileSync(join(temporary, 'build-info.json'), `${JSON.stringify(buildInfo, null, 2)}\n`);

    replaceGeneratedOutput(temporary, output);
    setPrivateOutputPermissions(output);

    const files = collectFiles(output);
    return { output, input_sha256: inputSha256, counts, files };
  } catch (error) {
    if (existsSync(temporary)) rmSync(temporary, { recursive: true });
    throw error;
  }
}

if (
  process.argv[1] &&
  existsSync(resolve(process.argv[1])) &&
  realpathSync(resolve(process.argv[1])) === realpathSync(import.meta.filename)
) {
  try {
    const arguments_ = parseArguments(process.argv.slice(2));
    const result = buildSite({ inputPath: arguments_.input, outputPath: arguments_.output });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
