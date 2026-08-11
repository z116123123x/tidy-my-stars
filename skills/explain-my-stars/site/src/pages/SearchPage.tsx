import { Search } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Virtuoso } from 'react-virtuoso';
import { RepositoryRow } from '../components/RepositoryRow';
import { PageHeader } from '../components/PageHeader';
import { useReport } from '../data';
import { listRoute } from '../domain/model';
import { uiText } from '../i18n';

const VIRTUALIZED_REPOSITORY_RESULT_THRESHOLD = 24;

export function SearchPage() {
  const { model, search } = useReport();
  const t = (english: string, traditionalChinese: string) => uiText(model.analysis.locale, english, traditionalChinese);
  const [params, setParams] = useSearchParams();
  const initialQuery = params.get('q') ?? '';
  const [draft, setDraft] = useState(initialQuery);
  useEffect(() => setDraft(initialQuery), [initialQuery]);
  const results = useMemo(() => search(initialQuery), [initialQuery, search]);
  const repositoryResults = useMemo(
    () => results.filter((result) => result.item.kind === 'repository'),
    [results]
  );
  const listResults = useMemo(
    () => results.filter((result) => result.item.kind === 'list'),
    [results]
  );
  const repositoryMatches = useMemo(() => {
    const normalizedQuery = initialQuery.toLocaleLowerCase(model.analysis.locale);
    return repositoryResults.map((result) => {
      const repository = model.repositoriesByName.get(result.item.id)!;
      const reason = repository.memberships.find((membership) =>
        membership.reason.toLocaleLowerCase(model.analysis.locale).includes(normalizedQuery)
      )?.reason;
      return { repository, reason };
    });
  }, [initialQuery, model, repositoryResults]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const query = draft.trim();
    setParams(query ? { q: query } : {});
  };

  return (
    <div className="page">
      <PageHeader eyebrow={t('Global discovery', '全域探索')} title={t('Search everything', '搜尋全部內容')} description={t('Repository names, descriptions, List names, and every exact classification reason are indexed together.', 'repository 名稱、說明、List 名稱與每一條完整分類理由都在同一個索引中。')} crumbs={[{ label: t('Search', '搜尋') }]} />
      <form className="search-page-form" role="search" onSubmit={submit}>
        <Search aria-hidden="true" size={21} />
        <label className="sr-only" htmlFor="site-search">{t('Search the Stars library', '搜尋 Stars 資料庫')}</label>
        <input id="site-search" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t('Try “voice”, “CAD”, “agent memory”…', '試試「voice」、「CAD」、「agent memory」…')} autoFocus />
        <button className="button button--primary" type="submit">{t('Search', '搜尋')}</button>
      </form>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {initialQuery ? t(
          `“${initialQuery}” has ${repositoryResults.length} repository ${repositoryResults.length === 1 ? 'result' : 'results'} and ${listResults.length} List ${listResults.length === 1 ? 'result' : 'results'}.`,
          `「${initialQuery}」有 ${repositoryResults.length} 個 repository 結果與 ${listResults.length} 個 List 結果。`
        ) : ''}
      </p>

      {!initialQuery ? (
        <section className="search-empty-state">
          <p className="eyebrow">{t('Search has context', '搜尋理解內容脈絡')}</p>
          <h2>{t('Use the words you remember', '輸入你記得的詞')}</h2>
          <p>{t('You do not need the exact repository name. Search a purpose, technology, List, or a phrase from the classification reason.', '不需要記得完整 repository 名稱；可搜尋用途、技術、List，或分類理由中的一句話。')}</p>
          <div className="search-suggestions">
            {['agent memory', 'voice', 'data visualization', 'self-hosted'].map((query) => <button key={query} type="button" onClick={() => { setDraft(query); setParams({ q: query }); }}>{query}</button>)}
          </div>
        </section>
      ) : (
        <div className="search-results-layout">
          <section aria-labelledby="repo-results-heading">
            <div className="section-heading section-heading--row"><div><p className="eyebrow">Repositories</p><h2 id="repo-results-heading">{t(`${repositoryResults.length} matches`, `${repositoryResults.length} 個結果`)}</h2></div></div>
            {repositoryMatches.length > VIRTUALIZED_REPOSITORY_RESULT_THRESHOLD ? (
              <div className="virtual-directory repository-list">
                <Virtuoso
                  data={repositoryMatches}
                  increaseViewportBy={320}
                  computeItemKey={(_, match) => match.repository.full_name}
                  itemContent={(_, match) => <RepositoryRow repository={match.repository} reason={match.reason} />}
                />
              </div>
            ) : (
              <div className="repository-list">
                {repositoryMatches.length ? repositoryMatches.map(({ repository, reason }) => (
                  <RepositoryRow key={repository.full_name} repository={repository} reason={reason} />
                )) : <p className="empty-inline">{t('No repository matches this search.', '找不到符合的 repository。')}</p>}
              </div>
            )}
          </section>
          <aside className="search-list-results" aria-labelledby="list-results-heading">
            <p className="eyebrow">Lists</p>
            <h2 id="list-results-heading">{t(`${listResults.length} matches`, `${listResults.length} 個結果`)}</h2>
            {listResults.length ? listResults.map((result) => {
              const list = model.listsById.get(result.item.id)!;
              return <Link key={list.id} to={listRoute(list)}><strong>{list.name}</strong><small>{model.repositoriesByList.get(list.id)?.length ?? 0} repositories</small></Link>;
            }) : <p>{t('No List name or description matched.', '沒有符合的 List 名稱或說明。')}</p>}
          </aside>
        </div>
      )}
    </div>
  );
}
