import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { BallotConfig } from '../lib/ballot-config.js';

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  prompt: text('prompt').notNull(),
  status: text('status', { enum: ['queued', 'active', 'complete', 'abandoned'] })
    .notNull()
    .default('queued'),
  queuePosition: integer('queue_position').notNull().default(0),
  config: jsonb('config').$type<BallotConfig>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export const ballots = pgTable(
  'ballots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    status: text('status', { enum: ['provisional', 'open', 'closed'] })
      .notNull()
      .default('open'),
    // For provisional (pre-staged) ballots: which leading word this ballot assumes won.
    assumedWord: text('assumed_word'),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    // Tiebreaker runoff extension deadline (T=0 only).
    runoffUntil: timestamp('runoff_until', { withTimezone: true }),
    winningWordId: uuid('winning_word_id'),
  },
  (t) => [index('ballots_session_idx').on(t.sessionId), index('ballots_status_idx').on(t.status)],
);

export const words = pgTable(
  'words',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ballotId: uuid('ballot_id')
      .notNull()
      .references(() => ballots.id, { onDelete: 'cascade' }),
    text: text('text').notNull(), // normalized key (lowercased, trimmed)
    displayText: text('display_text').notNull(), // most-voted casing, for rendering
    voteCount: integer('vote_count').notNull().default(0),
    isHidden: boolean('is_hidden').notNull().default(false),
    firstSubmittedAt: timestamp('first_submitted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('words_ballot_idx').on(t.ballotId),
    uniqueIndex('words_ballot_text_idx').on(t.ballotId, t.text),
  ],
);

export const votes = pgTable(
  'votes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ballotId: uuid('ballot_id')
      .notNull()
      .references(() => ballots.id, { onDelete: 'cascade' }),
    wordId: uuid('word_id')
      .notNull()
      .references(() => words.id, { onDelete: 'cascade' }),
    voterToken: text('voter_token').notNull(),
    source: text('source', { enum: ['gallery_qr', 'remote', 'curator'] })
      .notNull()
      .default('remote'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One vote per voter per ballot (changing a vote updates the existing row).
    uniqueIndex('votes_ballot_voter_idx').on(t.ballotId, t.voterToken),
    index('votes_word_idx').on(t.wordId),
  ],
);

// Singleton row holding global default BallotConfig (id always 'global').
export const globalConfig = pgTable('global_config', {
  id: text('id').primaryKey().default('global'),
  config: jsonb('config').$type<BallotConfig>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Session = typeof sessions.$inferSelect;
export type Ballot = typeof ballots.$inferSelect;
export type Word = typeof words.$inferSelect;
export type Vote = typeof votes.$inferSelect;
