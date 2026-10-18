import { DocType } from '@erp/shared';
import { DocumentNumberingService } from '../src/documents/document-numbering.service';
import { asTenant, createTestApp, registerTenant, type TestApp } from './helpers';

describe('DocumentNumberingService', () => {
  let t: TestApp;
  let numbering: DocumentNumberingService;

  beforeAll(async () => {
    t = await createTestApp();
    numbering = t.app.get(DocumentNumberingService);
  });
  afterAll(() => t.close());

  const nextIn = (tenantId: string, docType: DocType, date?: Date) =>
    asTenant(tenantId, () =>
      t.prisma.db.$transaction((tx) => numbering.next(tx, tenantId, docType, date), {
        maxWait: 20_000,
        timeout: 20_000,
      }),
    );

  it('20 parallel calls give 20 unique sequential numbers with no gaps', async () => {
    const { tenantId } = await registerTenant(t);
    const date = new Date('2026-06-15T10:00:00Z');
    const numbers = await Promise.all(
      Array.from({ length: 20 }, () => nextIn(tenantId, DocType.BL, date)),
    );
    const expected = Array.from(
      { length: 20 },
      (_, i) => `BL-2026-${String(i + 1).padStart(6, '0')}`,
    );
    expect(new Set(numbers).size).toBe(20);
    expect([...numbers].sort()).toEqual(expected);
  });

  it('a rolled-back transaction gives its number back (no gap)', async () => {
    const { tenantId } = await registerTenant(t);
    const date = new Date('2026-03-01T10:00:00Z');
    expect(await nextIn(tenantId, DocType.FAC, date)).toBe('FAC-2026-000001');

    await expect(
      asTenant(tenantId, () =>
        t.prisma.db.$transaction(async (tx) => {
          await numbering.next(tx, tenantId, DocType.FAC, date);
          throw new Error('sale failed after numbering');
        }),
      ),
    ).rejects.toThrow('sale failed');

    expect(await nextIn(tenantId, DocType.FAC, date)).toBe('FAC-2026-000002');
  });

  it('sequences are separate per tenant, per document type and per year', async () => {
    const a = await registerTenant(t);
    const b = await registerTenant(t);
    const d2026 = new Date('2026-12-31T12:00:00Z');
    const d2027 = new Date('2027-01-01T12:00:00Z');

    expect(await nextIn(a.tenantId, DocType.BL, d2026)).toBe('BL-2026-000001');
    expect(await nextIn(a.tenantId, DocType.BL, d2026)).toBe('BL-2026-000002');
    expect(await nextIn(b.tenantId, DocType.BL, d2026)).toBe('BL-2026-000001');
    expect(await nextIn(a.tenantId, DocType.AV, d2026)).toBe('AV-2026-000001');
    expect(await nextIn(a.tenantId, DocType.BL, d2027)).toBe('BL-2027-000001');
  });

  it('refuses a tenantId that is not the context tenant', async () => {
    const a = await registerTenant(t);
    const b = await registerTenant(t);
    await expect(
      asTenant(a.tenantId, () =>
        t.prisma.db.$transaction((tx) => numbering.next(tx, b.tenantId, DocType.BL)),
      ),
    ).rejects.toThrow(/does not match/);
  });
});
