import 'dotenv/config';
import * as schema from './schema.js';

/**
 * Two drivers, one schema:
 *  - production: node-postgres against DATABASE_URL (Fly Postgres)
 *  - local dev:  PGlite, an in-process Postgres persisted to ./.pgdata
 *
 * Both expose the same Drizzle query API, so the rest of the app is
 * driver-agnostic. Set DATABASE_URL to switch to a real Postgres.
 */
export type DB = Awaited<ReturnType<typeof createDb>>['db'];

export async function createDb() {
  const url = process.env.DATABASE_URL;

  if (url) {
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const pg = await import('pg');
    const pool = new pg.default.Pool({ connectionString: url });
    const db = drizzle(pool, { schema });
    return { db, kind: 'postgres' as const, raw: pool };
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const dataDir = process.env.PGLITE_DIR ?? './.pgdata';
  const client = new PGlite(dataDir);
  await client.waitReady;
  const db = drizzle(client, { schema });
  return { db, kind: 'pglite' as const, raw: client };
}

export { schema };
