import { describe, expect, it } from 'vitest';
import {
  achievementPercent,
  bucketStart,
  cappedDelivered,
  comparisonRange,
  deliveryRate,
  deriveRatio,
  dropSize,
  frozenWeightKg,
  isWholeMonths,
  kgToTonnes,
  lineWeightKg,
  monthRange,
  previousMonthStart,
  ratePercent,
  skuPerBl,
  STAT_MEASURE_KEYS,
  STAT_MEASURES,
  statBuckets,
  type StatMeasureDef,
  TARGET_MEASURE,
  trendPercent,
  VEHICLE_TARGET_METRICS,
} from './distribution-stats';
import { Edition, editionsWith, Feature } from './features';
import {
  distributionStatsQuerySchema,
  putVehicleTargetsSchema,
  statsExportQuerySchema,
  statsTimelineQuerySchema,
} from './schemas/distribution-stats';

describe('measure registry', () => {
  it('derives every ratio from two sum or distinct measures that exist', () => {
    for (const key of STAT_MEASURE_KEYS) {
      const def: StatMeasureDef = STAT_MEASURES[key];
      if (def.additivity !== 'ratio') {
        expect(def.of, key).toBeUndefined();
        continue;
      }
      expect(def.of, key).toBeDefined();
      for (const part of def.of!) {
        expect(STAT_MEASURE_KEYS, `${key} ← ${part}`).toContain(part);
        expect(STAT_MEASURES[part as keyof typeof STAT_MEASURES].additivity).not.toBe('ratio');
      }
    }
  });

  it('maps every target metric to a measure', () => {
    for (const metric of VEHICLE_TARGET_METRICS) {
      expect(STAT_MEASURE_KEYS).toContain(TARGET_MEASURE[metric]);
    }
  });

  it('sells the statistics in Distribution and Entreprise only', () => {
    expect(editionsWith(Feature.DISTRIBUTION_STATS)).toEqual([
      Edition.DISTRIBUTION,
      Edition.ENTREPRISE,
    ]);
  });
});

describe('drop size, SKU / BL and rates', () => {
  it('gives no drop size with 0 BL', () => {
    expect(dropSize('1500.00', 0)).toBeNull();
    expect(dropSize('0', 0)).toBeNull();
  });

  it('divides the CA by the number of BL, rounded half-up to the centime', () => {
    expect(dropSize('1000.00', 3)).toBe('333.33');
    expect(dropSize('2000.00', 3)).toBe('666.67');
    expect(dropSize('-150.00', 2)).toBe('-75.00');
  });

  it('averages distinct products per BL', () => {
    expect(skuPerBl(7, 2)).toBe('3.50');
    expect(skuPerBl(0, 0)).toBeNull();
  });

  it('gives null ratios on a zero base', () => {
    expect(ratePercent(5, 0)).toBeNull();
    expect(ratePercent(0, 8)).toBe('0.0');
    expect(ratePercent(7, 8)).toBe('87.5');
    expect(achievementPercent('50', '0')).toBeNull();
    expect(achievementPercent('1250.5', '1000')).toBe('125.1');
  });

  it('lets the recouvrement exceed 100 % when old debt is paid', () => {
    expect(deriveRatio('recouvrement', '1500.00', '1000.00')).toBe('150.0');
    expect(deriveRatio('recouvrement', '10.00', '0')).toBeNull();
  });

  it('derives each ratio in its own unit', () => {
    expect(deriveRatio('dropSize', '1000.00', 3)).toBe('333.33');
    expect(deriveRatio('skuPerBl', 7, 2)).toBe('3.50');
    expect(deriveRatio('visitRate', 3, 4)).toBe('75.0');
  });

  it('compares with a previous value only when there is one', () => {
    expect(trendPercent('120', '100')).toBe('20.0');
    expect(trendPercent('80', '100')).toBe('-20.0');
    expect(trendPercent('80', '0')).toBeNull();
    expect(trendPercent('80', '-5')).toBeNull();
  });
});

describe('taux de livraison', () => {
  it('caps each line at what was ordered', () => {
    expect(cappedDelivered('10', '12')).toBe('10.000');
    expect(cappedDelivered('10', '4.5')).toBe('4.500');
    expect(cappedDelivered('10', null)).toBe('0.000');
    expect(cappedDelivered('10', '-1')).toBe('0.000');
  });

  it('never exceeds 100 %, even when one line was over-delivered', () => {
    expect(
      deliveryRate([
        { ordered: '10', delivered: '15' },
        { ordered: '10', delivered: '10' },
      ]),
    ).toBe('100.0');
    // The over-delivery of line 1 does not hide the short line 2.
    expect(
      deliveryRate([
        { ordered: '10', delivered: '30' },
        { ordered: '10', delivered: '5' },
      ]),
    ).toBe('75.0');
  });

  it('counts a cancelled order as not delivered, and nothing as no rate', () => {
    expect(deliveryRate([{ ordered: '8', delivered: null }])).toBe('0.0');
    expect(deliveryRate([])).toBeNull();
  });
});

