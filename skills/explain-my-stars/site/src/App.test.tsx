import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { DataProvider } from './data';
import { fixture } from './test/fixture';
import { parseReviewDecisions, persistReviewDecisions, reviewDecisionStorageKey, sensitivityExplanation } from './pages/ReviewPages';
import { csvCell } from './pages/UtilityPages';
import { commandShortcutLabel } from './i18n';
import type { ReportProvenance } from './types';

function renderRoute(route: string) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <DataProvider><App /></DataProvider>
    </MemoryRouter>
  );
}

const provenanceFixture: ReportProvenance = {
  schema_version: '1.0',
  source: {
    account_login: fixture.account.login,
    generated_at: fixture.generated_at,
    stars_analysis_bytes_sha256: '1'.repeat(64)
  },
  semantic: {
    validation_status: 'passed',
    candidate_sha256: '2'.repeat(64),
    plan_sha256: '3'.repeat(64),
    collection_receipt_sha256: '4'.repeat(64),
    execution_receipts_sha256: '5'.repeat(64),
    validation_receipt_sha256: '6'.repeat(64),
    limitations: [
      'Semantic origin is not authenticated.',
      'Semantic understanding is not proven.'
    ]
  },
  application: {
    status: 'planned',
    claim_basis: 'no-application-receipt',
    receipt_sha256: null,
    validation_receipt_sha256: null,
    final_state_sha256: null,
    limitations: []
  }
};

const appliedLimitationFixture = [
  'Offline validation does not authenticate the claimed account or GitHub pre-write read, or prove that the read is fresh.',
  'Offline validation does not prove that remote state remained unchanged between this gate and the first deletion.',
  'The deterministic receipt proves the exact frozen gate conditions when rederived, but not that the preflight validator actually ran before the first mutation.',
  'Offline validation verifies frozen artifacts and hashes; it does not prove that the user granted the authorization claimed by the runner or that external actions occurred.',
  'Offline validation does not authenticate GitHub final-state reads or mutation responses.'
];

function encodeAnalysis(analysis: typeof fixture): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify(analysis));
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function stubReportData(
  analysis = fixture,
  provenance: object = provenanceFixture,
  provenanceBoundAnalysis = analysis
) {
  const deliveredAnalysisBytes = encodeAnalysis(analysis);
  const boundAnalysisBytes = encodeAnalysis(provenanceBoundAnalysis);
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/data/report-provenance.json')) {
      const value = structuredClone(provenance) as ReportProvenance;
      return {
        ok: true,
        json: async () => ({
          ...value,
          source: {
            ...value.source,
            stars_analysis_bytes_sha256: await sha256Hex(boundAnalysisBytes)
          }
        })
      };
    }
    return {
      ok: true,
      arrayBuffer: async () => deliveredAnalysisBytes.slice().buffer
    };
  }));
}

