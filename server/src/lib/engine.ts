import { and, asc, eq, sql } from 'drizzle-orm';
import type { DB } from '../db/index.js';
import { ballots, globalConfig, sessions, votes, words } from '../db/schema.js';
import type { Ballot, Session, Word } from '../db/schema.js';
import { type BallotConfig, normalizeConfig } from './ballot-config.js';
import {
  type Candidate,
  type CloseReason,
  ballotState,
  buildDistribution,
  evaluateClosure,
  leaderShare,
  selectWinner,
} from './ballot-closure.js';
import { hub } from './events.js';
import { END_TOKEN, PARAGRAPH_TOKEN, isSpecialToken, moderate, normalizeWord } from './moderation.js';

export class Engine {
  constructor(private db: DB) {}

  // ---- config ----------------------------------------------------------------

  async getGlobalConfig(): Promise<BallotConfig> {
    const row = await this.db.query.globalConfig.findFirst({ where: eq(globalConfig.id, 'global') });
    return normalizeConfig(row?.config);
  }

  async setGlobalConfig(config: BallotConfig): Promise<void> {
    await this.db
      .insert(globalConfig)
      .values({ id: 'global', config })
      .onConflictDoUpdate({ target: globalConfig.id, set: { config, updatedAt: new Date() } });
  }

  // ---- sessions --------------------------------------------------------------

  async createSession(prompt: string, config?: Partial<BallotConfig>): Promise<Session> {
    const base = await this.getGlobalConfig();
    const merged = { ...base, ...(config ?? {}) };
    const maxPos = await this.db
      .select({ m: sql<number>`coalesce(max(${sessions.queuePosition}), -1)` })
      .from(sessions)
      .where(eq(sessions.status, 'queued'));
    const nextPos = (maxPos[0]?.m ?? -1) + 1;
    const [session] = await this.db
      .insert(sessions)
      .values({ prompt, config: merged, status: 'queued', queuePosition: nextPos })
      .returning();
    // If nothing is active, promote this one immediately.
    await this.promoteNextIfIdle();
    hub.publish({ type: 'state', sessionId: session.id });
    return session;
  }

  async getActiveSession(): Promise<Session | undefined> {
    return this.db.query.sessions.findFirst({ where: eq(sessions.status, 'active') });
  }

  /** Promote the next queued session to active if no session is currently active. */
  async promoteNextIfIdle(): Promise<Session | undefined> {
    const active = await this.getActiveSession();
    if (active) return active;
    const next = await this.db.query.sessions.findFirst({
      where: eq(sessions.status, 'queued'),
      orderBy: [asc(sessions.queuePosition), asc(sessions.createdAt)],
    });
    if (!next) return undefined;
    const [updated] = await this.db
      .update(sessions)
      .set({ status: 'active', startedAt: new Date() })
      .where(eq(sessions.id, next.id))
      .returning();
    await this.openBallot(updated.id, 0);
    hub.publish({ type: 'session_active', sessionId: updated.id });
    return updated;
  }

  async listSessions(status?: Session['status']): Promise<Session[]> {
    const rows = status
      ? await this.db.query.sessions.findMany({ where: eq(sessions.status, status) })
      : await this.db.query.sessions.findMany();
    return rows.sort(
      (a, b) =>
        a.queuePosition - b.queuePosition || a.createdAt.getTime() - b.createdAt.getTime(),
    );
  }

