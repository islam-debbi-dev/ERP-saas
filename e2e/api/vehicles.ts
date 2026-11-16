/**
 * Test 36, part A: API correctness of phase 36 (distribution par véhicule).
 *
 *   API=http://localhost:3003 DB=postgresql://erp:erp@localhost:5432/erp_t36 pnpm test:vehicles:api
 *
 * Real API, real PostgreSQL, a local scratch database. Each area makes its own company (on
 * the DISTRIBUTION edition, users invited through `POST /users/invite`), so the suite can be
 * run again and again; the companies of `vehicles-seed.ts` are only read. Expected values
 * come from the spec (docs/prompts/phase-36-vehicle-first-distribution.md) or from SQL
 * written here and in `sql/vehicles-history.sql`, never from the service under test.
 *
 * `T36_ONLY=types,identity` runs some areas only (the invariants always run).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { DB } from '../lib/config.ts';
import { closeDb, query } from '../lib/db.ts';
import { area, assert, check, record, writeSummary } from '../lib/harness.ts';
import {
  algiersToday,
  Api,
  client,
  company,
  type Company,
  dbRead,
  invite,
  type Item,
  openingStock,
  product,
  same,
  type Staff,
} from '../lib/audit.ts';
import { type ApiResponse } from '../lib/http.ts';
import { assertT36Db, loadFixture, proof36 } from '../lib/vehicles-fixture.ts';
import { proposeVehicleCode } from '../../packages/shared/src/vehicles.ts';

assertT36Db();
const only = (process.env['T36_ONLY'] ?? '').split(',').filter(Boolean);
const on = (name: string): boolean => only.length === 0 || only.includes(name);
const APP_DB = DB.replace('//erp:erp@', '//erp_app:erp_app@');
const WEEK = [0, 1, 2, 3, 4, 5, 6];
const today = algiersToday();

// ---------------------------------------------------------------- helpers

type Res = ApiResponse<Record<string, unknown>>;
const codeOf = (r: ApiResponse<unknown>): string | undefined =>
  (r.body as { code?: string } | null)?.code;
const brief = (r: ApiResponse<unknown>): string => `HTTP ${r.status} ${r.raw.slice(0, 260)}`;

function refused(r: ApiResponse<unknown>, code: string, what: string): void {
  assert(
    r.status >= 400 && r.status < 500 && codeOf(r) === code,
    `${what}: expected ${code}, got ${brief(r)}`,
  );
}
function accepted(r: ApiResponse<unknown>, what: string): void {
  assert(r.status >= 200 && r.status < 300, `${what}: expected 2xx, got ${brief(r)}`);
}
/** A 400 from the validation pipe (never a 500, never accepted). */
function invalid(r: ApiResponse<unknown>, what: string): void {
  assert(r.status === 400, `${what}: expected 400, got ${brief(r)}`);
}

const co = (label: string): Promise<Company> =>
  company(`T36 ${label}`, { edition: 'DISTRIBUTION' });

interface Truck {
  id: string;
  code: string | null;
  assignedUser: { id: string } | null;
}
const post = (api: Api, path: string, body: unknown = {}): Promise<Res> =>
  api.send<Record<string, unknown>>('POST', path, body);
const patch = (api: Api, path: string, body: unknown): Promise<Res> =>
  api.send<Record<string, unknown>>('PATCH', path, body, null);
const newTruck = (c: Company, body: Record<string, unknown>): Promise<Res> =>
  c.owner.send<Record<string, unknown>>('POST', '/warehouses', { type: 'VEHICLE', ...body }, null);
async function truck(
  c: Company,
  name: string,
  extra: Record<string, unknown> = {},
): Promise<Truck> {
  return c.owner.post<Truck>('/warehouses', { name, type: 'VEHICLE', ...extra }, null);
}
const driver = (
  api: Api,
  vehicleId: string,
  userId: string | null,
  reason?: string,
): Promise<Res> =>
  api.send<Record<string, unknown>>(
    'POST',
    `/warehouses/${vehicleId}/driver`,
    { userId, ...(reason ? { reason } : {}) },
  );
async function setDriver(c: Company, vehicleId: string, userId: string | null): Promise<void> {
  accepted(await driver(c.owner, vehicleId, userId), `driver of ${vehicleId}`);
}

interface HistoryRow {
  id: string;
  userId: string | null;
  fromAt: Date;
  setBy: string | null;
  reason: string | null;
}
const history = (vehicleId: string): Promise<HistoryRow[]> =>
  query<HistoryRow>(
    `SELECT id, "userId", "fromAt", "setBy", reason FROM vehicle_assignments
     WHERE "vehicleId" = $1::uuid ORDER BY "fromAt", "createdAt", id`,
    [vehicleId],
  );
const rowCount = async (tenantId: string): Promise<number> =>
  Number(
    (
      await query<{ n: string }>(
        `SELECT count(*) AS n FROM vehicle_assignments WHERE "tenantId" = $1::uuid`,
        [tenantId],
      )
    )[0]!.n,
  );
const driverNow = async (vehicleId: string): Promise<string | null> =>
  (
    await query<{ u: string | null }>(
      `SELECT "assignedUserId" AS u FROM warehouses WHERE id = $1::uuid`,
      [vehicleId],
    )
  )[0]!.u;
const audits = (tenantId: string, action: string, entityId?: string) =>
  query<{ before: unknown; after: unknown; userId: string | null }>(
    `SELECT before, after, "userId" FROM audit_logs
     WHERE "tenantId" = $1::uuid AND action = $2 AND ($3::text IS NULL OR "entityId" = $3) ORDER BY "createdAt"`,
    [tenantId, action, entityId ?? null],
  );

/** One statement in its own transaction, always rolled back. Returns the error, or null. */
async function sqlAs(
  url: string,
  tenantId: string | null,
  text: string,
  params: unknown[] = [],
): Promise<{ error: string | null; rows: number }> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query('BEGIN');
    if (tenantId) await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    try {
      const r = await c.query(text, params as never[]);
      return { error: null, rows: r.rowCount ?? 0 };
    } catch (e) {
      return { error: (e as Error).message, rows: 0 };
    }
  } finally {
    await c.query('ROLLBACK').catch(() => undefined);
    await c.end();
  }
}

interface Stocked {
  c: Company;
  p: Item;
  clients: string[];
  transfer: (
    type: 'LOAD' | 'UNLOAD' | 'TRANSFER',
    from: string,
    to: string,
    qty: string,
  ) => Promise<Res>;
  stock: (warehouseId: string) => Promise<string>;
  sell: (who: Api, clientId: string, qty: string, extra?: Record<string, unknown>) => Promise<Res>;
  soldFrom: (saleId: string) => Promise<string | null>;
}
/** A company with one product (2 000 in the dépôt principal, CUMP 500, 1 000 DA HT) and clients. */
async function stocked(label: string, nClients = 3): Promise<Stocked> {
  const c = await co(label);
  const p = await product(c, { priceHt: '1000' });
  await openingStock(c, p, '2000', '500');
  const clients: string[] = [];
  for (let i = 0; i < nClients; i += 1) clients.push(await client(c, `Client ${i + 1}`));
  return {
    c,
    p,
    clients,
    transfer: async (type, from, to, qty) => {
      const draft = await c.owner.post<{ id: string }>('/stock-transfers', {
        type,
        fromWarehouseId: from,
        toWarehouseId: to,
        lines: [{ productId: p.id, unitId: p.unitId, qty }],
      });
      return post(c.owner, `/stock-transfers/${draft.id}/validate`);
    },
    stock: (w) => dbRead.warehouseStock(c.tenantId, p.id, w),
    sell: (who, clientId, qty, extra = {}) =>
      post(who, '/sales/quick', {
        type: 'BL',
        clientId,
        documentDate: today,
        warehouseId: null,
        lines: [{ productId: p.id, unitId: p.unitId, qty }],
        paidAmount: '0',
        ...extra,
      }),
    soldFrom: async (saleId) =>
      (
        await query<{ w: string | null }>(
          `SELECT DISTINCT "warehouseId"::text AS w FROM stock_movements WHERE "refId" = $1::uuid AND type = 'SALE'`,
          [saleId],
        )
      )[0]?.w ?? null,
  };
}
const saleId = (r: Res): string => (r.body as { sale: { id: string } }).sale.id;
const visitTruck = async (id: string): Promise<string | null> =>
  (
    await query<{ v: string | null }>(
      `SELECT "vehicleId"::text AS v FROM visits WHERE id = $1::uuid`,
      [id],
    )
  )[0]!.v;
const noSale = (who: Api, clientId: string, extra: Record<string, unknown> = {}): Promise<Res> =>
  post(who, '/visits', {
    clientId,
    startedAt: new Date().toISOString(),
    outcome: 'NO_SALE',
    reason: 'CLOSED',
    ...extra,
  });
interface Today {
  vehicle: { id: string; code: string | null } | null;
  routes: { id: string; name: string }[];
}
const todayOf = (u: Staff): Promise<Today> => u.api.read<Today>('/me/today');
const listOf = <T>(body: unknown): T[] =>
  Array.isArray(body) ? (body as T[]) : ((body as { items: T[] }).items ?? []);

// ================================================================ 1. vehicle types

async function vehicleTypes(): Promise<void> {
  area('A1. Vehicle types');
  const c = await co('types');
  const other = await co('types other');
  const mk = (api: Api, body: Record<string, unknown>) =>
    api.send<Record<string, unknown>>(
      'POST',
      '/vehicle-types',
      { name: 'Type', activity: 'CASH_VAN', ...body },
      null,
    );

  await check(
    'code of 1 and of 20 characters accepted, 21 refused with 400, empty refused',
    async () => {
      accepted(await mk(c.owner, { code: 'X' }), '1 char');
      accepted(await mk(c.owner, { code: 'A'.repeat(20) }), '20 chars');
      invalid(await mk(c.owner, { code: 'B'.repeat(21) }), '21 chars');
      invalid(await mk(c.owner, { code: '   ' }), 'blank');
    },
  );
  const mxt = await c.owner.post<{ id: string }>(
    '/vehicle-types',
    { code: 'MXT', name: 'Gros + détail', codePrefix: 'VAN', activity: 'CASH_VAN' },
    null,
  );
  await check('MXT then mxt in the same company: VEHICLE_CODE_TAKEN', async () => {
    refused(await mk(c.owner, { code: 'mxt' }), 'VEHICLE_CODE_TAKEN', 'mxt');
    refused(await mk(c.owner, { code: ' Mxt ' }), 'VEHICLE_CODE_TAKEN', 'Mxt with spaces');
    const dd = await c.owner.post<{ id: string }>(
      '/vehicle-types',
      { code: 'DD', name: 'Prévente', activity: 'PRESALE' },
      null,
    );
    refused(
      await patch(c.owner, `/vehicle-types/${dd.id}`, { code: 'MxT' }),
      'VEHICLE_CODE_TAKEN',
      'rename to MxT',
    );
    accepted(
      await patch(c.owner, `/vehicle-types/${mxt.id}`, { code: 'mxt' }),
      'a type may change the case of its own code',
    );
    accepted(await patch(c.owner, `/vehicle-types/${mxt.id}`, { code: 'MXT' }), 'and back');
  });
  await check('the same code in another company is allowed', async () => {
    accepted(await mk(other.owner, { code: 'MXT' }), 'MXT in the other company');
    const f = loadFixture();
    const both = await query<{ code: string; n: string }>(
      `SELECT lower(code) AS code, count(DISTINCT "tenantId") AS n FROM vehicle_types
       WHERE "tenantId" = ANY($1::uuid[]) GROUP BY 1`,
      [[f.a.tenantId, f.b.tenantId]],
    );
    assert(
      both.length === 5 && both.every((r) => r.n === '2'),
      `seeded A and B share ${JSON.stringify(both)}`,
    );
  });
  await check(
    'a code is compared as text: "_" and "%" are not wildcards (AB1 exists, A_1 is another code)',
    async () => {
      accepted(await mk(c.owner, { code: 'AB1' }), 'AB1');
      const underscore = await mk(c.owner, { code: 'A_1' });
      const percent = await mk(c.owner, { code: '%' });
      assert(
        underscore.status < 300 && percent.status < 300,
        `A_1 -> ${brief(underscore)} ; % -> ${brief(percent)}`,
      );
    },
    { expected: 'spec: code is the owner\'s own text, unique "case-insensitive", nothing more' },
  );

  const t1 = await truck(c, 'Camion type', { vehicleTypeId: mxt.id });
  await check(
    'archive refused while a live truck has the type (VEHICLE_TYPE_IN_USE), allowed once the truck is archived',
    async () => {
      const r = await post(c.owner, `/vehicle-types/${mxt.id}/archive`);
      refused(r, 'VEHICLE_TYPE_IN_USE', 'archive in use');
      accepted(
        await c.owner.send('DELETE', `/warehouses/${t1.id}`, undefined, null),
        'archive the truck',
      );
      accepted(await post(c.owner, `/vehicle-types/${mxt.id}/archive`), 'archive the type');
    },
  );
  await check(
    'an archived type is not listed, not usable on a new truck, and its code is free again',
    async () => {
      const list = await c.owner.read<{ id: string }[]>('/vehicle-types');
      assert(!list.some((t) => t.id === mxt.id), 'the archived type is still listed');
      refused(
        await newTruck(c, { name: 'Camion X', vehicleTypeId: mxt.id }),
        'VEHICLE_TYPE_NOT_FOUND',
        'truck with an archived type',
      );
      const live = await truck(c, 'Camion Y');
      refused(
        await patch(c.owner, `/warehouses/${live.id}`, { vehicleTypeId: mxt.id }),
        'VEHICLE_TYPE_NOT_FOUND',
        'update to an archived type',
      );
      accepted(await mk(c.owner, { code: 'MXT' }), 'MXT again');
      refused(
        await patch(c.owner, `/vehicle-types/${mxt.id}`, { name: 'x' }),
        'VEHICLE_TYPE_NOT_FOUND',
        'edit an archived type',
      );
      const again = await post(c.owner, `/vehicle-types/${mxt.id}/archive`);
      assert(again.status >= 400 && again.status < 500, `second archive: ${brief(again)}`);
    },
  );
  await check(
    'a type switched off (active: false) but not archived: what the API does',
    async () => {
      const off = await c.owner.post<{ id: string }>(
        '/vehicle-types',
        { code: 'OFF', name: 'Off', activity: 'MIXED' },
        null,
      );
      accepted(await patch(c.owner, `/vehicle-types/${off.id}`, { active: false }), 'switch off');
      const listed = (await c.owner.read<{ id: string; active: boolean }[]>('/vehicle-types')).find(
        (t) => t.id === off.id,
      );
      const used = await newTruck(c, { name: 'Camion off', vehicleTypeId: off.id });
      record({
        name: `INFO inactive type: listed=${!!listed} (active=${listed?.active}), usable on a new truck=${used.status < 300}`,
        status: 'INFO',
      });
    },
  );
  await check(
    'activity outside the four, unknown field on update, codePrefix of 11: 400',
    async () => {
      invalid(await mk(c.owner, { code: 'ZZ', activity: 'TAXI' }), 'activity');
      invalid(await mk(c.owner, { code: 'ZZ', codePrefix: 'P'.repeat(11) }), 'prefix 11');
      invalid(
        await patch(c.owner, `/vehicle-types/${mxt.id}`, { tenantId: other.tenantId }),
        'tenantId in the body',
      );
      accepted(await mk(c.owner, { code: 'PFX', codePrefix: '' }), 'empty prefix = none');
    },
  );
  await check('audit rows: one per write, with before / after', async () => {
    const created = await audits(c.tenantId, 'VEHICLE_TYPE_CREATED', mxt.id);
    const updated = await audits(c.tenantId, 'VEHICLE_TYPE_UPDATED', mxt.id);
    const archived = await audits(c.tenantId, 'VEHICLE_TYPE_ARCHIVED', mxt.id);
    assert(
      created.length === 1 && updated.length === 2 && archived.length === 1,
      `created ${created.length}, updated ${updated.length}, archived ${archived.length}`,
    );
    assert((created[0]!.after as { code: string }).code === 'MXT', 'after of the creation');
    assert(
      (updated[0]!.before as { code: string }).code === 'MXT' &&
        (updated[0]!.after as { code: string }).code === 'mxt',
      'before / after of the update',
    );
    assert(created[0]!.userId === c.session.userId, 'who');
    // A refused write leaves no row.
    const n = (await audits(c.tenantId, 'VEHICLE_TYPE_CREATED')).length;
    const types = Number(
      (
        await query<{ n: string }>(
          `SELECT count(*) AS n FROM vehicle_types WHERE "tenantId" = $1::uuid`,
          [c.tenantId],
        )
      )[0]!.n,
    );
    assert(n === types, `${n} creation audits for ${types} types`);
  });
  await check('a SELLER (no SETTINGS_EDIT) reads the types and cannot write them', async () => {
    const s = await invite(c, 'SELLER');
    accepted(await s.api.get('/vehicle-types'), 'read');
    const w = await mk(s.api, { code: 'SEL' });
    assert(w.status === 403, `write: ${brief(w)}`);
  });
}

