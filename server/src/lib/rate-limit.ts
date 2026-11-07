/**
 * Minimal fixed-window rate limiter (in-memory; correct for a single instance).
 * Used for NAT-aware burst throttling on voting — see plan.md "Open Decisions:
 * vote weighting". Limits are deliberately generous so a whole gallery behind
 * one wifi IP is never silenced; they only blunt scripted bursts.
 */
export class RateLimiter {
  private windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Consume one unit for `key`. Returns whether allowed + ms until reset. */
  check(key: string): { ok: boolean; retryAfterMs: number } {
    const now = Date.now();
    const w = this.windows.get(key);
    if (!w || w.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return { ok: true, retryAfterMs: 0 };
    }
    if (w.count >= this.max) return { ok: false, retryAfterMs: w.resetAt - now };
    w.count += 1;
    return { ok: true, retryAfterMs: 0 };
  }

  /** Drop expired windows so the map doesn't grow unbounded. */
  sweep() {
    const now = Date.now();
    for (const [k, w] of this.windows) if (w.resetAt <= now) this.windows.delete(k);
  }
}
