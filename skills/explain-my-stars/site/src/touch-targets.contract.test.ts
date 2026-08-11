import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('44px touch-target contract', () => {
  it('gives standalone repository and navigation links a 44 by 44 target', () => {
    const css = source('./styles.css');
    expect(css).toMatch(/\.skip-link\s*\{[^}]*min-block-size:\s*44px/s);
    expect(css).toMatch(/\.breadcrumbs a\s*\{[^}]*min-inline-size:\s*44px[^}]*min-block-size:\s*44px/s);
    expect(css).toMatch(/\.breadcrumbs li > a\s*\{[^}]*min-inline-size:\s*44px/s);
    expect(css).toMatch(/\.repository-row__title\s*\{[^}]*min-block-size:\s*44px/s);
    expect(css).toMatch(/\.text-link\s*\{[^}]*min-inline-size:\s*44px[^}]*min-block-size:\s*44px/s);
    expect(css).toMatch(/\.section-heading--row > a\s*\{[^}]*min-inline-size:\s*44px[^}]*min-block-size:\s*44px/s);
    expect(css).toMatch(/\.membership-card h3 a\s*\{[^}]*min-inline-size:\s*44px[^}]*min-block-size:\s*44px/s);
    expect(css).toMatch(/\.repository-review-banner > a\s*\{[^}]*min-inline-size:\s*44px[^}]*min-block-size:\s*44px/s);
    expect(css).toMatch(/\.directory-toolbar input, \.directory-toolbar select\s*\{[^}]*min-block-size:\s*44px/s);
    expect(css).toMatch(/\.standalone-filter input\s*\{[^}]*min-block-size:\s*44px/s);
    expect(css).toMatch(/\.sitemap-branches h2 a\s*\{[^}]*min-inline-size:\s*44px[^}]*min-block-size:\s*44px/s);
    expect(css).toMatch(/\.command-palette input\s*\{[^}]*min-block-size:\s*44px/s);
  });

  it('lets Methods cards shrink instead of widening the mobile viewport', () => {
    const css = source('./styles.css');
    expect(css).toMatch(/\.methods-grid\s*\{[^}]*repeat\(2, minmax\(0, 1fr\)\)/s);
    expect(css).toMatch(/\.methods-grid article\s*\{[^}]*min-inline-size:\s*0/s);
    expect(css).toMatch(/\.methods-grid p, \.methods-grid dd, \.methods-grid li\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  });
});