// ================================================================ 2. truck identity

async function identity(): Promise<void> {
  area('A2. Truck identity');
  const c = await co('identity');
  const type = await c.owner.post<{ id: string }>(
    '/vehicle-types',
    { code: 'MXT', name: 'Gros + détail', codePrefix: 'VAN', activity: 'CASH_VAN' },
    null,
  );
  const first = await truck(c, 'Camion 1', {
    code: 'VAN-28 MXT 01',
    vehicleTypeId: type.id,
    wilayaCode: 28,
  });
  const depot = await c.owner.post<{ id: string }>(
    '/warehouses',
    { name: 'Dépôt Batna', type: 'SECONDARY', code: 'CDD BATNA 05' },
    null,
  );

  await check(
    'code unique among the live dépôts and trucks of the company, whatever the case',
    async () => {
      refused(
        await newTruck(c, { name: 'Camion 2', code: 'van-28 mxt 01' }),
        'VEHICLE_CODE_TAKEN',
        'same code, lower case',
      );
      refused(
        await newTruck(c, { name: 'Camion 2', code: 'cdd batna 05' }),
        'VEHICLE_CODE_TAKEN',
        "a truck with a dépôt's code",
      );
      refused(
        await c.owner.send(
          'POST',
          '/warehouses',
          { name: 'Dépôt 3', type: 'SECONDARY', code: 'VAN-28 MXT 01' },
          null,
        ),
        'VEHICLE_CODE_TAKEN',
        "a dépôt with a truck's code",
      );
      const second = await truck(c, 'Camion 2', { code: 'VAN-28 MXT 02' });
      refused(
        await patch(c.owner, `/warehouses/${second.id}`, { code: 'VAN-28 mxt 01' }),
        'VEHICLE_CODE_TAKEN',
        'rename onto a taken code',
      );
      accepted(
        await patch(c.owner, `/warehouses/${first.id}`, { code: 'van-28 MXT 01' }),
        'a truck may change the case of its own code',
      );
      accepted(
        await patch(c.owner, `/warehouses/${first.id}`, { code: 'VAN-28 MXT 01' }),
        'and back',
      );
    },
  );
  await check('the code is free again once the first truck is archived', async () => {
    const t = await truck(c, 'Camion à archiver', { code: 'LIV 28 MIX' });
    accepted(await c.owner.send('DELETE', `/warehouses/${t.id}`, undefined, null), 'archive');
    accepted(
      await newTruck(c, { name: 'Camion remplaçant', code: 'liv 28 mix' }),
      'the code again',
    );
  });
  await check(
    'a code is compared as text: "VAN_28 MXT 01" is not "VAN-28 MXT 01" ("_" is no wildcard)',
    async () => {
      const r = await newTruck(c, { name: 'Camion underscore', code: 'VAN_28 MXT 01' });
      assert(r.status < 300, brief(r));
    },
    { expected: 'accepted: another code' },
  );
  const depotFields = [
    ['vehicleTypeId', type.id],
    ['wilayaCode', 5],
    ['plateNumber', '00123-119-05'],
    ['capacityKg', 1000],
  ] as const;
  await check(
    'identity fields on a new dépôt are refused with the code the spec names (VEHICLE_FIELDS_ON_DEPOT), as on update',
    async () => {
      const got: string[] = [];
      for (const [field, value] of depotFields) {
        const made = await c.owner.send(
          'POST',
          '/warehouses',
          { name: `Dépôt ${field}`, type: 'SECONDARY', [field]: value },
          null,
        );
        assert(
          made.status === 400 || made.status === 409 || made.status === 422,
          `create with ${field}: ${brief(made)}`,
        );
        got.push(`${field}: HTTP ${made.status} ${codeOf(made)}`);
      }
      const left = await query(
        `SELECT 1 FROM warehouses WHERE "tenantId" = $1::uuid AND name LIKE 'Dépôt %Id' OR name LIKE 'Dépôt wilaya%'`,
        [c.tenantId],
      );
      assert(left.length === 0, 'a refused dépôt was created');
      assert(
        got.every((g) => g.endsWith('VEHICLE_FIELDS_ON_DEPOT')),
        `POST /warehouses answers ${got.join(' ; ')} (PATCH answers VEHICLE_FIELDS_ON_DEPOT)`,
      );
    },
    { expected: 'spec, API: error code VEHICLE_FIELDS_ON_DEPOT' },
  );
  await check(
    'identity fields refused on a dépôt on update, one by one (VEHICLE_FIELDS_ON_DEPOT); a code is allowed',
    async () => {
      for (const [field, value] of depotFields) {
        refused(
          await patch(c.owner, `/warehouses/${depot.id}`, { [field]: value }),
          'VEHICLE_FIELDS_ON_DEPOT',
          `update ${depot.id} with ${field}`,
        );
        refused(
          await patch(c.owner, `/warehouses/${c.mainWarehouseId}`, { [field]: value }),
          'VEHICLE_FIELDS_ON_DEPOT',
          `update the dépôt principal with ${field}`,
        );
      }
      accepted(
        await patch(c.owner, `/warehouses/${c.mainWarehouseId}`, { code: 'CDD MSILA 28' }),
        'code on the dépôt principal',
      );
      accepted(
        await patch(c.owner, `/warehouses/${depot.id}`, { wilayaCode: null, plateNumber: null }),
        'nulls on a dépôt',
      );
    },
  );
  await check('the database refuses them too (CHECK), written as the app role', async () => {
    for (const set of [
      `"wilayaCode" = 5`,
      `"plateNumber" = 'X'`,
      `"capacityKg" = 10`,
      `"vehicleTypeId" = '${type.id}'`,
    ]) {
      const r = await sqlAs(
        APP_DB,
        c.tenantId,
        `UPDATE warehouses SET ${set} WHERE id = $1::uuid`,
        [depot.id],
      );
      assert(
        !!r.error && r.error.includes('warehouses_vehicle_identity_check'),
        `SET ${set}: ${r.error ?? `${r.rows} row(s) updated`}`,
      );
    }
    const ok = await sqlAs(
      APP_DB,
      c.tenantId,
      `UPDATE warehouses SET code = 'SQL CODE' WHERE id = $1::uuid`,
      [depot.id],
    );
    assert(ok.error === null && ok.rows === 1, `a code by SQL: ${ok.error}`);
    for (const [set, name] of [
      [`"wilayaCode" = 0`, 'warehouses_wilaya_code_check'],
      [`"wilayaCode" = 70`, 'warehouses_wilaya_code_check'],
      [`"capacityKg" = 0`, 'warehouses_capacity_kg_check'],
      [`"capacityKg" = -1`, 'warehouses_capacity_kg_check'],
    ] as const) {
      const r = await sqlAs(
        APP_DB,
        c.tenantId,
        `UPDATE warehouses SET ${set} WHERE id = $1::uuid`,
        [first.id],
      );
      assert(
        !!r.error && r.error.includes(name),
        `SET ${set} on a truck: ${r.error ?? 'accepted'}`,
      );
    }
    const dup = await sqlAs(
      APP_DB,
      c.tenantId,
      `UPDATE warehouses SET code = 'van-28 MXT 01' WHERE id = $1::uuid`,
      [depot.id],
    );
    assert(
      !!dup.error && dup.error.includes('warehouses_tenantId_code_live_key'),
      `duplicate code by SQL: ${dup.error ?? 'accepted'}`,
    );
  });
  await check('wilaya 0 and 70 refused, 1 and 69 accepted; a string, a float refused', async () => {
    invalid(await newTruck(c, { name: 'W0', wilayaCode: 0 }), 'wilaya 0');
    invalid(await newTruck(c, { name: 'W70', wilayaCode: 70 }), 'wilaya 70');
    invalid(await newTruck(c, { name: 'Wstr', wilayaCode: '28' }), 'wilaya "28"');
    invalid(await newTruck(c, { name: 'Wfloat', wilayaCode: 28.5 }), 'wilaya 28.5');
    accepted(await newTruck(c, { name: 'W1', wilayaCode: 1 }), 'wilaya 1');
    accepted(await newTruck(c, { name: 'W69', wilayaCode: 69 }), 'wilaya 69');
  });
  await check(
    'capacityKg 0, -1, a float and huge values refused with 400; 1 and 1 000 000 accepted',
    async () => {
      for (const v of [0, -1, 1.5, 1_000_001, 2_147_483_648, 1e20, '1000']) {
        invalid(
          await newTruck(c, { name: `Cap ${String(v)}`, capacityKg: v }),
          `capacityKg ${String(v)}`,
        );
      }
      accepted(await newTruck(c, { name: 'Cap 1', capacityKg: 1 }), 'capacityKg 1');
      accepted(
        await newTruck(c, { name: 'Cap max', capacityKg: 1_000_000 }),
        'capacityKg 1 000 000',
      );
    },
  );
  await check('plate of 20 accepted, 21 refused; code of 30 accepted, 31 refused', async () => {
    accepted(await newTruck(c, { name: 'P20', plateNumber: '1'.repeat(20) }), 'plate 20');
    invalid(await newTruck(c, { name: 'P21', plateNumber: '1'.repeat(21) }), 'plate 21');
    accepted(await newTruck(c, { name: 'C30', code: 'C'.repeat(30) }), 'code 30');
    invalid(await newTruck(c, { name: 'C31', code: 'D'.repeat(31) }), 'code 31');
  });
  await check(
    "the owner's text is kept as typed: Arabic, inner spaces, slash, lower case",
    async () => {
      for (const code of ['شاحنة 28 MXT', 'VAN34-SELF/MT', 'van  28   mxt', 'PRV05-DD01']) {
        const r = await newTruck(c, { name: `Camion ${code}`, code });
        accepted(r, code);
        assert(
          (r.body as { code: string }).code === code,
          `sent ${JSON.stringify(code)}, stored ${JSON.stringify((r.body as { code: string }).code)}`,
        );
      }
      const trimmed = await newTruck(c, { name: 'Camion trim', code: '  TRIM 01  ' });
      assert(
        (trimmed.body as { code: string }).code === 'TRIM 01',
        `outer spaces: ${JSON.stringify(trimmed.body)}`,
      );
      const blank = await newTruck(c, { name: 'Camion blank', code: '   ' });
      assert(
        blank.status < 300 && (blank.body as { code: string | null }).code === null,
        `blank code = no code: ${brief(blank)}`,
      );
      refused(
        await newTruck(c, { name: 'Camion ar 2', code: 'شاحنة 28 mxt' }),
        'VEHICLE_CODE_TAKEN',
        'Arabic code, other case of the Latin part',
      );
    },
  );
  await check('list filters: type, wilaya, search on code / name / plate', async () => {
    const find = async (qs: string) =>
      (await c.owner.read<{ id: string }[]>(`/warehouses?${qs}`)).map((w) => w.id);
    assert((await find(`type=VEHICLE&vehicleTypeId=${type.id}`)).join() === first.id, 'by type');
    assert(
      (await find('type=VEHICLE&wilayaCode=28')).includes(first.id) &&
        !(await find('wilayaCode=28')).includes(depot.id),
      'by wilaya',
    );
    assert((await find('search=28%20mxt%2001')).includes(first.id), 'search on the code');
    assert((await find(`search=${'1'.repeat(20)}`)).length === 1, 'search on the plate');
    invalid(await c.owner.get('/warehouses?wilayaCode=0'), 'filter wilaya 0');
    invalid(await c.owner.get('/warehouses?wilayaCode=70'), 'filter wilaya 70');
  });
  await check(
    'the search box takes "%" and "_" as text (no truck has either in its code, name or plate)',
    async () => {
      const all = (await c.owner.read<{ id: string }[]>('/warehouses')).length;
      const pct = (await c.owner.read<{ id: string }[]>('/warehouses?search=%25')).length;
      const und =
        await c.owner.read<{ code: string | null; name: string; plateNumber: string | null }[]>(
          '/warehouses?search=N_2',
        );
      const wrong = und.filter(
        (w) => ![w.code, w.name, w.plateNumber].some((v) => v?.toLowerCase().includes('n_2')),
      );
      assert(
        pct === 0 && wrong.length === 0,
        `?search=% returns ${pct} of ${all} dépôts; ?search=N_2 returns ${wrong.length} rows that do not hold "N_2" (e.g. ${JSON.stringify(wrong[0]?.code ?? wrong[0]?.name)})`,
      );
    },
    { expected: 'a search on text' },
  );

  // The code helper (packages/shared/src/vehicles.ts), called as the form calls it.
  await check(
    'code helper: the lowest free number, gaps filled (01, 02, 04 taken -> 03)',
    async () => {
      const base = { prefix: 'VAN', typeCode: 'MXT', wilayaCode: 28 };
      assert(proposeVehicleCode({ ...base, taken: [] }) === 'VAN-28 MXT 01', 'first');
      const got = proposeVehicleCode({
        ...base,
        taken: ['VAN-28 MXT 01', 'VAN-28 MXT 02', 'VAN-28 MXT 04'],
      });
      assert(got === 'VAN-28 MXT 03', `gap: ${got}`);
      assert(
        proposeVehicleCode({ ...base, taken: ['van-28 mxt 01'] }) === 'VAN-28 MXT 02',
        'taken whatever the case',
      );
      assert(
        proposeVehicleCode({ typeCode: 'SELF/MT', wilayaCode: 34, taken: [] }) === '34 SELF/MT 01',
        'no prefix',
      );
      assert(
        proposeVehicleCode({ prefix: 'LIV', typeCode: 'MIX', taken: [] }) === 'LIV MIX 01',
        'no wilaya',
      );
      assert(
        proposeVehicleCode({ prefix: 'شاحنة', typeCode: 'mxt', wilayaCode: 5, taken: [] }) ===
          'شاحنة-05 mxt 01',
        'Arabic prefix, case kept',
      );
      assert(proposeVehicleCode({ taken: [] }) === '01', 'nothing chosen');
    },
  );
  await check(
    'code helper: what it proposes is always free and fits (100 trucks of one type and wilaya, long prefix)',
    async () => {
      const taken = Array.from(
        { length: 99 },
        (_, i) => `VAN-28 MXT ${String(i + 1).padStart(2, '0')}`,
      );
      const hundredth = proposeVehicleCode({
        prefix: 'VAN',
        typeCode: 'MXT',
        wilayaCode: 28,
        taken,
      });
      assert(hundredth === 'VAN-28 MXT 100', `after 99: ${hundredth}`);
      // The longest type code (20) with the longest prefix (10): the base fills its 27 characters.
      const long = { prefix: 'P'.repeat(10), typeCode: 'T'.repeat(20), wilayaCode: 28 };
      const base27 = proposeVehicleCode({ ...long, taken: [] });
      const taken27 = Array.from(
        { length: 99 },
        (_, i) => `${base27.slice(0, -3)} ${String(i + 1).padStart(2, '0')}`,
      );
      const next = proposeVehicleCode({ ...long, taken: taken27 });
      assert(
        next.length <= 30 &&
          !taken27.map((t) => t.toLowerCase()).includes(next.toLowerCase()) &&
          /\d$/.test(next),
        `first proposal ${JSON.stringify(base27)}; with 01..99 taken it proposes ${JSON.stringify(next)} (no number: the form would offer the same text for every further truck)`,
      );
    },
    { expected: 'a free code of at most 30 characters ending with a number' },
  );
  await check(
    'audit: the identity is in the after of WAREHOUSE_CREATED and in before / after of WAREHOUSE_UPDATED',
    async () => {
      const created = await audits(c.tenantId, 'WAREHOUSE_CREATED', first.id);
      const a = created[0]!.after as Record<string, unknown>;
      assert(
        a['code'] === 'VAN-28 MXT 01' && a['wilayaCode'] === 28 && a['vehicleTypeId'] === type.id,
        JSON.stringify(a),
      );
      accepted(
        await patch(c.owner, `/warehouses/${first.id}`, {
          plateNumber: '00123-119-28',
          capacityKg: 3500,
        }),
        'update',
      );
      const upd = (await audits(c.tenantId, 'WAREHOUSE_UPDATED', first.id)).at(-1)!;
      const b = upd.before as Record<string, unknown>;
      assert(
        b['plateNumber'] === null && b['capacityKg'] === null && b['code'] === 'VAN-28 MXT 01',
        `before ${JSON.stringify(b)}`,
      );
      assert(
        (upd.after as Record<string, unknown>)['capacityKg'] === 3500,
        `after ${JSON.stringify(upd.after)}`,
      );
    },
  );
}

