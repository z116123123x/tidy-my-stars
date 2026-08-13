export type ListKind = 'classification' | 'review-queue';

export interface StarsList {
  id: string;
  name: string;
  kind: ListKind;
  description: string;
}

export interface Membership {
  list_id: string;
  reason: string;
}

export interface Repository {
  full_name: string;
  url: string;
  description: string | null;
  memberships: Membership[];
  unclassified_reason?: string;
}

export interface StarsAnalysis {
  schema_version: '1.0';
  generated_at: string;
  locale: string;
  account: {
    login: string;
    star_count: number;
  };
  run: {
    likely_unstar_sensitivity: number;
    analysis_status: string;
    application_status: string;
  };
  lists: StarsList[];
  repositories: Repository[];
  validation: {
    coverage_status: string;
    semantic_review: string;
    notes: string[];
  };
}

export interface ReportProvenance {
  readonly schema_version: '1.0';
  readonly source: {
    readonly account_login: string;
    readonly generated_at: string;
    readonly stars_analysis_bytes_sha256: string;
  };
  readonly semantic: {
    readonly validation_status: 'passed';
    readonly candidate_sha256: string;
    readonly plan_sha256: string;
    readonly collection_receipt_sha256: string;
    readonly execution_receipts_sha256: string;
    readonly validation_receipt_sha256: string;
    readonly limitations: readonly string[];
  };
  readonly application: {
    readonly status: 'planned' | 'applied';
    readonly claim_basis: 'no-application-receipt' | 'validated-external-receipt';
    readonly receipt_sha256: string | null;
    readonly validation_receipt_sha256: string | null;
    readonly final_state_sha256: string | null;
    readonly limitations: readonly string[];
  };
}

export interface SearchDocument {
  kind: 'repository' | 'list';
  id: string;
  title: string;
  description: string;
  listNames: string[];
  reasons: string[];
  searchable: string;
}

export interface ReportModel {
  analysis: StarsAnalysis;
  provenance: ReportProvenance;
  listsById: Map<string, StarsList>;
  repositoriesByName: Map<string, Repository>;
  repositoriesByList: Map<string, Repository[]>;
  classificationLists: StarsList[];
  reviewList: StarsList;
  reviewRepositories: Repository[];
  classificationMembershipCount: number;
  reviewMembershipCount: number;
  overlapRepositoryCount: number;
}
