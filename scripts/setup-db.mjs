import 'dotenv/config';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is required. Copy .env.example to .env and set local credentials.');
  process.exit(1);
}
const databaseUrl = new URL(connectionString);
if (decodeURIComponent(databaseUrl.pathname.slice(1)) !== 'Golden Gate') {
  console.error('DATABASE_URL must target the exact database name "Golden Gate".');
  process.exit(1);
}
const adminUrl = new URL(connectionString);
adminUrl.pathname = '/postgres';
const admin = new pg.Client({ connectionString: adminUrl.toString() });
try {
  await admin.connect();
  const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
    'Golden Gate',
  ]);
  if (existing.rowCount === 0) {
    await admin.query('CREATE DATABASE "Golden Gate"');
    console.log('Created database "Golden Gate".');
  }
} finally {
  await admin.end();
}
const client = new pg.Client({ connectionString });
try {
  await client.connect();
  const names = (await readdir(new URL('../db/migrations/', import.meta.url)))
    .filter((name) => name.endsWith('.sql'))
    .sort();
  for (const name of names) {
    const version = name.slice(0, -4);
    const exists = await client.query('SELECT to_regclass($1) AS name', [
      'public.schema_migrations',
    ]);
    if (exists.rows[0].name) {
      const prior = await client.query('SELECT 1 FROM schema_migrations WHERE version=$1', [
        version,
      ]);
      if (prior.rowCount) continue;
    }
    const migration = await readFile(new URL(`../db/migrations/${name}`, import.meta.url), 'utf8');
    await client.query(migration);
    console.log(`Applied schema migration ${version}.`);
  }
} finally {
  await client.end();
}