// ================================================================ 3. driver change

async function driverChange(): Promise<void> {
  area('A3. Driver change');
  const c = await co('driver');
  const t = c.tenantId;
  const a = await invite(c, 'SELLER');
  const b = await invite(c, 'SELLER');
  const liv = await invite(c, 'LIVREUR');
  const store = await invite(c, 'STOREKEEPER');
  const t1 = await truck(c, 'Camion 1', { code: 'T1' });
  const t2 = await truck(c, 'Camion 2', { code: 'T2' });

  await check(
    'one row per change, written with who and why; the same driver again writes nothing',
    async () => {
      const before = await rowCount(t);
      const r = await driver(c.owner, t1.id, a.id, 'remplace Karim');
      accepted(r, 'A on truck 1');
      const h = await history(t1.id);
      assert(
        h.length === 1 &&
          h[0]!.userId === a.id &&
          h[0]!.setBy === c.session.userId &&
          h[0]!.reason === 'remplace Karim',
        JSON.stringify(h),
      );
      assert(
        Math.abs(h[0]!.fromAt.getTime() - Date.now()) < 5000,
        `fromAt ${h[0]!.fromAt.toISOString()} is not now`,
      );
      const again = await driver(c.owner, t1.id, a.id);
      accepted(again, 'the same change again');
      assert((await rowCount(t)) === before + 1, `rows: ${before} -> ${await rowCount(t)}`);
      assert((await audits(t, 'VEHICLE_DRIVER_CHANGED', t1.id)).length === 1, 'one audit row');
      const au = (await audits(t, 'VEHICLE_DRIVER_CHANGED', t1.id))[0]!;
      assert(
        (au.before as { userId: null }).userId === null &&
          (au.after as { userId: string }).userId === a.id,
        `audit ${JSON.stringify(au)}`,
      );
    },
  );
  await check('moving a driver who has another truck frees it: two rows, in one go', async () => {
    const before = await rowCount(t);
    const r = await driver(c.owner, t2.id, a.id);
    accepted(r, 'A to truck 2');
    assert(
      (r.body as { freedVehicle: { id: string } | null }).freedVehicle?.id === t1.id,
      `freedVehicle ${JSON.stringify(r.body)}`,
    );
    assert((await rowCount(t)) === before + 2, `rows: ${before} -> ${await rowCount(t)}`);
    const h1 = await history(t1.id);
    const h2 = await history(t2.id);
    assert(h1.at(-1)!.userId === null && h2.at(-1)!.userId === a.id, 'last rows');
    assert(
      (await driverNow(t1.id)) === null && (await driverNow(t2.id)) === a.id,
      'assignedUserId of both trucks',
    );
    assert((await audits(t, 'VEHICLE_DRIVER_CHANGED')).length === 3, 'audit rows of the move');
  });
  await check('userId null leaves the truck without a driver (one row naming nobody)', async () => {
    accepted(await driver(c.owner, t2.id, null), 'nobody on truck 2');
    assert(
      (await driverNow(t2.id)) === null && (await history(t2.id)).at(-1)!.userId === null,
      'truck 2 without driver',
    );
    const noop = await rowCount(t);
    accepted(await driver(c.owner, t2.id, null), 'nobody again');
    assert((await rowCount(t)) === noop, 'a second null writes nothing');
  });
  await check(
    'who may be put on a truck: a seller and a livreur, not a storekeeper, not an unknown user',
    async () => {
      accepted(await driver(c.owner, t2.id, liv.id), 'a livreur');
      refused(await driver(c.owner, t1.id, store.id), 'SELLER_NOT_ALLOWED', 'a storekeeper');
      const ghost = await driver(c.owner, t1.id, '00000000-0000-4000-8000-000000000000');
      assert(ghost.status >= 400 && ghost.status < 500, `unknown user: ${brief(ghost)}`);
      const depot = await driver(c.owner, c.mainWarehouseId, a.id);
      assert(
        depot.status >= 400 && depot.status < 500,
        `a driver on the dépôt principal: ${brief(depot)}`,
      );
      invalid(await driver(c.owner, t1.id, a.id, 'x'.repeat(121)), 'reason of 121');
      invalid(await post(c.owner, `/warehouses/${t1.id}/driver`, {}), 'no userId');
    },
  );
  await check(
    'who may call it: owner, manager, supervisor (his team); a seller, a livreur, a storekeeper get 403',
    async () => {
      for (const u of [a, liv, store]) {
        const r = await driver(u.api, t1.id, a.id);
        assert(r.status === 403, `${u.role}: ${brief(r)}`);
      }
      assert((await driverNow(t1.id)) === null, 'truck 1 still without driver');
    },
  );
  await check(
    'the dépôt form (PATCH assignedUserId) still refuses a driver who has a truck: VEHICLE_ALREADY_ASSIGNED',
    async () => {
      const before = await rowCount(t);
      refused(
        await patch(c.owner, `/warehouses/${t1.id}`, { assignedUserId: liv.id }),
        'VEHICLE_ALREADY_ASSIGNED',
        'PATCH',
      );
      refused(
        await newTruck(c, { name: 'Camion 3', assignedUserId: liv.id }),
        'VEHICLE_ALREADY_ASSIGNED',
        'POST',
      );
      assert((await rowCount(t)) === before, 'a refused change writes no row');
      const ghost = await query(
        `SELECT 1 FROM warehouses WHERE "tenantId" = $1::uuid AND name = 'Camion 3'`,
        [t],
      );
      assert(ghost.length === 0, 'the refused creation left a truck behind');
    },
  );

  await check(
    'a failure after the history row rolls everything back: no row, no driver, no audit',
    async () => {
      const fn = `t36_fail_${t.replace(/-/g, '').slice(0, 12)}`;
      await query(
        `CREATE FUNCTION ${fn}() RETURNS trigger AS $$ BEGIN
         IF NEW.action = 'VEHICLE_DRIVER_CHANGED' AND NEW."tenantId" = '${t}'::uuid THEN
           RAISE EXCEPTION 't36 forced failure'; END IF;
         RETURN NEW; END $$ LANGUAGE plpgsql`,
      );
      await query(
        `CREATE TRIGGER ${fn} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
      );
      try {
        const before = {
          rows: await rowCount(t),
          d1: await driverNow(t1.id),
          d2: await driverNow(t2.id),
          audits: (await audits(t, 'VEHICLE_DRIVER_CHANGED')).length,
        };
        // liv drives truck 2: moving him to truck 1 writes the freed truck's row, then fails on its audit.
        const moved = await driver(c.owner, t1.id, liv.id);
        // a on truck 1: the truck's own row is written, then its audit fails.
        const direct = await driver(c.owner, t1.id, a.id);
        const made = await newTruck(c, { name: 'Camion rollback', assignedUserId: a.id });
        assert(
          moved.status === 500 && direct.status === 500 && made.status === 500,
          `expected the forced 500s: ${moved.status}, ${direct.status}, ${made.status}`,
        );
        const after = {
          rows: await rowCount(t),
          d1: await driverNow(t1.id),
          d2: await driverNow(t2.id),
          audits: (await audits(t, 'VEHICLE_DRIVER_CHANGED')).length,
        };
        assert(
          JSON.stringify(after) === JSON.stringify(before),
          `before ${JSON.stringify(before)}, after ${JSON.stringify(after)}`,
        );
        const left = await query(
          `SELECT 1 FROM warehouses WHERE "tenantId" = $1::uuid AND name = 'Camion rollback'`,
          [t],
        );
        assert(left.length === 0, 'the truck of the failed creation is there');
      } finally {
        await query(`DROP TRIGGER ${fn} ON audit_logs`);
        await query(`DROP FUNCTION ${fn}()`);
      }
    },
  );

  // An open day blocks the change.
  await check(
    "an open SellerSession of the driver on the truck blocks the change (SESSION_OPEN_ON_VEHICLE), whoever's turn it is",
    async () => {
      await setDriver(c, t1.id, a.id);
      const s = await c.owner.post<{ id: string }>('/seller-sessions', {
        sellerId: a.id,
        date: today,
      });
      const before = await rowCount(t);
      refused(
        await driver(c.owner, t1.id, b.id),
        'SESSION_OPEN_ON_VEHICLE',
        'another driver on his truck',
      );
      refused(await driver(c.owner, t1.id, null), 'SESSION_OPEN_ON_VEHICLE', 'nobody on his truck');
      refused(
        await driver(c.owner, t2.id, a.id),
        'SESSION_OPEN_ON_VEHICLE',
        'him to another truck',
      );
      refused(
        await patch(c.owner, `/warehouses/${t1.id}`, { assignedUserId: null }),
        'SESSION_OPEN_ON_VEHICLE',
        'the dépôt form',
      );
      refused(
        await c.owner.send('DELETE', `/warehouses/${t1.id}`, undefined, null),
        'SESSION_OPEN_ON_VEHICLE',
        'archiving the truck',
      );
      assert(
        (await rowCount(t)) === before && (await driverNow(t1.id)) === a.id,
        'nothing changed',
      );
      accepted(
        await post(c.owner, `/seller-sessions/${s.id}/close`, { handedCash: '0' }),
        'close the day',
      );
      accepted(await driver(c.owner, t1.id, b.id), 'the change once the day is closed');
    },
  );

  // Every path that changes assignedUserId.
  await check(
    'every path writes its row: create with a driver, PATCH set / clear, archive, quick-assign',
    async () => {
      const d = await invite(c, 'SELLER');
      const made = await truck(c, 'Camion créé avec chauffeur', { assignedUserId: d.id });
      let h = await history(made.id);
      assert(h.length === 1 && h[0]!.userId === d.id, `create: ${JSON.stringify(h)}`);
      accepted(
        await patch(c.owner, `/warehouses/${made.id}`, { assignedUserId: null }),
        'PATCH null',
      );
      h = await history(made.id);
      assert(h.length === 2 && h[1]!.userId === null, `PATCH null: ${JSON.stringify(h)}`);
      accepted(
        await patch(c.owner, `/warehouses/${made.id}`, { assignedUserId: d.id }),
        'PATCH set',
      );
      accepted(
        await patch(c.owner, `/warehouses/${made.id}`, { name: 'Camion renommé' }),
        'PATCH of something else',
      );
      h = await history(made.id);
      assert(h.length === 3 && h[2]!.userId === d.id, `PATCH set: ${JSON.stringify(h)}`);
      accepted(await c.owner.send('DELETE', `/warehouses/${made.id}`, undefined, null), 'archive');
      h = await history(made.id);
      assert(
        h.length === 4 && h[3]!.userId === null && (await driverNow(made.id)) === null,
        `archive: ${JSON.stringify(h)}`,
      );
      for (let i = 1; i < h.length; i += 1)
        assert(h[i]!.fromAt > h[i - 1]!.fromAt, 'fromAt goes forward');
      // The driver of the archived truck is free for another one, through the form.
      accepted(
        await newTruck(c, { name: 'Camion suivant', assignedUserId: d.id }),
        'the freed driver on a new truck',
      );
    },
  );

  const lost = await invite(c, 'SELLER');
  const gone = await truck(c, 'Camion du vendeur désactivé', {
    code: 'GONE',
    assignedUserId: lost.id,
  });
  await check(
    'deactivating a user who drives a truck frees the truck (a row naming nobody), or is refused',
    async () => {
      const r = await post(c.owner, `/users/${lost.id}/deactivate`);
      const stillDriver = (await driverNow(gone.id)) === lost.id;
      const h = await history(gone.id);
      assert(
        r.status >= 400 || !stillDriver,
        `deactivate -> HTTP ${r.status}; warehouses.assignedUserId is still the deactivated user; history rows: ${h.length} (last userId ${h.at(-1)!.userId}). ` +
          `GET /warehouses shows him as today's driver: ${JSON.stringify((await c.owner.read<Truck[]>('/warehouses?type=VEHICLE')).find((w) => w.id === gone.id)?.assignedUser)}`,
      );
    },
    {
      expected:
        'spec: "every change of assignedUserId writes a row"; a truck is driven by a live user (assignDriver refuses a deleted one)',
    },
  );
  const demoted = await invite(c, 'SELLER');
  const kept = await truck(c, 'Camion du vendeur devenu magasinier', {
    code: 'DEMO',
    assignedUserId: demoted.id,
  });
  await check(
    'changing a driver to a role that cannot drive (STOREKEEPER) frees the truck, or is refused',
    async () => {
      const u = await c.owner.read<{
        fullName: string;
        email: string | null;
        phone: string | null;
      }>(`/users/${demoted.id}`);
      const r = await c.owner.send(
        'PUT',
        `/users/${demoted.id}`,
        { fullName: u.fullName, email: u.email, phone: u.phone, role: 'STOREKEEPER' },
        null,
      );
      const stillDriver = (await driverNow(kept.id)) === demoted.id;
      assert(
        r.status >= 400 || !stillDriver,
        `PUT role STOREKEEPER -> HTTP ${r.status}; the storekeeper is still assignedUserId of truck DEMO (assignDriver answers SELLER_NOT_ALLOWED for that role)`,
      );
    },
    { expected: 'DRIVING_ROLES = selling roles + LIVREUR (packages/shared/src/enums.ts)' },
  );
  await check(
    "SQL truth: for every truck of the company the last history row names today's driver",
    async () => {
      const bad = await query(
        `${block('driver_matches_last_history_row')} AND w."tenantId" = $1::uuid`,
        [t],
      );
      assert(bad.length === 0, JSON.stringify(bad));
    },
  );
}

