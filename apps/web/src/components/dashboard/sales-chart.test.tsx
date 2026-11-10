import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DashboardSeriesPoint } from '@erp/shared';
import messages from '@/messages/fr.json';
import { SalesChart } from './sales-chart';

const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => true }));

const point = (day: string, ttc: string, count: number): DashboardSeriesPoint => ({
  from: day,
  to: day,
  ttc,
  count,
  cash: null,
  margin: null,
  previousTtc: '0.00',
});

const POINTS = [
  point('2026-11-08', '1000.00', 1),
  point('2026-11-09', '0.00', 0),
  point('2026-11-10', '2500.00', 3),
];

function renderChart() {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages} timeZone="Africa/Algiers">
      <SalesChart
        points={POINTS}
        bucket="day"
        salesHref={(from, to) => `/ventes?from=${from}&to=${to}`}
      />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  push.mockReset();
});

describe('SalesChart', () => {
  it('moves between bars with the arrow keys, Home and End, and says the picked bar', () => {
    renderChart();
    const bars = screen
      .getAllByRole('button', { pressed: false })
      .filter((b) => b.getAttribute('aria-label')?.includes('nov.'));
    expect(bars).toHaveLength(3);
    // The tab stop is today's bar.
    expect(bars.map((b) => b.tabIndex)).toEqual([-1, -1, 0]);

    bars[2]!.focus();
    fireEvent.keyDown(bars[2]!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(bars[1]);
    expect(bars[1]!.getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(bars[1]!, { key: 'Home' });
    expect(document.activeElement).toBe(bars[0]);
    fireEvent.keyDown(bars[0]!, { key: 'End' });
    expect(document.activeElement).toBe(bars[2]);
    expect(screen.getByText(/3 documents/)).toBeTruthy();
    expect(bars[2]!.getAttribute('aria-label')).toMatch(/2.500,00.DA, 3 documents/);
  });

  it('a first tap shows the bar, a second one opens the sales of that day', () => {
    renderChart();
    const first = screen
      .getAllByRole('button')
      .find((b) => b.getAttribute('aria-label')?.startsWith('8 nov.'))!;
    fireEvent.click(first);
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(first);
    expect(push).toHaveBeenCalledWith('/ventes?from=2026-11-08&to=2026-11-08');
  });
});
