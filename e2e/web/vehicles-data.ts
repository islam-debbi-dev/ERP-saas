/**
 * Data of the phase 36 browser checks (test 36, part E). One company per Playwright project
 * and per run, made through the real API with every user invited by `POST /users/invite`,
 * plus one bare company for the empty states. Nothing is written with SQL.
 *
 * The codes are the ones the prompt names: `VAN-28 MXT 01`, `VAN34-SELF/MT`, `LIV 28 MIX`,
 * a code with an Arabic word, a plate with digits, and two 30-character codes that differ
 * only by their last number.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { company, type Company, openingStock, PASSWORD, product, uniq } from '../lib/audit.ts';
import { call } from '../lib/http.ts';
import { assertT36Db } from '../lib/vehicles-fixture.ts';

export { PASSWORD };

export const CODES = {
  van: 'VAN-28 MXT 01',
  self: 'VAN34-SELF/MT',
  liv: 'LIV 28 MIX',
  /** Typed in this order: VAN, the Arabic word for "truck", 01. */
  arabic: 'VAN شاحنة 01',
  /** The other typing order, a different code for the database. */
  arabicSwapped: 'VAN 01 شاحنة',
  long1: 'VAN-28 GROS DETAIL MSILA N 001',
  long2: 'VAN-28 GROS DETAIL MSILA N 002',
} as const;
export const PLATE = '00123-119-28';

export interface UiUser {
  id: string;
  email: string;
  fullName: string;
  token: string;
}
export interface UiTruck {
  id: string;
  code: string | null;
  name: string;
}
export interface UiData {
  tenantId: string;
  owner: UiUser;
  /** Drives `VAN-28 MXT 01`; has an old seller route too. */
  karim: UiUser;
  /** Arabic name. Drives `VAN34-SELF/MT`; has an old seller route. */
  samir: UiUser;
  /** Drives nothing; has a seller route for today. */
  nadia: UiUser;
  /** Drives nothing, has no route. */
  farid: UiUser;
  /** Livreur on `LIV 28 MIX`. */
  yacine: UiUser;
  types: Record<string, string>;
  trucks: Record<'van' | 'self' | 'liv' | 'arabic' | 'arabicSwapped' | 'long1' | 'long2' | 'plain', UiTruck>;
  depotBatnaId: string;
  routes: { vanToday: string; livToday: string; karimOld: string; samirOld: string; nadiaOld: string };
  /** Confirmed orders: the first is on `LIV 28 MIX`, the second on no truck. */
  orders: { onLiv: { id: string; number: string }; free: { id: string; number: string } };
  clientNames: string[];
  /** A company with nothing in it: the empty states. */
  empty: { owner: UiUser };
}

const authFile = (name: string): string => fileURLToPath(new URL(`../.auth/${name}`, import.meta.url));
export const RUN_FILE = authFile('vehicles-ui-run.json');
export const runId = (): string => (JSON.parse(readFileSync(RUN_FILE, 'utf8')) as { run: string }).run;

async function invite(c: Company, role: string, fullName: string): Promise<UiUser> {
  const email = `${uniq('u')}@audit.local`;
  const inv = await c.owner.post<{ inviteUrl: string }>(
    '/users/invite',
    { fullName, email, role, managerId: null, mode: 'LINK' },
    null,
  );
  const res = await call<{ accessToken: string; user: { id: string } }>(
    `/auth/invitations/${inv.inviteUrl.split('/').pop()!}/accept`,
    { method: 'POST', body: { password: PASSWORD }, headers: { 'X-Client-Type': 'native' } },
  );
  return { id: res.body.user.id, email, fullName, token: res.body.accessToken };
}

