export type LanguageHint = 'ar' | 'darja' | 'fr' | 'en';

const ARABIC = /[؀-ۿ]/g;
/** Arabizi: a digit standing for a letter inside a word (ma3na, 9adach, 7aja). */
const ARABIZI_DIGIT = /[a-z][379][a-z]|\b[379][a-z]{2,}/i;
const DARJA_WORDS =
  /\b(wach|wesh|chhal|ch7al|kifach|kifah|kifech|mazal|rani|raki|bghit|nheb|ndir|nzid|fel|hada|hadi|tani|bezaf|khlas|sah|wahed)\b/i;
const FRENCH =
  /[àâçéèêëîïôùûüœ]|\b(comment|combien|je|j'ai|mes|mon|une?|les?|des|pour|avec|quel|quelle|est|faire|où|bonjour)\b/i;
const ENGLISH = /\b(how|what|which|where|the|show|my|can|hello|many|much|sold)\b/i;

/**
 * A hint for the model, not a decision: it reads the question too. It keeps the answer in
 * the user's language when the same conversation mixes them.
 */
export function detectLanguage(message: string): LanguageHint {
  const letters = message.replace(/[\s\d\p{P}]/gu, '').length;
  const arabic = (message.match(ARABIC) ?? []).length;
  if (letters > 0 && arabic / letters >= 0.4) return 'ar';
  if (ARABIZI_DIGIT.test(message) || DARJA_WORDS.test(message)) return 'darja';
  if (FRENCH.test(message)) return 'fr';
  return ENGLISH.test(message) ? 'en' : 'fr';
}

const REPLY_IN: Record<LanguageHint, string> = {
  ar: 'The user writes Arabic: answer in Arabic script.',
  darja:
    'The user writes Algerian darja in Latin letters: answer in simple darja, in the same Latin letters.',
  fr: 'The user writes French: answer in French.',
  en: 'The user writes English: answer in English.',
};

export function languageInstruction(hint: LanguageHint): string {
  return REPLY_IN[hint];
}

const NO_ANSWER: Record<LanguageHint, string> = {
  ar: 'لا أستطيع الإجابة عن هذا السؤال. جرّب طرحه بطريقة أخرى.',
  darja: 'Ma n9derch njaweb 3la had so2al. Jarreb t9oulha b tari9a okhra.',
  fr: 'Je ne peux pas répondre à cette question. Essayez de la formuler autrement.',
  en: 'I cannot answer this question. Try asking it another way.',
};

const TOO_MANY_STEPS: Record<LanguageHint, string> = {
  ar: 'لم أتمكن من إنهاء البحث. جرّب سؤالا أبسط.',
  darja: 'Ma kmeltch el bahth. Jarreb so2al asahel.',
  fr: "Je n'ai pas pu terminer la recherche. Essayez une question plus simple.",
  en: 'I could not finish looking this up. Try a simpler question.',
};

export const fallbackText = {
  refusal: (hint: LanguageHint) => NO_ANSWER[hint],
  tooManySteps: (hint: LanguageHint) => TOO_MANY_STEPS[hint],
};
