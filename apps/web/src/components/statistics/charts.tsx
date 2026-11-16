'use client';

/**
 * The charts of /statistiques (phase 37), on the shadcn chart component (recharts). This
 * module is only reached through `next/dynamic` with `ssr: false` (see stat-charts.tsx),
 * so the dashboard and every other page stay free of recharts.
 *
 * Motion: bars and areas grow once on first load (≤ 400 ms, ease-out), nothing on later
 * refreshes, nothing at all under `prefers-reduced-motion: reduce`.
 */
import { useLocale } from 'next-intl';
import { useEffect, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Label,
  Line,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from 'recharts';
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';

export const SERIES_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];

/** True only during the first 450 ms after mount, and never with reduced motion. */
function useFirstAnimation(): boolean {
  const [on, setOn] = useState(() => {
    if (typeof window === 'undefined') return false;
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });
  useEffect(() => {
    if (!on) return;
    const id = window.setTimeout(() => setOn(false), 450);
    return () => window.clearTimeout(id);
  }, [on]);
  return on;
}

/** Arabic is the one right-to-left language: its time axis runs right to left. */
function useRtl(): boolean {
  return useLocale() === 'ar';
}

const shortLabel = (s: string, max = 14) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

export interface ChartSeries {
  key: string;
  label: string;
}

export interface ChartRow {
  /** Stable key of the row (an id, or a bucket). */
  id: string;
  label: string;
  /** Plot values by series key (display only). */
  values: Record<string, number>;
  /** The API's text for each series, shown in the tooltip. */
  display: Record<string, string>;
}

function configOf(series: ChartSeries[]): ChartConfig {
  return Object.fromEntries(
    series.map((s, i) => [
      s.key,
      { label: s.label, color: SERIES_COLORS[i % SERIES_COLORS.length] },
    ]),
  );
}

/**
 * Bars per row: horizontal (ranking: trucks, products, the longest label first on a phone)
 * or vertical (few categories). Several series sit side by side, with a legend.
 */
