import 'dotenv/config';
import pg from 'pg';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 8,
  connectionTimeoutMillis: 3000,
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  values: unknown[] = [],
) {
  return pool.query<T>(sql, values);
}