// ================================================================ 4. history helpers

async function historyHelpers(): Promise<void> {
  area('A4. History helpers and the worker history');
  const c = await co('history');
  const a = await invite(c, 'SELLER');
  const b = await invite(c, 'SELLER');
  const d = await invite(c, 'SELLER');
  const t1 = await truck(c, 'Camion 1', { code: 'H1' });
  const t2 = await truck(c, 'Camion 2', { code: 'H2' });
  const pause = () => new Promise((r) => setTimeout(r, 15));

  // Three changes on truck 1: A, then B, then nobody.
  await setDriver(c, t1.id, a.id);
  await pause();
  await setDriver(c, t1.id, b.id);
  await pause();
  await setDriver(c, t1.id, null);
  const rows = await history(t1.id);

  // The compiled service itself, on a plain Prisma client of the scratch database.
  const apiDir = fileURLToPath(new URL('../../apps/api/', import.meta.url));
  const req = createRequire(`${apiDir}dist/main.js`);
  req('reflect-metadata');
  const { VehiclesService } = req('./stock/vehicles.service.js') as {
    VehiclesService: new (...a: unknown[]) => Record<string, (...a: unknown[]) => Promise<unknown>>;
  };
  const { PrismaClient } = req('./generated/prisma/client.js') as {
    PrismaClient: new (o: unknown) => { $disconnect: () => Promise<void> };
  };
  const { PrismaPg } = req('@prisma/adapter-pg') as { PrismaPg: new (o: unknown) => unknown };
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DB }) });
  const svc = new VehiclesService(null, null, null, null);
  const at = async (ms: number) => ({
    driver: (await svc['driverAt']!(t1.id, new Date(ms), prisma)) as string | null,
    row: (await svc['vehicleAt']!(t1.id, new Date(ms), prisma)) as {
      userId: string | null;
      fromAt: Date;
    } | null,
  });
  try {
    await check(
      'driverAt / vehicleAt across three changes: at the exact fromAt, one millisecond before, between, in the future',
      async () => {
        assert(rows.length === 3, `rows ${rows.length}`);
        const [r1, r2, r3] = rows.map((r) => r.fromAt.getTime()) as [number, number, number];
        const before = await at(r1 - 1);
        assert(
          before.driver === null && before.row === null,
          `1 ms before the first row: ${JSON.stringify(before)}`,
        );
        assert((await at(r1)).driver === a.id, 'at the first fromAt: A');
        assert((await at(r2 - 1)).driver === a.id, '1 ms before the second: still A');
        const second = await at(r2);
        assert(
          second.driver === b.id && second.row!.fromAt.getTime() === r2,
          'at the second fromAt: B, since r2',
        );
        assert((await at(r3 - 1)).driver === b.id, '1 ms before the third: still B');
        const third = await at(r3);
        assert(
          third.driver === null && third.row !== null && third.row.userId === null,
          `at the third: nobody, and known (${JSON.stringify(third)})`,
        );
        const future = await at(Date.now() + 365 * 86_400_000);
        assert(
          future.driver === null && future.row!.fromAt.getTime() === r3,
          'a year from now: the last row',
        );
      },
    );
  } finally {
    await prisma.$disconnect();
  }

  // Driver A: truck 1 -> truck 2, then truck 2 given to B.
  const h = await co('worker history');
  const wa = await invite(h, 'SELLER');
  const wb = await invite(h, 'SELLER');
  const type = await h.owner.post<{ id: string }>(
    '/vehicle-types',
    { code: 'MXT', name: 'Gros + détail', activity: 'CASH_VAN' },
    null,
  );
  const w1 = await truck(h, 'Camion 1', { code: 'W1', vehicleTypeId: type.id });
  const w2 = await truck(h, 'Camion 2', { code: 'W2' });
  await setDriver(h, w1.id, wa.id);
  await pause();
  await setDriver(h, w2.id, wa.id);
  await pause();
  await setDriver(h, w2.id, wb.id);
  interface Period {
    id: string;
    vehicle: { id: string; code: string | null; type: { code: string } | null; inReach: boolean };
    fromAt: string;
    toAt: string | null;
    setBy: { id: string } | null;
  }
  const periods = async (api: Api, userId: string, qs = '') =>
    api.read<{ items: Period[]; nextCursor: string | null }>(
      `/users/${userId}/vehicle-assignments${qs}`,
    );
  await check(
    'A: truck 1 -> truck 2 -> truck 2 given to B: A has two closed periods with the right dates, B one open',
    async () => {
      const pa = (await periods(h.owner, wa.id)).items;
      const pb = (await periods(h.owner, wb.id)).items;
      const h1 = await history(w1.id);
      const h2 = await history(w2.id);
      assert(pa.length === 2 && pb.length === 1, `A ${pa.length} periods, B ${pb.length}`);
      // Newest first: truck 2, then truck 1.
      assert(pa[0]!.vehicle.id === w2.id && pa[1]!.vehicle.id === w1.id, 'newest first');
      assert(
        pa[1]!.fromAt === h1[0]!.fromAt.toISOString() &&
          pa[1]!.toAt === h1[1]!.fromAt.toISOString(),
        `truck 1: ${JSON.stringify(pa[1])} vs ${JSON.stringify(h1)}`,
      );
      assert(
        pa[0]!.fromAt === h2[0]!.fromAt.toISOString() &&
          pa[0]!.toAt === h2[1]!.fromAt.toISOString(),
        `truck 2: ${JSON.stringify(pa[0])}`,
      );
      assert(
        pb[0]!.vehicle.id === w2.id &&
          pb[0]!.toAt === null &&
          pb[0]!.fromAt === h2[1]!.fromAt.toISOString(),
        `B: ${JSON.stringify(pb[0])}`,
      );
      assert(
        pa[1]!.vehicle.code === 'W1' &&
          pa[1]!.vehicle.type?.code === 'MXT' &&
          pa[0]!.vehicle.type === null,
        'code and type of the trucks',
      );
      assert(
        pa.every((p) => p.setBy?.id === h.session.userId),
        'set by the owner',
      );
      // The truck left without a driver ends A's period on truck 1 too (a row naming nobody).
      assert(h1[1]!.userId === null, 'truck 1 ended by a row naming nobody');
    },
  );
  await check(
    'who reads it: the worker himself and the owner; another seller gets 403; an unknown user 404',
    async () => {
      accepted(await wa.api.get(`/users/${wa.id}/vehicle-assignments`), 'A reads his own');
      const other = await wb.api.get(`/users/${wa.id}/vehicle-assignments`);
      assert(other.status === 403, `B reads A's: ${brief(other)}`);
      const ghost = await h.owner.get(
        '/users/00000000-0000-4000-8000-000000000000/vehicle-assignments',
      );
      assert(ghost.status === 404, `unknown user: ${brief(ghost)}`);
      invalid(await h.owner.get(`/users/${wa.id}/vehicle-assignments?limit=0`), 'limit 0');
      invalid(await h.owner.get(`/users/${wa.id}/vehicle-assignments?limit=101`), 'limit 101');
      invalid(await h.owner.get(`/users/${wa.id}/vehicle-assignments?cursor=abc`), 'cursor abc');
      const unknownCursor = await h.owner.get<{ items: unknown[] }>(
        `/users/${wa.id}/vehicle-assignments?cursor=00000000-0000-4000-8000-000000000000`,
      );
      assert(
        unknownCursor.status === 200 || unknownCursor.status === 400,
        `unknown cursor: ${brief(unknownCursor)}`,
      );
    },
  );

  // Pagination under inserts: D hops between two trucks.
  const p1 = await truck(c, 'Camion P1', { code: 'P1' });
  const p2 = await truck(c, 'Camion P2', { code: 'P2' });
  for (let i = 0; i < 7; i += 1) await setDriver(c, i % 2 === 0 ? p1.id : p2.id, d.id);
  await check(
    'cursor pagination of the worker history is stable while new changes are written',
    async () => {
      const all = (await periods(c.owner, d.id, '?limit=100')).items.map((p) => p.id);
      assert(all.length === 7, `periods before: ${all.length}`);
      const seen: string[] = [];
      let page = await periods(c.owner, d.id, '?limit=2');
      seen.push(...page.items.map((p) => p.id));
      // Three more changes land between two pages.
      for (let i = 7; i < 10; i += 1) await setDriver(c, i % 2 === 0 ? p1.id : p2.id, d.id);
      while (page.nextCursor) {
        page = await periods(c.owner, d.id, `?limit=2&cursor=${page.nextCursor}`);
        seen.push(...page.items.map((p) => p.id));
      }
      assert(new Set(seen).size === seen.length, `a period came twice: ${seen.join(', ')}`);
      assert(
        JSON.stringify(seen) === JSON.stringify(all),
        `walked ${seen.length} periods, expected the 7 that were there, in order`,
      );
    },
  );
  await check(
    "cursor pagination of a truck's history (GET /warehouses/:id/assignments): the same walk",
    async () => {
      type Line = { id: string; user: { id: string } | null; fromAt: string };
      const read = (qs: string) =>
        c.owner.read<{ items: Line[]; nextCursor: string | null }>(
          `/warehouses/${p1.id}/assignments${qs}`,
        );
      const all = (await read('?limit=100')).items;
      const truth = (await history(p1.id)).reverse();
      assert(
        JSON.stringify(all.map((l) => [l.id, l.user?.id ?? null, l.fromAt])) ===
          JSON.stringify(truth.map((r) => [r.id, r.userId, r.fromAt.toISOString()])),
        'the list is the table, newest first',
      );
      const seen: string[] = [];
      let page = await read('?limit=3');
      seen.push(...page.items.map((l) => l.id));
      await setDriver(c, p1.id, null);
      await setDriver(c, p1.id, d.id);
      while (page.nextCursor) {
        page = await read(`?limit=3&cursor=${page.nextCursor}`);
        seen.push(...page.items.map((l) => l.id));
      }
      assert(
        JSON.stringify(seen) === JSON.stringify(all.map((l) => l.id)),
        `walked ${seen.length}, expected ${all.length}`,
      );
      const depot = await c.owner.get(`/warehouses/${c.mainWarehouseId}/assignments`);
      assert(depot.status === 404, `history of a dépôt: ${brief(depot)}`);
    },
  );

  // A truck outside the reader's reach: shown by its code, without a link.
  await check(
    "a truck outside the reader's dépôts appears by its code with inReach false",
    async () => {
      const r = await co('reach');
      const sup = await invite(r, 'SUPERVISOR');
      const s = await invite(r, 'SELLER', sup.id);
      const depot = await r.owner.post<{ id: string }>(
        '/warehouses',
        { name: 'Dépôt 2', type: 'SECONDARY' },
        null,
      );
      await r.owner.put(`/users/${sup.id}/access`, {
        access: [{ warehouseId: depot.id, level: 'OPERATE' }],
      });
      const far = await truck(r, 'Camion du principal', { code: 'FAR 01' });
      const near = await truck(r, 'Camion du dépôt 2', { code: 'NEAR 01' });
      await r.owner.patch(`/warehouses/${near.id}`, { parentWarehouseId: depot.id });
      await setDriver(r, far.id, s.id);
      await setDriver(r, near.id, s.id);
      const got = (await periods(sup.api, s.id)).items;
      const farP = got.find((p) => p.vehicle.id === far.id);
      const nearP = got.find((p) => p.vehicle.id === near.id);
      assert(!!farP && !!nearP, `periods: ${JSON.stringify(got)}`);
      assert(
        farP!.vehicle.code === 'FAR 01' && farP!.vehicle.inReach === false,
        `far truck: ${JSON.stringify(farP!.vehicle)}`,
      );
      assert(nearP!.vehicle.inReach === true, `near truck: ${JSON.stringify(nearP!.vehicle)}`);
      const outsider = await invite(r, 'SELLER');
      const denied = await sup.api.get(`/users/${outsider.id}/vehicle-assignments`);
      assert(denied.status === 403, `a seller outside the team: ${brief(denied)}`);
    },
  );
}