describe('weights', () => {
  it('uses the frozen weight when the line has one', () => {
    expect(lineWeightKg({ frozenKg: '12.500', qtyBase: '10', productWeightKg: '2' })).toEqual({
      kg: '12.500',
      estimated: false,
    });
  });

  it('estimates an old line from the current product weight', () => {
    expect(lineWeightKg({ frozenKg: null, qtyBase: '10', productWeightKg: '1.25' })).toEqual({
      kg: '12.500',
      estimated: true,
    });
  });

  it('keeps a weight unknown rather than 0', () => {
    expect(lineWeightKg({ frozenKg: null, qtyBase: '10', productWeightKg: null })).toEqual({
      kg: null,
      estimated: false,
    });
    expect(frozenWeightKg('10', null)).toBeNull();
  });

  it('freezes quantity × weight and prints tonnes with 3 decimals', () => {
    expect(frozenWeightKg('2.5', '0.333')).toBe('0.833');
    expect(kgToTonnes('12350')).toBe('12.350');
    expect(kgToTonnes('0.4')).toBe('0.000');
  });
});

describe('comparison periods', () => {
  it('has none when nothing is compared', () => {
    expect(comparisonRange({ from: '2026-11-01', to: '2026-11-16' }, 'none')).toBeNull();
  });

  it('takes the same number of days just before, across a month end', () => {
    expect(comparisonRange({ from: '2026-11-01', to: '2026-11-16' }, 'previous')).toEqual({
      from: '2026-10-16',
      to: '2026-10-31',
    });
    expect(comparisonRange({ from: '2026-03-01', to: '2026-03-03' }, 'previous')).toEqual({
      from: '2026-02-26',
      to: '2026-02-28',
    });
  });

  it('compares a whole month with the whole month before', () => {
    expect(isWholeMonths({ from: '2026-10-01', to: '2026-10-31' })).toBe(true);
    expect(isWholeMonths({ from: '2026-10-01', to: '2026-10-30' })).toBe(false);
    expect(comparisonRange({ from: '2026-10-01', to: '2026-10-31' }, 'previous')).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(comparisonRange({ from: '2024-03-01', to: '2024-03-31' }, 'previous')).toEqual({
      from: '2024-02-01',
      to: '2024-02-29',
    });
    expect(comparisonRange({ from: '2026-01-01', to: '2026-03-31' }, 'previous')).toEqual({
      from: '2025-10-01',
      to: '2025-12-31',
    });
  });

  it('goes back one year, clipping 29 February', () => {
    expect(comparisonRange({ from: '2026-11-01', to: '2026-11-16' }, 'lastYear')).toEqual({
      from: '2025-11-01',
      to: '2025-11-16',
    });
    expect(comparisonRange({ from: '2024-02-20', to: '2024-02-29' }, 'lastYear')).toEqual({
      from: '2023-02-20',
      to: '2023-02-28',
    });
    expect(comparisonRange({ from: '2025-02-01', to: '2025-02-28' }, 'lastYear')).toEqual({
      from: '2024-02-01',
      to: '2024-02-29',
    });
  });
});

