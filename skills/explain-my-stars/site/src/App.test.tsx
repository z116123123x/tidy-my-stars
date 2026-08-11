import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { DataProvider } from './data';
import { fixture } from './test/fixture';
import { parseReviewDecisions, persistReviewDecisions, reviewDecisionStorageKey, sensitivityExplanation } from './pages/ReviewPages';
import { csvCell } from './pages/UtilityPages';
import { commandShortcutLabel } from './i18n';

function renderRoute(route: string) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <DataProvider><App /></DataProvider>
    </MemoryRouter>
  );
}

describe('Stars site routing', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => fixture }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('exposes a real site map and every primary destination', async () => {
    renderRoute('/sitemap');
    expect(await screen.findByRole('heading', { name: '站點地圖', level: 1 })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Repositories' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Lists' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: '建議 Unstar' }).length).toBeGreaterThan(0);
  });

  it('opens a repository at a stable detail route with every exact reason', async () => {
    renderRoute('/repositories/acme/agent-studio');
    expect(await screen.findByRole('heading', { name: 'acme/agent-studio', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('It provides a reusable multi-step agent workflow.')).toBeInTheDocument();
    expect(screen.getByText('It includes a visual interface for composing workflows.')).toBeInTheDocument();
  });

  it('keeps Likely Unstar separate from classification Lists', async () => {
    renderRoute('/lists');
    expect(await screen.findByRole('heading', { name: 'Lists', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('建議 Unstar 不是主題 List')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Likely Unstar\s+1 repos/ })).not.toBeInTheDocument();
  });

  it('routes a Likely Unstar search result to the review queue instead of a List 404', async () => {
    renderRoute('/search?q=Likely%20Unstar');
    expect(await screen.findByRole('heading', { name: '搜尋全部內容', level: 1 })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Likely Unstar/ }).some((link) => link.getAttribute('href') === '/review')).toBe(true);
  });

  it('explains the selected sensitivity instead of hard-coding level 5', () => {
    expect(sensitivityExplanation(1, 'en')).toContain('Level 1');
    expect(sensitivityExplanation(5, 'zh-TW')).toContain('第 5 級');
    expect(sensitivityExplanation(5, 'en')).toContain('also includes');
    expect(sensitivityExplanation(10, 'en')).toContain('every repository except');
  });

  it('shows the unclassified reason for a queue-only review repository', async () => {
    const queueOnly = structuredClone(fixture);
    queueOnly.repositories[1].memberships = queueOnly.repositories[1].memberships.filter(
      (membership) => membership.list_id === 'likely-unstar'
    );
    queueOnly.repositories[1].unclassified_reason = 'No durable topic List is supported by the evidence.';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => queueOnly }));
    renderRoute('/review/acme/old-agent');
    expect(await screen.findByRole('heading', { name: '尚未歸入主題 List' })).toBeInTheDocument();
    expect(screen.getByText('No durable topic List is supported by the evidence.')).toBeInTheDocument();
  });

  it('namespaces review decisions by account and frozen run and degrades when storage is unavailable', () => {
    expect(reviewDecisionStorageKey('account-a', 'run-1')).not.toBe(reviewDecisionStorageKey('account-a', 'run-2'));
    expect(reviewDecisionStorageKey('account-a', 'run-1')).not.toBe(reviewDecisionStorageKey('account-b', 'run-1'));
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage unavailable'); });
    expect(persistReviewDecisions('test-key', { 'acme/repo': 'keep' })).toBe(false);
    setItem.mockRestore();
  });

  it('discards corrupt or unsupported persisted review decisions', () => {
    expect(parseReviewDecisions(null)).toEqual({});
    expect(parseReviewDecisions('null')).toEqual({});
    expect(parseReviewDecisions('[]')).toEqual({});
    expect(parseReviewDecisions('{"acme/old-agent":"unsupported","acme/keep":"keep"}')).toEqual({
      'acme/keep': 'keep'
    });
  });

  it('keeps hostile analysis text inert React text', async () => {
    const hostile = structuredClone(fixture);
    hostile.repositories[0].description = '</script><img src="https://evil.invalid/x" onerror="alert(1)">';
    hostile.repositories[0].memberships[0].reason = '<svg onload="fetch(\'https://evil.invalid/x\')">classification text</svg>';
    hostile.lists[0].name = '<script>alert(1)</script>';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => hostile }));
    renderRoute('/repositories/acme/agent-studio');
    expect(await screen.findByText(hostile.repositories[0].description)).toBeInTheDocument();
    expect(screen.getByText(hostile.repositories[0].memberships[0].reason)).toBeInTheDocument();
    expect(document.querySelector('main img')).toBeNull();
    expect(document.querySelector('main script')).toBeNull();
    expect(document.querySelector('main [onerror], main [onload]')).toBeNull();
  });

  it('neutralizes spreadsheet formulas, including invisible and localized prefixes, and correctly quotes CSV cells', () => {
    for (const value of [
      '=SUM(A1:A2)', '+1', '-2', '@cmd', ' =SUM(A1:A2)',
      '\t@cmd', '\r-2', '\n=SUM(A1:A2)', ' \n@cmd',
      '＝SUM(A1:A2)', '＋1', '－2', '＠cmd',
      '\u200b=SUM(A1:A2)', '\u200c＋1', '\u200d-2', '\u2060@cmd',
      '\ufeff=SUM(A1:A2)'
    ]) {
      expect(csvCell(value).replace(/^"|"$/g, '')).toMatch(/^'/);
    }
    expect(csvCell('\u200bordinary text')).toBe('\u200bordinary text');
    expect(csvCell('hello, "world"\n')).toBe('"hello, ""world""\n"');
    expect(csvCell('ordinary text')).toBe('ordinary text');
  });

  it('shows the command shortcut for the current platform', () => {
    expect(commandShortcutLabel('MacIntel')).toBe('⌘K');
    expect(commandShortcutLabel('Win32')).toBe('Ctrl+K');
    expect(commandShortcutLabel('Linux x86_64')).toBe('Ctrl+K');
  });
});
