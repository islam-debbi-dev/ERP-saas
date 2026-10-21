import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { tenantContext } from '../src/common/tenant-context';
import { ReconcileService } from '../src/reconcile/reconcile.service';
import {
  bearer,
  catalogOf,
  createProduct,
  createTestApp,
  registerTenant,
  tamper,
  type RegisteredTenant,
  type TestApp,
} from './helpers';
import { loadTestEnv } from './load-test-env';

/** The nightly reconcile: cached stock and client balances against their ledgers. */
describe('ledger reconcile', () => {
  let t: TestApp;
  let a: RegisteredTenant;
  let productId: string;
  let clientId: string;
  let reconcile: ReconcileService;

  const post = (url: string, body: object) =>
    t
      .http()
      .post(url)
      .set(...bearer(a.auth.accessToken))
      .set('Idempotency-Key', randomUUID())
      .send(body);

  /** Only this suite's tenant: other suites share the test database. */
  const mine = async () => {
    const result = await reconcile.run();
    expect(result.ran).toBe(true);
    return result.mismatches.filter((m) => m.tenantId === a.tenantId);
  };

  beforeAll(async () => {
    t = await createTestApp();
    reconcile = t.app.get(ReconcileService);
    a = await registerTenant(t, 'Reconcile SARL');
    const product = await createProduct(t, a, await catalogOf(t, a));
    productId = product.id;
    await post('/stock/adjustments', {
      reason: 'ERREUR',
      lines: [{ productId, unitId: product.baseUnitId, qty: '12' }],
    }).expect(201);
    clientId = (
      (await post('/clients', { code: 'RC1', name: 'Client Rec' }).expect(201)).body as {
        id: string;
      }
    ).id;
    await post(`/clients/${clientId}/opening-balance`, { amount: '5000' }).expect(201);
  });

  afterAll(() => t.close());

  it('finds nothing when the caches match the ledgers', async () => {
    expect(await mine()).toEqual([]);
  });

  it('reports a cached stock or balance that drifted from its ledger, and audits it', async () => {
    await tamper(t)`
      UPDATE product_stocks SET "qtyBase" = "qtyBase" + 1 WHERE "productId" = ${productId}::uuid`;
    await tamper(t)`
      UPDATE client_balances SET balance = balance + 100 WHERE "clientId" = ${clientId}::uuid`;

    const found = await mine();
    expect(found).toEqual(
      expect.arrayContaining([
        {
          check: 'stock_equals_ledger',
          tenantId: a.tenantId,
          entity: 'Product',
          entityId: productId,
          cached: '13.000',
          ledger: '12.000',
        },
        {
          check: 'client_balance_equals_ledger',
          tenantId: a.tenantId,
          entity: 'Client',
          entityId: clientId,
          cached: '5100.00',
          ledger: '5000.00',
        },
      ]),
    );
    expect(found).toHaveLength(2);

    const audit = await tenantContext.run({ tenantId: a.tenantId }, () =>
      t.prisma.db.auditLog.findMany({ where: { action: 'LEDGER_MISMATCH' } }),
    );
    expect(audit.map((r) => r.entityId).sort()).toEqual([clientId, productId].sort());

    // Put the caches back so later runs (and other suites) see clean data.
    await tamper(t)`
      UPDATE product_stocks SET "qtyBase" = "qtyBase" - 1 WHERE "productId" = ${productId}::uuid`;
    await tamper(t)`
      UPDATE client_balances SET balance = balance - 100 WHERE "clientId" = ${clientId}::uuid`;
    expect(await mine()).toEqual([]);
  });

  it('skips the run while another instance holds the lock', async () => {
    const other = new pg.Client({ connectionString: loadTestEnv().owner });
    await other.connect();
    try {
      await other.query('BEGIN');
      await other.query('SELECT pg_advisory_xact_lock(7120412)');
      expect(await reconcile.run()).toEqual({ ran: false, mismatches: [] });
      await other.query('COMMIT');
      expect((await reconcile.run()).ran).toBe(true);
    } finally {
      await other.end();
    }
  });
});
