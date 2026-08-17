import { ArrowRight, FolderTree, Library, Search, ShieldAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useReport } from '../data';
import { listRoute } from '../domain/model';
import { uiText } from '../i18n';

export function OverviewPage() {
  const { model } = useReport();
  const t = (english: string, traditionalChinese: string) => uiText(model.analysis.locale, english, traditionalChinese);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [showChart, setShowChart] = useState(() => (
    typeof window.matchMedia !== 'function' || window.matchMedia('(min-width: 621px)').matches
  ));
  useEffect(() => {
    window.scrollTo(0, 0);
    headingRef.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia('(min-width: 621px)');
    const update = () => setShowChart(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const topLists = model.classificationLists.slice(0, 8);
  const chartData = topLists.map((list) => ({
    id: list.id,
    name: list.name,
    shortName: list.name.length > 22 ? `${list.name.slice(0, 20)}…` : list.name,
    repositories: model.repositoriesByList.get(list.id)?.length ?? 0
  }));

  return (
    <div className="page page--overview">
      <section className="overview-hero">
        <div className="overview-hero__copy">
          <p className="eyebrow">{t('GitHub Stars · organized library', 'GitHub Stars · 分類資料庫')}</p>
          <h1 ref={headingRef} tabIndex={-1} data-page-heading>{t('Your GitHub Stars, mapped and searchable.', 'GitHub Stars 整理報告')}</h1>
          <p>
            {t('', '共有 ')}<strong>{model.analysis.repositories.length}</strong>{t(' repositories are organized into ', ' 個 repositories，整理成 ')}
            <strong>{model.classificationLists.length}</strong>{t(' useful, overlapping Lists. Search across names, descriptions, Lists, and every classification reason.', ' 個清楚且可重疊的 Lists。可搜尋名稱、說明、List 與每一條分類理由。')}
          </p>
          <div className="hero-actions">
            <Link className="button button--primary" to="/search"><Search aria-hidden="true" size={18} />{t('Search everything', '搜尋全部內容')}</Link>
            <Link className="button button--secondary" to="/sitemap">{t('See the site map', '查看站點地圖')}<ArrowRight aria-hidden="true" size={17} /></Link>
          </div>
        </div>
        <dl className="overview-ledger" aria-label={t('Collection summary', '收藏摘要')}>
          <div><dt>Repositories</dt><dd>{model.analysis.repositories.length}</dd></div>
          <div><dt>Lists</dt><dd>{model.analysis.lists.length}<small>{t(`${model.classificationLists.length} topics + 1 review queue`, `${model.classificationLists.length} 個主題 + 1 個審閱佇列`)}</small></dd></div>
          <div><dt>{t('Relationships', '歸屬關係')}</dt><dd>{model.classificationMembershipCount + model.reviewMembershipCount}<small>{t(`${model.overlapRepositoryCount} repos cross Lists`, `${model.overlapRepositoryCount} 個 repos 跨多個 Lists`)}</small></dd></div>
          <div className="overview-ledger__review"><dt>{model.reviewList.name}</dt><dd>{model.reviewRepositories.length}<small>{t('Review only; nothing is automatically unstarred', '只列入複核，不會自動取消收藏')}</small></dd></div>
        </dl>
      </section>

      <section className="route-cards" aria-labelledby="choose-path">
        <div className="section-heading">
          <p className="eyebrow">{t('Three ways in', '三個主要入口')}</p>
          <h2 id="choose-path">{t('Choose the job you are doing', '你現在想做什麼？')}</h2>
        </div>
        <div className="route-card-grid">
          <Link className="route-card" to="/repositories">
            <span className="route-card__icon"><Library aria-hidden="true" /></span>
            <span className="route-card__number">01</span>
            <strong>{t('Find a repository', '尋找 repository')}</strong>
            <p>{t('Browse A–Z or filter the full directory without opening every detail.', '用 A–Z、搜尋或篩選快速瀏覽，不必逐筆展開。')}</p>
            <span className="route-card__link">{t(`Browse ${model.analysis.repositories.length} repositories`, `瀏覽 ${model.analysis.repositories.length} 個 repositories`)} <ArrowRight size={16} /></span>
          </Link>
          <Link className="route-card" to="/lists">
            <span className="route-card__icon"><FolderTree aria-hidden="true" /></span>
            <span className="route-card__number">02</span>
            <strong>{t('Explore by purpose', '依用途探索')}</strong>
            <p>{t('Start with one clear topic, then see the repositories and reasons inside it.', '先選一個清楚的主題，再查看其中的 repositories 與分類理由。')}</p>
            <span className="route-card__link">{t(`Explore ${model.classificationLists.length} Lists`, `探索 ${model.classificationLists.length} 個 Lists`)} <ArrowRight size={16} /></span>
          </Link>
          <Link className="route-card route-card--review" to="/review">
            <span className="route-card__icon"><ShieldAlert aria-hidden="true" /></span>
            <span className="route-card__number">03</span>
            <strong>{t('Open Star Review', `開啟 ${model.reviewList.name}`)}</strong>
            <p>{t('Inspect one AI recommendation at a time. Nothing is automatically unstarred.', '一次查看一個 AI 建議；不會自動 unstar。')}</p>
            <span className="route-card__link">{t(`Review ${model.reviewRepositories.length} suggestions`, `複核 ${model.reviewRepositories.length} 個建議`)} <ArrowRight size={16} /></span>
          </Link>
        </div>
      </section>

      <section className="overview-grid">
        <div className="panel panel--chart">
          <div className="section-heading section-heading--row">
            <div><p className="eyebrow">{t('Collection shape', '收藏分布')}</p><h2>{t('Largest Lists', '最大的 Lists')}</h2></div>
            <Link to="/lists">{t('All Lists', '所有 Lists')} <ArrowRight size={15} /></Link>
          </div>
          <div className="chart-frame" role="img" aria-label={t('Repository counts for the eight largest Lists', '八個最大 Lists 的 repository 數量')}>
            {showChart ? <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 18, bottom: 4, left: 6 }}>
                <XAxis type="number" hide />
                <YAxis dataKey="shortName" type="category" width={150} axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: 'var(--text-muted)' }} />
                <Tooltip cursor={{ fill: 'var(--surface-subtle)' }} contentStyle={{ borderRadius: 10, border: '1px solid var(--border)' }} />
                <Bar dataKey="repositories" fill="var(--accent)" radius={[0, 5, 5, 0]} barSize={14} />
              </BarChart>
            </ResponsiveContainer> : null}
          </div>
          <ol className="sr-only">
            {chartData.map((item) => <li key={item.id}>{item.name}: {item.repositories} repositories</li>)}
          </ol>
        </div>
        <div className="panel panel--map-preview">
          <div className="section-heading"><p className="eyebrow">{t('Where things live', '內容在哪裡')}</p><h2>{t('Site map', '站點地圖')}</h2></div>
          <ol className="map-preview">
            <li><Link to="/search"><span>{t('Search', '搜尋')}</span><small>{t('Everything, from anywhere', '從任何地方搜尋全部內容')}</small></Link></li>
            <li><Link to="/repositories"><span>Repositories</span><small>{t('Directory → repository detail', '目錄 → repository 詳情')}</small></Link></li>
            <li><Link to="/lists"><span>Lists</span><small>{t('Purpose → List detail → repo', '用途 → List 詳情 → repo')}</small></Link></li>
            <li><Link to="/review"><span>{model.reviewList.name}</span><small>{t('Queue → one review decision', '佇列 → 單筆複核決定')}</small></Link></li>
          </ol>
          <Link className="text-link" to="/sitemap">{t('Open the complete map', '開啟完整地圖')} <ArrowRight size={15} /></Link>
        </div>
      </section>

      <section className="top-list-table" aria-labelledby="top-lists-heading">
        <div className="section-heading section-heading--row"><div><p className="eyebrow">{t('Start with a topic', '從主題開始')}</p><h2 id="top-lists-heading">{t('Lists with the most repositories', '包含最多 repositories 的 Lists')}</h2></div></div>
        <div className="table-rows">
          {topLists.slice(0, 5).map((list, index) => (
            <Link key={list.id} to={listRoute(list)} className="table-row">
              <span className="table-row__index">{String(index + 1).padStart(2, '0')}</span>
              <span><strong>{list.name}</strong><small>{list.description}</small></span>
              <span className="table-row__count">{model.repositoriesByList.get(list.id)?.length ?? 0}</span>
              <ArrowRight aria-hidden="true" size={17} />
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
