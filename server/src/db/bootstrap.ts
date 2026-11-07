import { DEFAULT_CONFIG } from '../lib/ballot-config.js';

/**
 * Idempotent schema creation. Runs on every boot against either driver.
 * Kept as plain DDL (rather than drizzle-kit migrations) so the app is
 * runnable with zero external tooling. Mirrors db/schema.ts exactly.
 */
const DDL = `
CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  queue_position integer NOT NULL DEFAULT 0,
  config jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS ballots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  position integer NOT NULL,
  status text NOT NULL DEFAULT 'open',
  assumed_word text,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  runoff_until timestamptz,
  winning_word_id uuid
);
CREATE INDEX IF NOT EXISTS ballots_session_idx ON ballots(session_id);
CREATE INDEX IF NOT EXISTS ballots_status_idx ON ballots(status);

CREATE TABLE IF NOT EXISTS words (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ballot_id uuid NOT NULL REFERENCES ballots(id) ON DELETE CASCADE,
  text text NOT NULL,
  display_text text NOT NULL,
  vote_count integer NOT NULL DEFAULT 0,
  is_hidden boolean NOT NULL DEFAULT false,
  first_submitted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS words_ballot_idx ON words(ballot_id);
CREATE UNIQUE INDEX IF NOT EXISTS words_ballot_text_idx ON words(ballot_id, text);

CREATE TABLE IF NOT EXISTS votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ballot_id uuid NOT NULL REFERENCES ballots(id) ON DELETE CASCADE,
  word_id uuid NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  voter_token text NOT NULL,
  source text NOT NULL DEFAULT 'remote',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS votes_ballot_voter_idx ON votes(ballot_id, voter_token);
CREATE INDEX IF NOT EXISTS votes_word_idx ON votes(word_id);

CREATE TABLE IF NOT EXISTS global_config (
  id text PRIMARY KEY DEFAULT 'global',
  config jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
`;

type RawClient =
  | { exec: (sql: string) => Promise<unknown> } // PGlite
  | { query: (sql: string) => Promise<unknown> }; // node-postgres Pool

export async function bootstrapSchema(raw: RawClient, kind: 'pglite' | 'postgres') {
  if (kind === 'pglite') {
    await (raw as { exec: (s: string) => Promise<unknown> }).exec(DDL);
  } else {
    await (raw as { query: (s: string) => Promise<unknown> }).query(DDL);
  }

  // Seed the singleton global default config if absent.
  const seed = `INSERT INTO global_config (id, config) VALUES ('global', '${JSON.stringify(
    DEFAULT_CONFIG,
  ).replace(/'/g, "''")}'::jsonb) ON CONFLICT (id) DO NOTHING;`;
  if (kind === 'pglite') {
    await (raw as { exec: (s: string) => Promise<unknown> }).exec(seed);
  } else {
    await (raw as { query: (s: string) => Promise<unknown> }).query(seed);
  }
}
