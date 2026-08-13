import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const script = join(root, 'skills/explain-my-stars/site/scripts/browser-qa.mjs');

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'browser-qa-contract-'));
  const site = join(directory, 'site');
  mkdirSync(site);
  writeFileSync(join(site, 'index.html'), '<!doctype html><title>Fixture</title>');
  const input = join(directory, 'stars-analysis.json');
  writeFileSync(input, '{}\n');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { directory, input, site };
}

function run(arguments_) {
  return spawnSync(process.execPath, [script, ...arguments_], { encoding: 'utf8' });
}

test('browser QA fails before launch when output or artifacts overlap protected inputs', (t) => {
  const { directory, input, site } = fixture(t);
  const overlappingOutput = run([
    '--input', input, '--site', site, '--output', join(site, 'browser-evidence.json'),
    '--artifacts', join(directory, 'artifacts')
  ]);
  assert.notEqual(overlappingOutput.status, 0);
  assert.match(overlappingOutput.stderr, /Output must not overlap/);
  assert.equal(readFileSync(join(site, 'index.html'), 'utf8'), '<!doctype html><title>Fixture</title>');

  const overlappingArtifacts = run([
    '--input', input, '--site', site, '--output', join(directory, 'browser-evidence.json'),
    '--artifacts', join(site, 'artifacts')
  ]);
  assert.notEqual(overlappingArtifacts.status, 0);
  assert.match(overlappingArtifacts.stderr, /Artifacts must not overlap/);
});

test('browser QA refuses to replace a foreign evidence file', (t) => {
  const { directory, input, site } = fixture(t);
  const output = join(directory, 'browser-evidence.json');
  writeFileSync(output, '{"user":"owned"}\n');
  const result = run([
    '--input', input, '--site', site, '--output', output,
    '--artifacts', join(directory, 'artifacts')
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /another producer/);
  assert.equal(readFileSync(output, 'utf8'), '{"user":"owned"}\n');
});
