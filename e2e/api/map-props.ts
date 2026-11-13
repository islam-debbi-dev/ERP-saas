/**
 * Property tests of the pure geo helpers of phase 35 (`packages/shared/src/geo.ts`), on
 * random inputs drawn from a fixed seed. No API, no database.
 *
 *   pnpm exec tsx api/map-props.ts
 *
 * `orderByNearest`: the output is a permutation of the input, stops without a point keep
 * their relative order at the end, the result is deterministic, every step goes to a
 * nearest remaining point, and the start rule holds (given start, else first located).
 * `boundingBox`: no point within the radius ever falls outside the box.
 */
import {
  boundingBox,
  haversineM,
  type LatLng,
  orderByNearest,
} from '../../packages/shared/src/geo.ts';
import { area, assert, check, summary, writeSummary } from '../lib/harness.ts';
import { prng } from '../lib/map-fixture.ts';

interface P {
  id: number;
  lat: number | null;
  lng: number | null;
}

const RUNS = 400;

function draw(rnd: () => number, n: number, mode: number): P[] {
  return Array.from({ length: n }, (_, id) => {
    if (rnd() < 0.15) return { id, lat: rnd() < 0.5 ? null : 36 + rnd(), lng: null };
    if (mode === 1) return { id, lat: 36.75, lng: 3.05 }; // all on one point: only ties
    if (mode === 2) return { id, lat: Math.round(36 + rnd() * 3), lng: Math.round(3 + rnd() * 3) }; // grid: many ties
    if (mode === 3) return { id, lat: rnd() * 180 - 90, lng: rnd() * 360 - 180 }; // whole globe
    return { id, lat: 35 + rnd() * 2, lng: -1 + rnd() * 7 }; // northern Algeria
  });
}

const located = (p: P): p is P & LatLng => p.lat !== null && p.lng !== null;

function problems(start: LatLng | null, input: P[]): string[] {
  const out = orderByNearest(start, input);
  const bad: string[] = [];
  if (out.length !== input.length) bad.push(`length ${out.length} for ${input.length}`);
  if (new Set(out).size !== out.length || out.some((p) => !input.includes(p))) bad.push('not a permutation');
  const firstUnlocated = out.findIndex((p) => !located(p));
  if (firstUnlocated >= 0 && out.slice(firstUnlocated).some(located)) bad.push('a located stop after an unlocated one');
  const tail = out.filter((p) => !located(p)).map((p) => p.id);
  const expectedTail = input.filter((p) => !located(p)).map((p) => p.id);
  if (tail.join() !== expectedTail.join()) bad.push('unlocated stops lost their relative order');
  const again = orderByNearest(start, input);
  if (again.map((p) => p.id).join() !== out.map((p) => p.id).join()) bad.push('not deterministic');
  if (orderByNearest(start, [...input]).map((p) => p.id).join() !== out.map((p) => p.id).join()) bad.push('depends on the array identity');

  // Greedy rule: each step is a nearest remaining point; ties keep the input order.
  const head = out.filter(located);
  const left = input.filter(located);
  let here: LatLng | null = start;
  for (let i = 0; i < head.length; i++) {
    const next = head[i]!;
    if (!here) {
      if (next !== left[0]) bad.push('without a start, the first located stop must stay first');
    } else {
      const d = haversineM(here, next);
      const best = Math.min(...left.map((p) => haversineM(here!, p)));
      if (d > best) bad.push(`step ${i} is ${d - best} m farther than the nearest`);
      const firstBest = left.find((p) => haversineM(here!, p) === best);
      if (d === best && firstBest !== next) bad.push(`step ${i}: tie not resolved in input order`);
    }
    left.splice(left.indexOf(next), 1);
    here = next;
    if (bad.length > 3) break;
  }
  return bad;
}

async function main(): Promise<void> {
  area('orderByNearest — properties');
  for (const [label, withStart] of [['with a start', true], ['without a start', false]] as const) {
    await check(`${RUNS} random sets of 0 to 300 points, ${label}`, () => {
      const rnd = prng(withStart ? 3501 : 3502);
      for (let run = 0; run < RUNS; run++) {
        const n = run < 4 ? run : Math.floor(rnd() * 301);
        const input = draw(rnd, n, run % 4);
        const start = withStart ? { lat: 36.7 + rnd() * 0.1, lng: 3 + rnd() * 0.1 } : null;
        const bad = problems(start, input);
        assert(bad.length === 0, `run ${run} (n=${n}, mode ${run % 4}): ${bad.join('; ')}`);
      }
    });
  }
  await check('the input array is not mutated', () => {
    const rnd = prng(3503);
    const input = draw(rnd, 120, 0);
    const copy = input.map((p) => ({ ...p }));
    orderByNearest({ lat: 36.7, lng: 3 }, input);
    assert(JSON.stringify(input) === JSON.stringify(copy), 'the caller\'s list changed');
  });
  await check('300 stops are ordered in under 50 ms', () => {
    const rnd = prng(3504);
    const input = draw(rnd, 300, 0);
    const t = performance.now();
    for (let i = 0; i < 20; i++) orderByNearest({ lat: 36.7, lng: 3 }, input);
    const ms = (performance.now() - t) / 20;
    assert(ms < 50, `${ms.toFixed(1)} ms per call`);
  });
  await check('a NaN coordinate does not lose or duplicate a stop', () => {
    const input: P[] = [
      { id: 0, lat: 36.7, lng: 3.0 },
      { id: 1, lat: Number.NaN, lng: 3.1 },
      { id: 2, lat: 36.8, lng: 3.2 },
    ];
    const out = orderByNearest(null, input);
    assert(out.length === 3 && new Set(out.map((p) => p.id)).size === 3, `got ${JSON.stringify(out.map((p) => p.id))}`);
  });

  area('boundingBox — never smaller than the circle');
  await check('20 000 random points within the radius are inside the box', () => {
    const rnd = prng(3505);
    for (let i = 0; i < 20_000; i++) {
      const center = { lat: rnd() * 179.8 - 89.9, lng: rnd() * 360 - 180 };
      const radiusM = 100 + rnd() * 49_900;
      // A point at a random bearing and a distance up to the radius.
      const bearing = rnd() * 2 * Math.PI;
      const dist = rnd() * radiusM;
      const R = 6_371_008.8;
      const φ1 = (center.lat * Math.PI) / 180;
      const λ1 = (center.lng * Math.PI) / 180;
      const δ = dist / R;
      const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(bearing));
      const λ2 = λ1 + Math.atan2(Math.sin(bearing) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
      const p = { lat: (φ2 * 180) / Math.PI, lng: ((((λ2 * 180) / Math.PI + 540) % 360) + 360) % 360 - 180 };
      if (haversineM(center, p) > radiusM) continue;
      const box = boundingBox(center, radiusM);
      const latIn = p.lat >= box.minLat - 1e-9 && p.lat <= box.maxLat + 1e-9;
      const lngIn =
        box.minLng <= box.maxLng
          ? p.lng >= box.minLng - 1e-9 && p.lng <= box.maxLng + 1e-9
          : p.lng >= box.minLng - 1e-9 || p.lng <= box.maxLng + 1e-9;
      assert(
        latIn && lngIn,
        `centre ${JSON.stringify(center)} r=${radiusM.toFixed(0)}: ${JSON.stringify(p)} at ${haversineM(center, p).toFixed(0)} m is outside ${JSON.stringify(box)}`,
      );
    }
  });

  writeSummary('test-35/props');
  if (summary().failed > 0) process.exitCode = 1;
}

void main();