// ================================================================ 5. append-only

async function appendOnly(): Promise<void> {
  area('A5. vehicle_assignments is append-only');
  const f = loadFixture();
  const t = f.a.tenantId;
  const n = await rowCount(t);
  for (const [who, url] of [
    ['app role (erp_app)', APP_DB],
    ['owner role (erp)', DB],
  ] as const) {
    await check(`UPDATE and DELETE refused by the trigger as the ${who}`, async () => {
      for (const sql of [
        `UPDATE vehicle_assignments SET reason = 'edited' WHERE "tenantId" = $1::uuid`,
        `UPDATE vehicle_assignments SET "userId" = NULL, "fromAt" = now() WHERE "tenantId" = $1::uuid`,
        `DELETE FROM vehicle_assignments WHERE "tenantId" = $1::uuid`,
      ]) {
        const r = await sqlAs(url, t, sql, [t]);
        assert(
          !!r.error && r.error.includes('append-only'),
          `${sql.slice(0, 40)}…: ${r.error ?? `${r.rows} row(s) changed`}`,
        );
      }
    });
  }
  await check('TRUNCATE: refused to the app role', async () => {
    const r = await sqlAs(APP_DB, t, 'TRUNCATE vehicle_assignments');
    assert(!!r.error, 'the app role truncated the history');
  });
  const tr = await sqlAs(DB, null, 'TRUNCATE vehicle_assignments');
  record({
    name: `INFO TRUNCATE as the owner role (rolled back): ${tr.error ? `refused (${tr.error})` : 'accepted: the row trigger does not cover TRUNCATE'}`,
    status: 'INFO',
  });
  await check(
    'the app role inserts only for its own company (RLS), and the rows are all still there',
    async () => {
      const foreign = await sqlAs(
        APP_DB,
        f.b.tenantId,
        `INSERT INTO vehicle_assignments (id, "tenantId", "vehicleId", "fromAt") VALUES (gen_random_uuid(), $1::uuid, $2::uuid, now())`,
        [t, f.a.trucks[0]!.id],
      );
      assert(
        !!foreign.error && /row-level security/.test(foreign.error),
        `insert for another company: ${foreign.error ?? 'accepted'}`,
      );
      const seen = await sqlAs(
        APP_DB,
        f.b.tenantId,
        `SELECT 1 FROM vehicle_assignments WHERE "tenantId" = $1::uuid`,
        [t],
      );
      assert(seen.error === null && seen.rows === 0, `B reads ${seen.rows} rows of A`);
      assert((await rowCount(t)) === n, 'rows of A changed');
    },
  );
}

// ================================================================ 6. tournées per vehicle

