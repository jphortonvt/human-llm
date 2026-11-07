import type { FastifyInstance } from 'fastify';
import type { Engine } from '../lib/engine.js';
import { RateLimiter } from '../lib/rate-limit.js';
import { getOrSetVoterToken } from '../lib/voter-token.js';

// NAT-aware burst limits. Generous enough for a busy gallery behind one wifi IP;
// they only throttle scripted floods. Tune as real sessions show actual rates.
const VOTE_WINDOW_MS = 10_000;
const VOTE_PER_IP_MAX = 40; // vote actions / 10s from one IP (whole room)
const VOTE_PER_TOKEN_MAX = 6; // vote actions / 10s from one voter (re-votes, not flooding)
const NEWWORD_WINDOW_MS = 60_000;
const NEWWORD_PER_IP_MAX = 20; // brand-new candidate words / min from one IP

/** Public + voter-facing read/write endpoints. No auth (voters are anonymous). */
export function registerApiRoutes(app: FastifyInstance, engine: Engine) {
  const perIpVotes = new RateLimiter(VOTE_PER_IP_MAX, VOTE_WINDOW_MS);
  const perTokenVotes = new RateLimiter(VOTE_PER_TOKEN_MAX, VOTE_WINDOW_MS);
  const perIpNewWords = new RateLimiter(NEWWORD_PER_IP_MAX, NEWWORD_WINDOW_MS);
  const sweeper = setInterval(() => {
    perIpVotes.sweep();
    perTokenVotes.sweep();
    perIpNewWords.sweep();
  }, 60_000);
  sweeper.unref?.();
  // Currently active session (or null).
  app.get('/api/sessions/active', async () => {
    const active = await engine.getActiveSession();
    if (!active) return { session: null };
    const detail = await engine.getSessionDetail(active.id);
    return detail ?? { session: null };
  });

  // Full detail for a specific session.
  app.get<{ Params: { id: string } }>('/api/sessions/:id', async (req, reply) => {
    const detail = await engine.getSessionDetail(req.params.id);
    if (!detail) return reply.code(404).send({ error: 'not found' });
    return detail;
  });

  // Cast or change a vote on a ballot.
  app.post<{ Params: { id: string }; Body: { word?: string; source?: string } }>(
    '/api/ballots/:id/vote',
    async (req, reply) => {
      const token = getOrSetVoterToken(req, reply);
      const word = (req.body?.word ?? '').toString();
      if (!word.trim()) return reply.code(400).send({ error: 'word required' });

      // Burst throttle: per-IP (whole room) and per-voter (anti-toggle/automation).
      const tooFast = (r: { ok: boolean; retryAfterMs: number }) => {
        if (r.ok) return false;
        reply
          .code(429)
          .header('Retry-After', Math.ceil(r.retryAfterMs / 1000))
          .send({ error: 'voting too fast, slow down a moment' });
        return true;
      };
      if (tooFast(perIpVotes.check(req.ip))) return reply;
      if (tooFast(perTokenVotes.check(token))) return reply;

      const ballot = await engine.getCurrentBallotById(req.params.id);
      if (!ballot) return reply.code(404).send({ error: 'ballot not found' });
      const config = await engine.getConfigForBallot(ballot);

      // Extra guard against new-word flooding (the spam vector). Voting for an
      // existing candidate is never blocked by this limit.
      const isNewWord = !(await engine.hasCandidate(req.params.id, word));
      if (isNewWord) {
        const nw = perIpNewWords.check(req.ip);
        if (!nw.ok) {
          return reply
            .code(429)
            .header('Retry-After', Math.ceil(nw.retryAfterMs / 1000))
            .send({ error: 'too many new words from here — vote for an existing one' });
        }
      }

      const source = req.body?.source === 'gallery_qr' ? 'gallery_qr' : 'remote';
      const result = await engine.castVote(req.params.id, word, token, source, config);
      if ('error' in result) return reply.code(400).send(result);
      return { ok: true, votedFor: result.word.displayText, changed: result.changed };
    },
  );

  // The voter's current vote on a ballot (so the UI can mark it).
  app.get<{ Params: { id: string } }>('/api/ballots/:id/my-vote', async (req, reply) => {
    const token = getOrSetVoterToken(req, reply);
    const wordId = await engine.getVoterChoice(req.params.id, token);
    return { wordId };
  });
}
