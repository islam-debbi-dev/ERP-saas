/**
 * Remembers that this browser has logged in, so the app only asks the API to
 * restore a session when there may be one (no pointless 401 for visitors).
 * Holds no secret: the refresh token itself stays in an httpOnly cookie.
 * Storage can be unavailable (private mode): then we simply always try.
 */
const KEY = 'erp_session_hint';

export const sessionHint = {
  get(): boolean {
    try {
      return window.localStorage.getItem(KEY) === '1';
    } catch {
      return true;
    }
  },
  set(hasSession: boolean): void {
    try {
      window.localStorage.setItem(KEY, hasSession ? '1' : '0');
    } catch {
      // Storage blocked: nothing to remember.
    }
  },
};
