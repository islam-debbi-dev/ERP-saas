import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import { issueParams } from './import-issues';

describe('the location warnings of an Excel import', () => {
  const cases = [
    ['location_not_found', { wilaya: 'Nulle part', commune: 'Xyz' }, ['Nulle part', 'Xyz']],
    ['location_ambiguous', { wilaya: '', commune: 'Xyz' }, ['Xyz']],
    ['commune_under_review', { wilaya: '', commune: 'Xyz' }, ['Xyz']],
    ['location_former_wilaya', { commune: 'Xyz', wilaya: '55 Touggourt' }, ['Xyz']],
  ] as const;

  it.each([
    ['ar', ar, 'تقرت'],
    ['fr', fr, 'Touggourt'],
    ['en', en, 'Touggourt'],
  ] as const)('render with their values in %s', (locale, messages, touggourt) => {
    const t = createTranslator({
      locale,
      messages,
      namespace: 'imports.issues',
      onError: (error) => {
        throw error;
      },
    });
    for (const [code, params, values] of cases) {
      const text = t(code, issueParams({ code, params: { ...params } }, locale) as never);
      for (const value of values) expect(text).toContain(value);
      if (code === 'location_former_wilaya') expect(text).toContain(`55 · ${touggourt}`);
    }
  });
});
