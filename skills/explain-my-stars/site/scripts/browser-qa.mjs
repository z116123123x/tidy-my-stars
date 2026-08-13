#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium } from 'playwright';

const GENERATOR = 'explain-my-stars-browser-qa-v1';
const VIEWPORTS = Object.freeze([
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 }
]);
const STATIC_ROUTES = Object.freeze([
  '#/', '#/search?q=agent', '#/repositories', '#/lists', '#/review',
  '#/sitemap', '#/methods', '#/print'
]);

function usage() {
  return 'Usage: node browser-qa.mjs --input <stars-analysis.json> --site <stars-site-directory> --output <browser-evidence.json> --artifacts <browser-qa-directory>';
}

function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!['--input', '--site', '--output', '--artifacts'].includes(key) || !value) throw new Error(usage());
    result[key.slice(2)] = value;
  }
  for (const required of ['input', 'site', 'output', 'artifacts']) if (!result[required]) throw new Error(usage());
  return result;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function collectFiles(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolutePath = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Site must not contain symbolic links: ${relativePath}`);
    return entry.isDirectory() ? collectFiles(absolutePath, relativePath) : [relativePath];
  }).sort();
}

function siteInventory(directory) {
  const entries = collectFiles(directory).map((path) => {
    const bytes = readFileSync(join(directory, path));
    return { path, sha256: sha256(bytes) };
  });
  return sha256(entries.map((entry) => `${entry.path}\0${entry.sha256}`).join('\n'));
}

function assertSeparatePath(candidate, protectedPath, label) {
  const candidatePath = resolve(candidate);
  const protectedAbsolute = resolve(protectedPath);
  if (candidatePath === protectedAbsolute || candidatePath.startsWith(`${protectedAbsolute}${sep}`)) {
    throw new Error(`${label} must not overlap the input or generated site.`);
  }
}

function assertSafeOutput(path) {
  if (!existsSync(path)) return;
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
    throw new Error('Browser evidence output must be a new file or a regular, singly-linked receipt from this generator.');
  }
  let current;
  try {
    current = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('Refusing to replace a non-JSON browser evidence output.');
  }
  if (current?.generator !== GENERATOR) throw new Error('Refusing to replace browser evidence owned by another producer.');
}

function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  const descriptor = openSync(temporary, 'wx', 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
  } finally {
    closeSync(descriptor);
  }
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
}

function contentType(path) {
  return new Map([
    ['.html', 'text/html; charset=utf-8'],
    ['.js', 'text/javascript; charset=utf-8'],
    ['.css', 'text/css; charset=utf-8'],
    ['.json', 'application/json; charset=utf-8'],
    ['.svg', 'image/svg+xml'],
    ['.png', 'image/png'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.webp', 'image/webp']
  ]).get(extname(path).toLowerCase()) ?? 'application/octet-stream';
}

async function startServer(site) {
  const server = createServer((request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const decoded = decodeURIComponent(url.pathname);
      const requested = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
      const absolute = resolve(site, requested);
      if (absolute !== site && !absolute.startsWith(`${site}${sep}`)) throw new Error('Path traversal rejected.');
      if (!existsSync(absolute) || !statSync(absolute).isFile()) {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('Not found');
        return;
      }
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': contentType(absolute),
        'x-content-type-options': 'nosniff'
      });
      response.end(readFileSync(absolute));
    } catch (error) {
      response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(error.message);
    }
  });
  await new Promise((resolveListening, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListening);
  });
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()))
  };
}

function routeForList(list) {
  return list.kind === 'review-queue' ? '#/review' : `#/lists/${encodeURIComponent(list.id)}`;
}

function routeForRepository(repository) {
  return `#/repositories/${repository.full_name.split('/').map(encodeURIComponent).join('/')}`;
}

async function inspectLayout(page, mobile) {
  return page.evaluate(({ mobile }) => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
    };
    const undersized = mobile ? [...document.querySelectorAll('a,button,input,select,summary,textarea')]
      .filter(visible)
      .map((element) => {
        const box = element.getBoundingClientRect();
        return { label: element.textContent?.trim() || element.getAttribute('aria-label') || element.tagName, width: box.width, height: box.height };
      })
      .filter((item) => item.width < 44 || item.height < 44) : [];
    return {
      overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      undersized
    };
  }, { mobile });
}

async function runAxe(page, route, violations) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  for (const violation of result.violations) {
    violations.push({ route, id: violation.id, impact: violation.impact, nodes: violation.nodes.length });
  }
}

async function waitForPage(page) {
  await page.locator('main h1').first().waitFor({ state: 'visible' });
  await page.waitForLoadState('networkidle');
}

async function captureScreenshot(page, path, artifacts) {
  await page.screenshot({ path, fullPage: true });
  if (process.platform !== 'win32') chmodSync(path, 0o600);
  const bytes = readFileSync(path);
  if (bytes.length < 1024) throw new Error(`Screenshot is unexpectedly small: ${path}`);
  return { path: relative(artifacts, path), bytes: bytes.length, sha256: sha256(bytes) };
}