describe('Stars site routing', () => {
  beforeEach(() => {
    stubReportData();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('exposes a real site map and every primary destination', async () => {
    renderRoute('/sitemap');
    expect(await screen.findByRole('heading', { name: '站點地圖', level: 1 })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Repositories' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Lists' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Star 複核' }).length).toBeGreaterThan(0);
  });

  it('keeps the overview definition list structurally valid', async () => {
    renderRoute('/');
    await screen.findByRole('heading', { name: 'GitHub Stars 整理報告' });
    const ledger = document.querySelector('dl.overview-ledger');
    expect(ledger).not.toBeNull();
    expect([...ledger!.children].every((group) =>
      group.tagName === 'DIV'
      && [...group.children].every((child) => child.tagName === 'DT' || child.tagName === 'DD')
    )).toBe(true);
  });

  it('opens a repository at a stable detail route with every exact reason', async () => {
    renderRoute('/repositories/acme/agent-studio');
    expect(await screen.findByRole('heading', { name: 'acme/agent-studio', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('It provides a reusable multi-step agent workflow.')).toBeInTheDocument();
    expect(screen.getByText('It includes a visual interface for composing workflows.')).toBeInTheDocument();
  });

  it('keeps Star Review separate from classification Lists', async () => {
    renderRoute('/lists');
    expect(await screen.findByRole('heading', { name: 'Lists', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Star 複核不是主題 List')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Star Review\s+1 repos/ })).not.toBeInTheDocument();
  });

  it('routes a Star Review search result to the review queue instead of a List 404', async () => {
    renderRoute('/search?q=Star%20Review');
    expect(await screen.findByRole('heading', { name: '搜尋全部內容', level: 1 })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Star Review/ }).some((link) => link.getAttribute('href') === '/review')).toBe(true);
  });

  it('opens global search without mutating an inline body style blocked by the CSP', async () => {
    renderRoute('/');
    await screen.findByRole('heading', { name: 'GitHub Stars 整理報告' });
    fireEvent.click(screen.getByRole('button', { name: /尋找任何內容/ }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(document.body.getAttribute('style')).toBeNull();
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
    stubReportData(queueOnly);
    renderRoute('/review/acme/old-agent');
    expect(await screen.findByRole('heading', { name: '尚未歸入主題 List' })).toBeInTheDocument();
    expect(screen.getByText('No durable topic List is supported by the evidence.')).toBeInTheDocument();
  });

  it('namespaces review decisions by account and frozen run and degrades when storage is unavailable', () => {
    expect(reviewDecisionStorageKey('account-a', 'run-1', 'a'.repeat(64))).not.toBe(
      reviewDecisionStorageKey('account-a', 'run-2', 'a'.repeat(64))
    );
    expect(reviewDecisionStorageKey('account-a', 'run-1', 'a'.repeat(64))).not.toBe(
      reviewDecisionStorageKey('account-b', 'run-1', 'a'.repeat(64))
    );
    expect(reviewDecisionStorageKey('account-a', 'run-1', 'a'.repeat(64))).not.toBe(
      reviewDecisionStorageKey('account-a', 'run-1', 'b'.repeat(64))
    );
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
    stubReportData(hostile);
    renderRoute('/repositories/acme/agent-studio');
    expect(await screen.findByText(hostile.repositories[0].description)).toBeInTheDocument();
    expect(screen.getByText(hostile.repositories[0].memberships[0].reason)).toBeInTheDocument();
    expect(document.querySelector('main img')).toBeNull();
    expect(document.querySelector('main script')).toBeNull();
    expect(document.querySelector('main [onerror], main [onload]')).toBeNull();
  });

  it('surfaces every offline limitation and distinguishes planned state from a receipt-backed applied claim', async () => {
    renderRoute('/methods');
    expect(await screen.findByRole('heading', { name: '方法', level: 1 })).toBeInTheDocument();
    for (const limitation of provenanceFixture.semantic.limitations) {
      expect(screen.getByText(limitation)).toBeInTheDocument();
    }
    expect(screen.getByText('規劃中 — 未提供套用收據')).toBeInTheDocument();

    const applied: ReportProvenance = {
      ...structuredClone(provenanceFixture),
      application: {
        status: 'applied',
        claim_basis: 'validated-external-receipt',
        receipt_sha256: '7'.repeat(64),
        validation_receipt_sha256: '8'.repeat(64),
        final_state_sha256: '9'.repeat(64),
        limitations: appliedLimitationFixture
      }
    };
    stubReportData(fixture, applied);
    renderRoute('/methods');
    expect(await screen.findByText('套用聲明 — 已驗證外部收據')).toBeInTheDocument();
    expect(screen.getByText(/不是經 GitHub 驗證的即時事實/)).toBeInTheDocument();
    for (const limitation of applied.application.limitations) {
      expect(screen.getByText(limitation)).toBeInTheDocument();
    }
    expect(screen.queryByText('GitHub Lists 已套用')).not.toBeInTheDocument();
  });

  it('fails closed when generated provenance metadata is incomplete', async () => {
    const incomplete = {
      ...structuredClone(provenanceFixture),
      semantic: { ...structuredClone(provenanceFixture.semantic), limitations: [] }
    };
    stubReportData(fixture, incomplete);
    renderRoute('/');
    expect(await screen.findByRole('heading', { name: 'Stars analysis could not be loaded' })).toBeInTheDocument();
    expect(screen.getByText(/semantic limitations must contain all disclosed/i)).toBeInTheDocument();
  });

  it('rejects changed analysis bytes even when account and generated time still match provenance', async () => {
    const tampered = structuredClone(fixture);
    tampered.repositories[0].memberships[0].reason = 'A changed reason with the same account and generated timestamp.';
    stubReportData(tampered, provenanceFixture, fixture);
    renderRoute('/repositories/acme/agent-studio');
    expect(await screen.findByRole('heading', { name: 'Stars analysis could not be loaded' })).toBeInTheDocument();
    expect(screen.getByText(/exact bytes do not match report provenance/i)).toBeInTheDocument();
    expect(screen.queryByText(tampered.repositories[0].memberships[0].reason)).not.toBeInTheDocument();
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
