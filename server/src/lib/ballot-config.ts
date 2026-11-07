/**
 * BallotConfig — every tunable knob that governs how a ballot closes and how a
 * winner is selected. Stored as JSONB per-session and as a singleton row of
 * global defaults. See plan.md "Ballot Closure Logic".
 */
export type TiebreakerStrategy =
  | 'extend_then_coinflip'
  | 'extend_then_curator'
  | 'curator_only'
  | 'coinflip';

export type BallotConfig = {
  // Winner selection
  temperature: number; // 0 = argmax, 1 = proportional sampling, >1 flattened, <1 sharpened

  // Landslide close (distribution-driven)
  landslide_enabled: boolean;
  landslide_share: number;
  landslide_min_votes: number;

  // Confident close (distribution-driven)
  confident_enabled: boolean;
  confident_share: number;
  confident_margin: number; // fraction (0.15 == 15pp)
  confident_min_votes: number;

  // Vote ceiling (safety net, optional)
  max_votes_enabled: boolean;
  max_votes: number;

  // Soft timeout (safety net, optional, OFF by default)
  soft_timeout_enabled: boolean;
  soft_timeout_seconds: number;
  min_votes_floor: number;

  // Hard timeout (safety net, optional, OFF by default)
  hard_timeout_enabled: boolean;
  hard_timeout_seconds: number;

  // Tiebreaker (only used when temperature == 0)
  tie_threshold: number;
  tie_extension_seconds: number;
  tiebreaker_strategy: TiebreakerStrategy;

  // Pre-staging
  prestage_enabled: boolean;
  prestage_threshold: number;

  // Special tokens
  end_token_enabled: boolean;
  paragraph_token_enabled: boolean;
  max_tokens_per_session: number;
};

/**
 * The artistically-pure default: distribution-driven only, both timeouts off,
 * vote ceiling off, temperature 1 (LLM-faithful proportional sampling).
 */
export const DEFAULT_CONFIG: BallotConfig = {
  temperature: 1.0,

  landslide_enabled: true,
  landslide_share: 0.7,
  landslide_min_votes: 6,

  confident_enabled: true,
  confident_share: 0.45,
  confident_margin: 0.15,
  confident_min_votes: 12,

  max_votes_enabled: false,
  max_votes: 200,

  soft_timeout_enabled: false,
  soft_timeout_seconds: 1500, // 25 min
  min_votes_floor: 5,

  hard_timeout_enabled: false,
  hard_timeout_seconds: 3600, // 60 min

  tie_threshold: 0.02,
  tie_extension_seconds: 180,
  tiebreaker_strategy: 'extend_then_coinflip',

  prestage_enabled: true,
  prestage_threshold: 0.5,

  end_token_enabled: true,
  paragraph_token_enabled: false,
  max_tokens_per_session: 100,
};

export type Preset = { name: string; description: string; config: BallotConfig };

export const PRESETS: Record<string, Preset> = {
  patient: {
    name: 'Patient (default)',
    description: 'Distribution-only, no timeouts, T=1.',
    config: { ...DEFAULT_CONFIG },
  },
  greedy: {
    name: 'Greedy',
    description: 'T=0, deterministic, distribution-only.',
    config: { ...DEFAULT_CONFIG, temperature: 0 },
  },
  surreal: {
    name: 'Surreal',
    description: 'T=1.5, distribution-only.',
    config: { ...DEFAULT_CONFIG, temperature: 1.5 },
  },
  paced: {
    name: 'Paced (25/60 min)',
    description: 'Adds soft + hard timeouts for unattended exhibitions.',
    config: {
      ...DEFAULT_CONFIG,
      soft_timeout_enabled: true,
      soft_timeout_seconds: 1500,
      hard_timeout_enabled: true,
      hard_timeout_seconds: 3600,
    },
  },
  fast: {
    name: 'Fast cycle',
    description: 'Lower thresholds + soft timeout at 10 min (high-attendance demos only).',
    config: {
      ...DEFAULT_CONFIG,
      landslide_share: 0.6,
      landslide_min_votes: 4,
      confident_share: 0.4,
      confident_margin: 0.1,
      confident_min_votes: 8,
      soft_timeout_enabled: true,
      soft_timeout_seconds: 600,
      min_votes_floor: 3,
    },
  },
};

/** Merge a partial/legacy config over defaults so missing fields are always present. */
export function normalizeConfig(partial: Partial<BallotConfig> | null | undefined): BallotConfig {
  return { ...DEFAULT_CONFIG, ...(partial ?? {}) };
}
