import { algiersDay, money } from '@erp/shared';
import { algiersMidnight } from '../common/algiers';
import type { AiPrices } from './ai-config.service';
import type { LlmUsage } from './llm/llm-provider';

/**
 * Prices are per million tokens, so tokens × price is already in millionths of a dollar.
 * `inputTokens` holds the cached ones, which are paid at their own rate.
 */
export function costMicroUsd(usage: LlmUsage, prices: AiPrices): bigint {
  const uncached = Math.max(usage.inputTokens - usage.cachedTokens, 0);
  const cost = money(uncached)
    .times(money(prices.input))
    .plus(money(usage.cachedTokens).times(money(prices.cachedInput)))
    .plus(money(usage.outputTokens).times(money(prices.output)));
  return BigInt(cost.toFixed(0));
}

export interface Period {
  start: Date;
  end: Date;
}

function firstOfNextMonth(day: string): string {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
}

/** The Algiers month of `now`, and the day its quota comes back. */
export function algiersMonth(now = new Date()): Period & { resetDate: string } {
  const today = algiersDay(now);
  const resetDate = firstOfNextMonth(today);
  return {
    start: algiersMidnight(`${today.slice(0, 7)}-01`),
    end: algiersMidnight(resetDate),
    resetDate,
  };
}

export function algiersToday(now = new Date()): Period {
  const start = algiersMidnight(algiersDay(now));
  return { start, end: new Date(start.getTime() + 86_400_000) };
}