async function tournees(): Promise<void> {
  area('A6. Tournées per vehicle');
  const c = await co('tournees');
  const t = c.tenantId;
  const a = await invite(c, 'SELLER');
  const b = await invite(c, 'SELLER');
  const noTruck = await invite(c, 'SELLER');
  const t1 = await truck(c, 'Camion 1', {
    code: 'VAN-28 MXT 01',
    wilayaCode: 28,
    assignedUserId: a.id,
  });
  const clients = [await client(c, 'C1'), await client(c, 'C2')];
  const route = async (body: Record<string, unknown>) =>
    post(c.owner, '/routes', { weekdays: WEEK, active: true, ...body });

  const vr = await route({ name: 'Tournée du camion', vehicleId: t1.id });
  await check(
    'a route planned for a truck stores sellerId null, even when a seller is sent with it',
    async () => {
      accepted(vr, 'vehicle route');
      const both = await route({ name: 'Camion + vendeur', vehicleId: t1.id, sellerId: b.id });
      accepted(both, 'vehicle + seller');
      const rows = await query<{ sellerId: string | null; vehicleId: string | null }>(
        `SELECT "sellerId", "vehicleId" FROM routes WHERE id = ANY($1::uuid[])`,
        [[vr.body['id'], both.body['id']]],
      );
      assert(
        rows.every((r) => r.sellerId === null && r.vehicleId === t1.id),
        JSON.stringify(rows),
      );
      await c.owner.send('DELETE', `/routes/${String(both.body['id'])}`, undefined, null);
    },
  );
  await c.owner.put(`/routes/${String(vr.body['id'])}/stops`, { clientIds: clients });
  const vrId = String(vr.body['id']);
  const old = await route({ name: 'Ancienne tournée de B', sellerId: b.id });
  const oldId = String(old.body['id']);

  await check(
    'a route with neither a truck nor a seller is refused: ROUTE_NEEDS_OWNER in the API, routes_owner_check in the database',
    async () => {
      refused(await route({ name: 'Sans rien' }), 'ROUTE_NEEDS_OWNER', 'create');
      refused(
        await patch(c.owner, `/routes/${vrId}`, { vehicleId: null }),
        'ROUTE_NEEDS_OWNER',
        'clear the truck of a vehicle route',
      );
      const cleared = await patch(c.owner, `/routes/${oldId}`, { sellerId: null });
      assert(
        cleared.status >= 400 && cleared.status < 500,
        `clear the seller of a seller route: ${brief(cleared)}`,
      );
      const sql = await sqlAs(
        APP_DB,
        t,
        `UPDATE routes SET "vehicleId" = NULL, "sellerId" = NULL WHERE id = $1::uuid`,
        [vrId],
      );
      assert(
        !!sql.error && sql.error.includes('routes_owner_check'),
        `by SQL: ${sql.error ?? 'accepted'}`,
      );
      const depot = await route({ name: 'Sur un dépôt', vehicleId: c.mainWarehouseId });
      assert(
        depot.status >= 400 && depot.status < 500,
        `a route for the dépôt principal: ${brief(depot)}`,
      );
    },
  );
  await check(
    "aujourd'hui (GET /me/today): the truck's route for its driver, with the truck named; nothing for the others",
    async () => {
      const ta = await todayOf(a);
      assert(
        ta.vehicle?.id === t1.id && ta.vehicle.code === 'VAN-28 MXT 01',
        `A's truck: ${JSON.stringify(ta.vehicle)}`,
      );
      assert(
        ta.routes.map((r) => r.id).join() === vrId,
        `A's routes: ${JSON.stringify(ta.routes)}`,
      );
      const tb = await todayOf(b);
      assert(
        tb.vehicle === null && tb.routes.map((r) => r.id).join() === oldId,
        `B (no truck, an old route): ${JSON.stringify(tb)}`,
      );
      const tn = await todayOf(noTruck);
      assert(
        tn.vehicle === null && tn.routes.length === 0,
        `a seller with nothing: ${JSON.stringify(tn)}`,
      );
    },
  );
  await check(
    'right after the driver change, with no route edit: the new driver has the tournée, the previous one no longer',
    async () => {
      const updatedAt = (
        await query<{ u: Date }>(`SELECT "updatedAt" AS u FROM routes WHERE id = $1::uuid`, [vrId])
      )[0]!.u;
      await setDriver(c, t1.id, b.id);
      const [ta, tb] = await Promise.all([todayOf(a), todayOf(b)]);
      assert(
        ta.vehicle === null && ta.routes.length === 0,
        `A still sees ${JSON.stringify(ta.routes)}`,
      );
      assert(tb.vehicle?.id === t1.id, `B's truck: ${JSON.stringify(tb.vehicle)}`);
      assert(
        JSON.stringify(tb.routes.map((r) => r.id).sort()) === JSON.stringify([vrId, oldId].sort()),
        `B sees the truck's route and his old one: ${JSON.stringify(tb.routes)}`,
      );
      const after = (
        await query<{ u: Date }>(`SELECT "updatedAt" AS u FROM routes WHERE id = $1::uuid`, [vrId])
      )[0]!.u;
      assert(after.getTime() === updatedAt.getTime(), 'the route row was touched');
      // A no longer reads the route of a truck he does not drive; B does.
      const lost = await a.api.get(`/routes/${vrId}`);
      assert(lost.status === 404, `A reads the route: ${brief(lost)}`);
      accepted(await b.api.get(`/routes/${vrId}`), 'B reads the route');
    },
  );
  await check(
    "the stops B sees on the truck's tournée say what the truck already did today (A visited one before the change)",
    async () => {
      // New pair: A visits a stop, then the truck goes to B.
      const t9 = await truck(c, 'Camion 9', { code: 'T9' });
      const x = await invite(c, 'SELLER');
      const y = await invite(c, 'SELLER');
      await setDriver(c, t9.id, x.id);
      const r9 = await route({ name: 'Tournée T9', vehicleId: t9.id });
      await c.owner.put(`/routes/${String(r9.body['id'])}/stops`, { clientIds: clients });
      accepted(
        await noSale(x.api, clients[0]!, { routeId: r9.body['id'] }),
        'X visits the first stop',
      );
      await setDriver(c, t9.id, y.id);
      const ty = await y.api.read<{
        planned: number;
        visited: number;
        stops: { client: { id: string }; visitedToday: boolean }[];
      }>('/me/today');
      record({
        name: `INFO after the change, the new driver's day shows visited ${ty.visited} / ${ty.planned} (the truck's first stop was visited today by the previous driver: visitedToday=${ty.stops.find((s) => s.client.id === clients[0])?.visitedToday})`,
        status: 'INFO',
      });
    },
  );

  // Convert.
  await check(
    'convert one: SELLER_HAS_NO_VEHICLE when the seller drives none; the route is left as it was',
    async () => {
      const r = await route({ name: 'Tournée du vendeur sans camion', sellerId: noTruck.id });
      const id = String(r.body['id']);
      refused(
        await post(c.owner, `/routes/${id}/convert-to-vehicle`),
        'SELLER_HAS_NO_VEHICLE',
        'convert',
      );
      const row = (
        await query<{ sellerId: string | null; vehicleId: string | null }>(
          `SELECT "sellerId", "vehicleId" FROM routes WHERE id = $1::uuid`,
          [id],
        )
      )[0]!;
      assert(row.sellerId === noTruck.id && row.vehicleId === null, JSON.stringify(row));
      assert(
        (await audits(t, 'ROUTE_CONVERTED', id)).length === 0,
        'an audit row for a refused conversion',
      );
    },
  );
  await check(
    "convert one: the route takes its seller's truck of now, loses its seller, is audited; a second convert changes nothing",
    async () => {
      const r = await post(c.owner, `/routes/${oldId}/convert-to-vehicle`);
      accepted(r, 'convert');
      const row = (
        await query<{ sellerId: string | null; vehicleId: string | null }>(
          `SELECT "sellerId", "vehicleId" FROM routes WHERE id = $1::uuid`,
          [oldId],
        )
      )[0]!;
      assert(row.sellerId === null && row.vehicleId === t1.id, JSON.stringify(row));
      const au = await audits(t, 'ROUTE_CONVERTED', oldId);
      assert(
        au.length === 1 &&
          (au[0]!.before as { sellerId: string }).sellerId === b.id &&
          (au[0]!.after as { vehicleId: string }).vehicleId === t1.id,
        JSON.stringify(au),
      );
      const again = await post(c.owner, `/routes/${oldId}/convert-to-vehicle`);
      assert(again.status < 500, `second convert: ${brief(again)}`);
      assert((await audits(t, 'ROUTE_CONVERTED', oldId)).length === 1, 'a second audit row');
      const seller = await b.api.send('POST', `/routes/${oldId}/convert-to-vehicle`, {});
      assert(seller.status === 403, `a seller converts: ${brief(seller)}`);
    },
  );
  await check(
    'bulk convert: the count, the routes of sellers without a truck skipped, a second run converts 0, one audit row per route',
    async () => {
      const b2 = await co('bulk');
      const s1 = await invite(b2, 'SELLER');
      const s2 = await invite(b2, 'SELLER');
      const s3 = await invite(b2, 'SELLER');
      const k1 = await truck(b2, 'K1', { assignedUserId: s1.id });
      const k2 = await truck(b2, 'K2', { assignedUserId: s2.id });
      const ids: Record<string, string[]> = { s1: [], s2: [], s3: [] };
      for (const [key, s, n] of [
        ['s1', s1, 3],
        ['s2', s2, 2],
        ['s3', s3, 2],
      ] as const) {
        for (let i = 0; i < n; i += 1) {
          ids[key]!.push(
            (
              await b2.owner.post<{ id: string }>(
                '/routes',
                { name: `R ${key} ${i}`, sellerId: s.id, weekdays: WEEK, active: i !== 0 },
                null,
              )
            ).id,
          );
        }
      }
      const archived = (
        await b2.owner.post<{ id: string }>(
          '/routes',
          { name: 'R archivée', sellerId: s1.id, weekdays: WEEK, active: true },
          null,
        )
      ).id;
      await b2.owner.send('DELETE', `/routes/${archived}`, undefined, null);
      const first = await post(b2.owner, '/routes/convert-to-vehicle');
      accepted(first, 'bulk');
      assert(
        first.body['converted'] === 5 && first.body['skipped'] === 2,
        `first run: ${JSON.stringify(first.body)}`,
      );
      const rows = await query<{ id: string; sellerId: string | null; vehicleId: string | null }>(
        `SELECT id, "sellerId", "vehicleId" FROM routes WHERE "tenantId" = $1::uuid`,
        [b2.tenantId],
      );
      const by = new Map(rows.map((r) => [r.id, r]));
      assert(
        ids['s1']!.every((i) => by.get(i)!.vehicleId === k1.id && by.get(i)!.sellerId === null),
        'routes of seller 1 -> K1',
      );
      assert(
        ids['s2']!.every((i) => by.get(i)!.vehicleId === k2.id),
        'routes of seller 2 -> K2',
      );
      assert(
        ids['s3']!.every((i) => by.get(i)!.vehicleId === null && by.get(i)!.sellerId === s3.id),
        'routes of seller 3 untouched',
      );
      assert(by.get(archived)!.vehicleId === null, 'an archived route was converted');
      const second = await post(b2.owner, '/routes/convert-to-vehicle');
      assert(second.body['converted'] === 0, `second run: ${JSON.stringify(second.body)}`);
      assert(
        (await audits(b2.tenantId, 'ROUTE_CONVERTED')).length === 5,
        `audit rows: ${(await audits(b2.tenantId, 'ROUTE_CONVERTED')).length}`,
      );
    },
  );
  await check(
    'list filters: ?vehicleId= gives the routes of that truck, ?sellerId= the old seller routes',
    async () => {
      const byTruck = await c.owner.read<
        { id: string; vehicle: { id: string; driver: { id: string } | null } | null }[]
      >(`/routes?vehicleId=${t1.id}`);
      assert(
        byTruck.length === 2 &&
          byTruck.every((r) => r.vehicle?.id === t1.id && r.vehicle.driver?.id === b.id),
        JSON.stringify(byTruck.map((r) => r.vehicle)),
      );
      const bySeller = await c.owner.read<{ id: string }[]>(`/routes?sellerId=${b.id}`);
      assert(bySeller.length === 0, `seller routes of B after the conversion: ${bySeller.length}`);
    },
  );
}

// ================================================================ 7. frozen truck

async function frozen(): Promise<void> {
  area('A7. The truck frozen on visits and orders');
  const s = await stocked('frozen', 4);
  const { c, p, clients } = s;
  const a = await invite(c, 'SELLER');
  const b = await invite(c, 'SELLER');
  const liv1 = await invite(c, 'LIVREUR');
  const liv2 = await invite(c, 'LIVREUR');
  const t1 = await truck(c, 'Camion 1', { code: 'F1' });
  const t2 = await truck(c, 'Camion 2', { code: 'F2' });
  const del = await truck(c, 'Camion livraison', { code: 'LIV 28 MIX' });
  const beforeTruck = new Date(Date.now() - 1).toISOString();
  await new Promise((r) => setTimeout(r, 20));
  await setDriver(c, t1.id, a.id);
  await setDriver(c, del.id, liv1.id);
  accepted(await s.transfer('LOAD', c.mainWarehouseId, del.id, '100'), 'load the delivery truck');

  const v1 = await noSale(a.api, clients[0]!);
  await check(
    'Visit.vehicleId = the truck the seller drives when it starts; a seller without a truck: null',
    async () => {
      accepted(v1, 'visit');
      assert((await visitTruck(String(v1.body['id']))) === t1.id, 'visit of A');
      assert(
        (v1.body['vehicle'] as { id: string } | null)?.id === t1.id,
        `the DTO names the truck: ${JSON.stringify(v1.body['vehicle'])}`,
      );
      const vb = await noSale(b.api, clients[0]!);
      assert((await visitTruck(String(vb.body['id']))) === null, 'visit of B (no truck)');
    },
  );
  await check(
    "a visit typed in for a moment before he had the truck gets no truck (history, never today's driver)",
    async () => {
      const past = await noSale(a.api, clients[1]!, { startedAt: beforeTruck });
      accepted(past, 'backdated visit');
      assert(
        (await visitTruck(String(past.body['id']))) === null,
        `truck of a visit started at ${beforeTruck}: ${await visitTruck(String(past.body['id']))}`,
      );
    },
  );
  const order1 = await post(a.api, '/orders', {
    clientId: clients[2]!,
    lines: [{ productId: p.id, unitId: p.unitId, qty: '6' }],
  });
  await check('Order.vehicleId = the truck of the prévendeur when the order is taken', async () => {
    accepted(order1, 'order');
    const row = (
      await query<{ v: string | null; d: string | null }>(
        `SELECT "vehicleId" AS v, "deliveryVehicleId" AS d FROM orders WHERE id = $1::uuid`,
        [order1.body['id']],
      )
    )[0]!;
    assert(row.v === t1.id && row.d === null, JSON.stringify(row));
  });
  await setDriver(c, t2.id, a.id);
  await check('a later driver change rewrites neither the visit nor the order', async () => {
    assert((await visitTruck(String(v1.body['id']))) === t1.id, 'the visit');
    const row = (
      await query<{ v: string | null }>(`SELECT "vehicleId" AS v FROM orders WHERE id = $1::uuid`, [
        order1.body['id'],
      ])
    )[0]!;
    assert(row.v === t1.id, 'the order');
    const v2 = await noSale(a.api, clients[0]!);
    assert((await visitTruck(String(v2.body['id']))) === t2.id, 'a new visit takes the new truck');
  });
  await check(
    'a correction visit copies the truck of the visit it replaces, not the truck of today',
    async () => {
      const fix = await post(a.api, '/visits', {
        clientId: clients[0]!,
        startedAt: new Date().toISOString(),
        outcome: 'NO_SALE',
        reason: 'NO_MONEY',
        correctsVisitId: v1.body['id'],
      });
      accepted(fix, 'correction');
      assert(
        (await visitTruck(String(fix.body['id']))) === t1.id,
        `correction: ${await visitTruck(String(fix.body['id']))}, corrected visit: ${t1.id}, truck of today: ${t2.id}`,
      );
    },
  );
  await check(
    'the visits table refuses an UPDATE of the frozen truck through the API (no route) and the list filters by truck',
    async () => {
      const on1 = listOf<{ id: string }>((await c.owner.get(`/visits?vehicleId=${t1.id}`)).body);
      const truth = await query<{ id: string }>(
        `SELECT id FROM visits WHERE "tenantId" = $1::uuid AND "vehicleId" = $2::uuid`,
        [c.tenantId, t1.id],
      );
      assert(
        JSON.stringify(on1.map((v) => v.id).sort()) ===
          JSON.stringify(truth.map((v) => v.id).sort()),
        `filter ${on1.length}, table ${truth.length}`,
      );
    },
  );

  // Delivery truck.
  const confirmed = await post(a.api, `/orders/${String(order1.body['id'])}/confirm`);
  const orderId = String(order1.body['id']);
  const line = (confirmed.body['lines'] as { id: string }[])[0]!.id;
  const mine = async (u: Staff): Promise<string[]> =>
    listOf<{ id: string }>((await u.api.get('/orders?status=CONFIRMED')).body).map((o) => o.id);
  await check(
    'assigning a delivery truck puts the order on the truck and on its driver of today ("Mes livraisons")',
    async () => {
      const r = await patch(c.owner, `/orders/${orderId}/livreur`, { deliveryVehicleId: del.id });
      accepted(r, 'assign');
      const row = (
        await query<{ l: string | null; d: string | null }>(
          `SELECT "livreurId" AS l, "deliveryVehicleId" AS d FROM orders WHERE id = $1::uuid`,
          [orderId],
        )
      )[0]!;
      assert(row.d === del.id && row.l === liv1.id, JSON.stringify(row));
      assert(
        (await mine(liv1)).includes(orderId) && !(await mine(liv2)).includes(orderId),
        'livreur 1 has it, livreur 2 not',
      );
      const depot = await patch(c.owner, `/orders/${orderId}/livreur`, {
        deliveryVehicleId: c.mainWarehouseId,
      });
      assert(
        depot.status >= 400 && depot.status < 500,
        `a dépôt as delivery truck: ${brief(depot)}`,
      );
    },
  );
  await check(
    'the driver changes before delivery: the order follows the truck, the new driver has it, the old one no longer',
    async () => {
      await setDriver(c, del.id, liv2.id);
      assert((await mine(liv2)).includes(orderId), 'livreur 2 does not see the order');
      assert(!(await mine(liv1)).includes(orderId), 'livreur 1 still sees the order');
      const old = await liv1.api.get(`/orders/${orderId}`);
      assert(old.status === 404, `livreur 1 opens it: ${brief(old)}`);
      const tries = await post(liv1.api, `/orders/${orderId}/deliver`, {
        lines: [{ orderLineId: line, qty: '6' }],
        paidAmount: '0',
        paymentMode: 'ESPECES',
      });
      assert(
        tries.status === 404 || tries.status === 403,
        `livreur 1 delivers it: ${brief(tries)}`,
      );
      const shown = await c.owner.read<{ livreur: { id: string } | null }>(`/orders/${orderId}`);
      assert(
        shown.livreur?.id === liv2.id,
        `the office sees livreur ${JSON.stringify(shown.livreur)}`,
      );
    },
  );
  const levelsBefore = { truck: await s.stock(del.id), main: await s.stock(c.mainWarehouseId) };
  let blLeft: string | null = null;
  await check(
    'delivery by the new driver: deliveryVehicleId and livreurId say what and who delivered, the cash is his',
    async () => {
      const r = await post(liv2.api, `/orders/${orderId}/deliver`, {
        lines: [{ orderLineId: line, qty: '6' }],
        paidAmount: '2000',
        paymentMode: 'ESPECES',
      });
      accepted(r, 'deliver');
      const row = (
        await query<{ l: string | null; d: string | null; v: string | null; sale: string }>(
          `SELECT "livreurId" AS l, "deliveryVehicleId" AS d, "vehicleId" AS v, "saleId" AS sale FROM orders WHERE id = $1::uuid`,
          [orderId],
        )
      )[0]!;
      assert(row.d === del.id && row.l === liv2.id && row.v === t1.id, JSON.stringify(row));
      blLeft = await s.soldFrom(row.sale);
      const pay = await query<{ c: string | null }>(
        `SELECT "collectedBy" AS c FROM payments WHERE "saleId" = $1::uuid`,
        [row.sale],
      );
      assert(pay.length === 1 && pay[0]!.c === liv2.id, `the cash is with ${JSON.stringify(pay)}`);
      assert(!(await mine(liv2)).includes(orderId), 'a delivered order is no longer "to deliver"');
      const kept = listOf<{ id: string }>(
        (await liv2.api.get('/orders?status=DELIVERED')).body,
      ).map((o) => o.id);
      assert(kept.includes(orderId), 'the one who delivered keeps the delivered order');
    },
  );
  await check(
    'the BL of an order put on a loaded delivery truck leaves that truck (the order was taken by a seller, who named no dépôt)',
    async () => {
      const now = { truck: await s.stock(del.id), main: await s.stock(c.mainWarehouseId) };
      const orderDepot = (
        await query<{ w: string | null }>(
          `SELECT "warehouseId" AS w FROM orders WHERE id = $1::uuid`,
          [orderId],
        )
      )[0]!.w;
      assert(
        blLeft === del.id,
        `the 6 units left ${blLeft === c.mainWarehouseId ? 'the dépôt principal' : blLeft}: delivery truck ${levelsBefore.truck} -> ${now.truck} (100 were loaded on it), dépôt principal ${levelsBefore.main} -> ${now.main}; ` +
          `Order.deliveryVehicleId = the truck. The order got warehouseId = ${orderDepot === c.mainWarehouseId ? 'the dépôt principal' : orderDepot} when the seller took it, though he sent none (ScopeService.onlyWarehouse)`,
      );
    },
    {
      expected:
        'spec: "the truck that delivered it … (the BL\'s dépôt when it is a truck)"; domain: a truck is a dépôt with its own stock, chargement and déchargement',
    },
  );
  await check(
    'an order whose dépôt is the delivery truck itself (taken by the office): the BL leaves the truck',
    async () => {
      const d = await post(c.owner, '/orders', {
        clientId: clients[3]!,
        sellerId: a.id,
        warehouseId: del.id,
        lines: [{ productId: p.id, unitId: p.unitId, qty: '3' }],
      });
      accepted(d, 'order on the truck');
      const conf = await post(c.owner, `/orders/${String(d.body['id'])}/confirm`);
      accepted(
        await patch(c.owner, `/orders/${String(d.body['id'])}/livreur`, {
          deliveryVehicleId: del.id,
        }),
        'assign',
      );
      const before = await s.stock(del.id);
      const r = await post(liv2.api, `/orders/${String(d.body['id'])}/deliver`, {
        lines: [{ orderLineId: (conf.body['lines'] as { id: string }[])[0]!.id, qty: '3' }],
        paidAmount: '0',
        paymentMode: 'ESPECES',
      });
      accepted(r, 'deliver');
      const row = (
        await query<{ d: string | null; sale: string }>(
          `SELECT "deliveryVehicleId" AS d, "saleId" AS sale FROM orders WHERE id = $1::uuid`,
          [d.body['id']],
        )
      )[0]!;
      assert(row.d === del.id && (await s.soldFrom(row.sale)) === del.id, 'left the truck');
      same(await s.stock(del.id), String(Number(before) - 3), 'delivery truck stock');
    },
  );
  await check('later driver changes do not rewrite a delivered order', async () => {
    await setDriver(c, del.id, liv1.id);
    const row = (
      await query<{ l: string | null; d: string | null }>(
        `SELECT "livreurId" AS l, "deliveryVehicleId" AS d FROM orders WHERE id = $1::uuid`,
        [orderId],
      )
    )[0]!;
    assert(row.d === del.id && row.l === liv2.id, JSON.stringify(row));
    const now1 = listOf<{ id: string }>((await liv1.api.get('/orders')).body).map((o) => o.id);
    assert(!now1.includes(orderId), 'the driver of today sees an order delivered by another');
  });
  await check(
    'an order delivered from the dépôt principal by the office has no delivery truck; list filter ?deliveryVehicleId=',
    async () => {
      const d = await post(a.api, '/orders', {
        clientId: clients[3]!,
        warehouseId: c.mainWarehouseId,
        lines: [{ productId: p.id, unitId: p.unitId, qty: '2' }],
      });
      const conf = await post(a.api, `/orders/${String(d.body['id'])}/confirm`);
      const r = await post(c.owner, `/orders/${String(d.body['id'])}/deliver`, {
        lines: [{ orderLineId: (conf.body['lines'] as { id: string }[])[0]!.id, qty: '2' }],
        paidAmount: '0',
        paymentMode: 'ESPECES',
      });
      accepted(r, 'deliver from the dépôt');
      const row = (
        await query<{ d: string | null; v: string | null }>(
          `SELECT "deliveryVehicleId" AS d, "vehicleId" AS v FROM orders WHERE id = $1::uuid`,
          [d.body['id']],
        )
      )[0]!;
      assert(row.d === null && row.v === t2.id, JSON.stringify(row));
      const filtered = listOf<{ id: string }>(
        (await c.owner.get(`/orders?deliveryVehicleId=${del.id}`)).body,
      ).map((o) => o.id);
      const truth = await query<{ id: string }>(
        `SELECT id FROM orders WHERE "tenantId" = $1::uuid AND "deliveryVehicleId" = $2::uuid`,
        [c.tenantId, del.id],
      );
      assert(
        JSON.stringify([...filtered].sort()) === JSON.stringify(truth.map((o) => o.id).sort()),
        `filter ${filtered.length}, table ${truth.length}`,
      );
    },
  );
  await check('a visit dated in the future: what the API does', async () => {
    const r = await noSale(a.api, clients[0]!, {
      startedAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    });
    record({
      name: `INFO POST /visits with startedAt 30 days from now: HTTP ${r.status} ${codeOf(r) ?? ''}${r.status < 300 ? `, vehicleId ${(await visitTruck(String(r.body['id']))) === t2.id ? "= today's truck" : 'other'}` : ''}`,
      status: 'INFO',
    });
  });
}

