import { describe, expect, it } from 'vitest';
import { buildReportModel, createSearchDocuments, listRoute, literalSearchRank, repositoryRoute, reviewRoute } from './model';
import { fixture, provenanceFixture } from '../test/fixture';

describe('report model', () => {
  it('derives exact overlapping and review counts without changing analysis', () => {
    const model = buildReportModel(fixture, provenanceFixture);
    expect(model.classificationLists).toHaveLength(2);
    expect(model.reviewRepositories.map((repository) => repository.full_name)).toEqual(['acme/old-agent']);
    expect(model.classificationMembershipCount).toBe(3);
    expect(model.reviewMembershipCount).toBe(1);
    expect(model.overlapRepositoryCount).toBe(1);
    expect(model.repositoriesByList.get('agents')).toHaveLength(2);
  });

  it('indexes names, Lists, descriptions, and exact reasons', () => {
    const model = buildReportModel(fixture, provenanceFixture);
    const documents = createSearchDocuments(model);
    const repository = documents.find((document) => document.id === 'acme/agent-studio');
    expect(repository?.searchable).toContain('visual agent workflow studio');
    expect(repository?.searchable).toContain('Agent Workflows');
    expect(repository?.searchable).toContain('reusable multi-step agent workflow');
    expect(documents.find((document) => document.id === 'fixture/unclassified')?.searchable)
      .toContain('Evidence does not support a durable browsing purpose.');
  });

  it('creates stable deep-link routes', () => {
    const model = buildReportModel(fixture, provenanceFixture);
    const repository = model.repositoriesByName.get('acme/agent-studio')!;
    expect(repositoryRoute(repository)).toBe('/repositories/acme/agent-studio');
    expect(reviewRoute(repository)).toBe('/review/acme/agent-studio');
    expect(listRoute(model.listsById.get('agents')!)).toBe('/lists/agents');
    expect(listRoute(model.reviewList)).toBe('/review');
  });

  it('ranks an exact List title ahead of many repositories that merely belong to it', () => {
    const model = buildReportModel(fixture, provenanceFixture);
    const documents = createSearchDocuments(model);
    for (const listId of ['agents', 'likely-unstar']) {
      const listDocument = documents.find((document) => document.kind === 'list' && document.id === listId)!;
      const repositoryDocument = documents.find((document) => document.kind === 'repository')!;
      const crowded = Array.from({ length: 12 }, (_, index) => ({
        ...repositoryDocument,
        id: `crowded/repository-${index}`,
        title: `crowded/repository-${index}`,
        listNames: [listDocument.title],
        searchable: `crowded/repository-${index} ${listDocument.title}`
      }));
      const normalizedQuery = listDocument.title.normalize('NFKC').toLocaleLowerCase('en');
      const ranked = [...crowded, listDocument].sort((left, right) =>
        literalSearchRank(left, normalizedQuery, 'en') - literalSearchRank(right, normalizedQuery, 'en')
      );
      expect(ranked[0]).toBe(listDocument);
      expect(ranked.slice(0, 10)).toContain(listDocument);
    }
  });
});
