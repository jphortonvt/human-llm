import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { createDb } from './db/index.js';
import { bootstrapSchema } from './db/bootstrap.js';
import { Engine } from './lib/engine.js';
import { assertCuratorPasswordConfigured } from './lib/curator-auth.js';
import { registerApiRoutes } from './routes/api.js';
import { registerCuratorRoutes } from './routes/curator.js';
import { registerEventRoutes } from './routes/events.js';
import { startBallotLifecycle } from './workers/ballot-lifecycle.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';

async function main() {
  // Fail fast if the internet-reachable curator console is left on the default password.
  assertCuratorPasswordConfigured();

  const { db, kind, raw } = await createDb();
  await bootstrapSchema(raw as never, kind);
  const engine = new Engine(db);

  // Recover on boot: if a session is active but has no open ballot, open one.
  await engine.promoteNextIfIdle();

  // trustProxy lets req.ip reflect the real client (X-Forwarded-For) behind a
  // platform proxy like Fly, so per-IP curator rate limiting is accurate.
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    trustProxy: true,
  });

  registerEventRoutes(app);
  registerApiRoutes(app, engine);
  registerCuratorRoutes(app, engine, db);

  app.get('/api/health', async () => ({ ok: true, db: kind }));

  // Serve the built web app (Vite output) when present. In dev the Vite server
  // proxies /api to here, so static serving is a no-op until `npm run build`.
  const webDist = path.resolve(__dirname, '../public');
  if (existsSync(path.join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    // SPA fallback: any non-API route serves index.html.
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api')) return reply.code(404).send({ error: 'not found' });
      return reply.sendFile('index.html');
    });
  }

  const stopWorker = startBallotLifecycle(engine);

  await app.listen({ port: PORT, host: HOST });
  app.log.info(`human-llm server up on :${PORT} (db: ${kind})`);

  const shutdown = async () => {
    stopWorker();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