async function runQa({ input, site, artifacts }) {
  const analysisBytes = readFileSync(input);
  const analysis = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(analysisBytes));
  const repositories = analysis.repositories;
  const classification = analysis.lists.find((list) => list.kind === 'classification');
  const queue = analysis.lists.find((list) => list.kind === 'review-queue');
  const reviewRepository = repositories.find((repository) => repository.memberships.some((membership) => membership.list_id === queue?.id));
  if (!classification || !queue || !repositories.length || !reviewRepository) throw new Error('Browser QA requires repositories, a classification List, and a nonempty review queue.');

  mkdirSync(artifacts, { recursive: false, mode: 0o700 });
  chmodSync(artifacts, 0o700);
  const server = await startServer(site);
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim() || undefined;
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const consoleErrors = [];
  const pageErrors = [];
  const externalRequests = [];
  const violations = [];
  const screenshots = [];
  let overflowOrClipping = 0;
  try {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: 'light',
        reducedMotion: 'no-preference'
      });
      const page = await context.newPage();
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(`${viewport.name}: ${message.text()}`);
      });
      page.on('pageerror', (error) => pageErrors.push(`${viewport.name}: ${error.message}`));
      page.on('request', (request) => {
        if (new URL(request.url()).origin !== server.origin) externalRequests.push(request.url());
      });

      const routes = [
        ...STATIC_ROUTES,
        routeForList(classification),
        routeForRepository(repositories[0]),
        `#/review/${reviewRepository.full_name.split('/').map(encodeURIComponent).join('/')}`
      ];
      for (const route of routes) {
        await page.goto(`${server.origin}/${route}`);
        await waitForPage(page);
        const layout = await inspectLayout(page, viewport.name === 'mobile');
        if (layout.overflow > 0 || layout.undersized.length) {
          overflowOrClipping += 1;
          throw new Error(`${viewport.name} ${route} layout failed: ${JSON.stringify(layout)}`);
        }
        await runAxe(page, `${viewport.name}:${route}`, violations);
      }

      await page.goto(`${server.origin}/#/`);
      await waitForPage(page);
      screenshots.push(await captureScreenshot(page, join(artifacts, `${viewport.name}-overview.png`), artifacts));
      if (viewport.name === 'mobile') {
        await page.locator('summary[aria-label="Open navigation"], summary[aria-label="開啟導覽"]').click();
        const mobileLinks = page.locator('details[open] a');
        if (await mobileLinks.count() < 8) throw new Error('Mobile navigation did not expose every primary destination.');
        for (const box of await mobileLinks.evaluateAll((elements) => elements.map((element) => {
          const rect = element.getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        }))) {
          if (box.width < 44 || box.height < 44) throw new Error(`Mobile navigation target is smaller than 44px: ${JSON.stringify(box)}`);
        }
        await page.locator('summary[aria-label="Open navigation"], summary[aria-label="開啟導覽"]').click();
      }
      await context.close();
    }

    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(`interaction: ${message.text()}`); });
    page.on('pageerror', (error) => pageErrors.push(`interaction: ${error.message}`));
    page.on('request', (request) => { if (new URL(request.url()).origin !== server.origin) externalRequests.push(request.url()); });

    await page.goto(`${server.origin}/#/`);
    await waitForPage(page);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
    const search = page.locator('#command-search');
    await search.waitFor({ state: 'visible' });
    await search.fill(classification.name);
    const firstResult = page.locator('.command-result').first();
    if (!((await firstResult.textContent()) ?? '').includes(classification.name)) throw new Error('Exact List search did not rank the List first.');
    await search.press('Enter');
    await waitForPage(page);
    if (new URL(page.url()).hash !== routeForList(classification)) throw new Error('Search selection reached the wrong route.');

    const repositoryRoute = routeForRepository(repositories[0]);
    await page.goto(`${server.origin}/${repositoryRoute}`);
    await waitForPage(page);
    await page.reload();
    await waitForPage(page);
    if (new URL(page.url()).hash !== repositoryRoute) throw new Error('Direct deep-link reload did not preserve the route.');
    await page.goto(`${server.origin}/#/`);
    await waitForPage(page);
    await page.goto(`${server.origin}/${repositoryRoute}`);
    await waitForPage(page);
    await page.goBack();
    if (new URL(page.url()).hash !== '#/') throw new Error('Back navigation did not restore Overview.');
    await page.goForward();
    if (new URL(page.url()).hash !== repositoryRoute) throw new Error('Forward navigation did not restore the repository.');

    const reviewRoute = `#/review/${reviewRepository.full_name.split('/').map(encodeURIComponent).join('/')}`;
    await page.goto(`${server.origin}/${reviewRoute}`);
    await waitForPage(page);
    await page.getByRole('button', { name: /Keep|保留/ }).click();
    await page.goto(`${server.origin}/#/review`);
    await waitForPage(page);
    const reviewRow = page.locator(`a[href="${reviewRoute}"]`);
    if (!/Keep|保留/.test((await reviewRow.textContent()) ?? '')) throw new Error('Review decision was not visible after returning to the queue.');
    await reviewRow.click();
    await page.getByRole('button', { name: /Clear saved decision|清除已儲存決定/ }).click();

    await page.goto(`${server.origin}/#/`);
    await waitForPage(page);
    const skip = page.locator('.skip-link');
    await skip.focus();
    if (!await skip.isVisible()) throw new Error('Skip control is not visible when keyboard-focused.');
    await page.keyboard.press('Enter');
    const focusedMain = await page.evaluate(() => document.activeElement?.id);
    if (focusedMain !== 'main-content') throw new Error('Skip control did not focus the main content.');

    await page.goto(`${server.origin}/#/sitemap`);
    await waitForPage(page);
    if (await page.locator('main a').count() < 7) throw new Error('Site map is incomplete.');

    await page.goto(`${server.origin}/#/print`);
    await waitForPage(page);
    const printText = (await page.locator('main').textContent()) ?? '';
    for (const repository of repositories) if (!printText.includes(repository.full_name)) throw new Error(`Print view omits ${repository.full_name}.`);
    await page.emulateMedia({ media: 'print' });
    screenshots.push(await captureScreenshot(page, join(artifacts, 'print.png'), artifacts));
    await page.emulateMedia({ media: 'screen' });

    await page.goto(`${server.origin}/#/`);
    await waitForPage(page);
    await page.emulateMedia({ forcedColors: 'active' });
    if (!await page.locator('main h1').isVisible()) throw new Error('Primary content disappeared in forced-colors mode.');
    await page.emulateMedia({ forcedColors: 'none', reducedMotion: 'reduce' });
    const reducedMotion = await page.evaluate(() => {
      const durationToMs = (value) => value.split(',').map((item) => {
        const token = item.trim();
        return token.endsWith('ms') ? Number.parseFloat(token) : Number.parseFloat(token) * 1000;
      });
      const durations = [...document.querySelectorAll('*')].flatMap((element) => {
        const style = getComputedStyle(element);
        return [...durationToMs(style.animationDuration), ...durationToMs(style.transitionDuration)];
      });
      return {
        matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
        longestDurationMs: Math.max(0, ...durations)
      };
    });
    if (!reducedMotion.matches || reducedMotion.longestDurationMs > 1) {
      throw new Error(`Reduced-motion CSS did not reduce all motion to at most 1ms: ${JSON.stringify(reducedMotion)}`);
    }
    await context.close();

    if (consoleErrors.length || pageErrors.length) throw new Error(`Browser console errors: ${JSON.stringify([...consoleErrors, ...pageErrors])}`);
    if (externalRequests.length) throw new Error(`External runtime requests: ${JSON.stringify(externalRequests)}`);
    if (violations.length) throw new Error(`Accessibility violations: ${JSON.stringify(violations)}`);

    return {
      input_sha256: sha256(analysisBytes),
      site_sha256: siteInventory(site),
      generator: GENERATOR,
      browser: {
        status: 'passed',
        method: 'Automated Chromium rendered QA exercised the exact local site across the required route and interaction matrix.',
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
        limitations: ['Automated in Chromium; no claim of cross-browser equivalence.']
      },
      visual: {
        status: 'passed',
        method: 'Automated viewport geometry, touch-target, navigation, site-map, print, and screenshot checks on the exact rendered site.',
        evidence: {
          overflow_or_clipping: overflowOrClipping,
          mobile_navigation: 'passed',
          site_map: 'passed',
          print_static: 'passed',
          screenshots
        },
        limitations: ['Screenshots and geometry checks do not replace subjective human aesthetic review.']
      },
      accessibility: {
        status: 'passed',
        method: 'axe WCAG A/AA scans on every required desktop/mobile route plus keyboard, names, contrast, forced-colors, and reduced-motion checks.',
        evidence: {
          focus_order: 'passed',
          accessible_names: 'passed',
          contrast: 'passed',
          forced_colors: 'passed',
          reduced_motion: 'passed',
          axe_violations: 0
        },
        limitations: ['Automated accessibility checks cannot establish every assistive-technology experience.']
      }
    };
  } finally {
    await browser.close();
    await server.close();
  }
}

async function main() {
  const arguments_ = parseArguments(process.argv.slice(2));
  const input = resolve(arguments_.input);
  const site = resolve(arguments_.site);
  const output = resolve(arguments_.output);
  const artifacts = resolve(arguments_.artifacts);
  if (!existsSync(input) || !statSync(input).isFile() || lstatSync(input).isSymbolicLink()) throw new Error('Input must be a regular non-symlink file.');
  if (!existsSync(site) || !statSync(site).isDirectory() || lstatSync(site).isSymbolicLink()) throw new Error('Site must be a regular non-symlink directory.');
  assertSeparatePath(output, input, 'Output');
  assertSeparatePath(output, site, 'Output');
  assertSeparatePath(artifacts, input, 'Artifacts');
  assertSeparatePath(artifacts, site, 'Artifacts');
  if (existsSync(artifacts)) throw new Error('Browser QA artifact directory must not already exist.');
  assertSafeOutput(output);
  const evidence = await runQa({ input, site, artifacts });
  atomicJson(output, evidence);
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
