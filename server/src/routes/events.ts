import type { FastifyInstance } from 'fastify';
import { hub } from '../lib/events.js';

/**
 * Server-Sent Events stream. The display and voter UIs subscribe here and
 * re-pull REST state on each event. A heartbeat keeps proxies from closing
 * the connection; clients reconnect with backoff on drop.
 */
export function registerEventRoutes(app: FastifyInstance) {
  app.get('/api/events', (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write('retry: 3000\n\n');

    const send = (event: unknown) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    send({ type: 'hello' });

    const unsubscribe = hub.subscribe((event) => send(event));
    const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 15000);

    req.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
