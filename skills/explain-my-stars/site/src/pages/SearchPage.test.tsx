import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate
} from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../data';
import { fixture } from '../test/fixture';
import type { Repository, StarsAnalysis } from '../types';
import { SearchPage } from './SearchPage';

interface VirtualizedMatch {
  repository: Repository;
  reason?: string;
}

vi.mock('react-virtuoso', () => ({
  Virtuoso: ({
    data,
    itemContent
  }: {
    data: VirtualizedMatch[];
    itemContent: (index: number, match: VirtualizedMatch) => ReactNode;
  }) => (
    <div data-testid="virtualized-search-results" data-result-count={data.length}>
      {data[0] ? <div>{itemContent(0, data[0])}</div> : null}
      {data.length > 1 ? <div>{itemContent(data.length - 1, data[data.length - 1])}</div> : null}
    </div>
  )
}));

function largeSearchFixture(): StarsAnalysis {
  const analysis = structuredClone(fixture);
  analysis.lists[0].name = 'Common Agent Workflows';
  analysis.lists[1].description = 'Common interface tools.';
  analysis.repositories = Array.from({ length: 5000 }, (_, index) => {
    const suffix = String(index).padStart(4, '0');
    return {
      full_name: `owner/common-repository-${suffix}`,
      url: `https://github.com/owner/common-repository-${suffix}`,
      description: `Common repository ${suffix}`,
      memberships: [{ list_id: 'agents', reason: 'A common reusable workflow.' }]
    };
  });
  analysis.account.star_count = analysis.repositories.length;
  return analysis;
}

function HistoryHarness() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <SearchPage />
      <span data-testid="location">{`${location.pathname}${location.search}`}</span>
      <button type="button" onClick={() => navigate(-1)}>Back</button>
    </>
  );
}

function renderSearch(analysis: StarsAnalysis, initialEntry: string) {
  const analysisBytes = new TextEncoder().encode(JSON.stringify(analysis));
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (!String(input).endsWith('/data/report-provenance.json')) {
      return { ok: true, arrayBuffer: async () => analysisBytes.slice().buffer };
    }
    const digest = await globalThis.crypto.subtle.digest('SHA-256', analysisBytes);
    const starsAnalysisSha256 = Array.from(
      new Uint8Array(digest),
      (byte) => byte.toString(16).padStart(2, '0')
    ).join('');
    return {
      ok: true,
      json: async () => ({
      schema_version: '1.0',
      source: {
        account_login: analysis.account.login,
        generated_at: analysis.generated_at,
        stars_analysis_bytes_sha256: starsAnalysisSha256
      },
      semantic: {
        validation_status: 'passed',
        candidate_sha256: '2'.repeat(64),
        plan_sha256: '3'.repeat(64),
        collection_receipt_sha256: '4'.repeat(64),
        execution_receipts_sha256: '5'.repeat(64),
        validation_receipt_sha256: '6'.repeat(64),
        limitations: ['Offline semantic validation has external limits.']
      },
      application: {
        status: 'planned',
        claim_basis: 'no-application-receipt',
        receipt_sha256: null,
        validation_receipt_sha256: null,
        final_state_sha256: null,
        limitations: []
      }
      })
    };
  }));
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="search" element={<DataProvider><HistoryHarness /></DataProvider>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('full search results', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('virtualizes a long repository result set without truncating its count', async () => {
    renderSearch(largeSearchFixture(), '/search?q=common');

    const virtualized = await screen.findByTestId('virtualized-search-results');
    expect(virtualized).toHaveAttribute('data-result-count', '5000');
    expect(screen.getByRole('heading', { name: '5000 個結果' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '2 個結果' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /owner\/common-repository-4999/ })).toBeInTheDocument();

    const status = screen.getByText('「common」有 5000 個 repository 結果與 2 個 List 結果。');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveAttribute('aria-atomic', 'true');
    expect(status).toHaveTextContent('「common」有 5000 個 repository 結果與 2 個 List 結果');
  });

  it('keeps the submitted query in the URL and restores it on Back', async () => {
    const user = userEvent.setup();
    renderSearch(fixture, '/search?q=agent');

    const input = await screen.findByRole('textbox', { name: '搜尋 Stars 資料庫' });
    expect(input).toHaveValue('agent');

    await user.clear(input);
    await user.type(input, 'visual');
    await user.click(screen.getByRole('button', { name: '搜尋' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/search?q=visual');

    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/search?q=agent'));
    await waitFor(() => expect(input).toHaveValue('agent'));
  });
});
