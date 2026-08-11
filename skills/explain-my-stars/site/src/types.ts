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
