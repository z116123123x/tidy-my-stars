import { ArrowUpRight, Layers3, ShieldAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { repositoryRoute } from '../domain/model';
import { useReport } from '../data';
import { uiText } from '../i18n';
import type { Repository } from '../types';

export function RepositoryRow({
  repository,
  reason,
  destination
}: {
  repository: Repository;
  reason?: string;
  destination?: string;
}) {
  const { model } = useReport();
  const lists = repository.memberships
    .map((membership) => model.listsById.get(membership.list_id))
    .filter(Boolean);
  const isReview = lists.some((list) => list?.kind === 'review-queue');

  return (
    <article className="repository-row">
      <div className="repository-row__main">
        <Link className="repository-row__title" to={destination ?? repositoryRoute(repository)}>
          <bdi dir="auto">{repository.full_name}</bdi>
          <ArrowUpRight aria-hidden="true" size={15} />
        </Link>
        <p>{repository.description || uiText(model.analysis.locale, 'No repository description was available.', '沒有可用的 repository 說明。')}</p>
        {reason ? <p className="repository-row__reason">{reason}</p> : null}
      </div>
      <div className="repository-row__meta" aria-label={uiText(model.analysis.locale, 'Classification summary', '分類摘要')}>
        <span><Layers3 aria-hidden="true" size={14} />{lists.filter((list) => list?.kind === 'classification').length}</span>
        {isReview ? <span className="review-chip"><ShieldAlert aria-hidden="true" size={14} />{uiText(model.analysis.locale, 'Review', '待複核')}</span> : null}
      </div>
    </article>
  );
}