describe('buckets (Algiers days)', () => {
  it('starts a week on Sunday and a month on the 1st', () => {
    // 2026-11-16 is a Monday.
    expect(bucketStart('2026-11-16', 'day')).toBe('2026-11-16');
    expect(bucketStart('2026-11-16', 'week')).toBe('2026-11-15');
    expect(bucketStart('2026-11-15', 'week')).toBe('2026-11-15');
    expect(bucketStart('2026-11-16', 'month')).toBe('2026-11-01');
  });

  it('lists every day, empty ones included', () => {
    expect(
      statBuckets({ from: '2026-02-27', to: '2026-03-01' }, 'day').map((b) => b.bucket),
    ).toEqual(['2026-02-27', '2026-02-28', '2026-03-01']);
  });

  it('clips the first and last week to the range', () => {
    expect(statBuckets({ from: '2026-11-10', to: '2026-11-24' }, 'week')).toEqual([
      { bucket: '2026-11-08', from: '2026-11-10', to: '2026-11-14' },
      { bucket: '2026-11-15', from: '2026-11-15', to: '2026-11-21' },
      { bucket: '2026-11-22', from: '2026-11-22', to: '2026-11-24' },
    ]);
  });

  it('cuts months at their real length, leap years included', () => {
    expect(statBuckets({ from: '2024-01-15', to: '2024-03-10' }, 'month')).toEqual([
      { bucket: '2024-01-01', from: '2024-01-15', to: '2024-01-31' },
      { bucket: '2024-02-01', from: '2024-02-01', to: '2024-02-29' },
      { bucket: '2024-03-01', from: '2024-03-01', to: '2024-03-10' },
    ]);
  });

  it('knows the month of a day and the month before', () => {
    expect(monthRange('2024-02-10')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(previousMonthStart('2026-01-01')).toBe('2025-12-01');
    expect(previousMonthStart('2026-11-01')).toBe('2026-10-01');
  });
});

describe('query schemas', () => {
  const A = '11111111-1111-4111-8111-111111111111';
  const B = '22222222-2222-4222-8222-222222222222';

  it('reads multi-select filters from a comma list, without duplicates', () => {
    const q = distributionStatsQuerySchema.parse({
      from: '2026-11-01',
      to: '2026-11-16',
      vehicleIds: `${A},${B},${A}`,
      vehicleWilayas: '28,5',
      activities: 'CASH_VAN',
      clientWilayas: "M'sila, Batna",
    });
    expect(q.vehicleIds).toEqual([A, B]);
    expect(q.vehicleWilayas).toEqual([28, 5]);
    expect(q.activities).toEqual(['CASH_VAN']);
    expect(q.clientWilayas).toEqual(["M'sila", 'Batna']);
    expect(q.compare).toBe('none');
    expect(q.groupBy).toBe('day');
    expect(q.brandIds).toBeUndefined();
  });

  it('refuses a reversed range, more than 366 days and a wilaya that does not exist', () => {
    const bad = (q: Record<string, string>) => distributionStatsQuerySchema.safeParse(q).success;
    expect(bad({ from: '2026-11-02', to: '2026-11-01' })).toBe(false);
    expect(bad({ from: '2025-01-01', to: '2026-01-02' })).toBe(false);
    expect(bad({ from: '2024-01-01', to: '2024-12-31' })).toBe(true);
    expect(bad({ from: '2026-11-01', to: '2026-11-02', vehicleWilayas: '70' })).toBe(false);
    expect(bad({ from: '2026-11-01', to: '2026-11-02', vehicleIds: 'not-a-uuid' })).toBe(false);
  });

  it('splits a timeline by at most 8 trucks', () => {
    const ids = Array.from({ length: 9 }, (_, i) => `${A.slice(0, -1)}${i}`).join(',');
    const base = { from: '2026-11-01', to: '2026-11-02', measure: 'caTtc', splitBy: 'vehicle' };
    expect(statsTimelineQuerySchema.safeParse({ ...base, vehicleIds: ids }).success).toBe(false);
    expect(statsTimelineQuerySchema.safeParse({ ...base, vehicleIds: `${A},${B}` }).success).toBe(
      true,
    );
    expect(statsTimelineQuerySchema.safeParse({ ...base, measure: 'nope' }).success).toBe(false);
  });

  it('asks an export for what its view needs', () => {
    expect(statsExportQuerySchema.safeParse({ view: 'overview' }).success).toBe(false);
    expect(
      statsExportQuerySchema.safeParse({ view: 'overview', from: '2026-11-01', to: '2026-11-02' })
        .success,
    ).toBe(true);
    expect(
      statsExportQuerySchema.safeParse({
        view: 'by-dimension',
        from: '2026-11-01',
        to: '2026-11-02',
      }).success,
    ).toBe(false);
    expect(
      statsExportQuerySchema.safeParse({ view: 'vehicle-day', vehicleId: A, date: '2026-11-02' })
        .success,
    ).toBe(true);
  });

  it('takes a month of targets: positive values, one per truck and metric', () => {
    const row = { vehicleId: A, metric: 'CA_TTC', targetValue: '1 500 000,5' };
    const ok = putVehicleTargetsSchema.parse({ period: '2026-11-01', targets: [row] });
    expect(ok.targets[0]!.targetValue).toBe('1500000.5');
    const bad = (body: unknown) => putVehicleTargetsSchema.safeParse(body).success;
    expect(bad({ period: '2026-11-02', targets: [row] })).toBe(false);
    expect(bad({ period: '2026-11-01', targets: [row, row] })).toBe(false);
    expect(bad({ period: '2026-11-01', targets: [{ ...row, targetValue: '0' }] })).toBe(false);
    expect(bad({ period: '2026-11-01', targets: [{ ...row, targetValue: null }] })).toBe(true);
  });
});
