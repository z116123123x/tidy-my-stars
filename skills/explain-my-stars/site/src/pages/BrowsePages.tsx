import { ArrowRight, ExternalLink, Filter, Layers3, Search, ShieldAlert } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Virtuoso } from 'react-virtuoso';
import { PageHeader } from '../components/PageHeader';
import { RepositoryRow } from '../components/RepositoryRow';
import { useReport } from '../data';
import { listRoute, repositoryRoute } from '../domain/model';
import { uiText } from '../i18n';
import type { Repository } from '../types';

export function RepositoriesPage() {
  const { model, search } = useReport();
  const t = (english: string, traditionalChinese: string) => uiText(model.analysis.locale, english, traditionalChinese);
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const listId = params.get('list') ?? '';
  const sort = params.get('sort') ?? 'az';

  const repositories = useMemo(() => {
    const queryMatches = query
      ? search(query).filter((result) => result.item.kind === 'repository').map((result) => model.repositoriesByName.get(result.item.id)!)
      : [...model.analysis.repositories];
    const filtered = listId
      ? queryMatches.filter((repository) => repository.memberships.some((membership) => membership.list_id === listId))
      : queryMatches;
    filtered.sort((a, b) => sort === 'za'
      ? b.full_name.localeCompare(a.full_name)
      : a.full_name.localeCompare(b.full_name));
    return filtered;
  }, [listId, model, query, search, sort]);

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    setParams(next);
  };

  return (
    <div className="page page--directory">
      <PageHeader eyebrow={t('Repository directory', 'Repository 目錄')} title={t('All repositories', '所有 repositories')} description={t('A compact, searchable index. Open one repository to see its complete classification and review context.', '精簡且可搜尋的索引。開啟任一 repository，即可查看完整分類與複核脈絡。')} crumbs={[{ label: 'Repositories' }]} />
      <section className="directory-toolbar" aria-label={t('Repository filters', 'Repository 篩選')}>
        <label className="toolbar-search"><Search aria-hidden="true" size={18} /><span className="sr-only">{t('Filter repositories', '篩選 repositories')}</span><input value={query} onChange={(event) => update('q', event.target.value)} placeholder={t('Filter this directory…', '篩選此目錄…')} /></label>
        <label><Filter aria-hidden="true" size={17} /><span className="sr-only">{t('Filter by List', '依 List 篩選')}</span><select value={listId} onChange={(event) => update('list', event.target.value)}><option value="">{t('All Lists', '所有 Lists')}</option>{model.classificationLists.map((list) => <option value={list.id} key={list.id}>{list.name}</option>)}</select></label>
        <label><span className="sr-only">Sort order</span><select value={sort} onChange={(event) => update('sort', event.target.value)}><option value="az">A → Z</option><option value="za">Z → A</option></select></label>
      </section>
      <div className="directory-status" role="status">{t('', '顯示 ')}<strong>{repositories.length}</strong>{t(` of ${model.analysis.repositories.length} repositories`, ` / ${model.analysis.repositories.length} 個 repositories`)}</div>
      <section className="virtual-directory" aria-label={t('Repository results', 'Repository 結果')}>
        {repositories.length ? (
          <Virtuoso
            data={repositories}
            increaseViewportBy={320}
            itemContent={(_, repository) => <RepositoryRow repository={repository} />}
          />
        ) : <div className="empty-panel"><Search aria-hidden="true" /><h2>{t('No repositories found', '找不到 repository')}</h2><p>{t('Remove a filter or try a broader phrase.', '移除篩選條件，或改用更廣泛的詞。')}</p><button type="button" onClick={() => setParams({})}>{t('Clear filters', '清除篩選')}</button></div>}
      </section>
    </div>
  );
}

