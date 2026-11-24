import { REQUIRED_FEATURES, assertDemoVolumeTenant, preflightProblems, type Me } from './guard.js';

const EMAIL = 'demo-volume@grossiste.dz';
const me: Me = { email: EMAIL, role: 'OWNER', tenantName: 'Demo Volume', features: [...REQUIRED_FEATURES] };

describe('seed-field tenant guard', () => {
  it('accepts the demo-volume owner', () => {
    expect(() => assertDemoVolumeTenant(me, EMAIL)).not.toThrow();
  });

  it('refuses another email, another role, another company', () => {
    expect(() => assertDemoVolumeTenant({ ...me, email: 'demo@grossiste.dz' }, EMAIL)).toThrow(/email/);
    expect(() => assertDemoVolumeTenant({ ...me, role: 'MANAGER' }, EMAIL)).toThrow(/OWNER/);
    expect(() => assertDemoVolumeTenant({ ...me, tenantName: 'Grossiste Demo' }, EMAIL)).toThrow(/demo-volume/);
    expect(() => assertDemoVolumeTenant({ ...me, email: null }, EMAIL)).toThrow(/email/);
  });
});

describe('seed-field preflight', () => {
  const ok = { me, maxMobileSellers: 5, maxUsers: 20, userCount: 1, usersToCreate: 9, geoCheckMode: 'FLAG', creditLimitMode: 'WARN' };

  it('has nothing to fix on a ready company (null limits mean unlimited)', () => {
    expect(preflightProblems(ok)).toEqual([]);
    expect(preflightProblems({ ...ok, maxMobileSellers: null, maxUsers: null })).toEqual([]);
  });

  it('lists a missing feature, too few phones, too few users and the wrong modes', () => {
    const p = preflightProblems({
      ...ok,
      me: { ...me, features: ['TOURNEES'] },
      maxMobileSellers: 3,
      maxUsers: 5,
      geoCheckMode: 'BLOCK',
      creditLimitMode: 'BLOCK',
    });
    expect(p.join('\n')).toMatch(/MOBILE_APP/);
    expect(p.join('\n')).toMatch(/maxMobileSellers is 3/);
    expect(p.join('\n')).toMatch(/maxUsers is 5/);
    expect(p.join('\n')).toMatch(/geoCheckMode/);
    expect(p.join('\n')).toMatch(/creditLimitMode/);
  });
});
