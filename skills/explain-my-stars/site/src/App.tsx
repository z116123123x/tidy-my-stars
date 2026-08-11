import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { useReport } from './data';
import { uiText } from './i18n';

const OverviewPage = lazy(() => import('./pages/OverviewPage').then((module) => ({ default: module.OverviewPage })));
const SearchPage = lazy(() => import('./pages/SearchPage').then((module) => ({ default: module.SearchPage })));
const RepositoriesPage = lazy(() => import('./pages/BrowsePages').then((module) => ({ default: module.RepositoriesPage })));
const RepositoryDetailPage = lazy(() => import('./pages/BrowsePages').then((module) => ({ default: module.RepositoryDetailPage })));
const ListsPage = lazy(() => import('./pages/BrowsePages').then((module) => ({ default: module.ListsPage })));
const ListDetailPage = lazy(() => import('./pages/BrowsePages').then((module) => ({ default: module.ListDetailPage })));
const ReviewQueuePage = lazy(() => import('./pages/ReviewPages').then((module) => ({ default: module.ReviewQueuePage })));
const ReviewDetailPage = lazy(() => import('./pages/ReviewPages').then((module) => ({ default: module.ReviewDetailPage })));
const SitemapPage = lazy(() => import('./pages/UtilityPages').then((module) => ({ default: module.SitemapPage })));
const MethodsPage = lazy(() => import('./pages/UtilityPages').then((module) => ({ default: module.MethodsPage })));
const PrintExportPage = lazy(() => import('./pages/UtilityPages').then((module) => ({ default: module.PrintExportPage })));
const NotFoundPage = lazy(() => import('./pages/UtilityPages').then((module) => ({ default: module.NotFoundPage })));

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<RouteBoundary><OverviewPage /></RouteBoundary>} />
        <Route path="search" element={<RouteBoundary><SearchPage /></RouteBoundary>} />
        <Route path="repositories" element={<RouteBoundary><RepositoriesPage /></RouteBoundary>} />
        <Route path="repositories/:owner/:name" element={<RouteBoundary><RepositoryDetailPage /></RouteBoundary>} />
        <Route path="lists" element={<RouteBoundary><ListsPage /></RouteBoundary>} />
        <Route path="lists/:listId" element={<RouteBoundary><ListDetailPage /></RouteBoundary>} />
        <Route path="review" element={<RouteBoundary><ReviewQueuePage /></RouteBoundary>} />
        <Route path="review/:owner/:name" element={<RouteBoundary><ReviewDetailPage /></RouteBoundary>} />
        <Route path="sitemap" element={<RouteBoundary><SitemapPage /></RouteBoundary>} />
        <Route path="methods" element={<RouteBoundary><MethodsPage /></RouteBoundary>} />
        <Route path="print" element={<RouteBoundary><PrintExportPage /></RouteBoundary>} />
        <Route path="*" element={<RouteBoundary><NotFoundPage /></RouteBoundary>} />
      </Route>
    </Routes>
  );
}

function RouteBoundary({ children }: { children: React.ReactNode }) {
  const { model } = useReport();
  return <Suspense fallback={<div className="route-loading" role="status" aria-busy="true"><span /><p>{uiText(model.analysis.locale, 'Opening this part of the library…', '正在開啟這個區域…')}</p></div>}>{children}</Suspense>;
}
