/**
 * Test 36 (vehicle-first distribution): the seeded companies, kept in `.auth/` (ignored by
 * git) so parts A to E share them. Tokens live 12 h on the audit stack (`map-stack.sh`).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ARTIFACTS, DB } from './config.ts';

export const FIXTURE_FILE = fileURLToPath(
  new URL('../.auth/vehicles-fixture.json', import.meta.url),
);
export const OUT36 = `${ARTIFACTS}test-36/`;

export interface SeedUser {
  id: string;
  email: string;
  role: string;
  token: string;
}

export interface SeedTruck {
  id: string;
  code: string | null;
  name: string;
  /** Key of `types`, or null for the truck without a type. */
  type: string | null;
  parent: 'main' | 'secondary';
  driver: string | null;
}

export interface SeedCompany {
  tenantId: string;
  ownerToken: string;
  ownerId: string;
  mainWarehouseId: string;
  secondaryWarehouseId: string | null;
  users: Record<string, SeedUser>;
  /** By the owner's own code (`MXT`, `SELF/MT`…). */
  types: Record<
    string,
    { id: string; activity: string; codePrefix: string | null; archived: boolean }
  >;
  trucks: SeedTruck[];
  productId: string | null;
  unitId: string | null;
  clientIds: string[];
}

/** One row of history written before the truck columns are trusted (part D reads it). */
export interface SeedHistory {
  kind:
    | 'seller_route'
    | 'vehicle_route'
    | 'visit_van_sale'
    | 'visit_order'
    | 'visit_neither'
    | 'order_delivered_by_truck'
    | 'order_on_truck_bl_from_depot'
    | 'order_delivered_from_main';
  id: string;
  /** The truck the backfill must find, or null when it cannot be known. */
  backfillVehicleId: string | null;
  note: string;
}

export interface VehiclesFixture {
  db: string;
  createdAt: string;
  a: SeedCompany;
  b: SeedCompany;
  essentiel: SeedCompany;
  history: SeedHistory[];
}

export function saveFixture(f: VehiclesFixture): void {
  mkdirSync(fileURLToPath(new URL('../.auth/', import.meta.url)), { recursive: true });
  writeFileSync(FIXTURE_FILE, JSON.stringify(f, null, 2));
}

export function loadFixture(): VehiclesFixture {
  if (!existsSync(FIXTURE_FILE)) {
    throw new Error(
      'No fixture: run `pnpm test:vehicles:seed` first (e2e/REPORT-36.md, section 2)',
    );
  }
  const f = JSON.parse(readFileSync(FIXTURE_FILE, 'utf8')) as VehiclesFixture;
  if (f.db !== DB) throw new Error(`The fixture was seeded on ${f.db}, DB is ${DB}: seed again`);
  return f;
}

/** Test 36 only runs on its own local scratch databases, never on `erp` nor anything remote. */
export function assertT36Db(url: string = DB): void {
  const u = new URL(url);
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (!local || !u.pathname.startsWith('/erp_t36')) {
    throw new Error(
      `Refusing to run on ${u.hostname}${u.pathname}: set DB to a local erp_t36* database`,
    );
  }
}

export function proof36(file: string, content: string): string {
  mkdirSync(OUT36, { recursive: true });
  writeFileSync(`${OUT36}${file}`, content);
  return `e2e/artifacts/test-36/${file}`;
}
