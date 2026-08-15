import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.DATABASE_UNPOOLED_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_UNPOOLED_URL or DATABASE_URL is required for migrations.');

const checksumFor = (sql) => createHash('sha256').update(sql).digest('hex');
const canonicalizeSql = (sql) => sql.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');

const directory = resolve(import.meta.dirname, '..', 'db', 'migrations');
const files = (await readdir(directory)).filter(file => /^\d+_.+\.sql$/.test(file)).sort();
const client = new Client({ connectionString, application_name: 'fish-and-spices-migrations' });
await client.connect();

try {
  await client.query('select pg_advisory_lock($1)', [740_315_826]);
  await client.query(`create table if not exists schema_migrations (
    version text primary key,
    checksum text not null,
    applied_at timestamptz not null default now()
  )`);

  for (const file of files) {
    const sql = await readFile(join(directory, file), 'utf8');
    const checksum = checksumFor(canonicalizeSql(sql));
    const legacyChecksum = checksumFor(sql);
    const existing = await client.query('select checksum from schema_migrations where version = $1', [file]);
    if (existing.rowCount) {
      const existingChecksum = existing.rows[0].checksum;
      if (existingChecksum !== checksum && existingChecksum !== legacyChecksum) {
        throw new Error(`Applied migration checksum changed: ${file}`);
      }
      if (existingChecksum !== checksum) {
        await client.query('update schema_migrations set checksum = $2 where version = $1', [file, checksum]);
        console.log(`Migration checksum normalized: ${file}`);
      }
      console.log(`Migration already applied: ${file}`);
      continue;
    }

    await client.query('begin');
    try {
      await client.query(sql);
      await client.query('insert into schema_migrations (version, checksum) values ($1, $2)', [file, checksum]);
      await client.query('commit');
      console.log(`Migration applied: ${file}`);
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  }
} finally {
  await client.query('select pg_advisory_unlock($1)', [740_315_826]).catch(() => {});
  await client.end();
}
