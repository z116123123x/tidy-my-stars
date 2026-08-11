import type { StarsAnalysis } from '../types';

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