export function ListsPage() {
  const { model } = useReport();
  const t = (english: string, traditionalChinese: string) => uiText(model.analysis.locale, english, traditionalChinese);
  const [params, setParams] = useSearchParams();
  const query = (params.get('q') ?? '').toLocaleLowerCase(model.analysis.locale);
  const lists = model.classificationLists.filter((list) => `${list.name} ${list.description}`.toLocaleLowerCase(model.analysis.locale).includes(query));

  return (
    <div className="page">
      <PageHeader eyebrow={t('Purpose directory', '用途目錄')} title="Lists" description={t('Each List answers one useful browsing question. A repository can appear in several Lists when it serves several independent purposes.', '每個 List 都回答一個實用的瀏覽問題；當 repository 有多個獨立用途時，可以同時出現在多個 Lists。')} crumbs={[{ label: 'Lists' }]} actions={<div className="count-badge">{t(`${model.classificationLists.length} topic Lists`, `${model.classificationLists.length} 個主題 Lists`)}</div>} />
      <label className="standalone-filter"><Search aria-hidden="true" size={18} /><span className="sr-only">{t('Filter Lists', '篩選 Lists')}</span><input value={params.get('q') ?? ''} onChange={(event) => setParams(event.target.value ? { q: event.target.value } : {})} placeholder={t('Find a List…', '尋找 List…')} /></label>
      <div className="directory-status" role="status">{t('', '顯示 ')}<strong>{lists.length}</strong>{t(` of ${model.classificationLists.length} Lists`, ` / ${model.classificationLists.length} 個 Lists`)}</div>
      <section className="list-directory" aria-label={t('Classification Lists', '分類 Lists')}>
        {lists.map((list, index) => (
          <Link to={listRoute(list)} key={list.id} className="list-directory-row">
            <span className="list-directory-row__index">{String(index + 1).padStart(2, '0')}</span>
            <span className="list-directory-row__body"><strong>{list.name}</strong><small>{list.description}</small></span>
            <span className="list-directory-row__count">{model.repositoriesByList.get(list.id)?.length ?? 0}<small>repos</small></span>
            <ArrowRight aria-hidden="true" size={18} />
          </Link>
        ))}
        {!lists.length ? <div className="empty-panel"><h2>{t('No Lists found', '找不到 List')}</h2><p>{t('Try a broader phrase or clear the filter.', '請改用更廣泛的詞，或清除篩選。')}</p><button type="button" onClick={() => setParams({})}>{t('Clear filter', '清除篩選')}</button></div> : null}
      </section>
      <aside className="review-callout">
        <ShieldAlert aria-hidden="true" />
        <div><p className="eyebrow">{t('Separate review workflow', '獨立的複核流程')}</p><h2>{t('Star Review is not a topic List', 'Star 複核不是主題 List')}</h2><p>{t('It remains separate because it asks for a decision, not a browsing purpose.', '它要求使用者做決定，而不是提供瀏覽用途，因此保持獨立。')}</p></div>
        <Link className="button button--secondary" to="/review">{t('Open review queue', '開啟複核佇列')}</Link>
      </aside>
    </div>
  );
}

export function ListDetailPage() {
  const { model } = useReport();
  const t = (english: string, traditionalChinese: string) => uiText(model.analysis.locale, english, traditionalChinese);
  const { listId = '' } = useParams();
  const list = model.listsById.get(listId);
  if (!list || list.kind !== 'classification') return <NotFound title={t('List not found', '找不到此 List')} />;
  const repositories = model.repositoriesByList.get(list.id) ?? [];

  const related = model.classificationLists
    .filter((candidate) => candidate.id !== list.id)
    .map((candidate) => ({
      list: candidate,
      overlap: (model.repositoriesByList.get(candidate.id) ?? []).filter((repository) => repositories.some((member) => member.full_name === repository.full_name)).length
    }))
    .filter((item) => item.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, 5);

  return (
    <div className="page">
      <PageHeader eyebrow={t('List detail', 'List 詳情')} title={list.name} description={list.description} crumbs={[{ label: 'Lists', to: '/lists' }, { label: list.name }]} actions={<div className="count-badge">{repositories.length} repositories</div>} />
      <div className="detail-layout">
        <section className="detail-main" aria-labelledby="members-heading">
          <div className="section-heading"><p className="eyebrow">{t('Members', '成員')}</p><h2 id="members-heading">{t('Why each repository belongs here', '每個 repository 為什麼屬於這裡')}</h2></div>
          <div className="repository-list repository-list--reasons">
            {repositories.map((repository) => <RepositoryRow key={repository.full_name} repository={repository} reason={repository.memberships.find((membership) => membership.list_id === list.id)?.reason} />)}
          </div>
        </section>
        <aside className="detail-aside">
          <p className="eyebrow">{t('Common crossings', '常見重疊')}</p>
          <h2>{t('Related Lists', '相關 Lists')}</h2>
          <p>{t('Repositories in this List also appear in these purposes most often.', '這個 List 的 repositories 最常同時出現在下列用途。')}</p>
          <div className="related-list-links">
            {related.map((item) => <Link key={item.list.id} to={listRoute(item.list)}><span>{item.list.name}</span><small>{t(`${item.overlap} shared`, `${item.overlap} 個重疊`)}</small></Link>)}
          </div>
        </aside>
      </div>
    </div>
  );
}

