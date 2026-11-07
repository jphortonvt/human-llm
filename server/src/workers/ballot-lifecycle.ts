import type { Engine } from '../lib/engine.js';

/**
 * Recurring lifecycle worker. Every ~2s it asks the engine to evaluate every
 * open ballot against its closure conditions (and resolve expired runoffs).
 * The engine handles winner selection, pre-stage promotion, and session
 * advancement. Runs in-process; a single instance is correct for one server.
 */
export function startBallotLifecycle(engine: Engine, intervalMs = 2000) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return; // never overlap ticks
    running = true;
    try {
      await engine.tick();
    } catch (err) {
      console.error('[ballot-lifecycle] tick error:', err);
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
