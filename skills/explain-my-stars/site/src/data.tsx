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
import type { ReportModel, ReportProvenance, SearchDocument, StarsAnalysis } from './types';

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

const sha256 = /^[a-f0-9]{64}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(value: Record<string, unknown>, expected: string[], path: string) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${path} has unsupported or missing fields.`);
  }
}

function assertHash(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || !sha256.test(value)) throw new Error(`${path} is not a SHA-256 hash.`);
}

function assertLimitations(value: unknown, path: string, { required }: { required: boolean }): asserts value is string[] {
  if (!Array.isArray(value)
      || value.some((item) => typeof item !== 'string' || !item.trim())
      || new Set(value).size !== value.length
      || (required && value.length === 0)) {
    throw new Error(`${path} must contain ${required ? 'all disclosed ' : ''}unique nonblank limitations.`);
  }
}

export function assertReportProvenance(value: unknown, analysis?: StarsAnalysis): asserts value is ReportProvenance {
  if (!isRecord(value)) throw new Error('Report provenance payload is not an object.');
  assertExactKeys(value, ['schema_version', 'source', 'semantic', 'application'], 'Report provenance');
  if (value.schema_version !== '1.0') throw new Error('Unsupported report provenance schema.');

  if (!isRecord(value.source)) throw new Error('Report provenance source is incomplete.');
  assertExactKeys(value.source, ['account_login', 'generated_at', 'stars_analysis_bytes_sha256'], 'Report provenance source');
  if (analysis && (value.source.account_login !== analysis.account.login || value.source.generated_at !== analysis.generated_at)) {
    throw new Error('Report provenance does not describe this frozen analysis.');
  }
  assertHash(value.source.stars_analysis_bytes_sha256, 'Report provenance analysis hash');

  if (!isRecord(value.semantic)) throw new Error('Report provenance semantic validation is incomplete.');
  assertExactKeys(value.semantic, [
    'validation_status', 'candidate_sha256', 'plan_sha256', 'collection_receipt_sha256',
    'execution_receipts_sha256', 'validation_receipt_sha256', 'limitations'
  ], 'Report provenance semantic validation');
  if (value.semantic.validation_status !== 'passed') throw new Error('Report provenance semantic validation did not pass.');
  for (const field of [
    'candidate_sha256', 'plan_sha256', 'collection_receipt_sha256',
    'execution_receipts_sha256', 'validation_receipt_sha256'
  ] as const) assertHash(value.semantic[field], `Report provenance semantic ${field}`);
  assertLimitations(value.semantic.limitations, 'Report provenance semantic limitations', { required: true });

  if (!isRecord(value.application)) throw new Error('Report provenance application state is incomplete.');
  assertExactKeys(value.application, [
    'status', 'claim_basis', 'receipt_sha256', 'validation_receipt_sha256',
    'final_state_sha256', 'limitations'
  ], 'Report provenance application state');
  if (value.application.status === 'planned') {
    if (value.application.claim_basis !== 'no-application-receipt'
        || value.application.receipt_sha256 !== null
        || value.application.validation_receipt_sha256 !== null
        || value.application.final_state_sha256 !== null) {
      throw new Error('Planned report provenance must not claim application evidence.');
    }
    assertLimitations(value.application.limitations, 'Report provenance application limitations', { required: false });
    if (value.application.limitations.length !== 0) {
      throw new Error('Planned report provenance must not attribute limitations to a missing application receipt.');
    }
  } else if (value.application.status === 'applied') {
    if (value.application.claim_basis !== 'validated-external-receipt') {
      throw new Error('Applied report provenance must identify a validated external receipt claim.');
    }
    assertHash(value.application.receipt_sha256, 'Report provenance application receipt hash');
    assertHash(value.application.validation_receipt_sha256, 'Report provenance application validation hash');
    assertHash(value.application.final_state_sha256, 'Report provenance final-state hash');
    assertLimitations(value.application.limitations, 'Report provenance application limitations', { required: true });
  } else {
    throw new Error('Unsupported report provenance application status.');
  }
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto SHA-256 is unavailable; exact analysis provenance cannot be verified.');
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function parseExactAnalysis(buffer: ArrayBuffer): unknown {
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer);
  } catch {
    throw new Error('Analysis bytes are not valid exact UTF-8.');
  }
  try {
    return JSON.parse(source) as unknown;
  } catch {
    throw new Error('Analysis bytes are not valid JSON.');
  }
}

function freezeProvenance(provenance: ReportProvenance): ReportProvenance {
  Object.freeze(provenance.semantic.limitations);
  Object.freeze(provenance.application.limitations);
  Object.freeze(provenance.source);
  Object.freeze(provenance.semantic);
  Object.freeze(provenance.application);
  return Object.freeze(provenance);
}

export function DataProvider({ children }: PropsWithChildren) {
  const [report, setReport] = useState<{ analysis: StarsAnalysis; provenance: ReportProvenance } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const baseUrl = `${import.meta.env.BASE_URL}data/`;
    Promise.all([
      fetch(`${baseUrl}stars-analysis.json`, { signal: controller.signal }),
      fetch(`${baseUrl}report-provenance.json`, { signal: controller.signal })
    ])
      .then(async ([analysisResponse, provenanceResponse]) => {
        if (!analysisResponse.ok) throw new Error(`Unable to load analysis (${analysisResponse.status}).`);
        if (!provenanceResponse.ok) throw new Error(`Unable to load report provenance (${provenanceResponse.status}).`);
        const analysisBuffer = await analysisResponse.arrayBuffer();
        const provenanceValue: unknown = await provenanceResponse.json();
        assertReportProvenance(provenanceValue);
        const analysisSha256 = await sha256Hex(analysisBuffer);
        if (analysisSha256 !== provenanceValue.source.stars_analysis_bytes_sha256) {
          throw new Error('Analysis exact bytes do not match report provenance.');
        }
        const analysisValue = parseExactAnalysis(analysisBuffer);
        assertAnalysis(analysisValue);
        assertReportProvenance(provenanceValue, analysisValue);
        setReport({ analysis: analysisValue, provenance: freezeProvenance(provenanceValue) });
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => controller.abort();
  }, []);

  const value = useMemo<DataContextValue | null>(() => {
    if (!report) return null;
    const { analysis, provenance } = report;
    const model = buildReportModel(analysis, provenance);
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
  }, [report]);

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