export function RepositoryDetailPage() {
  const { model } = useReport();
  const t = (english: string, traditionalChinese: string) => uiText(model.analysis.locale, english, traditionalChinese);
  const { owner = '', name = '' } = useParams();
  const fullName = `${owner}/${name}`;
  const repository = model.repositoriesByName.get(fullName);
  if (!repository) return <NotFound title={t('Repository not found', '找不到此 repository')} />;
  const classificationMemberships = repository.memberships.filter((membership) => model.listsById.get(membership.list_id)?.kind === 'classification');
  const reviewMembership = repository.memberships.find((membership) => model.listsById.get(membership.list_id)?.kind === 'review-queue');
  const sourceListIds = new Set(classificationMemberships.map((membership) => membership.list_id));
  const related = model.analysis.repositories
    .filter((candidate) => candidate.full_name !== repository.full_name)
    .map((candidate) => ({
      repository: candidate,
      lists: candidate.memberships
        .map((membership) => model.listsById.get(membership.list_id))
        .filter((list) => list?.kind === 'classification' && sourceListIds.has(list.id))
    }))
    .filter((item) => item.lists.length > 0)
    .sort((a, b) => b.lists.length - a.lists.length || a.repository.full_name.localeCompare(b.repository.full_name))
    .slice(0, 6);

  return (
    <div className="page">
      <PageHeader
        eyebrow={t('Repository detail', 'Repository 詳情')}
        title={repository.full_name}
        description={repository.description || t('No repository description was available.', '沒有可用的 repository 說明。')}
        crumbs={[{ label: 'Repositories', to: '/repositories' }, { label: repository.full_name }]}
        monospaceTitle
        actions={<a className="button button--primary" href={repository.url} target="_blank" rel="noreferrer noopener">{t('Open GitHub', '在 GitHub 開啟')} <ExternalLink aria-hidden="true" size={16} /></a>}
      />
      {reviewMembership ? <section className="repository-review-banner"><ShieldAlert aria-hidden="true" /><div><p className="eyebrow">{t('AI review suggestion', 'AI 複核建議')}</p><h2>{t('Star Review', 'Star 複核')}</h2><p>{reviewMembership.reason}</p><small>{t('This is a suggestion for you to inspect, not an automatic unstar.', '這只是請你檢視的建議，不會自動 unstar。')}</small></div><Link to={`/review/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`}>{t('Review in context', '前往複核')} <ArrowRight size={16} /></Link></section> : null}
      <div className="detail-layout">
        <section className="detail-main" aria-labelledby="membership-heading">
          <div className="section-heading"><p className="eyebrow">{t('Classification', '分類')}</p><h2 id="membership-heading">{t('Where it belongs—and why', '它屬於哪些 Lists，以及原因')}</h2><p>{t(`${classificationMemberships.length} supported browsing ${classificationMemberships.length === 1 ? 'purpose' : 'purposes'}.`, `${classificationMemberships.length} 個有根據的瀏覽用途。`)}</p></div>
          <div className="membership-stack">
            {classificationMemberships.map((membership) => {
              const list = model.listsById.get(membership.list_id)!;
              return <article className="membership-card" key={membership.list_id}><div><Layers3 aria-hidden="true" /><span>List</span></div><h3><Link to={listRoute(list)}>{list.name}</Link></h3><p>{membership.reason}</p><Link className="text-link" to={listRoute(list)}>{t(`See all ${model.repositoriesByList.get(list.id)?.length ?? 0} repositories`, `查看全部 ${model.repositoriesByList.get(list.id)?.length ?? 0} 個 repositories`)} <ArrowRight size={15} /></Link></article>;
            })}
            {!classificationMemberships.length ? <div className="empty-panel"><h2>{t('Not classified', '尚未分類')}</h2><p>{repository.unclassified_reason}</p></div> : null}
          </div>
        </section>
        <aside className="detail-aside">
          <p className="eyebrow">{t('More from the same Lists', '同 Lists 的其他項目')}</p><h2>{t('Same-List repositories', '同 List repositories')}</h2><p>{t('These appear in one or more of the same classification Lists.', '這些 repositories 出現在一個或多個相同的分類 Lists。')}</p>
          <div className="related-repositories">{related.map((item) => <Link key={item.repository.full_name} to={repositoryRoute(item.repository)}><bdi dir="auto">{item.repository.full_name}</bdi><small>{item.lists.map((list) => list!.name).join(' · ')}</small></Link>)}</div>
        </aside>
      </div>
    </div>
  );
}

function NotFound({ title }: { title: string }) {
  const { model } = useReport();
  const t = (english: string, traditionalChinese: string) => uiText(model.analysis.locale, english, traditionalChinese);
  return <div className="page"><PageHeader eyebrow="404" title={title} description={t('The requested destination is not part of this frozen analysis.', '要求的目的地不在這次凍結的分析中。')} /><Link className="button button--primary" to="/sitemap">{t('Open site map', '開啟站點地圖')}</Link></div>;
}
