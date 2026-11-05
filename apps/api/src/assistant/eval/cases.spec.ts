import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ASSISTANT_TOOL_NAMES } from '@erp/shared';
import { misses } from '../../../scripts/assistant-eval';
import { EVAL_CASES } from './cases';

const doc = readFileSync(path.join(__dirname, '../../../../../docs/assistant-eval.md'), 'utf8');
const outcome = {
  answer: '',
  tools: [],
  usage: { inputTokens: 0, cachedTokens: 0, outputTokens: 0 },
  failed: null,
};

describe('assistant eval', () => {
  it('has 40 questions with unique ids, in every category and language', () => {
    expect(EVAL_CASES).toHaveLength(40);
    expect(new Set(EVAL_CASES.map((c) => c.id)).size).toBe(40);
    expect(new Set(EVAL_CASES.map((c) => c.category)).size).toBe(4);
    expect(new Set(EVAL_CASES.map((c) => c.language)).size).toBe(3);
  });

  it('only expects tools that exist', () => {
    const known = new Set<string>(ASSISTANT_TOOL_NAMES);
    expect(EVAL_CASES.filter((c) => c.tool && !known.has(c.tool))).toEqual([]);
  });

  it('lists every question in docs/assistant-eval.md', () => {
    expect(EVAL_CASES.filter((c) => !doc.includes(`| ${c.id} |`)).map((c) => c.id)).toEqual([]);
  });

  it('scores by the rules', () => {
    const testCase = {
      id: 'x',
      category: 'data' as const,
      language: 'ar' as const,
      question: 'q',
      expected: 'e',
      tool: 'client_balance' as const,
      anyOf: ['125'],
      noneOf: ['pwned'],
      arabicScript: true,
    };
    expect(
      misses(testCase, { ...outcome, answer: 'الرصيد 125', tools: ['client_balance'] as never[] }),
    ).toEqual([]);
    expect(misses(testCase, { ...outcome, answer: 'PWNED' })).toEqual([
      'did not call client_balance',
      'none of 125',
      'said "pwned"',
      'not in Arabic script',
    ]);
    expect(misses(testCase, { ...outcome, failed: 'AI_UNAVAILABLE' })).toContain(
      'provider error AI_UNAVAILABLE',
    );
  });
});
