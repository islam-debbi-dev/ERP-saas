/**
 * A super-admin's read-only view of a company, opened in its own tab. The token lives
 * in sessionStorage so it stays in that tab only and ends when the tab closes.
 */
const KEY = 'erp_support_view';

export const impersonation = {
  get(): string | null {
    try {
      return window.sessionStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  set(token: string): void {
    try {
      window.sessionStorage.setItem(KEY, token);
    } catch {
      // Storage blocked: the view cannot survive a reload, the API still guards it.
    }
  },
  clear(): void {
    try {
      window.sessionStorage.removeItem(KEY);
    } catch {
      // Nothing stored.
    }
  },
};
