import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createTestApp, type TestApp } from './helpers';
import { tenantContext } from '../src/common/tenant-context';

const apiDir = path.join(__dirname, '..');

const runSeed = () =>
  execFileSync(path.join(apiDir, 'node_modules', '.bin', 'tsx'), ['prisma/seed.ts'], {
    cwd: apiDir,
    env: { ...process.env, SEED_OWNER_PASSWORD: 'Demo1234!' },
    stdio: 'pipe',
  }).toString();

describe('seed', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('creates the demo tenant and owner, and is safe to run twice', async () => {
    runSeed();
    const second = runSeed();
    expect(second).toMatch(/already exists/);

    const users = await tenantContext.runAsSystem(() =>
      t.prisma.db.user.findMany({
        where: { email: 'demo@grossiste.dz' },
        include: { tenant: true },
      }),
    );
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ role: 'OWNER', tenant: { name: 'Grossiste Demo' } });

    const res = await t
      .http()
      .post('/auth/login')
      .send({ email: 'demo@grossiste.dz', password: 'Demo1234!' })
      .expect(200);
    expect(res.body).toMatchObject({ user: { tenantName: 'Grossiste Demo' } });

    // Phase 16: one demo route with its three stops, not doubled by the second run.
    const stops = await tenantContext.runAsSystem(() =>
      t.prisma.db.routeStop.count({ where: { routeId: '00000000-0000-4000-8000-0000000016a1' } }),
    );
    expect(stops).toBe(3);
    // The seed runs twice through tsx in a child process: give it room on a busy CI runner.
  }, 60_000);
});
