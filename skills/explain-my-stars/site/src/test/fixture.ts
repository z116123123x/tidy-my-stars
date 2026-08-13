import type { ReportProvenance, StarsAnalysis } from '../types';

export const fixture: StarsAnalysis = {
  schema_version: '1.0',
  generated_at: '2026-08-09T00:00:00Z',
  locale: 'zh-TW',
  account: { login: 'fixture-user', star_count: 3 },
  run: {
    likely_unstar_sensitivity: 5,
    analysis_status: 'complete',
    application_status: 'planned'
  },
  lists: [
    { id: 'agents', name: 'Agent Workflows', kind: 'classification', description: 'Runnable agent systems.' },
    { id: 'design', name: 'Design Tools', kind: 'classification', description: 'Tools for interface design.' },
    { id: 'likely-unstar', name: 'Likely Unstar', kind: 'review-queue', description: 'Review suggestions.' }
  ],
  repositories: [
    {
      full_name: 'acme/agent-studio',
      url: 'https://github.com/acme/agent-studio',
      description: 'A visual agent workflow studio.',
      memberships: [
        { list_id: 'agents', reason: 'It provides a reusable multi-step agent workflow.' },
        { list_id: 'design', reason: 'It includes a visual interface for composing workflows.' }
      ]
    },
    {
      full_name: 'acme/old-agent',
      url: 'https://github.com/acme/old-agent',
      description: 'An early agent runner.',
      memberships: [
        { list_id: 'agents', reason: 'It remains an executable agent runner.' },
        { list_id: 'likely-unstar', reason: 'The project is superseded and has little distinct remaining value.' }
      ]
    },
    {
      full_name: 'fixture/unclassified',
      url: 'https://github.com/fixture/unclassified',
      description: null,
      memberships: [],
      unclassified_reason: 'Evidence does not support a durable browsing purpose.'
    }
  ],
  validation: { coverage_status: 'complete', semantic_review: 'passed', notes: [] }
};

export const provenanceFixture: ReportProvenance = {
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
};
