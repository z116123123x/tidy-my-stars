import * as Dialog from '@radix-ui/react-dialog';
import { CornerDownLeft, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useReport } from '../data';
import { listRoute, repositoryRoute } from '../domain/model';
import { commandShortcutLabel, uiText } from '../i18n';

export function SearchPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { model, search } = useReport();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const navigate = useNavigate();
  const locale = model.analysis.locale;
  const searchShortcut = commandShortcutLabel();
  const results = useMemo(() => search(query).slice(0, 10), [query, search]);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    setQuery('');
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => setActiveIndex(0), [query]);

  useEffect(() => {
    if (!open || !results[activeIndex]) return;
    document.getElementById(`command-result-${activeIndex}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, open, results]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  const activate = (result: (typeof results)[number]) => {
    const destination = result.item.kind === 'list'
      ? listRoute(model.listsById.get(result.item.id)!)
      : repositoryRoute(model.repositoriesByName.get(result.item.id)!);
    navigate(destination);
    onClose();
  };
  const openAllResults = () => {
    navigate({ pathname: '/search', search: query.trim() ? `?q=${encodeURIComponent(query.trim())}` : '' });
    onClose();
  };
  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && results.length) {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % results.length);
    } else if (event.key === 'ArrowUp' && results.length) {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + results.length) % results.length);
    } else if (event.key === 'Enter' && results[activeIndex]) {
      event.preventDefault();
      activate(results[activeIndex]);
    }
  };

  return (
    <Dialog.Root modal={false} open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="command-layer" />
        <Dialog.Content
          className="command-palette"
          aria-describedby="command-description"
          onOpenAutoFocus={(event) => { event.preventDefault(); inputRef.current?.focus(); }}
          onCloseAutoFocus={(event) => { event.preventDefault(); returnFocusRef.current?.focus(); }}
        >
          <Dialog.Title className="sr-only">{uiText(locale, 'Search Stars', '搜尋 Stars')}</Dialog.Title>
          <Dialog.Description className="sr-only" id="command-description">{uiText(locale, 'Search repositories, Lists, descriptions, and classification reasons.', '搜尋 repositories、Lists、說明與分類理由。')}</Dialog.Description>
        <header>
          <Search aria-hidden="true" size={20} />
          <label className="sr-only" htmlFor="command-search">{uiText(locale, 'Search Stars', '搜尋 Stars')}</label>
          <input
            id="command-search"
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder={uiText(locale, 'Search repositories, Lists, and reasons…', '搜尋 repository、List 或理由…')}
            autoComplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls="command-results"
            aria-activedescendant={results[activeIndex] ? `command-result-${activeIndex}` : undefined}
          />
          <Dialog.Close asChild><button type="button" className="icon-button" aria-label={uiText(locale, 'Close search', '關閉搜尋')}><X aria-hidden="true" size={18} /></button></Dialog.Close>
        </header>
        <div id="command-results" className="command-results" role="listbox" aria-label={uiText(locale, 'Search results', '搜尋結果')}>
          {!query ? (
            <div className="command-hint">
              <p>{uiText(locale, 'Search the entire collection, including every classification reason.', '搜尋整個收藏，包括每一條分類理由。')}</p>
              <span>{model.analysis.repositories.length} repositories · {model.analysis.lists.length} Lists</span>
            </div>
          ) : results.length ? results.map((result, index) => (
            <button
              type="button"
              role="option"
              aria-selected={activeIndex === index}
              id={`command-result-${index}`}
              className="command-result"
              key={`${result.item.kind}:${result.item.id}`}
              onClick={() => activate(result)}
              onMouseMove={() => setActiveIndex(index)}
            >
              <span className="command-result__kind">{result.item.kind === 'list' ? 'List' : 'Repo'}</span>
              <span>
                <strong><bdi dir="auto">{result.item.title}</bdi></strong>
                <small>{result.item.description || result.item.listNames.join(' · ')}</small>
              </span>
              <CornerDownLeft aria-hidden="true" size={15} />
            </button>
          )) : <p className="empty-inline">{uiText(locale, `No result matches “${query}”.`, `找不到符合「${query}」的結果。`)}</p>}
          {query.trim() ? <button type="button" className="command-all-results" onClick={openAllResults}>{uiText(locale, 'Open the full results page', '開啟完整搜尋結果')}</button> : null}
        </div>
        <footer>{uiText(locale, 'Press', '按')} <kbd>Esc</kbd> {uiText(locale, 'to close', '關閉')} · <kbd>{searchShortcut}</kbd> {uiText(locale, 'to reopen', '再次開啟')}</footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
