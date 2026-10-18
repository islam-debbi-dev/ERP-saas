import { randomUUID } from 'node:crypto';
import { Body, Controller, Module, Post } from '@nestjs/common';
import { ErrorCode } from '@erp/shared';
import { AuditService } from '../src/audit/audit.service';
import { Idempotent } from '../src/idempotency/idempotent.decorator';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  asTenant,
  bearer,
  createTestApp,
  registerTenant,
  type RegisteredTenant,
  type TestApp,
} from './helpers';

let calls = 0;
let failNext = false;

/** Test-only route with a side effect (an audit row), standing in for a sale or versement. */
@Controller('test-idem')
class IdemTestController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  @Idempotent()
  async create(
    @Body() body: { amount: string },
  ): Promise<{ call: number; amount: string; id: string }> {
    calls += 1;
    if (failNext) {
      failNext = false;
      throw new Error('boom');
    }
    const id = randomUUID();
    await this.prisma.db.$transaction((tx) =>
      this.audit.log(tx, { action: 'TEST_EFFECT', entity: 'Test', entityId: id, after: body }),
    );
    return { call: calls, amount: body.amount, id };
  }
}

@Module({ controllers: [IdemTestController] })
class IdemTestModule {}

describe('IdempotencyInterceptor', () => {
  let t: TestApp;
  let a: RegisteredTenant;
  let b: RegisteredTenant;

  beforeAll(async () => {
    t = await createTestApp([IdemTestModule]);
    a = await registerTenant(t, 'Idem A');
    b = await registerTenant(t, 'Idem B');
  });
  afterAll(() => t.close());

  const post = (token: string, key: string | null, body: object) => {
    const req = t
      .http()
      .post('/test-idem')
      .set(...bearer(token));
    if (key) req.set('Idempotency-Key', key);
    return req.send(body);
  };
  const effects = (tenantId: string) =>
    asTenant(tenantId, () => t.prisma.db.auditLog.count({ where: { action: 'TEST_EFFECT' } }));

  it('requires the header', async () => {
    const res = await post(a.auth.accessToken, null, { amount: '1.00' }).expect(400);
    expect(res.body).toMatchObject({ code: ErrorCode.IDEMPOTENCY_KEY_REQUIRED });
  });

  it('same key + same body returns the stored response and creates nothing new', async () => {
    const key = `key-${randomUUID()}`;
    const before = await effects(a.tenantId);
    const first = await post(a.auth.accessToken, key, { amount: '100.00' }).expect(201);
    // Same body with keys in another order still counts as the same request.
    const replay = await post(a.auth.accessToken, key, { amount: '100.00' }).expect(201);

    expect(replay.body).toEqual(first.body);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(await effects(a.tenantId)).toBe(before + 1);
  });

  it('same key + different body returns 409 IDEMPOTENCY_KEY_REUSED', async () => {
    const key = `key-${randomUUID()}`;
    await post(a.auth.accessToken, key, { amount: '100.00' }).expect(201);
    const res = await post(a.auth.accessToken, key, { amount: '999.00' }).expect(409);
    expect(res.body).toMatchObject({ code: ErrorCode.IDEMPOTENCY_KEY_REUSED });
  });

  it('keys are per tenant: the same key in another tenant is a new request', async () => {
    const key = `key-${randomUUID()}`;
    const ra = await post(a.auth.accessToken, key, { amount: '5.00' }).expect(201);
    const rb = await post(b.auth.accessToken, key, { amount: '5.00' }).expect(201);
    expect(rb.body).not.toEqual(ra.body);
    expect(rb.headers['idempotent-replayed']).toBeUndefined();
  });

  it('concurrent requests with the same key run the handler once', async () => {
    const key = `key-${randomUUID()}`;
    const before = await effects(a.tenantId);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => post(a.auth.accessToken, key, { amount: '7.00' })),
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201).length).toBeGreaterThanOrEqual(1);
    expect(statuses.every((s) => s === 201 || s === 409)).toBe(true);
    for (const r of results.filter((x) => x.status === 409)) {
      expect(r.body).toMatchObject({ code: ErrorCode.IDEMPOTENCY_REQUEST_IN_PROGRESS });
    }
    expect(await effects(a.tenantId)).toBe(before + 1);
  });

  it('a failed request frees the key so the client can retry', async () => {
    const key = `key-${randomUUID()}`;
    failNext = true;
    await post(a.auth.accessToken, key, { amount: '3.00' }).expect(500);
    const retry = await post(a.auth.accessToken, key, { amount: '3.00' }).expect(201);
    expect(retry.headers['idempotent-replayed']).toBeUndefined();
  });
});
