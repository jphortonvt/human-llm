import type { BallotConfig } from './ballot-config.js';

export type Candidate = {
  wordId: string;
  text: string;
  displayText: string;
  voteCount: number;
};

export type Distribution = {
  candidates: Candidate[]; // visible (non-hidden) candidates only
  totalVotes: number;
};

export function buildDistribution(candidates: Candidate[]): Distribution {
  const totalVotes = candidates.reduce((s, c) => s + c.voteCount, 0);
  // Sort descending by votes, tiebreak by earliest text for stability.
  const sorted = [...candidates].sort(
    (a, b) => b.voteCount - a.voteCount || a.text.localeCompare(b.text),
  );
  return { candidates: sorted, totalVotes };
}

export function leaderShare(d: Distribution): number {
  if (d.totalVotes === 0) return 0;
  return (d.candidates[0]?.voteCount ?? 0) / d.totalVotes;
}

export function runnerUpShare(d: Distribution): number {
  if (d.totalVotes === 0) return 0;
  return (d.candidates[1]?.voteCount ?? 0) / d.totalVotes;
}

export type CloseReason =
  | 'hard_timeout'
  | 'vote_ceiling'
  | 'landslide'
  | 'confident'
  | 'soft_timeout'
  | 'curator';

/**
 * Closure evaluation. Returns the reason a ballot should close, or null to keep
 * it open. Mirrors the resolution order in plan.md "Resolution Order — Step 1".
 * Disabled conditions are skipped. `curator` is handled out-of-band (manual).
 */
export function evaluateClosure(
  d: Distribution,
  config: BallotConfig,
  openedAtMs: number,
  nowMs: number,
): CloseReason | null {
  const elapsed = (nowMs - openedAtMs) / 1000;
  const votes = d.totalVotes;
  const lShare = leaderShare(d);
  const margin = lShare - runnerUpShare(d);

  // 1. Hard timeout — forces close even on a no-vote ballot.
  if (config.hard_timeout_enabled && elapsed >= config.hard_timeout_seconds) {
    return 'hard_timeout';
  }
  // 2. Vote ceiling.
  if (config.max_votes_enabled && votes >= config.max_votes) {
    return 'vote_ceiling';
  }
  // 3. Landslide.
  if (
    config.landslide_enabled &&
    votes >= config.landslide_min_votes &&
    lShare >= config.landslide_share
  ) {
    return 'landslide';
  }
  // 4. Confident close.
  if (
    config.confident_enabled &&
    votes >= config.confident_min_votes &&
    lShare >= config.confident_share &&
    margin >= config.confident_margin
  ) {
    return 'confident';
  }
  // 5. Soft timeout — accepts whatever leader exists after the timeout.
  if (
    config.soft_timeout_enabled &&
    elapsed >= config.soft_timeout_seconds &&
    votes >= config.min_votes_floor
  ) {
    return 'soft_timeout';
  }
  return null;
}

export type SelectionResult = {
  winner: Candidate;
  /** post-temperature probabilities aligned to d.candidates order (for display). */
  probabilities: number[];
  /** true when this was an unforced pick the curator/tiebreaker should be aware of. */
  tie: boolean;
  method: 'single' | 'sampled' | 'argmax' | 'coinflip';
};

/**
 * Apply the temperature transform p_i' = p_i^(1/T) / Σ p_j^(1/T) and sample.
 * rng defaults to Math.random; injectable for deterministic tests.
 */
export function temperatureProbabilities(shares: number[], T: number): number[] {
  if (shares.length === 0) return [];
  if (T <= 0) {
    // Argmax — all mass on the max. Ties split evenly (handled by caller for T=0).
    const max = Math.max(...shares);
    const winners = shares.map((s) => (s === max ? 1 : 0));
    const n = winners.reduce((a: number, b: number) => a + b, 0);
    return winners.map((w) => w / n);
  }
  const powed = shares.map((s) => Math.pow(s, 1 / T));
  const sum = powed.reduce((a, b) => a + b, 0);
  if (sum === 0) return shares.map(() => 1 / shares.length);
  return powed.map((p) => p / sum);
}

function sampleIndex(probs: number[], rng: () => number): number {
  const r = rng();
  let acc = 0;
  for (let i = 0; i < probs.length; i++) {
    acc += probs[i];
    if (r <= acc) return i;
  }
  return probs.length - 1;
}

/**
 * Winner selection — runs once when a ballot closes.
 * Mirrors plan.md "Resolution Order — Step 2".
 */
export function selectWinner(
  d: Distribution,
  config: BallotConfig,
  rng: () => number = Math.random,
): SelectionResult {
  const cands = d.candidates;
  if (cands.length === 0) {
    throw new Error('selectWinner called with no candidates');
  }
  if (cands.length === 1) {
    return { winner: cands[0], probabilities: [1], tie: false, method: 'single' };
  }

  const shares = cands.map((c) => (d.totalVotes ? c.voteCount / d.totalVotes : 0));

  // T == 0: argmax, with explicit tie handling.
  if (config.temperature === 0) {
    const topShare = shares[0];
    const secondShare = shares[1] ?? 0;
    const isTie = topShare - secondShare <= config.tie_threshold;
    const probs = temperatureProbabilities(shares, 0);
    if (isTie) {
      // Caller decides extend vs coinflip vs curator. Default coinflip among tied.
      const tied = cands.filter((_, i) => shares[i] >= topShare - config.tie_threshold);
      const winner = tied[Math.floor(rng() * tied.length)] ?? cands[0];
      return { winner, probabilities: probs, tie: true, method: 'coinflip' };
    }
    return { winner: cands[0], probabilities: probs, tie: false, method: 'argmax' };
  }

  // T > 0: proportional / tempered sampling.
  const probs = temperatureProbabilities(shares, config.temperature);
  const idx = sampleIndex(probs, rng);
  return { winner: cands[idx], probabilities: probs, tie: false, method: 'sampled' };
}

/** Qualitative state shown on display/voter screens (no timers). */
export function ballotState(
  d: Distribution,
  config: BallotConfig,
): 'gathering' | 'forming' | 'settling' | 'converged' | 'contested' {
  const votes = d.totalVotes;
  const share = leaderShare(d);
  if (votes < config.confident_min_votes) return 'gathering';
  if (votes > 20 && share < 0.35) return 'contested';
  if (share > 0.7) return 'converged';
  if (share >= 0.4) return 'settling';
  return 'forming';
}
