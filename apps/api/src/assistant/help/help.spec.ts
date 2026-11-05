import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Feature, FEATURES } from '@erp/shared';
import {
  BUNDLE_FILE,
  readArticles,
  readWebRoutes,
  renderBundle,
} from '../../../scripts/assistant-help';
import { helpFor, isAppRoute, renderHelp } from './help-articles';

const articles = readArticles();
const messages = (locale: string) =>
  JSON.parse(
    readFileSync(path.join(__dirname, '../../../../web/src/messages', `${locale}.json`), 'utf8'),
  ) as unknown;

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  return typeof value === 'object' && value !== null ? Object.values(value).flatMap(strings) : [];
}

/** Rough on purpose, and high: Arabic costs about twice as many tokens per character. */
function estimateTokens(text: string): number {
  const arabic = (text.match(/[؀-ۿ]/g) ?? []).length;
  return Math.ceil(arabic / 1.5 + (text.length - arabic) / 3);
}

describe('help articles', () => {
  it('has 30 to 40 topics, each in French and Arabic', () => {
    const fr = articles.filter((a) => a.language === 'fr').map((a) => a.slug);
    const ar = articles.filter((a) => a.language === 'ar').map((a) => a.slug);
    expect(fr.length).toBeGreaterThanOrEqual(30);
    expect(fr.length).toBeLessThanOrEqual(40);
    expect(ar).toEqual(fr);
  });

  it('stays under the token budget of the prompt', () => {
    expect(estimateTokens(renderHelp(articles))).toBeLessThan(25_000);
  });

  it('links only routes that exist in apps/web/src/app', () => {
    const routes = new Set(readWebRoutes());
    const links = articles.flatMap((a) =>
      [...a.body.matchAll(/\]\((\/[^)]*)\)/g)].map((m) => ({ slug: a.slug, href: m[1] ?? '' })),
    );
    expect(links.length).toBeGreaterThan(articles.length);
    expect(links.filter((l) => !routes.has(l.href))).toEqual([]);
  });

  it('gives every article a link to its screen', () => {
    expect(articles.filter((a) => !/\]\(\//.test(a.body)).map((a) => a.slug)).toEqual([]);
  });

  it('only names modules that exist', () => {
    const known = new Set<string>(FEATURES);
    expect(articles.filter((a) => a.feature && !known.has(a.feature))).toEqual([]);
  });

  it.each(['fr', 'ar'] as const)('quotes real %s button labels', (language) => {
    const labels = new Set(strings(messages(language)));
    // Not screen labels: an example, and the name of an import type in the file picker.
    const free = new Set(['10+1', 'Stock initial', 'Clients et soldes', 'prix différent']);
    const wrong = articles
      .filter((a) => a.language === language)
      .flatMap((a) => [...a.body.matchAll(/« ([^»]+) »/g)].map((m) => m[1] ?? ''))
      .filter((quote) => !labels.has(quote) && !free.has(quote));
    expect([...new Set(wrong)]).toEqual([]);
  });

  it('keeps the bundle in step with the .md files and the web routes', () => {
    expect(existsSync(BUNDLE_FILE)).toBe(true);
    expect(readFileSync(BUNDLE_FILE, 'utf8')).toBe(renderBundle());
  });
});

describe('helpFor', () => {
  it('leaves out the modules a company does not have', () => {
    const slugs = helpFor([Feature.EXPENSES]).map((a) => a.slug);
    expect(slugs).toContain('faire-vente');
    expect(slugs).toContain('depenses');
    expect(slugs).not.toContain('tournees');
    expect(slugs).not.toContain('dossiers-importation');
    expect(slugs).not.toContain('paie');
  });

  it('gives the same text for the same features, whatever their order', () => {
    const a = renderHelp(helpFor([Feature.HR, Feature.TOURNEES]));
    const b = renderHelp(helpFor([Feature.TOURNEES, Feature.HR]));
    expect(a).toBe(b);
  });
});

describe('isAppRoute', () => {
  it('knows real screens, dynamic ones included', () => {
    expect(isAppRoute('/ventes/nouvelle')).toBe(true);
    expect(isAppRoute('/ventes/1a2b')).toBe(true);
    expect(isAppRoute('/clients?filter=debt')).toBe(true);
  });

  it('refuses anything else', () => {
    expect(isAppRoute('/nulle-part')).toBe(false);
    expect(isAppRoute('/ventes/1/2')).toBe(false);
    expect(isAppRoute('/admin/societes')).toBe(false);
    expect(isAppRoute('https://evil.example/ventes')).toBe(false);
    expect(isAppRoute('//evil.example/ventes')).toBe(false);
  });
});
