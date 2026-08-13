import { ArrowLeft, ArrowRight, Check, Clock3, Search, ShieldAlert, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Virtuoso } from 'react-virtuoso';
import { PageHeader } from '../components/PageHeader';
import { useReport } from '../data';
import { listRoute, reviewRoute } from '../domain/model';
import { uiText } from '../i18n';
import type { Repository } from '../types';

type ReviewDecision = 'keep' | 'later' | 'consider-unstar';
type ReviewDecisions = Record<string, ReviewDecision>;

export function reviewDecisionStorageKey(account: string, generatedAt: string, candidateSha256: string): string {
  return `explain-my-stars:review-decisions:${encodeURIComponent(account)}:${encodeURIComponent(generatedAt)}:${candidateSha256}`;
}

export function persistReviewDecisions(storageKey: string, decisions: ReviewDecisions): boolean {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(decisions));
    return true;
  } catch {
    return false;
  }
}

export function parseReviewDecisions(raw: string | null): ReviewDecisions {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) =>
        value === 'keep' || value === 'later' || value === 'consider-unstar'
      )
    ) as ReviewDecisions;
  } catch {
    return {};
  }
}

const sensitivityThresholds = {
  en: [
    'complete evidence leaves virtually no meaningful value',
    'retention concerns decisively outweigh all demonstrated value',
    'retention concerns materially outweigh demonstrated value',
    'retention concerns slightly outweigh demonstrated value',
    'one concrete, defensible retention concern remains, even when keeping is slightly more likely',
    'several individually weak concerns form one coherent review case',
    'one weak but specific evidence-based retention concern remains, even when value clearly outweighs it',
    'demonstrated collection value is only marginal or highly conditional',
    'complete evidence shows no clearly distinct collection value',
    'complete evidence does not clearly establish strong retention value'
  ],
  zh: [
    '完整證據幾乎看不到任何有意義的實用、學習、研究、歷史、參考或獨特價值',
    '保留疑慮明顯壓過所有已證實的價值',
    '保留疑慮實質上壓過已證實的價值',
    '保留疑慮略高於已證實的價值',
    '仍有一項具體且可辯護的保留疑慮，即使保留仍稍微更合理',
    '數個個別較弱的疑慮共同形成一個連貫的複核理由',
    '仍有一項微弱但具體、以證據為基礎的保留疑慮，即使已證實的價值明顯更高',
    '已證實的收藏價值只屬邊緣或高度受條件限制',
    '完整蒐證後仍看不到清楚且獨特的收藏價值',
    '完整證據未能清楚建立強烈的保留價值'
  ]
};

export function sensitivityExplanation(level: number, locale: string): string {
  const traditionalChinese = /^zh(?:-(?:hant|tw|hk|mo))(?:-|$)/i.test(locale);
  const threshold = sensitivityThresholds[traditionalChinese ? 'zh' : 'en'][level - 1];
  if (traditionalChinese) {
    const rule = level === 1
      ? `第 1 級只在${threshold}時列入複核`
      : level === 10
        ? '第 10 級會列入所有 repositories，只有完整證據清楚建立強烈保留價值時才不列入'
        : `第 ${level} 級保留所有較窄等級的案例，並在${threshold}時也列入複核`;
    return `1 最窄、10 最廣。${rule}；它不是品質分數，也不是預設移除數量。`;
  }
  const rule = level === 1
    ? `Level 1 includes a repository only when ${threshold}`
    : level === 10
      ? 'Level 10 includes every repository except those whose complete evidence clearly establishes strong retention value'
      : `Level ${level} keeps every narrower-level case and also includes a repository when ${threshold}`;
  return `1 is narrow and 10 is broad. ${rule}; it is not a quality score or a target removal count.`;
}

function useReviewDecisions(account: string, generatedAt: string, candidateSha256: string) {
  const storageKey = reviewDecisionStorageKey(account, generatedAt, candidateSha256);
  const [{ decisions, storageError }, setReviewState] = useState<{
    decisions: ReviewDecisions;
    storageError: boolean;
  }>(() => {
    try {
      return { decisions: parseReviewDecisions(window.localStorage.getItem(storageKey)), storageError: false };
    } catch {
      return { decisions: {}, storageError: true };
    }
  });
  const decide = (repository: Repository, decision: ReviewDecision) => {
    const next = { ...decisions, [repository.full_name]: decision };
    if (persistReviewDecisions(storageKey, next)) {
      setReviewState({ decisions: next, storageError: false });
    } else {
      setReviewState((current) => ({ ...current, storageError: true }));
    }
  };
  const clear = (repository: Repository) => {
    const next = { ...decisions };
    delete next[repository.full_name];
    if (persistReviewDecisions(storageKey, next)) {
      setReviewState({ decisions: next, storageError: false });
    } else {
      setReviewState((current) => ({ ...current, storageError: true }));
    }
  };
  return { decisions, decide, clear, storageError };
}

