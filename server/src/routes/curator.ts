import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { DB } from '../db/index.js';
import { type BallotConfig, PRESETS, normalizeConfig } from '../lib/ballot-config.js';
import { checkPassword, lockedFor, recordFailure, recordSuccess } from '../lib/curator-auth.js';
import type { Engine } from '../lib/engine.js';
import { computeMetrics } from '../lib/metrics.js';

/** Extract the offered password from `x-curator-password` or HTTP Basic auth. */
function offeredPassword(req: FastifyRequest): string | null {
  const header = req.headers['x-curator-password'];
  if (typeof header === 'string') return header;

  const auth = req.headers.authorization;
  if (auth?.startsWith('Basic ')) {
    const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
    return decoded.split(':')[1] ?? '';
  }
  return null;
}

/** Constant-time, rate-limited shared-password gate. */
function checkAuth(req: FastifyRequest, reply: FastifyReply): boolean {
  const ip = req.ip;
  const remaining = lockedFor(ip);
  if (remaining > 0) {
    reply
      .code(429)
      .header('Retry-After', Math.ceil(remaining / 1000))
      .send({ error: 'too many attempts, try again later' });
    return false;
  }

  if (checkPassword(offeredPassword(req))) {
    recordSuccess(ip);
    return true;
  }
  recordFailure(ip);
  reply.code(401).send({ error: 'unauthorized' });
  return false;
}

export function registerCuratorRoutes(app: FastifyInstance, engine: Engine, db: DB) {
  app.addHook('preHandler', async (req, reply) => {
    if (req.url.startsWith('/api/curator')) {
      if (!checkAuth(req, reply)) return reply;
    }
  });

  // ---- queue / sessions ----
  app.post<{ Body: { prompt?: string; config?: Partial<BallotConfig> } }>(
    '/api/curator/sessions',
    async (req, reply) => {
      const prompt = (req.body?.prompt ?? '').toString().trim();
      if (!prompt) return reply.code(400).send({ error: 'prompt required' });
      const session = await engine.createSession(prompt, req.body?.config);
      return { session };
    },
  );

  app.get('/api/curator/sessions', async () => {
    const all = await engine.listSessions();
    return { sessions: all };
  });

  app.patch<{ Params: { id: string }; Body: Partial<{ prompt: string; queuePosition: number; config: BallotConfig }> }>(
    '/api/curator/sessions/:id',
    async (req) => {
      const session = await engine.updateSession(req.params.id, req.body ?? {});
      return { session };
    },
  );

  app.delete<{ Params: { id: string } }>('/api/curator/sessions/:id', async (req) => {
    await engine.deleteSession(req.params.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/curator/sessions/:id/abandon', async (req) => {
    await engine.abandonSession(req.params.id);
    return { ok: true };
  });

  // ---- live ballot controls ----
  app.post<{ Params: { id: string }; Body: { wordId?: string } }>(
    '/api/curator/ballots/:id/close',
    async (req, reply) => {
      const result = await engine.curatorClose(req.params.id, req.body?.wordId);
      if ('error' in result) return reply.code(400).send(result);
      return result;
    },
  );

  app.post<{ Params: { id: string }; Body: { hidden?: boolean } }>(
    '/api/curator/words/:id/hide',
    async (req) => {
      const word = await engine.hideWord(req.params.id, req.body?.hidden ?? true);
      return { word };
    },
  );

  // ---- config / tuning ----
  app.get('/api/curator/config/global', async () => {
    return { config: await engine.getGlobalConfig() };
  });

  app.put<{ Body: { config: BallotConfig } }>('/api/curator/config/global', async (req, reply) => {
    if (!req.body?.config) return reply.code(400).send({ error: 'config required' });
    await engine.setGlobalConfig(normalizeConfig(req.body.config));
    return { ok: true };
  });

  // Applies to the *next* ballot (current open ballot keeps its rules).
  app.put<{ Params: { id: string }; Body: { config: BallotConfig } }>(
    '/api/curator/sessions/:id/config',
    async (req, reply) => {
      if (!req.body?.config) return reply.code(400).send({ error: 'config required' });
      const session = await engine.updateSession(req.params.id, {
        config: normalizeConfig(req.body.config),
      });
      return { session };
    },
  );

  app.get('/api/curator/presets', async () => {
    return { presets: PRESETS };
  });

  // ---- metrics ----
  app.get<{ Querystring: { sessionId?: string } }>('/api/curator/metrics', async (req) => {
    const metrics = await computeMetrics(db, req.query.sessionId);
    return { metrics };
  });

  // ---- archive ----
  app.get('/api/curator/archive', async () => {
    return { sessions: await engine.getArchive() };
  });
}
