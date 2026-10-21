import { Injectable } from '@nestjs/common';

/** Attempts allowed per key (IP, identifier) in one window. */
export const LOGIN_ATTEMPTS_PER_WINDOW = 10;
export const LOGIN_WINDOW_MS = 60_000;
/** Above this many keys, expired windows are swept before adding one. */
const SWEEP_ABOVE = 10_000;

interface Window {
  start: number;
  count: number;
}

/**
 * Fixed-window counter in memory: enough for one API process (the MVP runs one).
 * With several instances, each one counts on its own; the per-account lock in the
 * database still holds across them.
 */
@Injectable()
export class LoginLimiter {
  private readonly windows = new Map<string, Window>();

  /** Counts one attempt for each key; false when any of them is over the limit. */
  hit(keys: string[], now = Date.now()): boolean {
    if (this.windows.size > SWEEP_ABOVE) this.sweep(now);
    let allowed = true;
    for (const key of keys) {
      const w = this.windows.get(key);
      if (!w || now - w.start >= LOGIN_WINDOW_MS) {
        this.windows.set(key, { start: now, count: 1 });
        continue;
      }
      w.count += 1;
      if (w.count > LOGIN_ATTEMPTS_PER_WINDOW) allowed = false;
    }
    return allowed;
  }

  /** Seconds until the oldest of these windows resets (for Retry-After). */
  retryAfter(keys: string[], now = Date.now()): number {
    const ends = keys
      .map((k) => this.windows.get(k))
      .filter((w): w is Window => w !== undefined)
      .map((w) => w.start + LOGIN_WINDOW_MS - now);
    return Math.max(1, Math.ceil(Math.max(0, ...ends) / 1000));
  }

  private sweep(now: number): void {
    for (const [key, w] of this.windows) {
      if (now - w.start >= LOGIN_WINDOW_MS) this.windows.delete(key);
    }
  }
}