function filterReviewRepositories(
  repositories: Repository[],
  query: string,
  listId: string,
  locale: string
): Repository[] {
  const normalizedQuery = query.normalize('NFKC').toLocaleLowerCase(locale).trim();
  return repositories.filter((repository) => {
    const inList = !listId || repository.memberships.some((membership) => membership.list_id === listId);
    if (!inList) return false;
    if (!normalizedQuery) return true;
    const text = [repository.full_name, repository.description ?? '', ...repository.memberships.map((membership) => membership.reason)].join(' ').toLocaleLowerCase(locale);
    return text.includes(normalizedQuery);
  });
}

export function ReviewQueuePage() {
  const { model } = useReport();
  const t = (english: string, traditionalChinese: string) => uiText(model.analysis.locale, english, traditionalChinese);
  const [params, setParams] = useSearchParams();
  const { decisions, storageError } = useReviewDecisions(
    model.analysis.account.login,
    model.analysis.generated_at,
    model.provenance.semantic.candidate_sha256
  );
  const query = params.get('q') ?? '';
  const listId = params.get('list') ?? '';
  const repositories = useMemo(
    () => filterReviewRepositories(model.reviewRepositories, query, listId, model.analysis.locale),
    [listId, model, query]
  );
  const completed = Object.keys(decisions).filter((name) => model.reviewRepositories.some((repository) => repository.full_name === name)).length;
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    setParams(next);
  };

  return (
    <div className="page page--review">
      <PageHeader eyebrow={t('Human decision queue', '人工決策佇列')} title={model.reviewList.name} description={t('AI found concrete reasons to review these repositories. You decide what stays; this site never changes GitHub.', 'AI 認為這些 repositories 值得你複核，並逐筆列出理由；由你決定保留什麼，這個網站不會修改 GitHub。')} crumbs={[{ label: model.reviewList.name }]} actions={<div className="review-progress"><span>{completed}/{model.reviewRepositories.length}</span><small>{t('marked on this device', '已在此裝置標記')}</small></div>} />
      {storageError ? <p className="storage-warning" role="alert">{t('This browser could not read or save review decisions. No unsaved choice is shown as recorded.', '這個瀏覽器目前無法讀取或儲存複核決定；未成功儲存的選擇不會顯示為已記錄。')}</p> : null}
      <section className="review-explainer"><ShieldAlert aria-hidden="true" /><div><strong>{t('Sensitivity', '敏感度')} {model.analysis.run.likely_unstar_sensitivity}/10</strong><p>{sensitivityExplanation(model.analysis.run.likely_unstar_sensitivity, model.analysis.locale)}</p></div></section>
      <section className="directory-toolbar" aria-label={t('Review filters', '複核篩選')}>
        <label className="toolbar-search"><Search aria-hidden="true" size={18} /><span className="sr-only">{t('Search review queue', '搜尋複核佇列')}</span><input value={query} onChange={(event) => update('q', event.target.value)} placeholder={t('Search recommendations…', '搜尋建議…')} /></label>
        <label><span className="sr-only">{t('Filter by classification List', '依分類 List 篩選')}</span><select value={listId} onChange={(event) => update('list', event.target.value)}><option value="">{t('All classifications', '所有分類')}</option>{model.classificationLists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}</select></label>
      </section>
      <div className="directory-status" role="status">{t('', '顯示 ')}<strong>{repositories.length}</strong>{t(` of ${model.reviewRepositories.length} suggestions`, ` / ${model.reviewRepositories.length} 個建議`)}</div>
      <section className="review-directory" aria-label={t('Likely Unstar suggestions', '建議 Unstar 清單')}>
        {repositories.length ? <Virtuoso data={repositories} increaseViewportBy={200} itemContent={(index, repository) => {
          const reason = repository.memberships.find((membership) => membership.list_id === model.reviewList.id)?.reason;
          const decision = decisions[repository.full_name];
          const decisionLabel = decision === 'consider-unstar' ? t('Consider unstar', '考慮 Unstar') : decision === 'later' ? t('Later', '稍後決定') : t('Keep', '保留');
          return <Link className="review-row" to={reviewRoute(repository)}><span className="review-row__index">{String(index + 1).padStart(2, '0')}</span><span><strong><bdi dir="auto">{repository.full_name}</bdi></strong><small>{reason}</small></span>{decision ? <span className={`decision-pill decision-pill--${decision}`}>{decisionLabel}</span> : <span className="decision-pill">{t('Unreviewed', '尚未複核')}</span>}<ArrowRight aria-hidden="true" size={17} /></Link>;
        }} /> : <div className="empty-panel"><h2>{t('No suggestions match', '沒有符合的建議')}</h2><p>{t('Clear a filter to return to the full review queue.', '清除篩選條件以返回完整複核佇列。')}</p></div>}
      </section>
    </div>
  );
}

