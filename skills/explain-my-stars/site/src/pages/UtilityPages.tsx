import { ArrowRight, Download, ExternalLink, FileJson, FolderTree, Library, Map, Printer, ShieldAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { useReport } from '../data';
import { listRoute, repositoryRoute } from '../domain/model';
import { uiText } from '../i18n';

const spreadsheetFormulaPrefix = /^(?:[\t\r\n]|[\t\r\n \u00ad\u034f\u180e\u200b-\u200f\u2060-\u2064\ufeff]*[=+\-@＝＋－＠])/u;

export function csvCell(value: string | number | null | undefined): string {
  const raw = String(value ?? '');
  const text = spreadsheetFormulaPrefix.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function SitemapPage() {
  const { model } = useReport();
  const t = (english: string, traditionalChinese: string) => uiText(model.analysis.locale, english, traditionalChinese);
  return (
    <div className="page">
      <PageHeader eyebrow={t('Information architecture', '資訊架構')} title={t('Site map', '站點地圖')} description={t('Every destination has one job. Use this map when you are unsure where a repository, reason, or review decision lives.', '每個目的地只有一個明確任務。不確定 repository、理由或複核決定在哪裡時，請使用這張地圖。')} crumbs={[{ label: t('Site map', '站點地圖') }]} />
      <section className="sitemap" aria-label={t('Site structure', '站點結構')}>
        <div className="sitemap-root"><span className="brand-mark" aria-hidden="true"><span /><span /><span /></span><div><strong>{t('Overview', '總覽')}</strong><small>{t('Collection shape and starting points', '收藏輪廓與主要入口')}</small></div></div>
        <div className="sitemap-branches">
          <article><Library aria-hidden="true" /><p className="eyebrow">{t('Find by identity', '依名稱尋找')}</p><h2><Link to="/repositories">Repositories</Link></h2><p>{t('A–Z and filtered directory.', 'A–Z 與可篩選目錄。')}</p><div className="sitemap-child"><span>{t(`${model.analysis.repositories.length} detail pages`, `${model.analysis.repositories.length} 個詳情頁`)}</span><small>{t('Description · classifications · reasons · related repos', '說明 · 分類 · 理由 · 相關 repos')}</small></div></article>
          <article><FolderTree aria-hidden="true" /><p className="eyebrow">{t('Find by purpose', '依用途尋找')}</p><h2><Link to="/lists">Lists</Link></h2><p>{t(`${model.classificationLists.length} independent browsing outcomes.`, `${model.classificationLists.length} 個獨立瀏覽用途。`)}</p><div className="sitemap-child"><span>{t(`${model.classificationLists.length} List pages`, `${model.classificationLists.length} 個 List 頁面`)}</span><small>{t('Description · members · reasons · related Lists', '說明 · 成員 · 理由 · 相關 Lists')}</small></div></article>
          <article className="sitemap-review"><ShieldAlert aria-hidden="true" /><p className="eyebrow">{t('Make a decision', '做出決定')}</p><h2><Link to="/review">{t('Star Review', 'Star 複核')}</Link></h2><p>{t(`${model.reviewRepositories.length} AI suggestions for human review.`, `${model.reviewRepositories.length} 個待人工複核的 AI 建議。`)}</p><div className="sitemap-child"><span>{t(`${model.reviewRepositories.length} review pages`, `${model.reviewRepositories.length} 個複核頁面`)}</span><small>{t('Concern · remaining value · local decision', '疑慮 · 剩餘價值 · 本機決定')}</small></div></article>
        </div>
        <div className="sitemap-utilities">
          <Link to="/search"><strong>{t('Global search', '全域搜尋')}</strong><small>{t('Crosses every repository, List, and reason', '涵蓋所有 repository、List 與理由')}</small><ArrowRight size={16} /></Link>
          <Link to="/methods"><strong>{t('Methods', '方法')}</strong><small>{t('Source, validation, boundaries, limitations', '來源、驗證、邊界與限制')}</small><ArrowRight size={16} /></Link>
          <Link to="/print"><strong>{t('Print & export', '列印與匯出')}</strong><small>{t('Complete flat view, CSV, and JSON', '完整平面檢視、CSV 與 JSON')}</small><ArrowRight size={16} /></Link>
        </div>
      </section>
    </div>
  );
}

export function MethodsPage() {
  const { model } = useReport();
  const t = (english: string, traditionalChinese: string) => uiText(model.analysis.locale, english, traditionalChinese);
  const provenance = model.provenance;
  const appliedClaim = provenance.application.status === 'applied';
  const applicationLabel = appliedClaim
    ? t('Applied claim — validated external receipt', '套用聲明 — 已驗證外部收據')
    : t('Planned — no application receipt', '規劃中 — 未提供套用收據');
  return (
    <div className="page">
      <PageHeader eyebrow={t('Provenance and boundaries', '來源與邊界')} title={t('Methods', '方法')} description={t('What this site knows, what it preserves, and what it never changes.', '這個網站知道什麼、保留什麼，以及絕不修改什麼。')} crumbs={[{ label: t('Methods', '方法') }]} />
      <section className="methods-grid">
        <article><span>01</span><h2>{t('Frozen source', '凍結來源')}</h2><p>{t('The site reads one validated stars-analysis.json. It does not mix in newer GitHub facts while presenting this run.', '網站只讀取一份已驗證的 stars-analysis.json；呈現本次結果時，不會混入較新的 GitHub 資料。')}</p><dl><div><dt>{t('Generated', '產生時間')}</dt><dd><time dateTime={model.analysis.generated_at}>{new Date(model.analysis.generated_at).toLocaleString(model.analysis.locale)}</time></dd></div><div><dt>{t('Account', '帳號')}</dt><dd><bdi dir="auto">{model.analysis.account.login}</bdi></dd></div><div><dt>{t('Exact source SHA-256', '精確來源 SHA-256')}</dt><dd><code>{provenance.source.stars_analysis_bytes_sha256}</code></dd></div></dl></article>
        <article><span>02</span><h2>{t('Semantic fidelity', '語意忠實度')}</h2><p>{t('List names, descriptions, repository identities, memberships, reasons, sensitivity, and queue eligibility remain unchanged. The passing receipt is offline evidence with the limits disclosed below.', 'List 名稱與說明、repository 身分、歸屬、理由、敏感度與佇列資格都保持不變；通過的收據是離線證據，其限制完整列於下方。')}</p><dl><div><dt>Schema</dt><dd>{model.analysis.schema_version}</dd></div><div><dt>{t('Coverage', '覆蓋')}</dt><dd>{model.analysis.validation.coverage_status}</dd></div><div><dt>{t('Semantic receipt', '語意收據')}</dt><dd><code>{provenance.semantic.validation_receipt_sha256}</code></dd></div></dl></article>
        <article><span>03</span><h2>{t('Overlapping Lists', '可重疊 Lists')}</h2><p>{t('A repository belongs to multiple Lists only when each List provides an independently useful browsing path.', '只有當每個 List 都提供獨立且實用的瀏覽路徑時，repository 才會同時屬於多個 Lists。')}</p><dl><div><dt>{t('Classification relationships', '分類關係')}</dt><dd>{model.classificationMembershipCount}</dd></div><div><dt>{t('Repositories crossing Lists', '跨 Lists 的 repositories')}</dt><dd>{model.overlapRepositoryCount}</dd></div></dl></article>
        <article><span>04</span><h2>{t('Star Review', 'Star 複核')}</h2><p>{t('Repositories worth another look are presented with their direct reason and remaining classifications. Only the user decides whether to unstar.', '值得再次檢視的 repositories 會連同直接理由與保留的分類一起呈現；只有使用者能決定是否 unstar。')}</p><dl><div><dt>{t('Sensitivity', '敏感度')}</dt><dd>{model.analysis.run.likely_unstar_sensitivity}/10</dd></div><div><dt>{t('Suggestions', '建議')}</dt><dd>{model.reviewRepositories.length}</dd></div></dl></article>
        <article><span>05</span><h2>{t('Application evidence', '套用證據')}</h2><p>{appliedClaim
          ? t('A separately validated external receipt claims the planned Lists were applied. This is receipt-backed metadata, not a live fact authenticated by GitHub.', '一份另行驗證的外部收據聲稱規劃中的 Lists 已套用。這是由收據支持的 metadata，不是經 GitHub 驗證的即時事實。')
          : t('No application receipt was supplied. This report presents the immutable plan and does not claim that GitHub Lists changed.', '未提供套用收據；這份報告只呈現不可變的規劃結果，不聲稱 GitHub Lists 已有變更。')}</p><dl><div><dt>{t('Application status', '套用狀態')}</dt><dd>{applicationLabel}</dd></div>{appliedClaim ? <div><dt>{t('External receipt', '外部收據')}</dt><dd><code>{provenance.application.receipt_sha256}</code></dd></div> : null}<div><dt>{t('Analysis status', '分析狀態')}</dt><dd>{model.analysis.run.analysis_status}</dd></div></dl></article>
        <article className="methods-limitations"><span>06</span><h2>{t('Limitations', '限制')}</h2><p>{t('Classification is an AI judgment grounded in the frozen evidence. A clear interface does not turn judgment into certainty.', '分類是 AI 根據凍結證據做出的判斷；介面清楚不代表判斷就成為確定事實。')}</p><h3>{t('Semantic offline limitations', '語意離線驗證限制')}</h3><ul>{provenance.semantic.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>{appliedClaim ? <><h3>{t('Application receipt limitations', '套用收據限制')}</h3><ul>{provenance.application.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul></> : null}<h3>{t('Analysis notes', '分析備註')}</h3>{model.analysis.validation.notes.length ? <ul>{model.analysis.validation.notes.map((note) => <li key={note}>{note}</li>)}</ul> : <p>{t('No additional validation note was recorded.', '沒有其他驗證備註。')}</p>}</article>
      </section>
    </div>
  );
}

export function PrintExportPage() {
  const { model } = useReport();
  const t = (english: string, traditionalChinese: string) => uiText(model.analysis.locale, english, traditionalChinese);
  const exportRepositories = () => download('stars-repositories.csv', [
    ['repository', 'url', 'description', 'classification_lists', 'likely_unstar'].join(','),
    ...model.analysis.repositories.map((repository) => {
      const lists = repository.memberships.map((membership) => model.listsById.get(membership.list_id)).filter((list) => list?.kind === 'classification').map((list) => list!.name);
      const review = repository.memberships.some((membership) => model.listsById.get(membership.list_id)?.kind === 'review-queue');
      return [repository.full_name, repository.url, repository.description, lists.join(' | '), review ? 'yes' : 'no'].map(csvCell).join(',');
    })
  ].join('\n'), 'text/csv;charset=utf-8');
  const exportMemberships = () => download('stars-memberships.csv', [
    ['repository', 'list', 'kind', 'reason'].join(','),
    ...model.analysis.repositories.flatMap((repository) => repository.memberships.map((membership) => {
      const list = model.listsById.get(membership.list_id)!;
      return [repository.full_name, list.name, list.kind, membership.reason].map(csvCell).join(',');
    }))
  ].join('\n'), 'text/csv;charset=utf-8');
  const exportJson = () => download('stars-analysis.json', `${JSON.stringify(model.analysis, null, 2)}\n`, 'application/json');

  return (
    <div className="page page--print">
      <PageHeader eyebrow={t('Portable views', '可攜式檢視')} title={t('Print & export', '列印與匯出')} description={t('Use the interactive site to explore. Use these outputs when you need the complete collection outside the interface.', '使用互動網站探索；需要在介面之外取得完整收藏時，使用這些輸出。')} crumbs={[{ label: t('Print & export', '列印與匯出') }]} actions={<button type="button" className="button button--primary" onClick={() => window.print()}><Printer aria-hidden="true" size={17} />{t('Print complete view', '列印完整內容')}</button>} />
      <section className="export-actions">
        <button type="button" onClick={exportRepositories}><Download aria-hidden="true" /><strong>Repository CSV</strong><small>{t(`${model.analysis.repositories.length} rows with Lists and review state`, `${model.analysis.repositories.length} 列，包含 Lists 與複核狀態`)}</small></button>
        <button type="button" onClick={exportMemberships}><Download aria-hidden="true" /><strong>{t('Membership CSV', '歸屬關係 CSV')}</strong><small>{t(`${model.classificationMembershipCount + model.reviewMembershipCount} exact relationships and reasons`, `${model.classificationMembershipCount + model.reviewMembershipCount} 條完整關係與理由`)}</small></button>
        <button type="button" onClick={exportJson}><FileJson aria-hidden="true" /><strong>{t('Analysis JSON', '分析 JSON')}</strong><small>{t('The unchanged structured source for this site', '網站使用的未修改結構化來源')}</small></button>
      </section>
      <section className="print-projection" aria-labelledby="print-heading">
        <div className="section-heading"><p className="eyebrow">{t('Complete flat projection', '完整平面投影')}</p><h2 id="print-heading">{model.analysis.account.login} · GitHub Stars</h2><p>{model.analysis.repositories.length} repositories · {model.analysis.lists.length} Lists · {model.classificationMembershipCount + model.reviewMembershipCount} {t('relationships', '條關係')}</p></div>
        {model.analysis.repositories.map((repository) => (
          <article key={repository.full_name}>
            <h3><bdi dir="auto">{repository.full_name}</bdi></h3>
            <p>{repository.description}</p>
            <dl>
              {repository.memberships.map((membership) => <div key={membership.list_id}><dt>{model.listsById.get(membership.list_id)?.name}</dt><dd>{membership.reason}</dd></div>)}
              {repository.unclassified_reason ? <div><dt>{t('Unclassified', '尚未分類')}</dt><dd>{repository.unclassified_reason}</dd></div> : null}
            </dl>
          </article>
        ))}
      </section>
    </div>
  );
}

export function NotFoundPage() {
  const { model } = useReport();
  const t = (english: string, traditionalChinese: string) => uiText(model.analysis.locale, english, traditionalChinese);
  return <div className="page"><PageHeader eyebrow="404" title={t('Destination not found', '找不到目的地')} description={t('Use the site map to return to a known part of the Stars library.', '使用站點地圖返回 Stars 資料庫中已知的位置。')} /><Link className="button button--primary" to="/sitemap"><Map aria-hidden="true" size={17} />{t('Open site map', '開啟站點地圖')}</Link></div>;
}
