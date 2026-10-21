import { LOGIN_ATTEMPTS_PER_WINDOW, LOGIN_WINDOW_MS, LoginLimiter } from './login-limiter';

describe('LoginLimiter', () => {
  it('allows the limit, refuses the next one, and resets with the window', () => {
    const limiter = new LoginLimiter();
    const t0 = 1_000_000;
    for (let i = 0; i < LOGIN_ATTEMPTS_PER_WINDOW; i++) {
      expect(limiter.hit(['ip:1'], t0 + i)).toBe(true);
    }
    expect(limiter.hit(['ip:1'], t0 + 100)).toBe(false);
    expect(limiter.retryAfter(['ip:1'], t0 + 100)).toBe(60);
    expect(limiter.hit(['ip:1'], t0 + LOGIN_WINDOW_MS)).toBe(true);
  });

  it('refuses when any key is over, and counts keys separately', () => {
    const limiter = new LoginLimiter();
    for (let i = 0; i < LOGIN_ATTEMPTS_PER_WINDOW; i++) limiter.hit(['ip:1', `id:${i}`], 0);
    expect(limiter.hit(['ip:2', 'id:0'], 1)).toBe(true);
    expect(limiter.hit(['ip:1', 'id:new'], 1)).toBe(false);
  });
});
