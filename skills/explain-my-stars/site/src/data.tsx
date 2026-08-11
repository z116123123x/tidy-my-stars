import Fuse, { type FuseResult } from 'fuse.js';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren
} from 'react';
import { buildReportModel, createSearchDocuments, literalSearchRank } from './domain/model';
import type { ReportModel, SearchDocument, StarsAnalysis } from './types';

interface DataContextValue {
  model: ReportModel;
  search: (query: string) => FuseResult<SearchDocument>[];
}

const DataContext = createContext<DataContextValue | null>(null);

function assertAnalysis(value: unknown): asserts value is StarsAnalysis {
  if (!value || typeof value !== 'object') throw new Error('Analysis payload is not an object.');
  const candidate = value as Partial<StarsAnalysis>;
  if (candidate.schema_version !== '1.0') throw new Error('Unsupported analysis schema.');
  if (!Array.isArray(candidate.lists) || !Array.isArray(candidate.repositories)) {
    throw new Error('Analysis payload is incomplete.');
  }
}

export function DataProvider({ children }: PropsWithChildren) {
  const [analysis, setAnalysis] = useState<StarsAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const dataUrl = `${import.meta.env.BASE_URL}data/stars-analysis.json`;
    fetch(dataUrl, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Unable to load analysis (${response.status}).`);
        const value: unknown = await response.json();
        assertAnalysis(value);
        setAnalysis(value);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => controller.abort();
  }, []);

  const value = useMemo<DataContextValue | null>(() => {
    if (!analysis) return null;
    const model = buildReportModel(analysis);
    const documents = createSearchDocuments(model);
    const fuse = new Fuse(documents, {
      keys: [
        { name: 'title', weight: 0.45 },
        { name: 'listNames', weight: 0.2 },
        { name: 'description', weight: 0.15 },
        { name: 'reasons', weight: 0.15 },
        { name: 'searchable', weight: 0.05 }
      ],
      threshold: 0.28,
      ignoreLocation: true,
      includeMatches: true,
      minMatchCharLength: 2
    });
    return {
      model,
      search(query) {
        const normalized = query.normalize('NFKC').toLocaleLowerCase(analysis.locale).trim();
        if (!normalized) return [];
        const literal = documents
          .map((item, refIndex) => ({ item, refIndex, score: 0 }))
          .filter((result) => result.item.searchable.normalize('NFKC').toLocaleLowerCase(analysis.locale).includes(normalized))
          .sort((left, right) =>
            literalSearchRank(left.item, normalized, analysis.locale) - literalSearchRank(right.item, normalized, analysis.locale) ||
            left.refIndex - right.refIndex
          );
        const literalIds = new Set(literal.map((result) => `${result.item.kind}:${result.item.id}`));
        const fuzzy = fuse.search(normalized).filter((result) => !literalIds.has(`${result.item.kind}:${result.item.id}`));
        return [...literal, ...fuzzy];
      }
    };
  }, [analysis]);

  if (error) {
    return (
      <main className="load-state load-state--error">
        <p className="eyebrow">Unable to open the library</p>
        <h1>Stars analysis could not be loaded</h1>
        <p>{error}</p>
        <p>Serve this generated directory through a local or hosted web server.</p>
      </main>
    );
  }

  if (!value) {
    return (
      <main className="load-state" aria-busy="true">
        <span className="loading-mark" aria-hidden="true" />
        <p>Loading Stars library…</p>
      </main>
    );
  }

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useReport(): DataContextValue {
  const value = useContext(DataContext);
  if (!value) throw new Error('useReport must be used within DataProvider.');
  return value;
}
