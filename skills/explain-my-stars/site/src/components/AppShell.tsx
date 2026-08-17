import {
  ArchiveX,
  BookOpen,
  FileText,
  FolderTree,
  Home,
  Library,
  Map,
  Menu,
  Search
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useReport } from '../data';
import { commandShortcutLabel, uiText } from '../i18n';
import { SearchPalette } from './SearchPalette';

const links = [
  { to: '/', en: 'Overview', zh: '總覽', icon: Home, end: true },
  { to: '/search', en: 'Search', zh: '搜尋', icon: Search },
  { to: '/repositories', en: 'Repositories', zh: 'Repositories', icon: Library },
  { to: '/lists', en: 'Lists', zh: 'Lists', icon: FolderTree },
  { to: '/review', en: 'Star Review', zh: 'Star 複核', icon: ArchiveX },
  { to: '/sitemap', en: 'Site map', zh: '站點地圖', icon: Map },
  { to: '/methods', en: 'Methods', zh: '方法', icon: BookOpen },
  { to: '/print', en: 'Print & export', zh: '列印與匯出', icon: FileText }
];

export function AppShell() {
  const { model } = useReport();
  const [searchOpen, setSearchOpen] = useState(false);
  const location = useLocation();
  const mobileMenuRef = useRef<HTMLDetailsElement>(null);
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  const locale = model.analysis.locale;
  const searchShortcut = commandShortcutLabel();
  const analysisStatus = model.analysis.run.analysis_status === 'complete'
    ? uiText(locale, 'Analysis complete', '分析完成')
    : `${uiText(locale, 'Analysis', '分析')} ${model.analysis.run.analysis_status}`;
  const applicationStatus = model.provenance.application.status === 'planned'
    ? uiText(locale, 'Lists remain planned', 'Lists 仍為規劃')
    : uiText(locale, 'Receipt claims Lists applied', '收據聲稱 Lists 已套用');
  const skipToContent = () => {
    const main = document.getElementById('main-content');
    main?.focus({ preventScroll: true });
    main?.scrollIntoView({ block: 'start' });
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping = target?.matches('input, textarea, select, [contenteditable="true"]');
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      } else if (event.key === '/' && !isTyping) {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    mobileMenuRef.current?.removeAttribute('open');
    if (location.pathname === '/') document.title = uiText(locale, 'Overview · Stars Library', '總覽 · Stars 資料庫');
  }, [locale, location.pathname]);

  return (
    <div className="app-shell">
      <button type="button" className="skip-link" onClick={skipToContent}>{uiText(locale, 'Skip to content', '跳到主要內容')}</button>
      <aside className="sidebar" aria-label={uiText(locale, 'Primary navigation', '主要導覽')}>
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>
          <div>
            <strong>{uiText(locale, 'Stars Library', 'Stars 資料庫')}</strong>
            <small><bdi dir="auto">@{model.analysis.account.login}</bdi></small>
          </div>
        </div>
        <button type="button" className="quick-search" onClick={() => setSearchOpen(true)}>
          <Search aria-hidden="true" size={17} />
          <span>{uiText(locale, 'Find anything', '尋找任何內容')}</span>
          <kbd>{searchShortcut}</kbd>
        </button>
        <nav>
          <p className="nav-label">{uiText(locale, 'Library', '資料庫')}</p>
          {links.slice(0, 6).map(({ to, en, zh, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}>
              <Icon aria-hidden="true" size={18} />
              <span>{to === '/review' ? model.reviewList.name : uiText(locale, en, zh)}</span>
              {to === '/repositories' ? <small>{model.analysis.repositories.length}</small> : null}
              {to === '/lists' ? <small>{model.classificationLists.length}</small> : null}
              {to === '/review' ? <small className="review-count">{model.reviewRepositories.length}</small> : null}
            </NavLink>
          ))}
          <p className="nav-label nav-label--secondary">{uiText(locale, 'Reference', '參考')}</p>
          {links.slice(6).map(({ to, en, zh, icon: Icon }) => (
            <NavLink key={to} to={to}>
              <Icon aria-hidden="true" size={18} />
              <span>{uiText(locale, en, zh)}</span>
            </NavLink>
          ))}
        </nav>
        <footer className="sidebar-footer">
          <span>{analysisStatus}</span>
          <span>{applicationStatus}</span>
        </footer>
      </aside>
      <header className="mobile-header">
        <div className="brand-block"><span className="brand-mark" aria-hidden="true"><span /><span /><span /></span><strong>{uiText(locale, 'Stars Library', 'Stars 資料庫')}</strong></div>
        <button type="button" className="icon-button" onClick={() => setSearchOpen(true)} aria-label={uiText(locale, 'Open search', '開啟搜尋')}><Search size={20} /></button>
        <details className="mobile-menu" ref={mobileMenuRef}>
          <summary aria-label={uiText(locale, 'Open navigation', '開啟導覽')}><Menu aria-hidden="true" size={22} /></summary>
          <nav aria-label={uiText(locale, 'Mobile navigation', '行動版導覽')}>
            {links.map(({ to, en, zh, icon: Icon, end }) => <NavLink key={to} to={to} end={end}><Icon aria-hidden="true" size={18} />{to === '/review' ? model.reviewList.name : uiText(locale, en, zh)}</NavLink>)}
          </nav>
        </details>
      </header>
      <main id="main-content" className="main-content" tabIndex={-1}>
        <Outlet />
      </main>
      <SearchPalette open={searchOpen} onClose={closeSearch} />
    </div>
  );
}