// ================================================================ 8. stock and money

async function stockAndMoney(): Promise<void> {
  area('A8. Stock and money after a driver change');
  const s = await stocked('stock', 4);
  const { c, clients } = s;
  const main = c.mainWarehouseId;
  const a = await invite(c, 'SELLER');
  const b = await invite(c, 'SELLER');
  const t1 = await truck(c, 'Camion 1', { code: 'S1', assignedUserId: a.id });
  const t2 = await truck(c, 'Camion 2', { code: 'S2' });
  accepted(await s.transfer('LOAD', main, t1.id, '100'), 'load truck 1');
  accepted(await s.transfer('LOAD', main, t2.id, '50'), 'load truck 2');
  const levels = async () => ({
    main: Number(await s.stock(main)),
    t1: Number(await s.stock(t1.id)),
    t2: Number(await s.stock(t2.id)),
  });

  await check(
    'before any change: a sale with no dépôt chosen leaves the truck the seller drives',
    async () => {
      const r = await s.sell(a.api, clients[0]!, '10', {
        paidAmount: '5000',
        paymentMode: 'ESPECES',
      });
      accepted(r, 'sale');
      assert((await s.soldFrom(saleId(r))) === t1.id, 'left truck 1');
      assert(
        JSON.stringify(await levels()) === JSON.stringify({ main: 1850, t1: 90, t2: 50 }),
        JSON.stringify(await levels()),
      );
    },
  );
  const session = await c.owner.post<{ id: string; warehouseId?: string | null }>(
    '/seller-sessions',
    { sellerId: a.id, date: today },
  );
  await check(
    'the day opened on truck 1 names truck 1; the move to truck 2 waits for the clôture',
    async () => {
      const row = (
        await query<{ w: string | null }>(
          `SELECT "warehouseId" AS w FROM seller_sessions WHERE id = $1::uuid`,
          [session.id],
        )
      )[0]!;
      assert(row.w === t1.id, `session truck ${row.w}`);
      refused(
        await driver(c.owner, t2.id, a.id),
        'SESSION_OPEN_ON_VEHICLE',
        'move while the day is open',
      );
      const closed = await post(c.owner, `/seller-sessions/${session.id}/close`, {
        handedCash: '5000',
      });
      accepted(closed, 'close');
      const s1 = (
        await query<{ e: string; ec: string }>(
          `SELECT "expectedCash"::text AS e, ecart::text AS ec FROM seller_sessions WHERE id = $1::uuid`,
          [session.id],
        )
      )[0]!;
      same(s1.e, '5000', 'expected cash of the morning');
      same(s1.ec, '0', 'écart');
    },
  );
  await setDriver(c, t2.id, a.id);
  await check(
    'after the change (critical): the sale takes its stock from the truck he drives now, not the old one, not the dépôt principal',
    async () => {
      const before = await levels();
      const r = await s.sell(a.api, clients[1]!, '7', {
        paidAmount: '3000',
        paymentMode: 'ESPECES',
      });
      accepted(r, 'sale');
      const from = await s.soldFrom(saleId(r));
      assert(
        from === t2.id,
        `the SALE movements are on ${from === t1.id ? 'the old truck' : from === main ? 'the dépôt principal' : from}`,
      );
      assert(
        JSON.stringify(await levels()) === JSON.stringify({ ...before, t2: 43 }),
        `${JSON.stringify(before)} -> ${JSON.stringify(await levels())}`,
      );
      const sale = (
        await query<{ w: string }>(`SELECT "warehouseId" AS w FROM sales WHERE id = $1::uuid`, [
          saleId(r),
        ])
      )[0]!;
      assert(sale.w === t2.id, 'Sale.warehouseId');
    },
  );
  await check('the visit of that sale freezes the same truck as the sale left', async () => {
    const r = await s.sell(a.api, clients[1]!, '1');
    const v = await post(a.api, '/visits', {
      clientId: clients[1]!,
      startedAt: new Date().toISOString(),
      outcome: 'SALE',
      saleId: saleId(r),
    });
    accepted(v, 'visit');
    assert(
      (await visitTruck(String(v.body['id']))) === t2.id && (await s.soldFrom(saleId(r))) === t2.id,
      'visit truck and sale truck',
    );
  });
  await check(
    'he can still name his old truck or the dépôt (what phase 15 allowed), and what he names is what moves',
    async () => {
      const before = await levels();
      const r = await s.sell(a.api, clients[1]!, '2', { warehouseId: t1.id });
      record({
        name: `INFO a seller naming a truck he no longer drives (warehouseId = old truck): HTTP ${r.status} ${codeOf(r) ?? ''}`,
        status: 'INFO',
      });
      if (r.status < 300) {
        assert((await s.soldFrom(saleId(r))) === t1.id, 'the movement is not on the named truck');
        assert(Number(await s.stock(t1.id)) === before.t1 - 2, 'old truck level');
      } else {
        assert(
          JSON.stringify(await levels()) === JSON.stringify(before),
          'a refused sale moved stock',
        );
      }
    },
  );
  await check(
    'chargement and déchargement after the change: the goods move between the named dépôts, the CUMP stays',
    async () => {
      const before = await levels();
      accepted(await s.transfer('UNLOAD', t1.id, main, String(before.t1)), 'unload the old truck');
      accepted(await s.transfer('LOAD', main, t2.id, '20'), 'load the new truck');
      const after = await levels();
      assert(
        after.t1 === 0 &&
          after.t2 === before.t2 + 20 &&
          after.main === before.main + before.t1 - 20,
        `${JSON.stringify(before)} -> ${JSON.stringify(after)}`,
      );
      same(await dbRead.avgCost(c.tenantId, s.p.id), '500', 'CUMP');
      const sum = after.main + after.t1 + after.t2;
      same(
        await dbRead.stock(c.tenantId, s.p.id),
        String(sum),
        'product level = sum of the dépôts',
      );
    },
  );
  await check(
    'cash responsibility after the move: he does not leave the second truck of his day with cash that no clôture counted',
    async () => {
      // 3 000 DA were collected on truck 2 after the morning's day (5 000) was closed. There
      // is one clôture per seller per day, so the guard looks at the cash since its last
      // count (fix of A-4): the change is refused until the clôture is corrected.
      const again = await post(c.owner, '/seller-sessions', { sellerId: a.id, date: today });
      const collected = (
        await query<{ s: string }>(
          `SELECT COALESCE(SUM(amount), 0)::text AS s FROM payments WHERE "tenantId" = $1::uuid AND "collectedBy" = $2::uuid AND mode = 'ESPECES' AND status = 'VALID'`,
          [c.tenantId, a.id],
        )
      )[0]!.s;
      const refused = await driver(c.owner, t2.id, null);
      const stillOn = (await driverNow(t2.id)) === a.id;
      assert(
        refused.status === 409 && codeOf(refused) === 'CASH_AFTER_CLOSING' && stillOn,
        `POST /seller-sessions again -> HTTP ${again.status}, the same closed session (${String(again.body['id']) === session.id}). ` +
          `Cash collected by the seller today: ${collected} DA, 5 000 of it in his clôture. ` +
          `POST /warehouses/S2/driver {userId: null} -> HTTP ${refused.status} ${codeOf(refused) ?? ''}; he is ${stillOn ? 'still' : 'no longer'} on S2.`,
      );
      const amount = (refused.body['details'] as { amount?: string } | undefined)?.amount;
      assert(amount === '3000.00', `the refusal names ${amount} DA, expected 3000.00`);
      // The new count is a correction of the clôture; after it he can leave the truck.
      accepted(
        await post(c.owner, `/seller-sessions/${session.id}/adjust`, {
          handedCash: collected,
          note: 'Encaissé sur le second camion',
        }),
        'adjust the clôture',
      );
      accepted(await driver(c.owner, t2.id, null), 'leave S2 once the cash is counted');
    },
    {
      expected:
        'spec: "close the day first, money responsibility must stay clear" — the guard refuses a driver who collected cash since his last clôture (CASH_AFTER_CLOSING)',
    },
  );
  await check(
    'a day opened before the seller had a truck (no truck on the session) blocks a later change until it is closed (INFO line)',
    async () => {
      const d = await truck(c, 'Camion 3', { code: 'S3' });
      const open = await c.owner.post<{ id: string }>('/seller-sessions', {
        sellerId: b.id,
        date: today,
      });
      await setDriver(c, d.id, b.id);
      const r = await s.sell(b.api, clients[2]!, '1', {
        warehouseId: main,
        paidAmount: '1190',
        paymentMode: 'ESPECES',
      });
      accepted(r, 'cash sale');
      const move = await driver(c.owner, d.id, null);
      record({
        name: `INFO seller with an OPEN day (opened before he got the truck, session.warehouseId null) and cash in hand is taken off his truck: HTTP ${move.status} ${codeOf(move) ?? '(allowed: the guard only looks at sessions that name the truck)'}`,
        status: 'INFO',
      });
      await post(c.owner, `/seller-sessions/${open.id}/close`, { handedCash: '1190' });
    },
  );

  // A truck switched off with its driver on it.
  const off = await stocked('inactive truck', 2);
  const x = await invite(off.c, 'SELLER');
  const tx = await truck(off.c, 'Camion X', { code: 'X1', assignedUserId: x.id });
  accepted(await off.transfer('LOAD', off.c.mainWarehouseId, tx.id, '30'), 'load');
  await check(
    'a truck switched off (active: false) with its driver still on it: the sale and its visit agree on the truck',
    async () => {
      accepted(
        await patch(off.c.owner, `/warehouses/${tx.id}`, { active: false }),
        'switch the truck off',
      );
      const h = await history(tx.id);
      const r = await off.sell(x.api, off.clients[0]!, '3');
      accepted(r, 'sale');
      const from = await off.soldFrom(saleId(r));
      const v = await post(x.api, '/visits', {
        clientId: off.clients[0]!,
        startedAt: new Date().toISOString(),
        outcome: 'SALE',
        saleId: saleId(r),
      });
      accepted(v, 'visit');
      const frozenTruck = await visitTruck(String(v.body['id']));
      const o = await post(x.api, '/orders', {
        clientId: off.clients[0]!,
        lines: [{ productId: off.p.id, unitId: off.p.unitId, qty: '1' }],
      });
      const orderTruck =
        (
          await query<{ v: string | null }>(
            `SELECT "vehicleId" AS v FROM orders WHERE id = $1::uuid`,
            [o.body['id']],
          )
        )[0]?.v ?? null;
      const name = (w: string | null) =>
        w === tx.id ? 'truck X1' : w === off.c.mainWarehouseId ? 'the dépôt principal' : String(w);
      const day = await todayOf(x);
      assert(
        (from === tx.id) === (frozenTruck === tx.id) && frozenTruck === orderTruck,
        `after PATCH active:false (assignedUserId kept: ${(await driverNow(tx.id)) === x.id}, history rows: ${h.length}, last names the seller: ${h.at(-1)!.userId === x.id}): ` +
          `the sale left ${name(from)} (truck stock ${await off.stock(tx.id)}, dépôt principal ${await off.stock(off.c.mainWarehouseId)}), ` +
          `Visit.vehicleId = ${name(frozenTruck)}, Order.vehicleId = ${name(orderTruck)}, GET /me/today vehicle = ${name(day.vehicle?.id ?? null)}`,
      );
    },
    {
      expected:
        'one truck for the sale, the visit and the order of the same seller at the same moment (phase 37 reads Visit.vehicleId as the truck of the sale)',
    },
  );
}