export async function prepare(project: string): Promise<UiData> {
  const file = authFile(`vehicles-ui-${project}-${runId()}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as UiData;
  assertT36Db();

  const c = await company(`T36 E ${project}`, { edition: 'DISTRIBUTION' });
  const owner: UiUser = { id: c.session.userId, email: c.session.email, fullName: `Owner T36 E ${project}`, token: c.session.token };
  const karim = await invite(c, 'SELLER', 'Karim Benali');
  const samir = await invite(c, 'SELLER', 'سمير بن يوسف');
  const nadia = await invite(c, 'SELLER', 'Nadia Haddad');
  const farid = await invite(c, 'SELLER', 'Farid Mansouri');
  const yacine = await invite(c, 'LIVREUR', 'Yacine Livreur');

  const batna = await c.owner.post<{ id: string }>('/warehouses', { name: 'Dépôt Batna', type: 'SECONDARY', code: 'CDD BATNA 05' }, null);

  const types: Record<string, string> = {};
  for (const t of [
    { code: 'MXT', name: 'Gros + détail', codePrefix: 'VAN', activity: 'CASH_VAN' },
    { code: 'DD', name: 'Prévente détail', codePrefix: 'PRV', activity: 'PRESALE' },
    { code: 'MIX', name: 'Livreur mixte', codePrefix: 'LIV', activity: 'DELIVERY' },
    { code: 'SELF/MT', name: 'Self + moderne', codePrefix: null, activity: 'MIXED' },
    { code: 'HRC', name: 'Hôtels, restaurants, cafés', codePrefix: 'VAN', activity: 'CASH_VAN' },
    { code: 'LIBRE', name: 'Type sans véhicule', codePrefix: null, activity: 'MIXED' },
  ]) {
    types[t.code] = (await c.owner.post<{ id: string }>('/vehicle-types', t, null)).id;
  }
  await c.owner.post(`/vehicle-types/${types['HRC']}/archive`, {}, null);

  const truck = async (
    name: string,
    body: Record<string, unknown>,
    depot?: string,
  ): Promise<UiTruck> => {
    const w = await c.owner.post<{ id: string }>('/warehouses', { name, type: 'VEHICLE', assignedUserId: null, ...body }, null);
    if (depot) await c.owner.patch(`/warehouses/${w.id}`, { parentWarehouseId: depot });
    return { id: w.id, code: (body['code'] as string | undefined) ?? null, name };
  };
  const trucks: UiData['trucks'] = {
    van: await truck("Camion M'sila", { code: CODES.van, vehicleTypeId: types['MXT'], wilayaCode: 28, plateNumber: PLATE, capacityKg: 3500, assignedUserId: karim.id }),
    self: await truck('Camion Bordj', { code: CODES.self, vehicleTypeId: types['SELF/MT'], wilayaCode: 34, capacityKg: 1500, assignedUserId: samir.id }, batna.id),
    liv: await truck('Livraison M’sila', { code: CODES.liv, vehicleTypeId: types['MIX'], wilayaCode: 28, plateNumber: '08901-121-28', capacityKg: 7000, assignedUserId: yacine.id }),
    arabic: await truck('شاحنة الجملة', { code: CODES.arabic, vehicleTypeId: types['DD'], wilayaCode: 5, plateNumber: '04567-120-05' }, batna.id),
    arabicSwapped: await truck('شاحنة التجزئة', { code: CODES.arabicSwapped, vehicleTypeId: types['DD'], wilayaCode: 5 }, batna.id),
    long1: await truck('Camion au très long nom pour la zone nord de la wilaya de M’sila', { code: CODES.long1, vehicleTypeId: types['MXT'], wilayaCode: 28 }),
    long2: await truck('Camion zone nord 2', { code: CODES.long2, vehicleTypeId: types['MXT'], wilayaCode: 28 }),
    plain: await truck('Camion sans type', {}),
  };
  // A little driver history on the Arabic truck: Farid, then nobody.
  await c.owner.post(`/warehouses/${trucks.arabic.id}/driver`, { userId: farid.id, reason: 'Remplacement du matin' }, null);
  await c.owner.post(`/warehouses/${trucks.arabic.id}/driver`, { userId: null, reason: 'Retour au dépôt' }, null);

  const p = await product(c, { priceHt: '1000', designation: 'Article T36 E' });
  await openingStock(c, p, '500', '500');
  const clientNames = ['Épicerie du Marché', 'Superette El Baraka', 'Kiosque de la Gare', 'بقالة النور'];
  const clients: string[] = [];
  for (const name of clientNames) {
    clients.push((await c.owner.post<{ id: string }>('/clients', { code: uniq('C-'), name, type: 'PARTICULIER' }, null)).id);
  }

  const weekdays = [0, 1, 2, 3, 4, 5, 6];
  const route = async (name: string, who: { vehicleId: string } | { sellerId: string }, stops: string[]): Promise<string> => {
    const r = await c.owner.post<{ id: string }>('/routes', { name, ...who, weekdays, active: true });
    await c.owner.put(`/routes/${r.id}/stops`, { clientIds: stops });
    return r.id;
  };
  const routes = {
    vanToday: await route("M'sila centre", { vehicleId: trucks.van.id }, clients.slice(0, 3)),
    livToday: await route('Livraisons du matin', { vehicleId: trucks.liv.id }, clients.slice(1, 3)),
    karimOld: await route('Tournée Karim (ancienne)', { sellerId: karim.id }, clients.slice(0, 2)),
    samirOld: await route('جولة سمير القديمة', { sellerId: samir.id }, clients.slice(2, 4)),
    nadiaOld: await route('Tournée Nadia', { sellerId: nadia.id }, clients.slice(1, 3)),
  };

  const order = async (clientId: string, deliveryVehicleId: string | null): Promise<{ id: string; number: string }> => {
    const draft = await c.owner.post<{ id: string }>('/orders', {
      clientId,
      sellerId: karim.id,
      warehouseId: c.mainWarehouseId,
      lines: [{ productId: p.id, unitId: p.unitId, qty: '5' }],
    });
    const o = await c.owner.post<{ id: string; number: string }>(`/orders/${draft.id}/confirm`, {});
    if (deliveryVehicleId) await c.owner.patch(`/orders/${o.id}/livreur`, { deliveryVehicleId });
    return { id: o.id, number: o.number };
  };
  const orders = { onLiv: await order(clients[0]!, trucks.liv.id), free: await order(clients[1]!, null) };

  const e = await company(`T36 E vide ${project}`, { edition: 'DISTRIBUTION' });
  const data: UiData = {
    tenantId: c.tenantId,
    owner,
    karim,
    samir,
    nadia,
    farid,
    yacine,
    types,
    trucks,
    depotBatnaId: batna.id,
    routes,
    orders,
    clientNames,
    empty: { owner: { id: e.session.userId, email: e.session.email, fullName: 'Owner vide', token: e.session.token } },
  };
  writeFileSync(file, JSON.stringify(data, null, 2));
  return data;
}
