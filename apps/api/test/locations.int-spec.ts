import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Activity, type ApiError, type ClientDto, ErrorCode, type SectorDto } from '@erp/shared';
import { communesOf } from '@erp/shared/communes';
import {
  bearer,
  createTestApp,
  registerTenant,
  type RegisteredTenant,
  tamper,
  type TestApp,
} from './helpers';
import { backfillToCsv } from '../src/locations/commune-backfill.report';
import { CommuneBackfillService } from '../src/locations/commune-backfill.service';
import { tenantContext } from '../src/common/tenant-context';

const errorOf = (res: { body: unknown }) => res.body as ApiError;

const BAB_EZZOUAR = 1621;
const EL_HARRACH = 1613;
const ORAN = 3101;
/** Touggourt left Ouargla (30) for wilaya 55: not gated. */
const TOUGGOURT = 3013;
/** A commune of wilaya 68, formerly M'Sila: under review. */
const GATED = communesOf(68)[0]!;

/** Phase 40a: wilaya and commune codes on clients and sectors. */
describe('locations (phase 40a)', () => {
  let t: TestApp;
  let a: RegisteredTenant;
  let b: RegisteredTenant;
  let seq = 0;

  const as = (who: RegisteredTenant) => {
    const auth = bearer(who.auth.accessToken);
    return {
      get: (url: string) =>
        t
          .http()
          .get(url)
          .set(...auth),
      post: (url: string, body: object) =>
        t
          .http()
          .post(url)
          .set(...auth)
          .set('Idempotency-Key', randomUUID())
          .send(body),
      put: (url: string, body: object) =>
        t
          .http()
          .put(url)
          .set(...auth)
          .send(body),
      patch: (url: string, body: object) =>
        t
          .http()
          .patch(url)
          .set(...auth)
          .send(body),
    };
  };

  const newClient = async (body: object, who = a): Promise<ClientDto> =>
    (
      await as(who)
        .post('/clients', { code: `L${++seq}`, name: `Client ${seq}`, ...body })
        .expect(201)
    ).body as ClientDto;

  /** What the current forms send: the whole client with its version, plus the changes. */
  const fullBody = (c: ClientDto) => ({
    code: c.code,
    name: c.name,
    wilaya: c.wilaya,
    commune: c.commune,
    version: c.version,
  });
  const editClient = (c: ClientDto, changes: object, who = a) =>
    as(who).patch(`/clients/${c.id}`, { ...fullBody(c), ...changes });
  const edited = async (c: ClientDto, changes: object): Promise<ClientDto> =>
    (await editClient(c, changes).expect(200)).body as ClientDto;

  const place = (c: ClientDto) => ({
    wilaya: c.wilaya,
    commune: c.commune,
    wilayaCode: c.wilayaCode,
    communeCode: c.communeCode,
  });

  const lastAudit = (id: string) =>
    tenantContext.runAsSystem(() =>
      t.prisma.db.auditLog.findFirstOrThrow({
        where: { entityId: id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );

  beforeAll(async () => {
    t = await createTestApp();
    a = await registerTenant(t, 'Lieux A', { activity: Activity.DISTRIBUTEUR });
    b = await registerTenant(t, 'Lieux B', { activity: Activity.DISTRIBUTEUR });
  });

  afterAll(async () => {
    await t.close();
  });

  describe('client writes with codes', () => {
    it('derives the wilaya from the commune and writes the French names', async () => {
      const c = await newClient({ communeCode: BAB_EZZOUAR, commune: 'anything' });
      expect(place(c)).toEqual({
        wilaya: 'Alger',
        commune: 'Bab Ezzouar',
        wilayaCode: 16,
        communeCode: BAB_EZZOUAR,
      });
    });

    it('keeps the commune text as sent with a wilaya alone, also of wilayas 59 to 69', async () => {
      const c = await newClient({ wilayaCode: 68, commune: 'Centre ville' });
      expect(place(c)).toMatchObject({
        commune: 'Centre ville',
        wilayaCode: 68,
        communeCode: null,
      });
      expect(c.wilaya).not.toBeNull();
    });

    it('refuses an unknown commune, a wrong wilaya, a commune under review and wilaya 70', async () => {
      const post = (body: object) =>
        as(a).post('/clients', { code: `L${++seq}`, name: 'Refusé', ...body });
      const code = async (body: object) => errorOf(await post(body)).code;
      expect(await code({ communeCode: 99999 })).toBe(ErrorCode.COMMUNE_UNKNOWN);
      expect(await code({ communeCode: BAB_EZZOUAR, wilayaCode: 31 })).toBe(
        ErrorCode.COMMUNE_WILAYA_MISMATCH,
      );
      expect(await code({ communeCode: GATED.code })).toBe(ErrorCode.COMMUNE_UNDER_REVIEW);
      expect(await code({ wilayaCode: 70 })).toBe(ErrorCode.VALIDATION_FAILED);
      // The same rules on an update, which then changes nothing.
      const c = await newClient({ communeCode: ORAN });
      const res = await editClient(c, { communeCode: GATED.code });
      expect(errorOf(res).code).toBe(ErrorCode.COMMUNE_UNDER_REVIEW);
      const now = (await as(a).get(`/clients/${c.id}`).expect(200)).body as ClientDto;
      expect(now).toMatchObject({ communeCode: ORAN, version: c.version });
    });

    it('clears the codes sent as null and keeps the text as sent', async () => {
      const c = await newClient({ communeCode: ORAN });
      const cleared = await edited(c, {
        wilayaCode: null,
        communeCode: null,
        wilaya: 'Oran ville',
        commune: 'Derrière le marché',
      });
      expect(place(cleared)).toEqual({
        wilaya: 'Oran ville',
        commune: 'Derrière le marché',
        wilayaCode: null,
        communeCode: null,
      });
    });
  });

  describe('client writes from an old app (codes left out)', () => {
    it('sets the codes on create when the text says one commune', async () => {
      const c = await newClient({ wilaya: 'alger', commune: 'dar el beida' });
      expect(place(c)).toEqual({
        wilaya: 'Alger',
        commune: 'Dar El Beïda',
        wilayaCode: 16,
        communeCode: 1620,
      });
      expect((await lastAudit(c.id)).after).toMatchObject({ locationResolution: 'MATCHED' });
    });

    it('keeps the codes while the text does not change, null and empty being equal', async () => {
      const c = await newClient({ communeCode: BAB_EZZOUAR });
      const renamed = await edited(c, { name: 'Autre nom', commune: '  Bab Ezzouar ' });
      expect(place(renamed)).toEqual(place(c));
      const coded = await newClient({ wilayaCode: 16 });
      const again = await edited(coded, { commune: '' });
      expect(again).toMatchObject({ wilayaCode: 16, communeCode: null });
    });

    it('moves the codes with a changed text that matches, with before and after audited', async () => {
      const c = await newClient({ communeCode: BAB_EZZOUAR });
      const moved = await edited(c, { commune: 'El Harrach' });
      expect(moved).toMatchObject({ wilayaCode: 16, communeCode: EL_HARRACH });
      const audit = await lastAudit(c.id);
      expect(audit.before).toMatchObject({ communeCode: BAB_EZZOUAR });
      expect(audit.after).toMatchObject({
        communeCode: EL_HARRACH,
        locationResolution: 'MATCHED',
      });
    });

    it('follows a former wilaya to the new one', async () => {
      const c = await newClient({ wilaya: 'Ouargla', commune: 'Touggourt' });
      expect(c).toMatchObject({ wilayaCode: 55, communeCode: TOUGGOURT, commune: 'Touggourt' });
      expect(c.wilaya).not.toBe('Ouargla');
      expect((await lastAudit(c.id)).after).toMatchObject({
        locationResolution: 'MATCHED_FORMER_WILAYA',
      });
    });

    it('clears both codes when the new text does not say one place', async () => {
      const c = await newClient({ communeCode: BAB_EZZOUAR });
      const lost = await edited(c, { commune: 'Quartier des 1000 logements' });
      expect(place(lost)).toEqual({
        wilaya: 'Alger',
        commune: 'Quartier des 1000 logements',
        wilayaCode: null,
        communeCode: null,
      });
      expect((await lastAudit(c.id)).after).toMatchObject({ locationResolution: 'NO_MATCH' });
      const gated = await newClient({ wilaya: "M'Sila", commune: GATED.fr });
      expect(gated).toMatchObject({ wilayaCode: null, communeCode: null, commune: GATED.fr });
    });
  });

  describe('sectors', () => {
    const sector = async (body: object, who = a): Promise<SectorDto> =>
      (
        await as(who)
          .post('/sectors', { name: `S${++seq}`, ...body })
          .expect(201)
      ).body as SectorDto;
    const patch = async (id: string, body: object): Promise<SectorDto> =>
      (await as(a).patch(`/sectors/${id}`, body).expect(200)).body as SectorDto;

    it('writes the French names of its communes and wilaya', async () => {
      const s = await sector({ communeCodes: [BAB_EZZOUAR, EL_HARRACH] });
      expect(s).toMatchObject({
        wilaya: 'Alger',
        wilayaCode: 16,
        communes: ['Bab Ezzouar', 'El Harrach'],
        communeCodes: [BAB_EZZOUAR, EL_HARRACH],
      });
    });

    it('keeps everything on a rename alone', async () => {
      const s = await sector({ communeCodes: [BAB_EZZOUAR] });
      const renamed = await patch(s.id, { name: `${s.name} bis` });
      expect(renamed).toEqual({ ...s, name: `${s.name} bis` });
    });

    it('refuses unknown, foreign and gated communes', async () => {
      const code = async (body: object) =>
        errorOf(await as(a).post('/sectors', { name: `S${++seq}`, ...body })).code;
      expect(await code({ communeCodes: [99999] })).toBe(ErrorCode.COMMUNE_UNKNOWN);
      expect(await code({ communeCodes: [BAB_EZZOUAR, ORAN] })).toBe(
        ErrorCode.COMMUNE_WILAYA_MISMATCH,
      );
      expect(await code({ wilayaCode: 31, communeCodes: [BAB_EZZOUAR] })).toBe(
        ErrorCode.COMMUNE_WILAYA_MISMATCH,
      );
      expect(await code({ communeCodes: [GATED.code] })).toBe(ErrorCode.COMMUNE_UNDER_REVIEW);
    });

    it('codes an old client only when every commune is found in one wilaya', async () => {
      const s = await sector({ wilaya: 'Alger', communes: ['bab ezzouar', 'el harrach'] });
      expect(s).toMatchObject({ wilayaCode: 16, communeCodes: [BAB_EZZOUAR, EL_HARRACH] });
      const cleared = await patch(s.id, {
        wilaya: 'Alger',
        communes: ['Bab Ezzouar', 'Cité inconnue'],
      });
      expect(cleared).toMatchObject({
        wilayaCode: null,
        communeCodes: [],
        communes: ['Bab Ezzouar', 'Cité inconnue'],
      });
      expect((await lastAudit(s.id)).after).toMatchObject({ locationResolution: 'NO_MATCH' });
      const two = await sector({ communes: ['Bab Ezzouar', 'Oran'] });
      expect(two).toMatchObject({ wilayaCode: null, communeCodes: [] });
    });

    it('clears codes on request, removing the names that came from them', async () => {
      const s = await sector({ communeCodes: [BAB_EZZOUAR] });
      const empty = await patch(s.id, { wilayaCode: 16, communeCodes: [] });
      expect(empty).toMatchObject({ wilayaCode: 16, communeCodes: [], communes: [] });
      const legacy = await sector({ communes: ['Cité inconnue'] });
      const kept = await patch(legacy.id, { wilayaCode: 16, communeCodes: [] });
      expect(kept.communes).toEqual(['Cité inconnue']);
    });
  });

  describe('backfill of the old text', () => {
    let c: RegisteredTenant;
    let outside: RegisteredTenant;
    let dir: string;
    let n = 0;

    beforeAll(async () => {
      c = await registerTenant(t, '=Lieux C', { activity: Activity.DISTRIBUTEUR });
      outside = await registerTenant(t, 'Lieux D', { activity: Activity.DISTRIBUTEUR });
      dir = mkdtempSync(path.join(tmpdir(), 'p40a-backfill-'));
    });

    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    /** A row as it was written before phase 40a: text only. */
    const legacy = async (
      who: RegisteredTenant,
      name: string,
      wilaya: string | null,
      commune: string | null,
    ): Promise<string> => {
      const made = await newClient({ code: `OLD${++n}`, name }, who);
      await tamper(
        t,
      )`UPDATE clients SET wilaya = ${wilaya}, commune = ${commune} WHERE id = ${made.id}::uuid`;
      return made.id;
    };
    const stored = (id: string) =>
      tenantContext.runAsSystem(() => t.prisma.db.client.findUniqueOrThrow({ where: { id } }));
    const run = (file: string, tenantIds: string[]) =>
      backfillToCsv(t.app.get(CommuneBackfillService), path.join(dir, file), { tenantIds });

    it('codes what is sure, lists the rest, and changes nothing the second time', async () => {
      const ids = {
        exact: await legacy(c, 'Exact', 'alger', 'bab ezzouar'),
        wilayaOnly: await legacy(c, 'Wilaya seule', '31', null),
        former: await legacy(c, 'Ancienne wilaya', 'Ouargla', 'Touggourt'),
        lost: await legacy(c, '=HYPERLINK("x")', 'Alger', '+213 cité inconnue'),
        gated: await legacy(c, 'Sous revue', "M'Sila", GATED.fr),
        archived: await legacy(c, 'Archivé', null, 'Bab Ezzouar'),
        empty: await legacy(c, 'Sans texte', null, '  '),
        foreign: await legacy(outside, 'Autre société', 'Alger', 'Bab Ezzouar'),
      };
      await tamper(t)`UPDATE clients SET "deletedAt" = now() WHERE id = ${ids.archived}::uuid`;
      // Already coded, with a text that says something else: never overwritten.
      const coded = await newClient({ communeCode: ORAN }, c);
      const half = await newClient({ wilayaCode: 31 }, c);
      await tamper(
        t,
      )`UPDATE clients SET commune = 'Bab Ezzouar', wilaya = 'Alger' WHERE id IN (${coded.id}::uuid, ${half.id}::uuid)`;

      const first = await run('first.csv', [c.tenantId]);
      expect(first).toEqual({ tenants: 1, changed: 4, unmatched: 2, listed: 3 });

      expect(await stored(ids.exact)).toMatchObject({
        wilaya: 'Alger',
        commune: 'Bab Ezzouar',
        wilayaCode: 16,
        communeCode: BAB_EZZOUAR,
        version: 2,
      });
      expect(await stored(ids.wilayaOnly)).toMatchObject({
        wilaya: 'Oran',
        wilayaCode: 31,
        communeCode: null,
      });
      expect(await stored(ids.former)).toMatchObject({ wilayaCode: 55, communeCode: TOUGGOURT });
      expect(await stored(ids.archived)).toMatchObject({ communeCode: BAB_EZZOUAR });
      expect(await stored(ids.lost)).toMatchObject({
        wilaya: 'Alger',
        commune: '+213 cité inconnue',
        wilayaCode: null,
        version: 1,
      });
      expect(await stored(ids.gated)).toMatchObject({ wilayaCode: null, communeCode: null });
      expect(await stored(ids.foreign)).toMatchObject({ wilayaCode: null, version: 1 });
      expect(await stored(coded.id)).toMatchObject({ communeCode: ORAN, wilayaCode: 31 });
      expect(await stored(half.id)).toMatchObject({ communeCode: null, wilayaCode: 31 });

      const audit = await lastAudit(ids.former);
      expect(audit).toMatchObject({
        action: 'CLIENT_LOCATION_BACKFILLED',
        tenantId: c.tenantId,
        before: { wilaya: 'Ouargla', communeCode: null },
        after: { communeCode: TOUGGOURT, locationResolution: 'MATCHED_FORMER_WILAYA' },
      });

      const csv = readFileSync(path.join(dir, 'first.csv'), 'utf8');
      expect(csv.startsWith('\uFEFF"tenant";')).toBe(true);
      const lines = csv.trim().split('\r\n').slice(1);
      expect(lines).toHaveLength(3);
      const line = (name: string) => lines.find((l) => l.includes(name))!;
      expect(line('Ancienne wilaya')).toContain(
        `"Ouargla";"Touggourt";"MATCHED_FORMER_WILAYA";"55";"${TOUGGOURT}"`,
      );
      expect(line('Sous revue')).toContain('"UNDER_REVIEW";"";""');
      expect(line('Sous revue')).toContain(`${GATED.code} ${GATED.fr}`);
      // No cell can run as a formula in a spreadsheet.
      expect(line('HYPERLINK')).toContain(`"'=HYPERLINK(""x"")"`);
      expect(line('HYPERLINK')).toContain(`"'+213 cité inconnue";"NO_MATCH"`);
      expect(lines.every((l) => l.startsWith(`"'=Lieux C";"${c.tenantId}"`))).toBe(true);

      const second = await run('second.csv', [c.tenantId]);
      expect(second).toEqual({ tenants: 1, changed: 0, unmatched: 2, listed: 2 });
      expect((await stored(ids.exact)).version).toBe(2);

      // An existing report is never overwritten, and nothing runs without a report.
      await expect(run('first.csv', [outside.tenantId])).rejects.toThrow(/EEXIST/);
      expect(await stored(ids.foreign)).toMatchObject({ wilayaCode: null });
    });
  });

  describe('tenant isolation', () => {
    it("never writes another company's client or sector", async () => {
      const c = await newClient({ communeCode: ORAN });
      const s = (
        await as(a)
          .post('/sectors', { name: 'Isolé', communeCodes: [ORAN] })
          .expect(201)
      ).body as SectorDto;
      await editClient(c, { communeCode: BAB_EZZOUAR, wilaya: null }, b).expect(404);
      await as(b)
        .patch(`/sectors/${s.id}`, { communeCodes: [BAB_EZZOUAR] })
        .expect(404);
      const now = (await as(a).get(`/clients/${c.id}`).expect(200)).body as ClientDto;
      expect(now.communeCode).toBe(ORAN);
      // The database refuses a wilaya outside the map, whatever the code path.
      await expect(
        tamper(t)`UPDATE clients SET "wilayaCode" = 70 WHERE id = ${c.id}::uuid`,
      ).rejects.toThrow(/clients_wilayaCode_check/);
    });
  });
});