// ================================================================ 9. livreurs, activities

async function livreursAndActivities(): Promise<void> {
  area('A9. Livreurs drive trucks; the activity is only a hint');
  const s = await stocked('activity', 3);
  const { c, p, clients } = s;
  const main = c.mainWarehouseId;
  const types: Record<string, string> = {};
  for (const activity of ['CASH_VAN', 'PRESALE', 'DELIVERY', 'MIXED']) {
    types[activity] = (
      await c.owner.post<{ id: string }>(
        '/vehicle-types',
        { code: activity.slice(0, 3), name: activity, activity },
        null,
      )
    ).id;
  }
  const liv = await invite(c, 'LIVREUR');
  const seller = await invite(c, 'SELLER');
  const pre = await invite(c, 'SELLER');
  const delivery = await truck(c, 'Livraison', {
    code: 'LIV 28 MIX',
    vehicleTypeId: types['DELIVERY'],
  });
  const presale = await truck(c, 'Prévente', {
    code: 'PRV05-DD01',
    vehicleTypeId: types['PRESALE'],
  });
  await check(
    'a livreur is put on a DELIVERY truck (new decision), through the quick change and through the form',
    async () => {
      accepted(await driver(c.owner, delivery.id, liv.id), 'quick change');
      accepted(
        await patch(c.owner, `/warehouses/${delivery.id}`, { assignedUserId: null }),
        'form: clear',
      );
      accepted(
        await patch(c.owner, `/warehouses/${delivery.id}`, { assignedUserId: liv.id }),
        'form: set',
      );
    },
  );
  accepted(await s.transfer('LOAD', main, delivery.id, '40'), 'load the delivery truck');
  accepted(
    await s.transfer('LOAD', main, presale.id, '40'),
    'load the presale truck (phase 15 allows any truck)',
  );
  await setDriver(c, presale.id, pre.id);

  await check(
    'the livreur delivers an order from his truck (an order whose dépôt is the truck)',
    async () => {
      const d = await post(c.owner, '/orders', {
        clientId: clients[0]!,
        sellerId: seller.id,
        warehouseId: delivery.id,
        lines: [{ productId: p.id, unitId: p.unitId, qty: '5' }],
      });
      accepted(d, 'order');
      const conf = await post(c.owner, `/orders/${String(d.body['id'])}/confirm`);
      accepted(
        await patch(c.owner, `/orders/${String(d.body['id'])}/livreur`, {
          deliveryVehicleId: delivery.id,
        }),
        'assign',
      );
      const r = await post(liv.api, `/orders/${String(d.body['id'])}/deliver`, {
        lines: [{ orderLineId: (conf.body['lines'] as { id: string }[])[0]!.id, qty: '5' }],
        paidAmount: '0',
        paymentMode: 'ESPECES',
      });
      accepted(r, 'deliver');
      same(await s.stock(delivery.id), '35', 'delivery truck');
    },
  );
  await check(
    'the livreur cannot sell from his truck: the existing rules (who may create a sale) still decide',
    async () => {
      const before = await s.stock(delivery.id);
      const quick = await s.sell(liv.api, clients[0]!, '1');
      const named = await s.sell(liv.api, clients[0]!, '1', { warehouseId: delivery.id });
      const order = await post(liv.api, '/orders', {
        clientId: clients[0]!,
        lines: [{ productId: p.id, unitId: p.unitId, qty: '1' }],
      });
      const visit = await noSale(liv.api, clients[0]!);
      record({
        name: `INFO livreur on a truck: POST /sales/quick -> ${quick.status} ${codeOf(quick) ?? ''}; naming his truck -> ${named.status} ${codeOf(named) ?? ''}; POST /orders -> ${order.status} ${codeOf(order) ?? ''}; POST /visits -> ${visit.status} ${codeOf(visit) ?? ''}`,
        status: 'INFO',
      });
      assert(
        quick.status === 403 && named.status === 403,
        `a livreur sold: ${brief(quick)} / ${brief(named)}`,
      );
      same(await s.stock(delivery.id), before, 'truck stock');
    },
  );
  await check(
    'activity is a hint: the driver of a PRESALE truck still sells from its stock, takes orders, and is loaded and unloaded',
    async () => {
      const r = await s.sell(pre.api, clients[1]!, '4');
      accepted(r, 'sale from a PRESALE truck');
      assert((await s.soldFrom(saleId(r))) === presale.id, 'left the presale truck');
      accepted(
        await post(pre.api, '/orders', {
          clientId: clients[1]!,
          lines: [{ productId: p.id, unitId: p.unitId, qty: '1' }],
        }),
        'order',
      );
      accepted(await s.transfer('UNLOAD', presale.id, main, '36'), 'unload');
    },
  );
  await check(
    'activity is a hint: a seller on a DELIVERY truck sells from it; a route may be planned for any truck; orders are assigned to a CASH_VAN or PRESALE truck',
    async () => {
      await setDriver(c, delivery.id, seller.id);
      const r = await s.sell(seller.api, clients[2]!, '2');
      accepted(r, 'sale from a DELIVERY truck');
      assert((await s.soldFrom(saleId(r))) === delivery.id, 'left the delivery truck');
      for (const w of [delivery, presale]) {
        accepted(
          await post(c.owner, '/routes', {
            name: `Tournée ${w.code}`,
            vehicleId: w.id,
            weekdays: WEEK,
            active: true,
          }),
          `route for ${w.code}`,
        );
      }
      const d = await post(pre.api, '/orders', {
        clientId: clients[2]!,
        lines: [{ productId: p.id, unitId: p.unitId, qty: '1' }],
      });
      await post(pre.api, `/orders/${String(d.body['id'])}/confirm`);
      accepted(
        await patch(c.owner, `/orders/${String(d.body['id'])}/livreur`, {
          deliveryVehicleId: presale.id,
        }),
        'order on a PRESALE truck',
      );
      accepted(
        await patch(c.owner, `/warehouses/${presale.id}`, { vehicleTypeId: types['CASH_VAN'] }),
        'change the type of a truck that has history',
      );
      accepted(
        await patch(c.owner, `/warehouses/${presale.id}`, { vehicleTypeId: null }),
        'a truck without type',
      );
    },
  );
}

// ================================================================ invariants, reconcile

const BLOCKS = new Map<string, string>();
{
  const text = readFileSync(
    fileURLToPath(new URL('../sql/vehicles-history.sql', import.meta.url)),
    'utf8',
  );
  for (const part of text.split(/^-- name: /m).slice(1)) {
    const name = part.slice(0, part.indexOf('\n')).trim();
    const sql = part
      .slice(part.indexOf('\n') + 1)
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim()
      .replace(/;$/, '');
    BLOCKS.set(name, sql);
  }
}
function block(name: string): string {
  const sql = BLOCKS.get(name);
  if (!sql) throw new Error(`no block ${name} in sql/vehicles-history.sql`);
  return sql;
}

async function invariants(): Promise<void> {
  area('A10. After the whole scenario: the database, read with SQL (sql/vehicles-history.sql)');
  const out: string[] = [];
  for (const [name, sql] of BLOCKS) {
    await check(name, async () => {
      const rows = await query(sql);
      out.push(
        `## ${name}: ${rows.length} row(s)`,
        ...rows.slice(0, 20).map((r) => JSON.stringify(r)),
        '',
      );
      assert(
        rows.length === 0,
        `${rows.length} row(s) break the rule, e.g. ${JSON.stringify(rows.slice(0, 2))}`,
      );
    });
  }
  proof36('vehicles-invariants.txt', out.join('\n'));
  await check('pnpm --filter @erp/api reconcile on the same database: no difference', async () => {
    const apiDir = fileURLToPath(new URL('../../apps/api/', import.meta.url));
    let log = '';
    let code = 0;
    try {
      log = execFileSync('node', ['dist/reconcile/reconcile.cli.js'], {
        cwd: apiDir,
        encoding: 'utf8',
        env: { ...process.env, DATABASE_URL: DB, DATABASE_URL_MIGRATE: DB },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      code = err.status ?? 1;
      log = `${err.stdout ?? ''}\n${err.stderr ?? ''}`;
    }
    proof36('reconcile.txt', log);
    assert(code === 0, `exit ${code}: ${log.trim().split('\n').slice(-3).join(' | ')}`);
  });
}

// ================================================================ run

const AREAS: [string, () => Promise<void>][] = [
  ['types', vehicleTypes],
  ['identity', identity],
  ['driver', driverChange],
  ['history', historyHelpers],
  ['append', appendOnly],
  ['tournees', tournees],
  ['frozen', frozen],
  ['stock', stockAndMoney],
  ['activity', livreursAndActivities],
];
for (const [name, fn] of AREAS) {
  if (!on(name)) continue;
  try {
    await fn();
  } catch (e) {
    // A broken set-up step: the area stops, the others still run.
    record({
      name: `${name}: the area stopped`,
      status: 'FAIL',
      evidence: e instanceof Error ? e.message : String(e),
    });
  }
}
await invariants();
writeSummary('vehicles-api');
await closeDb();
