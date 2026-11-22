import { randomUUID } from 'node:crypto';
import {
  type AuditLogPage,
  type AuthResponse,
  type AuthUser,
  type ClientDto,
  ErrorCode,
  type InviteResultDto,
  type PaymentDto,
  Permission,
  type ProductDto,
  type SaleResultDto,
  type StockLevelDto,
  type StockPage,
  type TenantSessionDto,
  type UserDto,
} from '@erp/shared';
import {
  asTenant,
  bearer,
  catalogOf,
  createTestApp,
  registerTenant,
  type RegisteredTenant,
  type TestApp,
  withMobileApp,
} from './helpers';

/** A fresh mobile number in national form (`0550…`): phones are unique platform-wide. */
const newPhone = (): string =>
  `0${5 + Math.floor(Math.random() * 3)}${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
/** `0550123456` → `+213550123456`, as the API stores it. */
const intl = (national: string) => `+213${national.slice(1)}`;

const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Algiers' }).format(new Date());
const PASSWORD = 'Password123!';

interface Staff extends RegisteredTenant {
  user: UserDto;
}

describe('users, permissions, sessions and audit', () => {
  let t: TestApp;
  let a: RegisteredTenant;
  let b: RegisteredTenant;
  let productId: string;
  let piece: string;
  let carton: string;
  let client: ClientDto;
  let seq = 0;

  /** Every login comes from its own address so the per-IP limiter stays out of the way. */
  const ip = () => `10.0.${Math.floor(++seq / 200)}.${seq % 200}`;

  const as = (who: { auth: { accessToken: string } }) => ({
    get: (url: string) =>
      t
        .http()
        .get(url)
        .set(...bearer(who.auth.accessToken)),
    post: (url: string, body: object = {}) =>
      t
        .http()
        .post(url)
        .set(...bearer(who.auth.accessToken))
        .set('Idempotency-Key', randomUUID())
        .send(body),
    put: (url: string, body: object) =>
      t
        .http()
        .put(url)
        .set(...bearer(who.auth.accessToken))
        .send(body),
    patch: (url: string, body: object) =>
      t
        .http()
        .patch(url)
        .set(...bearer(who.auth.accessToken))
        .send(body),
    delete: (url: string) =>
      t
        .http()
        .delete(url)
        .set(...bearer(who.auth.accessToken)),
  });

  const login = (identifier: string, password = PASSWORD, from = ip()) =>
    t
      .http()
      .post('/auth/login')
      .set('X-Forwarded-For', from)
      .set('X-Client-Type', 'native')
      .send({ identifier, password });

  /** Invited with a temporary password, logged in and password changed: ready to work. */
  const staff = async (
    role: 'MANAGER' | 'SELLER' | 'STOREKEEPER' | 'SUPERVISOR' | 'LIVREUR',
    owner = a,
  ): Promise<Staff> => {
    const phone = newPhone();
    const invited = (
      await as(owner)
        .post('/users/invite', {
          fullName: `${role} ${seq}`,
          phone,
          role,
          mode: 'PASSWORD',
          password: 'Temporary1!',
        })
        .expect(201)
    ).body as InviteResultDto;
    const auth = (await login(phone, 'Temporary1!').expect(200)).body as AuthResponse & {
      refreshToken: string;
    };
    expect(auth.user.mustChangePassword).toBe(true);
    await as({ auth })
      .post('/auth/password', { currentPassword: 'Temporary1!', newPassword: PASSWORD })
      .expect(200);
    return { ...owner, auth, email: phone, password: PASSWORD, user: invited.user };
  };

  const grant = (userId: string, grants: Permission[], revokes: Permission[] = []) =>
    as(a).put(`/users/${userId}/permissions`, { grants, revokes }).expect(200);

  const quick = (who: Staff | RegisteredTenant, extra: object = {}) =>
    as(who).post('/sales/quick', {
      documentDate: TODAY,
      clientId: client.id,
      lines: [{ productId, unitId: carton, qty: '1' }],
      ...extra,
    });

  beforeAll(async () => {
    t = await createTestApp();
    a = await registerTenant(t, 'Utilisateurs A');
    b = await registerTenant(t, 'Utilisateurs B');
    // Employees log in as native clients below (A1 needs the mobile module for that).
    await withMobileApp(t, a);
    await withMobileApp(t, b);
    const cat = await catalogOf(t, a);
    piece = cat.units['PIECE']!.id;
    carton = cat.units['CARTON']!.id;
    productId = (
      (
        await as(a)
          .post('/products', {
            reference: `USR-${Date.now()}`,
            designation: 'Article utilisateurs',
            baseUnitId: piece,
            tvaRate: '19',
            units: [
              {
                unitId: piece,
                factorToBase: '1',
                barcode: null,
                isDefaultSale: false,
                isDefaultPurchase: false,
              },
              {
                unitId: carton,
                factorToBase: '24',
                barcode: null,
                isDefaultSale: true,
                isDefaultPurchase: true,
              },
            ],
            prices: [{ unitId: carton, priceLevelId: cat.levels[0]!.id, priceHt: '2300' }],
          })
          .expect(201)
      ).body as ProductDto
    ).id;
    await as(a)
      .post('/stock/opening', {
        lines: [{ productId, unitId: piece, qty: '24000', unitCost: '80' }],
      })
      .expect(201);
    client = (await as(a).post('/clients', { code: 'U1', name: 'Client U' }).expect(201))
      .body as ClientDto;
  });
  afterAll(() => t.close());

  // ---------------------------------------------------------------- permissions

  describe('each sensitive permission: refused without, allowed with', () => {
    it('PRICE_OVERRIDE', async () => {
      const seller = await staff('SELLER');
      const lines = [{ productId, unitId: carton, qty: '1', unitPriceHt: '2000' }];
      const refused = await quick(seller, { lines }).expect(403);
      expect(refused.body).toMatchObject({
        code: ErrorCode.PRICE_OVERRIDE_FORBIDDEN,
        details: { permission: Permission.PRICE_OVERRIDE },
      });
      await grant(seller.user.id, [Permission.PRICE_OVERRIDE]);
      await quick(seller, { lines }).expect(201);

      const manager = await staff('MANAGER');
      await quick(manager, { lines }).expect(201);
      await grant(manager.user.id, [], [Permission.PRICE_OVERRIDE]);
      await quick(manager, { lines }).expect(403);
    });

    it('DISCOUNT_ABOVE_X, with the tenant threshold', async () => {
      await as(a).patch('/tenant/settings', { maxDiscountPct: '5' }).expect(200);
      const seller = await staff('SELLER');
      const at = (pct: string) => ({
        lines: [{ productId, unitId: carton, qty: '1', discountPct: pct }],
      });
      await quick(seller, at('5')).expect(201); // up to the threshold: free
      const refused = await quick(seller, at('10')).expect(403);
      expect(refused.body).toMatchObject({
        details: { permission: Permission.DISCOUNT_ABOVE_X, maxDiscountPct: '5' },
      });
      await grant(seller.user.id, [Permission.DISCOUNT_ABOVE_X]);
      await quick(seller, at('10')).expect(201);
      await as(a).patch('/tenant/settings', { maxDiscountPct: '0' }).expect(200);
    });

    it('CREDIT_OVERRIDE', async () => {
      const seller = await staff('SELLER');
      await as(a).patch('/tenant/settings', { creditLimitMode: 'BLOCK' }).expect(200);
      const tight = (
        await as(a)
          .post('/clients', { code: `U${++seq}`, name: 'Serré' })
          .expect(201)
      ).body as ClientDto;
      await asTenant(a.tenantId, () =>
        t.prisma.db.client.update({ where: { id: tight.id }, data: { creditLimit: 100 } }),
      );
      const sale = { clientId: tight.id, forceCredit: true };
      const refused = await quick(seller, sale).expect(403);
      expect(refused.body).toMatchObject({ details: { permission: Permission.CREDIT_OVERRIDE } });
      await grant(seller.user.id, [Permission.CREDIT_OVERRIDE]);
      await quick(seller, sale).expect(201);
      await as(a).patch('/tenant/settings', { creditLimitMode: 'WARN' }).expect(200);
    });

    it('SALE_CANCEL', async () => {
      const seller = await staff('SELLER');
      const sale = ((await quick(seller).expect(201)).body as SaleResultDto).sale;
      const refused = await as(seller)
        .post(`/sales/${sale.id}/cancel`, { reason: 'erreur' })
        .expect(403);
      expect(refused.body).toMatchObject({ details: { permission: Permission.SALE_CANCEL } });
      await grant(seller.user.id, [Permission.SALE_CANCEL]);
      await as(seller).post(`/sales/${sale.id}/cancel`, { reason: 'erreur' }).expect(200);
    });

    it("PAYMENT_CANCEL (someone else's versement)", async () => {
      const seller = await staff('SELLER');
      const p = (await as(a).post('/payments', { clientId: client.id, amount: '100' }).expect(201))
        .body as PaymentDto;
      const refused = await as(seller)
        .post(`/payments/${p.id}/cancel`, { reason: 'erreur' })
        .expect(403);
      expect(refused.body).toMatchObject({ details: { permission: Permission.PAYMENT_CANCEL } });
      await grant(seller.user.id, [Permission.PAYMENT_CANCEL]);
      await as(seller).post(`/payments/${p.id}/cancel`, { reason: 'erreur' }).expect(200);
    });

    it('STOCK_ADJUST', async () => {
      const keeper = await staff('STOREKEEPER');
      const body = { reason: 'CASSE', lines: [{ productId, unitId: piece, qty: '-1' }] };
      const refused = await as(keeper).post('/stock/adjustments', body).expect(403);
      expect(refused.body).toMatchObject({ details: { permission: Permission.STOCK_ADJUST } });
      await grant(keeper.user.id, [Permission.STOCK_ADJUST]);
      await as(keeper).post('/stock/adjustments', body).expect(201);
    });

    it('VIEW_COST_AND_MARGIN', async () => {
      const seller = await staff('SELLER');
      const hidden = (await as(seller).get(`/stock/${productId}`).expect(200))
        .body as StockLevelDto;
      expect(hidden).toMatchObject({ avgCost: null, value: null });
      const page = (await as(seller).get('/stock').expect(200)).body as StockPage;
      expect(page.summary.totalValue).toBeNull();
      await grant(seller.user.id, [Permission.VIEW_COST_AND_MARGIN]);
      const shown = (await as(seller).get(`/stock/${productId}`).expect(200)).body as StockLevelDto;
      expect(shown.avgCost).toBe('80.0000');

      const manager = await staff('MANAGER');
      await as(manager).get(`/reports/margin?from=${TODAY}&to=${TODAY}`).expect(200);
      await grant(manager.user.id, [], [Permission.VIEW_COST_AND_MARGIN]);
      const refused = await as(manager)
        .get(`/reports/margin?from=${TODAY}&to=${TODAY}`)
        .expect(403);
      expect(refused.body).toMatchObject({
        details: { permission: Permission.VIEW_COST_AND_MARGIN },
      });
      const d = (await as(manager).get('/dashboard').expect(200)).body as {
        sales: { margin: string | null };
        stock: { value: string | null };
      };
      expect(d.sales.margin).toBeNull();
      expect(d.stock.value).toBeNull();
    });

    it('EXPORT_DATA', async () => {
      const seller = await staff('SELLER');
      const url = `/reports/sales/export.xlsx?from=${TODAY}&to=${TODAY}`;
      await as(seller).get(`/reports/sales?from=${TODAY}&to=${TODAY}`).expect(200);
      const refused = await as(seller).get(url).expect(403);
      expect(refused.body).toMatchObject({ details: { permission: Permission.EXPORT_DATA } });
      await grant(seller.user.id, [Permission.EXPORT_DATA]);
      await as(seller).get(url).expect(200);
    });

    it('only the owner manages users; an owner keeps every permission', async () => {
      const manager = await staff('MANAGER');
      await as(manager).get('/users').expect(200);
      await as(manager)
        .post('/users/invite', { fullName: 'X', phone: newPhone(), role: 'SELLER', mode: 'LINK' })
        .expect(403);
      await as(a)
        .put(`/users/${a.auth.user.id}/permissions`, {
          grants: [],
          revokes: [Permission.SALE_CANCEL],
        })
        .expect(403);
    });
  });

  // ---------------------------------------------------------------- invitations and login

  describe('invitations and login', () => {
    it('a temporary password allows nothing but changing it', async () => {
      const phone = newPhone();
      await as(a)
        .post('/users/invite', {
          fullName: 'Nouveau',
          email: `nouveau-${randomUUID().slice(0, 6)}@test.dz`,
          phone,
          role: 'SELLER',
          mode: 'PASSWORD',
          password: 'Temporary1!',
        })
        .expect(201);
      // Phone login, written another way than at the invitation.
      const auth = (await login(intl(phone), 'Temporary1!').expect(200)).body as AuthResponse;
      expect(auth.user).toMatchObject({ phone: intl(phone), mustChangePassword: true });
      const blocked = await as({ auth }).get('/clients').expect(403);
      expect((blocked.body as { code: string }).code).toBe(ErrorCode.PASSWORD_CHANGE_REQUIRED);
      await as({ auth }).get('/auth/me').expect(200);
      await as({ auth })
        .post('/auth/password', { currentPassword: 'wrong', newPassword: PASSWORD })
        .expect(401);
      const me = (
        await as({ auth })
          .post('/auth/password', { currentPassword: 'Temporary1!', newPassword: PASSWORD })
          .expect(200)
      ).body as AuthUser;
      expect(me.mustChangePassword).toBe(false);
      await as({ auth }).get('/clients').expect(200);
      await login(phone, PASSWORD).expect(200);
    });

    it('an invitation link works once, and not once expired', async () => {
      const phone = newPhone();
      const res = (
        await as(a)
          .post('/users/invite', {
            fullName: 'Lien',
            phone,
            role: 'STOREKEEPER',
            mode: 'LINK',
          })
          .expect(201)
      ).body as InviteResultDto;
      expect(res.user.invitationPending).toBe(true);
      const token = res.inviteUrl!.split('/invitation/')[1]!;
      // The user cannot log in before choosing his password.
      await login(phone, 'anything-at-all').expect(401);
      const info = await t.http().get(`/auth/invitations/${token}`).expect(200);
      expect(info.body).toMatchObject({ fullName: 'Lien', tenantName: 'Utilisateurs A' });
      const accepted = await t
        .http()
        .post(`/auth/invitations/${token}/accept`)
        .set('X-Client-Type', 'native')
        .send({ password: PASSWORD })
        .expect(200);
      expect((accepted.body as AuthResponse).user.mustChangePassword).toBe(false);
      await t
        .http()
        .post(`/auth/invitations/${token}/accept`)
        .send({ password: PASSWORD })
        .expect(410);
      await login(phone).expect(200);

      const second = (
        await as(a).post(`/users/${res.user.id}/reset-password`, { mode: 'LINK' }).expect(200)
      ).body as InviteResultDto;
      const token2 = second.inviteUrl!.split('/invitation/')[1]!;
      await asTenant(a.tenantId, () =>
        t.prisma.db.userInvitation.updateMany({
          where: { userId: res.user.id, usedAt: null },
          data: { expiresAt: new Date(Date.now() - 1000) },
        }),
      );
      await t.http().get(`/auth/invitations/${token2}`).expect(410);
    });

    it('rejects an email or phone already used, and a user with neither', async () => {
      const phone = newPhone();
      await as(a)
        .post('/users/invite', { fullName: 'Un', phone, role: 'SELLER', mode: 'LINK' })
        .expect(201);
      const dup = await as(b)
        .post('/users/invite', {
          fullName: 'Deux',
          phone: intl(phone),
          role: 'SELLER',
          mode: 'LINK',
        })
        .expect(409);
      expect((dup.body as { code: string }).code).toBe(ErrorCode.PHONE_ALREADY_USED);
      const dupEmail = await as(a)
        .post('/users/invite', { fullName: 'Trois', email: a.email, role: 'SELLER', mode: 'LINK' })
        .expect(409);
      expect((dupEmail.body as { code: string }).code).toBe(ErrorCode.EMAIL_ALREADY_USED);
      await as(a)
        .post('/users/invite', { fullName: 'Rien', role: 'SELLER', mode: 'LINK' })
        .expect(400);
    });

    it('5 wrong passwords lock the account for 15 minutes, and are audited', async () => {
      const seller = await staff('SELLER');
      for (let i = 0; i < 5; i++) await login(seller.email, 'wrong-password').expect(401);
      const locked = await login(seller.email).expect(423);
      expect((locked.body as { code: string }).code).toBe(ErrorCode.ACCOUNT_LOCKED);
      const logs = (await as(a).get(`/audit-logs?userId=${seller.user.id}&limit=100`).expect(200))
        .body as AuditLogPage;
      expect(logs.items.filter((l) => l.action === 'LOGIN_FAILED')).toHaveLength(5);
      expect(logs.items.some((l) => l.action === 'ACCOUNT_LOCKED')).toBe(true);
      const listed = ((await as(a).get('/users').expect(200)).body as UserDto[]).find(
        (u) => u.id === seller.user.id,
      );
      expect(listed?.lockedUntil).not.toBeNull();
      // The owner unlocks with a new temporary password.
      await as(a)
        .post(`/users/${seller.user.id}/reset-password`, {
          mode: 'PASSWORD',
          password: 'Temporary2!',
        })
        .expect(200);
      await login(seller.email, 'Temporary2!').expect(200);
    });

    it('rate limits logins per address', async () => {
      const from = '10.99.99.99';
      for (let i = 0; i < 10; i++) {
        await login(`nobody-${i}@test.dz`, 'x', from).expect(401);
      }
      const limited = await login('nobody-11@test.dz', 'x', from).expect(429);
      expect((limited.body as { code: string }).code).toBe(ErrorCode.TOO_MANY_REQUESTS);
    });
  });

  // ---------------------------------------------------------------- deactivation and owners

  describe('deactivation and owners', () => {
    it("a deactivated user's access and refresh tokens stop working at once", async () => {
      const seller = await staff('SELLER');
      await as(seller).get('/clients').expect(200);
      await as(a).post(`/users/${seller.user.id}/deactivate`).expect(200);
      const denied = await as(seller).get('/clients').expect(401);
      expect([ErrorCode.SESSION_REVOKED, ErrorCode.INVALID_TOKEN]).toContain(
        (denied.body as { code: string }).code,
      );
      await t
        .http()
        .post('/auth/refresh')
        .send({ refreshToken: seller.auth.refreshToken })
        .expect(401);
      await login(seller.email).expect(401);
      // Never deleted: still listed, with his name.
      const listed = ((await as(a).get('/users').expect(200)).body as UserDto[]).find(
        (u) => u.id === seller.user.id,
      );
      expect(listed).toMatchObject({ active: false, fullName: seller.user.fullName });
      await as(a).post(`/users/${seller.user.id}/reactivate`).expect(200);
      await login(seller.email).expect(200);
    });

    it('the last owner cannot be demoted; an owner is protected from the others', async () => {
      const me = a.auth.user;
      const own = { fullName: me.fullName, email: a.email, phone: '', role: 'MANAGER' };
      const last = await as(a).put(`/users/${me.id}`, own).expect(409);
      expect((last.body as { code: string }).code).toBe(ErrorCode.LAST_OWNER);
      await as(a).post(`/users/${me.id}/deactivate`).expect(403);

      // A second owner cannot demote or deactivate the first.
      const partner = newPhone();
      const second = (
        await as(a)
          .post('/users/invite', {
            fullName: 'Associé',
            phone: partner,
            role: 'OWNER',
            mode: 'PASSWORD',
            password: 'Temporary1!',
          })
          .expect(201)
      ).body as InviteResultDto;
      const auth = (await login(partner, 'Temporary1!').expect(200)).body as AuthResponse;
      await as({ auth })
        .post('/auth/password', { currentPassword: 'Temporary1!', newPassword: PASSWORD })
        .expect(200);
      await as({ auth }).put(`/users/${me.id}`, own).expect(403);
      await as({ auth }).post(`/users/${me.id}/deactivate`).expect(403);
      // With two owners, the second may step down himself.
      await as({ auth })
        .put(`/users/${second.user.id}`, {
          fullName: 'Associé',
          phone: partner,
          role: 'MANAGER',
        })
        .expect(200);
    });
  });

  // ---------------------------------------------------------------- delegated user management

  // Audit 02, B-3: with USERS_MANAGE a supervisor made himself a manager's account, three ways.
  describe('a delegated USERS_MANAGE never reaches an account at or above its holder', () => {
    let sup: Staff;
    let manager: Staff;
    let livreur: Staff;
    const above = async (req: PromiseLike<{ status: number; body: unknown }>) => {
      const res = await req;
      expect(res.status).toBe(403);
      expect((res.body as { code: string }).code).toBe(ErrorCode.ACCESS_ABOVE_GRANTER);
    };
    const invitation = (role: string) => ({
      fullName: `Invité ${role}`,
      phone: newPhone(),
      role,
      mode: 'PASSWORD',
      password: 'Chosen-by-him1!',
    });

    beforeAll(async () => {
      sup = await staff('SUPERVISOR');
      manager = await staff('MANAGER');
      livreur = await staff('LIVREUR');
      await grant(sup.user.id, [Permission.USERS_MANAGE, Permission.USERS_VIEW]);
    });

    it('he cannot invite a manager, a role with rights he lacks, or his own role', async () => {
      await above(as(sup).post('/users/invite', invitation('MANAGER')));
      // A storekeeper receives goods and counts stock: a supervisor does not.
      await above(as(sup).post('/users/invite', invitation('STOREKEEPER')));
      await above(as(sup).post('/users/invite', invitation('SUPERVISOR')));
      await as(sup).post('/users/invite', invitation('OWNER')).expect(403);
      // Below him: allowed, which is what the owner delegated.
      await as(sup).post('/users/invite', invitation('LIVREUR')).expect(201);
      await as(sup).post('/users/invite', invitation('SELLER')).expect(201);
    });

    it('he cannot promote anyone to such a role, nor edit or deactivate who holds one', async () => {
      const edit = (who: Staff, role: string, fullName = who.user.fullName) =>
        as(sup).put(`/users/${who.user.id}`, { fullName, phone: who.email, role });
      await above(edit(livreur, 'MANAGER'));
      await above(edit(livreur, 'SUPERVISOR'));
      await above(edit(manager, 'MANAGER', 'Renommé'));
      await above(edit(manager, 'LIVREUR'));
      await above(as(sup).post(`/users/${manager.user.id}/deactivate`));
      await above(
        as(sup).put(`/users/${manager.user.id}/permissions`, {
          grants: [],
          revokes: [Permission.SALES_CREATE],
        }),
      );
      const users = (await as(a).get('/users').expect(200)).body as UserDto[];
      expect(users.find((u) => u.id === livreur.user.id)?.role).toBe('LIVREUR');
      expect(users.find((u) => u.id === manager.user.id)).toMatchObject({
        role: 'MANAGER',
        fullName: manager.user.fullName,
        active: true,
      });
      // A livreur is below him: renamed, and made a seller (nothing he lacks).
      await edit(livreur, 'LIVREUR', 'Livreur renommé').expect(200);
      await edit(livreur, 'SELLER').expect(200);
      await as(a)
        .put(`/users/${livreur.user.id}`, {
          fullName: 'Livreur',
          phone: livreur.email,
          role: 'LIVREUR',
        })
        .expect(200);
    });

    it('he cannot reset the password of a manager, of a peer, or of a user granted more than he has', async () => {
      const reset = (id: string) =>
        as(sup).post(`/users/${id}/reset-password`, {
          mode: 'PASSWORD',
          password: 'Stolen-by-him1!',
        });
      await above(reset(manager.user.id));
      await login(manager.email, 'Stolen-by-him1!').expect(401);
      await login(manager.email).expect(200);
      const peer = await staff('SUPERVISOR');
      await above(reset(peer.user.id));
      // A livreur the owner trusted with the pay figures is no longer below the supervisor.
      await grant(livreur.user.id, [Permission.SALARY_VIEW]);
      await above(reset(livreur.user.id));
      await grant(livreur.user.id, []);
      await reset(livreur.user.id).expect(200);
      // The owner is still above everyone.
      await as(a).post(`/users/${manager.user.id}/reset-password`, { mode: 'LINK' }).expect(200);
    });
  });

  // ---------------------------------------------------------------- sessions and audit

  describe('sessions and audit log', () => {
    it('the owner sees and revokes the session of an employee (lost phone)', async () => {
      const seller = await staff('SELLER');
      const sessions = (await as(a).get('/sessions').expect(200)).body as TenantSessionDto[];
      const lost = sessions.find((s) => s.user.id === seller.user.id);
      expect(lost).toBeDefined();
      expect(lost).toMatchObject({ ip: expect.any(String) as string });
      const own = (await as(seller).get('/sessions').expect(200)).body as TenantSessionDto[];
      expect(own.every((s) => s.user.id === seller.user.id)).toBe(true);
      await as(seller)
        .delete(`/sessions/${sessions.find((s) => s.current)!.id}`)
        .expect(404);
      await as(a).delete(`/sessions/${lost!.id}`).expect(204);
      await as(seller).get('/clients').expect(401);
    });

    it('a sale, a versement and an adjustment leave a trail with who and which device', async () => {
      const seller = await staff('SELLER');
      const sale = ((await quick(seller).expect(201)).body as SaleResultDto).sale;
      const payment = (
        await as(seller).post('/payments', { clientId: client.id, amount: '500' }).expect(201)
      ).body as PaymentDto;
      await as(a)
        .post('/stock/adjustments', {
          reason: 'AUTRE',
          lines: [{ productId, unitId: piece, qty: '2' }],
        })
        .expect(201);

      const bySeller = (
        await as(a).get(`/audit-logs?userId=${seller.user.id}&limit=100`).expect(200)
      ).body as AuditLogPage;
      const actions = bySeller.items.map((l) => [l.action, l.entityId]);
      expect(actions).toEqual(
        expect.arrayContaining([
          ['SALE_DRAFT_CREATED', sale.id],
          ['SALE_VALIDATED', sale.id],
          ['PAYMENT_CREATED', payment.id],
        ]),
      );
      expect(bySeller.items[0]?.user).toEqual({
        id: seller.user.id,
        fullName: seller.user.fullName,
      });
      const adjusted = (
        await as(a).get(`/audit-logs?action=STOCK_ADJUSTED&from=${TODAY}&to=${TODAY}`).expect(200)
      ).body as AuditLogPage;
      expect(adjusted.items[0]).toMatchObject({ entity: 'Stock', user: { id: a.auth.user.id } });
      expect(adjusted.items[0]?.deviceName).toBe('jest');
      const facets = (await as(a).get('/audit-logs/facets').expect(200)).body as {
        actions: string[];
      };
      expect(facets.actions).toEqual(expect.arrayContaining(['SALE_VALIDATED', 'USER_INVITED']));

      // Cursor pages do not overlap.
      const p1 = (await as(a).get('/audit-logs?limit=5').expect(200)).body as AuditLogPage;
      const p2 = (await as(a).get(`/audit-logs?limit=5&cursor=${p1.nextCursor}`).expect(200))
        .body as AuditLogPage;
      expect(p2.items.some((i) => p1.items.some((j) => j.id === i.id))).toBe(false);
    });

    it('the audit log is read-only for everyone and closed to sellers', async () => {
      const seller = await staff('SELLER');
      await as(seller).get('/audit-logs').expect(403);
      await expect(asTenant(a.tenantId, () => t.prisma.db.auditLog.deleteMany({}))).rejects.toThrow(
        /append-only/,
      );
      await expect(
        asTenant(a.tenantId, () => t.prisma.db.$executeRaw`UPDATE audit_logs SET action = 'x'`),
      ).rejects.toThrow(/append-only/);
    });

    it('keeps users, sessions and audit logs of each company apart', async () => {
      const usersA = ((await as(a).get('/users').expect(200)).body as UserDto[]).map((u) => u.id);
      const usersB = (await as(b).get('/users').expect(200)).body as UserDto[];
      expect(usersB.map((u) => u.id)).toContain(b.auth.user.id);
      expect(usersB.some((u) => usersA.includes(u.id))).toBe(false);
      const sessionsB = (await as(b).get('/sessions').expect(200)).body as TenantSessionDto[];
      expect(sessionsB.every((s) => s.user.id !== a.auth.user.id)).toBe(true);
      const logsB = (await as(b).get('/audit-logs?limit=100').expect(200)).body as AuditLogPage;
      expect(logsB.items.every((l) => l.user?.id !== a.auth.user.id)).toBe(true);
      const someSeller = ((await as(a).get('/users').expect(200)).body as UserDto[]).find(
        (u) => u.role === 'SELLER',
      )!;
      await as(b).get(`/users/${someSeller.id}`).expect(404);
      await as(b).post(`/users/${someSeller.id}/deactivate`).expect(404);
      await as(b)
        .put(`/users/${someSeller.id}/permissions`, { grants: [], revokes: [] })
        .expect(404);
      const sessionA = ((await as(a).get('/sessions').expect(200)).body as TenantSessionDto[])[0]!;
      await as(b).delete(`/sessions/${sessionA.id}`).expect(404);
    });
  });
});
