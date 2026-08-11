import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('maximum GitHub identity layout contract', () => {
  it('keeps canonical identities isolated in every repository discovery path', () => {
    const repositoryRow = source('./components/RepositoryRow.tsx');
    const reviewPages = source('./pages/ReviewPages.tsx');
    const searchPalette = source('./components/SearchPalette.tsx');
    const pageHeader = source('./components/PageHeader.tsx');

    expect(repositoryRow).toMatch(/<bdi dir="auto">\{repository\.full_name\}<\/bdi>/);
    expect(reviewPages.match(/<bdi dir="auto">\{(?:repository|previous|next)\.full_name\}<\/bdi>/g)?.length ?? 0)
      .toBeGreaterThanOrEqual(3);
    expect(searchPalette).toMatch(/<bdi dir="auto">\{result\.item\.title\}<\/bdi>/);
    expect(pageHeader).toMatch(/<bdi dir="auto">\{title\}<\/bdi>/);
  });

  it('lets a 39-character owner and 100-character repository shrink and wrap at 390px', () => {
    const css = source('./styles.css');
    const maximumIdentity = `${'o'.repeat(39)}/${'r'.repeat(100)}`;

    expect(maximumIdentity).toHaveLength(140);
    expect(css).toMatch(/\.breadcrumbs li[^\{]*\{[^}]*min-inline-size:\s*0[^}]*overflow-wrap:\s*anywhere/s);
    expect(css).toMatch(/\.breadcrumbs a\s*\{[^}]*min-inline-size:\s*44px[^}]*min-block-size:\s*44px[^}]*display:\s*inline-flex/s);
    expect(css).toMatch(/\.command-result > span:nth-child\(2\)[^\{]*\{[^}]*min-inline-size:\s*0/s);
    expect(css).toMatch(/\.command-result strong\s*\{[^}]*overflow-wrap:\s*anywhere[^}]*white-space:\s*normal/s);
    expect(css).toMatch(/\.repository-row__main\s*\{[^}]*min-inline-size:\s*0/s);
    expect(css).toMatch(/\.repository-row__title\s*\{[^}]*min-block-size:\s*44px/s);
    expect(css).toMatch(/\.repository-row__title bdi\s*\{[^}]*min-inline-size:\s*0[^}]*overflow-wrap:\s*anywhere/s);
    expect(css).toMatch(/\.review-row > span:nth-child\(2\)[^\{]*\{[^}]*min-inline-size:\s*0/s);
    expect(css).toMatch(/\.review-row bdi[^\{]*\{[^}]*min-inline-size:\s*0/s);
    expect(css).toMatch(/\.review-pagination\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s);
    expect(css).toMatch(/\.review-pagination a > span[^\{]*\{[^}]*min-inline-size:\s*0[^}]*overflow-wrap:\s*anywhere/s);
    expect(css).toMatch(/\.page-header h1\.page-title--identity\s*\{[^}]*font-size:\s*clamp\(1\.35rem, 6\.2vw, 2rem\)/s);
  });
});
