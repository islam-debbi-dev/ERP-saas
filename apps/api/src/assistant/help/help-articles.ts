import type { Feature } from '@erp/shared';
import { HELP_ARTICLES, WEB_ROUTES } from './help-bundle';

export interface HelpArticle {
  slug: string;
  language: 'fr' | 'ar';
  title: string;
  /** The module the article is about; null = core. */
  feature: string | null;
  body: string;
}

/**
 * The articles of a company, always in the same order: they are in the cached prefix, so
 * a company's text must not change from one request to the next.
 */
export function helpFor(features: readonly Feature[]): HelpArticle[] {
  const enabled = new Set<string>(features);
  return HELP_ARTICLES.filter((a) => a.feature === null || enabled.has(a.feature));
}

export function renderHelp(articles: readonly HelpArticle[]): string {
  return articles.map((a) => `### ${a.title} (${a.language})\n${a.body}`).join('\n\n');
}

const ROUTE_PATTERNS = WEB_ROUTES.map(
  (route) => new RegExp(`^${route.replace(/\[[^\]]+\]/g, '[^/]+')}$`),
);

/** Is this path a real screen of the app? Query and hash do not matter. */
export function isAppRoute(href: string): boolean {
  const path = href.split(/[?#]/)[0] ?? '';
  return ROUTE_PATTERNS.some((pattern) => pattern.test(path));
}