  async updateSession(
    sessionId: string,
    patch: { prompt?: string; queuePosition?: number; config?: BallotConfig },
  ): Promise<Session | undefined> {
    const set: Record<string, unknown> = {};
    if (patch.prompt !== undefined) set.prompt = patch.prompt;
    if (patch.queuePosition !== undefined) set.queuePosition = patch.queuePosition;
    if (patch.config !== undefined) set.config = patch.config;
    if (Object.keys(set).length === 0) {
      return this.db.query.sessions.findFirst({ where: eq(sessions.id, sessionId) });
    }
    const [row] = await this.db
      .update(sessions)
      .set(set)
      .where(eq(sessions.id, sessionId))
      .returning();
    hub.publish({ type: 'state', sessionId });
    return row;
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.id, sessionId));
    hub.publish({ type: 'state', sessionId });
  }

  /** Completed/abandoned sessions with full transcripts, for the Archive tab. */
  async getArchive() {
    const done = await this.db.query.sessions.findMany();
    const archived = done
      .filter((s) => s.status === 'complete' || s.status === 'abandoned')
      .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0));
    const out = [];
    for (const s of archived) {
      const detail = await this.getSessionDetail(s.id);
      out.push({
        id: s.id,
        prompt: s.prompt,
        status: s.status,
        completedAt: s.completedAt,
        response: detail?.lockedWords.map((w) => w.text).join(' ') ?? '',
      });
    }
    return out;
  }

  async abandonSession(sessionId: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ status: 'abandoned', completedAt: new Date() })
      .where(eq(sessions.id, sessionId));
    await this.promoteNextIfIdle();
    hub.publish({ type: 'state', sessionId });
  }

  // ---- ballots ---------------------------------------------------------------

  async openBallot(sessionId: string, position: number, asProvisional = false, assumedWord?: string) {
    const [ballot] = await this.db
      .insert(ballots)
      .values({
        sessionId,
        position,
        status: asProvisional ? 'provisional' : 'open',
        assumedWord: assumedWord ?? null,
      })
      .returning();
    if (asProvisional) {
      hub.publish({
        type: 'prestage_opened',
        sessionId,
        ballotId: ballot.id,
        assumedWord: assumedWord ?? '',
      });
    } else {
      hub.publish({ type: 'ballot_opened', sessionId, ballotId: ballot.id, position });
    }
    return ballot;
  }

  async getCurrentBallot(sessionId: string): Promise<Ballot | undefined> {
    return this.db.query.ballots.findFirst({
      where: and(eq(ballots.sessionId, sessionId), eq(ballots.status, 'open')),
      orderBy: [asc(ballots.position)],
    });
  }

  /** Look up any ballot (open or provisional) by id. */
  async getCurrentBallotById(ballotId: string): Promise<Ballot | undefined> {
    return this.db.query.ballots.findFirst({ where: eq(ballots.id, ballotId) });
  }

  /** Resolve the BallotConfig governing a ballot (from its session). */
  async getConfigForBallot(ballot: Ballot): Promise<BallotConfig> {
    const session = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, ballot.sessionId),
    });
    return normalizeConfig(session?.config);
  }

  /** Whether a (normalized) word already exists as a candidate on this ballot. */
  async hasCandidate(ballotId: string, rawWord: string): Promise<boolean> {
    const norm = normalizeWord(rawWord);
    if (!norm) return false;
    const w = await this.db.query.words.findFirst({
      where: and(eq(words.ballotId, ballotId), eq(words.text, norm.key)),
    });
    return !!w;
  }

  /** The word id this voter currently backs on a ballot, or null. */
  async getVoterChoice(ballotId: string, voterToken: string): Promise<string | null> {
    const v = await this.db.query.votes.findFirst({
      where: and(eq(votes.ballotId, ballotId), eq(votes.voterToken, voterToken)),
    });
    return v?.wordId ?? null;
  }

  async getProvisionalBallot(sessionId: string): Promise<Ballot | undefined> {
    return this.db.query.ballots.findFirst({
      where: and(eq(ballots.sessionId, sessionId), eq(ballots.status, 'provisional')),
      orderBy: [asc(ballots.position)],
    });
  }

  async getCandidates(ballotId: string, includeHidden = false): Promise<Candidate[]> {
    const rows = await this.db.query.words.findMany({ where: eq(words.ballotId, ballotId) });
    return rows
      .filter((w) => includeHidden || !w.isHidden)
      .map((w) => ({
        wordId: w.id,
        text: w.text,
        displayText: w.displayText,
        voteCount: w.voteCount,
      }));
  }

  // ---- voting ----------------------------------------------------------------

  /**
   * Cast or change a vote. One vote per voter per ballot; re-voting moves the
   * voter's existing vote to the new word. Returns the word voted for.
   */
  async castVote(
    ballotId: string,
    rawWord: string,
    voterToken: string,
    source: 'gallery_qr' | 'remote' | 'curator',
    config: BallotConfig,
  ): Promise<{ word: Word; changed: boolean } | { error: string }> {
    const ballot = await this.db.query.ballots.findFirst({ where: eq(ballots.id, ballotId) });
    if (!ballot) return { error: 'ballot not found' };
    if (ballot.status === 'closed') return { error: 'ballot closed' };

    const norm = normalizeWord(rawWord);
    if (!norm) return { error: 'invalid word (single token required)' };

    // Reject special tokens that are disabled in config.
    if (norm.key === END_TOKEN && !config.end_token_enabled) return { error: 'end token disabled' };
    if (norm.key === PARAGRAPH_TOKEN && !config.paragraph_token_enabled)
      return { error: 'paragraph token disabled' };

    const { flagged } = moderate(norm.display);
    if (flagged) return { error: 'word rejected by filter' };

    // Upsert the word row for this ballot.
    let word = await this.db.query.words.findFirst({
      where: and(eq(words.ballotId, ballotId), eq(words.text, norm.key)),
    });
    if (!word) {
      const inserted = await this.db
        .insert(words)
        .values({ ballotId, text: norm.key, displayText: norm.display, voteCount: 0 })
        .onConflictDoNothing()
        .returning();
      word =
        inserted[0] ??
        (await this.db.query.words.findFirst({
          where: and(eq(words.ballotId, ballotId), eq(words.text, norm.key)),
        }));
    }
    if (!word) return { error: 'could not register word' };

    // Does this voter already have a vote on this ballot?
    const existing = await this.db.query.votes.findFirst({
      where: and(eq(votes.ballotId, ballotId), eq(votes.voterToken, voterToken)),
    });

    let changed = false;
    if (existing) {
      if (existing.wordId === word.id) {
        return { word, changed: false }; // no-op, same word
      }
      // Move the vote: decrement old, point at new, increment new.
      await this.db.update(votes).set({ wordId: word.id }).where(eq(votes.id, existing.id));
      await this.recountWord(existing.wordId);
      changed = true;
    } else {
      await this.db.insert(votes).values({ ballotId, wordId: word.id, voterToken, source });
    }
    await this.recountWord(word.id);

    // Pre-staging check.
    await this.maybePreStage(ballot, config);

    hub.publish({ type: 'vote', sessionId: ballot.sessionId, ballotId });
    const fresh = await this.db.query.words.findFirst({ where: eq(words.id, word.id) });
    return { word: fresh ?? word, changed };
  }

  private async recountWord(wordId: string) {
    const [{ c }] = await this.db
      .select({ c: sql<number>`count(*)` })
      .from(votes)
      .where(eq(votes.wordId, wordId));
    await this.db
      .update(words)
      .set({ voteCount: Number(c) })
      .where(eq(words.id, wordId));
  }

  async hideWord(wordId: string, hidden: boolean) {
    const [w] = await this.db
      .update(words)
      .set({ isHidden: hidden })
      .where(eq(words.id, wordId))
      .returning();
    if (w) hub.publish({ type: 'state', sessionId: '' });
    return w;
  }

  // ---- pre-staging -----------------------------------------------------------

  private async maybePreStage(ballot: Ballot, config: BallotConfig) {
    if (!config.prestage_enabled) return;
    if (ballot.status !== 'open') return;
    const existing = await this.getProvisionalBallot(ballot.sessionId);
    if (existing) return;
    const cands = await this.getCandidates(ballot.id);
    const dist = buildDistribution(cands);
    if (dist.totalVotes === 0) return;
    const leader = dist.candidates[0];
    if (!leader) return;
    // Don't pre-stage past an [END] leader — the session would end.
    if (isSpecialToken(leader.text) && leader.text === END_TOKEN) return;
    if (leaderShare(dist) >= config.prestage_threshold) {
      await this.openBallot(ballot.sessionId, ballot.position + 1, true, leader.text);
    }
  }

  // ---- closure & advancement -------------------------------------------------

  /** Evaluated by the worker each tick for every open ballot. */
  async tick() {
    const open = await this.db.query.ballots.findMany({ where: eq(ballots.status, 'open') });
    const now = Date.now();
    for (const ballot of open) {
      const session = await this.db.query.sessions.findFirst({
        where: eq(sessions.id, ballot.sessionId),
      });
      if (!session || session.status !== 'active') continue;
      const config = normalizeConfig(session.config);

      // Runoff handling (T=0 tiebreaker extension).
      if (ballot.runoffUntil) {
        if (now < ballot.runoffUntil.getTime()) continue; // still extending
        await this.finalizeClose(ballot, config, 'curator'); // runoff expired → resolve
        continue;
      }

      const cands = await this.getCandidates(ballot.id);
      const dist = buildDistribution(cands);
      const reason = evaluateClosure(dist, config, ballot.openedAt.getTime(), now);
      if (reason) {
        await this.finalizeClose(ballot, config, reason);
      }
    }
  }

  /** Curator manual close. force=true skips tie-extension and resolves now. */
  async curatorClose(ballotId: string, forcedWordId?: string) {
    const ballot = await this.db.query.ballots.findFirst({ where: eq(ballots.id, ballotId) });
    if (!ballot || ballot.status !== 'open') return { error: 'no open ballot' };
    const session = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, ballot.sessionId),
    });
    if (!session) return { error: 'no session' };
    const config = normalizeConfig(session.config);
    return this.finalizeClose(ballot, config, 'curator', forcedWordId, true);
  }

  /**
   * Stop collecting votes, select a winner, lock the word, and advance the
   * session (promote pre-staged ballot or open a fresh one; complete on [END]).
   */
  private async finalizeClose(
    ballot: Ballot,
    config: BallotConfig,
    reason: CloseReason,
    forcedWordId?: string,
    force = false,
  ): Promise<{ winningWord: string } | { error: string }> {
    const cands = await this.getCandidates(ballot.id);
    const dist = buildDistribution(cands);

    if (dist.candidates.length === 0) {
      // Empty ballot. Only resolvable by curator/hard-timeout → abandon-ish: keep open
      // unless forced, in which case there's nothing to pick.
      if (!force && reason !== 'hard_timeout') return { error: 'no candidates' };
      // Nothing to lock; abandon the session as unresolvable.
      await this.abandonSession(ballot.sessionId);
      return { error: 'empty ballot — session abandoned' };
    }

    // Forced pick of a specific word (curator force-pick).
    let winner = dist.candidates[0];
    let probabilities = dist.candidates.map((c) => (dist.totalVotes ? c.voteCount / dist.totalVotes : 0));
    let sampledUpset = false;

    if (forcedWordId) {
      const w = dist.candidates.find((c) => c.wordId === forcedWordId);
      if (!w) return { error: 'forced word not in ballot' };
      winner = w;
    } else {
      const sel = selectWinner(dist, config);
      // T=0 tie with an extend strategy: start a runoff instead of closing (unless forced).
      if (
        sel.tie &&
        !force &&
        !ballot.runoffUntil &&
        (config.tiebreaker_strategy === 'extend_then_coinflip' ||
          config.tiebreaker_strategy === 'extend_then_curator')
      ) {
        const until = new Date(Date.now() + config.tie_extension_seconds * 1000);
        await this.db.update(ballots).set({ runoffUntil: until }).where(eq(ballots.id, ballot.id));
        hub.publish({
          type: 'runoff',
          sessionId: ballot.sessionId,
          ballotId: ballot.id,
          until: until.toISOString(),
        });
        return { error: 'runoff started' };
      }
      // curator_only strategy: leave open for the curator unless forced.
      if (sel.tie && !force && config.tiebreaker_strategy === 'curator_only') {
        return { error: 'awaiting curator (tie)' };
      }
      winner = sel.winner;
      probabilities = sel.probabilities;
      sampledUpset = winner.wordId !== dist.candidates[0].wordId;
    }

    // Lock the ballot.
    await this.db
      .update(ballots)
      .set({ status: 'closed', closedAt: new Date(), winningWordId: winner.wordId, runoffUntil: null })
      .where(eq(ballots.id, ballot.id));

    hub.publish({
      type: 'ballot_closed',
      sessionId: ballot.sessionId,
      ballotId: ballot.id,
      winningWord: winner.displayText,
      reason,
      sampledUpset,
      probabilities: dist.candidates.map((c, i) => ({ text: c.displayText, p: probabilities[i] ?? 0 })),
    });

    await this.advanceSession(ballot, winner, config);
    return { winningWord: winner.displayText };
  }

  private async advanceSession(closedBallot: Ballot, winner: Candidate, config: BallotConfig) {
    const nextPosition = closedBallot.position + 1;
    const sessionEndsHere =
      winner.text === END_TOKEN || nextPosition >= config.max_tokens_per_session;

    // Resolve the provisional/pre-staged ballot, if any.
    const provisional = await this.getProvisionalBallot(closedBallot.sessionId);

    if (sessionEndsHere) {
      if (provisional) {
        await this.db.delete(ballots).where(eq(ballots.id, provisional.id));
      }
      await this.db
        .update(sessions)
        .set({ status: 'complete', completedAt: new Date() })
        .where(eq(sessions.id, closedBallot.sessionId));
      hub.publish({ type: 'session_complete', sessionId: closedBallot.sessionId });
      await this.promoteNextIfIdle();
      return;
    }

    if (provisional && provisional.assumedWord === winner.text) {
      // Promote: the pre-staged guess held. Re-open it as the active ballot.
      await this.db
        .update(ballots)
        .set({ status: 'open', openedAt: new Date(), assumedWord: null })
        .where(eq(ballots.id, provisional.id));
      hub.publish({
        type: 'ballot_opened',
        sessionId: closedBallot.sessionId,
        ballotId: provisional.id,
        position: provisional.position,
      });
      return;
    }

    if (provisional) {
      // Invalidated: the sampled winner differed from the pre-staged assumption.
      await this.db.delete(ballots).where(eq(ballots.id, provisional.id));
      hub.publish({
        type: 'prestage_invalidated',
        sessionId: closedBallot.sessionId,
        ballotId: provisional.id,
      });
    }

    await this.openBallot(closedBallot.sessionId, nextPosition);
  }

  // ---- read models -----------------------------------------------------------

  /** Full detail for /display, /vote, /curator. */
  async getSessionDetail(sessionId: string) {
    const session = await this.db.query.sessions.findFirst({ where: eq(sessions.id, sessionId) });
    if (!session) return undefined;
    const config = normalizeConfig(session.config);

    const allBallots = await this.db.query.ballots.findMany({
      where: eq(ballots.sessionId, sessionId),
      orderBy: [asc(ballots.position)],
    });

    // Locked response so far: closed ballots in order, their winning word.
    const lockedWords: { position: number; text: string }[] = [];
    for (const b of allBallots) {
      if (b.status === 'closed' && b.winningWordId) {
        const w = await this.db.query.words.findFirst({ where: eq(words.id, b.winningWordId) });
        if (w && w.text !== END_TOKEN) {
          lockedWords.push({ position: b.position, text: w.displayText });
        }
      }
    }

    const current = allBallots.find((b) => b.status === 'open');
    const provisional = allBallots.find((b) => b.status === 'provisional');

    const currentBallot = current ? await this.ballotView(current, config) : null;
    const provisionalBallot = provisional ? await this.ballotView(provisional, config) : null;

    return {
      session: {
        id: session.id,
        prompt: session.prompt,
        status: session.status,
        config,
      },
      lockedWords,
      currentBallot,
      provisionalBallot,
      voterCount: hub.connectionCount,
    };
  }

  private async ballotView(ballot: Ballot, config: BallotConfig) {
    const cands = await this.getCandidates(ballot.id);
    const dist = buildDistribution(cands);
    return {
      id: ballot.id,
      position: ballot.position,
      status: ballot.status,
      assumedWord: ballot.assumedWord,
      inRunoff: !!ballot.runoffUntil && ballot.runoffUntil.getTime() > Date.now(),
      totalVotes: dist.totalVotes,
      state: ballotState(dist, config),
      candidates: dist.candidates.map((c) => ({
        wordId: c.wordId,
        text: c.displayText,
        key: c.text,
        votes: c.voteCount,
        share: dist.totalVotes ? c.voteCount / dist.totalVotes : 0,
      })),
    };
  }
}
