import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { DB } from './config.ts';

let pool: Pool | null = null;

export function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: DB, max: 10 });
  return pool;
}

/** Runs a read-only query on the dev database. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await db().query<T>(text, params as never[]);
  return res.rows;
}

export async function one<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  const rows = await query<T>(text, params);
  return rows[0];
}

export async function count(text: string, params: unknown[] = []): Promise<number> {
  const row = await one<{ n: string }>(text, params);
  return row ? Number(row.n) : 0;
}

export async function withTransaction<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