export function ReviewDetailPage() {
  const { model } = useReport();
  const t = (english: string, traditionalChinese: string) => uiText(model.analysis.locale, english, traditionalChinese);
  const { owner = '', name = '' } = useParams();
  const repository = model.repositoriesByName.get(`${owner}/${name}`);
  const { decisions, decide, clear, storageError } = useReviewDecisions(
    model.analysis.account.login,
    model.analysis.generated_at,
    model.provenance.semantic.candidate_sha256
  );
  if (!repository || !model.reviewRepositories.some((candidate) => candidate.full_name === repository.full_name)) {
    return <div className="page"><PageHeader eyebrow={t('Review', '複核')} title={t('Suggestion not found', '找不到此建議')} description={t('This repository is not in the current Likely Unstar queue.', '這個 repository 不在目前的建議 Unstar 佇列中。')} /><Link className="button button--primary" to="/review">{t('Return to queue', '返回佇列')}</Link></div>;
  }
  const index = model.reviewRepositories.findIndex((candidate) => candidate.full_name === repository.full_name);
  const previous = model.reviewRepositories[index - 1];
  const next = model.reviewRepositories[index + 1];
  const reason = repository.memberships.find((membership) => membership.list_id === model.reviewList.id)!.reason;
  const classifications = repository.memberships.filter((membership) => model.listsById.get(membership.list_id)?.kind === 'classification');
  const decision = decisions[repository.full_name];

  return (
    <div className="page page--review-detail">
      <PageHeader eyebrow={t(`Review ${index + 1} of ${model.reviewRepositories.length}`, `複核第 ${index + 1} / ${model.reviewRepositories.length} 筆`)} title={repository.full_name} description={repository.description || t('No repository description was available.', '沒有可用的 repository 說明。')} crumbs={[{ label: t('Likely Unstar', '建議 Unstar'), to: '/review' }, { label: repository.full_name }]} monospaceTitle />
      <div className="review-detail-layout">
        <section className="review-evidence">
          <div className="review-reason-block"><p className="eyebrow">{t('Why AI surfaced it', 'AI 為什麼提出這個建議')}</p><h2>{t('Likely Unstar reason', '建議 Unstar 的理由')}</h2><p>{reason}</p><small>{t('This is evidence for your review, not an instruction to remove it.', '這是供你複核的依據，不是要求移除的指令。')}</small></div>
          <div className="section-heading"><p className="eyebrow">{t('What remains useful', '仍然有用的部分')}</p><h2>{t('Current classifications', '目前分類')}</h2></div>
          <div className="membership-stack">
            {classifications.length ? classifications.map((membership) => {
              const list = model.listsById.get(membership.list_id)!;
              return <article className="membership-card" key={membership.list_id}><h3><Link to={listRoute(list)}>{list.name}</Link></h3><p>{membership.reason}</p></article>;
            }) : <article className="membership-card"><h3>{t('No topic List assigned', '尚未歸入主題 List')}</h3><p>{repository.unclassified_reason}</p></article>}
          </div>
        </section>
        <aside className="decision-panel">
          <p className="eyebrow">{t('Your decision', '你的決定')}</p><h2>{t('What do you want to remember?', '你想記錄什麼？')}</h2><p>{t('Saved only in this browser. It does not write to GitHub.', '只會儲存在這個瀏覽器，不會寫入 GitHub。')}</p>
          {storageError ? <p className="storage-warning" role="alert">{t('This browser could not save the decision. No unsaved choice is shown as recorded.', '這個瀏覽器無法儲存這項決定；未成功儲存的選擇不會顯示為已記錄。')}</p> : null}
          <div className="decision-buttons">
            <button type="button" aria-pressed={decision === 'keep'} onClick={() => decide(repository, 'keep')}><Check aria-hidden="true" /><span><strong>{t('Keep', '保留')}</strong><small>{t('Still earns its place', '仍然值得收藏')}</small></span></button>
            <button type="button" aria-pressed={decision === 'later'} onClick={() => decide(repository, 'later')}><Clock3 aria-hidden="true" /><span><strong>{t('Decide later', '稍後決定')}</strong><small>{t('Needs another look', '需要再看一次')}</small></span></button>
            <button type="button" aria-pressed={decision === 'consider-unstar'} onClick={() => decide(repository, 'consider-unstar')}><Trash2 aria-hidden="true" /><span><strong>{t('Consider unstar', '考慮 Unstar')}</strong><small>{t('You will act on GitHub yourself', '由你自行在 GitHub 操作')}</small></span></button>
          </div>
          {decision ? <button type="button" className="clear-decision" onClick={() => clear(repository)}>{t('Clear saved decision', '清除已儲存決定')}</button> : null}
          <a className="button button--secondary decision-github-link" href={repository.url} target="_blank" rel="noreferrer noopener">{t('Inspect on GitHub', '在 GitHub 查看')}</a>
        </aside>
      </div>
      <nav className="review-pagination" aria-label={t('Review navigation', '複核導覽')}>
        {previous ? <Link to={reviewRoute(previous)}><ArrowLeft aria-hidden="true" /><span><small>{t('Previous', '上一筆')}</small><bdi dir="auto">{previous.full_name}</bdi></span></Link> : <span />}
        {next ? <Link to={reviewRoute(next)}><span><small>{t('Next', '下一筆')}</small><bdi dir="auto">{next.full_name}</bdi></span><ArrowRight aria-hidden="true" /></Link> : <span />}
      </nav>
    </div>
  );
}
