import { timingSafeEqual } from 'node:crypto';

/**
 * Curator access control. The curator console is the only write surface, and in
 * a public/hybrid deployment it is reachable from the open internet — so the
 * shared password needs more care than a plain `===`:
 *
 *  - refuse to boot in production with the default password (so you can't ship
 *    an installation that anyone can administer),
 *  - constant-time comparison (no timing oracle on the secret),
 *  - per-IP lockout to blunt brute force.
 *
 * Voters and the display never hit curator endpoints, so this gate never
 * touches the public experience.
 */
const DEFAULT_PASSWORD = 'curator';
const PASSWORD = process.env.CURATOR_PASSWORD ?? DEFAULT_PASSWORD;
const IS_PROD = process.env.NODE_ENV === 'production';

/** Call at startup. Throws in production if the password is missing/default. */
export function assertCuratorPasswordConfigured() {
  const unsafe = !process.env.CURATOR_PASSWORD || process.env.CURATOR_PASSWORD === DEFAULT_PASSWORD;
  if (IS_PROD && unsafe) {
    throw new Error(
      'CURATOR_PASSWORD must be set to a strong value in production — the curator ' +
        'console is internet-reachable. Refusing to start with the default password.',
    );
  }
  if (unsafe) {
    console.warn(
      '[auth] curator password is the default ("curator"). Fine for local dev; ' +
        'set CURATOR_PASSWORD before exposing this to the internet.',
    );
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Compare against itself so the work is independent of length mismatch.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export function checkPassword(candidate: string | undefined | null): boolean {
  if (!candidate) return false;
  return constantTimeEqual(candidate, PASSWORD);
}

// ---- per-IP brute-force lockout (in-memory; fine for a single instance) ----

type Attempt = { fails: number; lockedUntil: number };
const attempts = new Map<string, Attempt>();
const FAIL_THRESHOLD = 6; // first lock kicks in after this many wrong tries
const BASE_LOCK_MS = 60_000; // 1 minute, doubling per extra failure

/** Remaining lock time in ms for this IP, or 0 if not locked. */
export function lockedFor(ip: string): number {
  const a = attempts.get(ip);
  if (a && a.lockedUntil > Date.now()) return a.lockedUntil - Date.now();
  return 0;
}

export function recordFailure(ip: string) {
  const a = attempts.get(ip) ?? { fails: 0, lockedUntil: 0 };
  a.fails += 1;
  if (a.fails >= FAIL_THRESHOLD) {
    a.lockedUntil = Date.now() + BASE_LOCK_MS * 2 ** (a.fails - FAIL_THRESHOLD);
  }
  attempts.set(ip, a);
}

/** Clears the failure counter — call on a successful auth. */
export function recordSuccess(ip: string) {
  attempts.delete(ip);
}
