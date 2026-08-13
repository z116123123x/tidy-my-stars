import type {
  ReportModel,
  ReportProvenance,
  Repository,
  SearchDocument,
  StarsAnalysis,
  StarsList
} from '../types';

export function buildReportModel(analysis: StarsAnalysis, provenance: ReportProvenance): ReportModel {
  const listsById = new Map(analysis.lists.map((list) => [list.id, list]));
  const repositoriesByName = new Map(
    analysis.repositories.map((repository) => [repository.full_name, repository])
  );
  const repositoriesByList = new Map<string, Repository[]>();

  for (const list of analysis.lists) repositoriesByList.set(list.id, []);
  for (const repository of analysis.repositories) {
    for (const membership of repository.memberships) {
      repositoriesByList.get(membership.list_id)?.push(repository);
    }
  }

  for (const repositories of repositoriesByList.values()) {
    repositories.sort((a, b) => a.full_name.localeCompare(b.full_name));
  }

  const classificationLists = analysis.lists
    .filter((list) => list.kind === 'classification')
    .sort((a, b) => {
      const countDifference =
        (repositoriesByList.get(b.id)?.length ?? 0) -
        (repositoriesByList.get(a.id)?.length ?? 0);
      return countDifference || a.name.localeCompare(b.name);
    });
  const reviewList = analysis.lists.find((list) => list.kind === 'review-queue');
  if (!reviewList) throw new Error('The analysis does not contain a review queue.');

  const reviewRepositories = repositoriesByList.get(reviewList.id) ?? [];
  let classificationMembershipCount = 0;
  let reviewMembershipCount = 0;
  let overlapRepositoryCount = 0;

  for (const repository of analysis.repositories) {
    const classificationCount = repository.memberships.filter(
      (membership) => listsById.get(membership.list_id)?.kind === 'classification'
    ).length;
    classificationMembershipCount += classificationCount;
    reviewMembershipCount += repository.memberships.length - classificationCount;
    if (classificationCount > 1) overlapRepositoryCount += 1;
  }

  return {
    analysis,
    provenance,
    listsById,
    repositoriesByName,
    repositoriesByList,
    classificationLists,
    reviewList,
    reviewRepositories,
    classificationMembershipCount,
    reviewMembershipCount,
    overlapRepositoryCount
  };
}

export function repositoryRoute(repository: Repository): string {
  const [owner, name] = repository.full_name.split('/');
  return `/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

export function reviewRoute(repository: Repository): string {
  const [owner, name] = repository.full_name.split('/');
  return `/review/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

export function listRoute(list: StarsList): string {
  if (list.kind === 'review-queue') return '/review';
  return `/lists/${encodeURIComponent(list.id)}`;
}

export function literalSearchRank(item: SearchDocument, normalizedQuery: string, locale: string): number {
  const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase(locale);
  const title = normalize(item.title);
  if (title === normalizedQuery) return 0;
  if (title.startsWith(normalizedQuery)) return 1;
  if (title.includes(normalizedQuery)) return 2;
  if (item.listNames.some((name) => normalize(name) === normalizedQuery)) return 3;
  return 4;
}

export function createSearchDocuments(model: ReportModel): SearchDocument[] {
  const repositoryDocuments = model.analysis.repositories.map((repository) => {
    const lists = repository.memberships
      .map((membership) => model.listsById.get(membership.list_id))
      .filter((list): list is StarsList => Boolean(list));
    const reasons = repository.memberships.map((membership) => membership.reason);
    const listNames = lists.map((list) => list.name);
    const description = repository.description ?? '';
    const unclassifiedReason = repository.unclassified_reason ?? '';
    return {
      kind: 'repository' as const,
      id: repository.full_name,
      title: repository.full_name,
      description,
      listNames,
      reasons: unclassifiedReason ? [...reasons, unclassifiedReason] : reasons,
      searchable: [repository.full_name, description, ...listNames, ...reasons, unclassifiedReason].join(' ')
    };
  });

  const listDocuments = model.analysis.lists.map((list) => ({
    kind: 'list' as const,
    id: list.id,
    title: list.name,
    description: list.description,
    listNames: [list.name],
    reasons: [],
    searchable: `${list.name} ${list.description}`
  }));

  return [...repositoryDocuments, ...listDocuments];
}

export function sharedListScore(
  model: ReportModel,
  source: Repository,
  candidate: Repository
): number {
  if (source.full_name === candidate.full_name) return 0;
  const sourceLists = new Set(
    source.memberships
      .filter((membership) => model.listsById.get(membership.list_id)?.kind === 'classification')
      .map((membership) => membership.list_id)
  );
  return candidate.memberships.filter((membership) => sourceLists.has(membership.list_id)).length;
}
