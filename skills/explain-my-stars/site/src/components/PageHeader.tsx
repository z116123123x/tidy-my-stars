import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useReport } from '../data';
import { uiText } from '../i18n';

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  monospaceTitle = false,
  crumbs = []
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
  monospaceTitle?: boolean;
  crumbs?: Array<{ label: string; to?: string }>;
}) {
  const { model } = useReport();
  const locale = model.analysis.locale;
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = `${title} · ${uiText(locale, 'Stars Library', 'Stars 資料庫')}`;
    window.scrollTo(0, 0);
    headingRef.current?.focus({ preventScroll: true });
  }, [locale, title]);

  return (
    <header className="page-header">
      {crumbs.length ? (
        <nav className="breadcrumbs" aria-label="Breadcrumb">
          <ol>
            <li><Link to="/">{uiText(locale, 'Overview', '總覽')}</Link></li>
            {crumbs.map((crumb) => <li key={`${crumb.label}:${crumb.to ?? ''}`}>{crumb.to ? <Link to={crumb.to}>{crumb.label}</Link> : <span aria-current="page">{crumb.label}</span>}</li>)}
          </ol>
        </nav>
      ) : null}
      <div className="page-header__body">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1 ref={headingRef} className={monospaceTitle ? 'page-title--identity' : undefined} tabIndex={-1} data-page-heading><bdi dir="auto">{title}</bdi></h1>
          <p className="page-intro">{description}</p>
        </div>
        {actions ? <div className="page-actions">{actions}</div> : null}
      </div>
    </header>
  );
}
