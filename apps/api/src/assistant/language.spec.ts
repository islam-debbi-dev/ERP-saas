import { detectLanguage, fallbackText, languageInstruction } from './language';

describe('language hints', () => {
  it.each([
    ['قداش عند فلان كريدي؟', 'ar'],
    ['كيفاش ندير avoir؟', 'ar'],
    ['wach ma3na CUMP ?', 'darja'],
    ['chhal mazal men produit X fel stock ?', 'darja'],
    ['9adach 3andi f stock', 'darja'],
    ['comment importer mes clients depuis Excel ?', 'fr'],
    ["combien j'ai vendu cette semaine ?", 'fr'],
    ['how many clients do I have', 'en'],
  ])('%s → %s', (message, language) => {
    expect(detectLanguage(message)).toBe(language);
  });

  it('does not take a document number for arabizi', () => {
    expect(detectLanguage('où est BL-2026-000012 ?')).toBe('fr');
  });

  it('falls back to French on nothing to go by', () => {
    expect(detectLanguage('123 ?')).toBe('fr');
  });

  it('has an instruction and fallback texts for every language', () => {
    for (const hint of ['ar', 'darja', 'fr', 'en'] as const) {
      expect(languageInstruction(hint)).not.toBe('');
      expect(fallbackText.refusal(hint)).not.toBe('');
      expect(fallbackText.tooManySteps(hint)).not.toBe('');
    }
  });
});