export function RankBarChart({
  rows,
  series,
  horizontal = true,
  onSelect,
}: {
  rows: ChartRow[];
  series: ChartSeries[];
  horizontal?: boolean;
  onSelect?: (row: ChartRow) => void;
}) {
  const animate = useFirstAnimation();
  const rtl = useRtl();
  const data = rows.map((r) => ({ id: r.id, label: r.label, ...r.values, _display: r.display }));
  const height = horizontal ? Math.max(160, rows.length * (series.length * 14 + 14) + 40) : 260;
  return (
    <ChartContainer config={configOf(series)} className="aspect-auto w-full" style={{ height }}>
      <BarChart
        accessibilityLayer
        data={data}
        layout={horizontal ? 'vertical' : 'horizontal'}
        margin={{ left: 4, right: 12, top: 4, bottom: 4 }}
        barGap={2}
      >
        <CartesianGrid horizontal={!horizontal} vertical={horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" hide reversed={rtl} />
            <YAxis
              type="category"
              dataKey="label"
              width={96}
              tickLine={false}
              axisLine={false}
              orientation={rtl ? 'right' : 'left'}
              tickFormatter={(v: string) => shortLabel(v)}
            />
          </>
        ) : (
          <>
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              reversed={rtl}
              interval="preserveStartEnd"
              tickFormatter={(v: string) => shortLabel(v, 10)}
            />
            <YAxis hide />
          </>
        )}
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              formatter={(item) => {
                const display = item.payload?._display as Record<string, string> | undefined;
                return display?.[String(item.dataKey)] ?? '';
              }}
            />
          }
        />
        {series.length > 1 ? <ChartLegend content={<ChartLegendContent />} /> : null}
        {series.map((s) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            fill={`var(--color-${s.key})`}
            radius={4}
            isAnimationActive={animate}
            animationDuration={400}
            animationEasing="ease-out"
            className={onSelect ? 'cursor-pointer' : undefined}
            onClick={(entry: { payload?: { id?: string } }) => {
              const row = rows.find((r) => r.id === entry.payload?.id);
              if (row && onSelect) onSelect(row);
            }}
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
}

/** One figure over time, with the comparison period as a dashed line. */
export function TimeAreaChart({
  rows,
  current,
  previous,
}: {
  rows: ChartRow[];
  current: ChartSeries;
  previous: ChartSeries | null;
}) {
  const animate = useFirstAnimation();
  const rtl = useRtl();
  const series = previous ? [current, previous] : [current];
  const data = rows.map((r) => ({ id: r.id, label: r.label, ...r.values, _display: r.display }));
  return (
    <ChartContainer config={configOf(series)} className="aspect-auto h-60 w-full">
      <AreaChart accessibilityLayer data={data} margin={{ left: 4, right: 4, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          reversed={rtl}
          minTickGap={24}
          interval="preserveStartEnd"
        />
        <YAxis hide />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(item) => {
                const display = item.payload?._display as Record<string, string> | undefined;
                return display?.[String(item.dataKey)] ?? '';
              }}
            />
          }
        />
        {previous ? <ChartLegend content={<ChartLegendContent />} /> : null}
        <Area
          dataKey={current.key}
          type="monotone"
          fill={`var(--color-${current.key})`}
          fillOpacity={0.25}
          stroke={`var(--color-${current.key})`}
          strokeWidth={2}
          isAnimationActive={animate}
          animationDuration={400}
          animationEasing="ease-out"
        />
        {previous ? (
          <Line
            dataKey={previous.key}
            type="monotone"
            stroke={`var(--color-${previous.key})`}
            strokeWidth={2}
            strokeDasharray="4 4"
            dot={false}
            isAnimationActive={false}
          />
        ) : null}
      </AreaChart>
    </ChartContainer>
  );
}

export interface DonutSlice {
  id: string;
  label: string;
  value: number;
  display: string;
}

/** Shares of a whole, the total in the centre; the legend under it carries every value. */
export function DonutChart({
  slices,
  centre,
  centreLabel,
  onSelect,
}: {
  slices: DonutSlice[];
  centre: string;
  centreLabel: string;
  onSelect?: (slice: DonutSlice) => void;
}) {
  const animate = useFirstAnimation();
  const config: ChartConfig = Object.fromEntries(
    slices.map((s, i) => [
      s.id,
      { label: s.label, color: SERIES_COLORS[i % SERIES_COLORS.length] },
    ]),
  );
  return (
    <div className="space-y-3">
      <ChartContainer config={config} className="mx-auto aspect-square max-h-56">
        <PieChart>
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                hideLabel
                nameKey="id"
                formatter={(item) =>
                  typeof item.payload?.display === 'string' ? item.payload.display : ''
                }
              />
            }
          />
          <Pie
            data={slices}
            dataKey="value"
            nameKey="id"
            innerRadius="58%"
            strokeWidth={2}
            stroke="var(--background)"
            isAnimationActive={animate}
            animationDuration={400}
            onClick={(entry: { payload?: { id?: string } }) => {
              const slice = slices.find((s) => s.id === entry.payload?.id);
              if (slice && onSelect) onSelect(slice);
            }}
            className={onSelect ? 'cursor-pointer' : undefined}
          >
            {slices.map((s, i) => (
              <Cell key={s.id} fill={SERIES_COLORS[i % SERIES_COLORS.length]} />
            ))}
            <Label
              content={({ viewBox }) => {
                if (!viewBox || !('cx' in viewBox)) return null;
                const { cx, cy } = viewBox as { cx: number; cy: number };
                return (
                  <text
                    x={cx}
                    y={cy}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300"
                  >
                    <tspan x={cx} y={cy - 6} className="fill-foreground text-sm font-semibold">
                      {centre}
                    </tspan>
                    <tspan x={cx} y={cy + 12} className="fill-muted-foreground text-[10px]">
                      {centreLabel}
                    </tspan>
                  </text>
                );
              }}
            />
          </Pie>
        </PieChart>
      </ChartContainer>
      <ul className="grid gap-1 text-sm sm:grid-cols-2">
        {slices.map((s, i) => (
          <li key={s.id} className="flex min-w-0 items-center gap-2">
            <span
              className="size-2.5 shrink-0 rounded-[2px]"
              style={{ backgroundColor: SERIES_COLORS[i % SERIES_COLORS.length] }}
              aria-hidden
            />
            <span className="truncate">{s.label}</span>
            <bdi dir="ltr" className="num ms-auto whitespace-nowrap">
              {s.display}
            </bdi>
          </li>
        ))}
      </ul>
    </div>
  );
}
