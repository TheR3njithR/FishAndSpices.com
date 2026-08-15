import pg from 'pg';

const { Pool } = pg;

export function createDatabase(config) {
  if (!config.databaseUrl) return null;
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 10,
    min: 0,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
    maxUses: 7_500,
    application_name: 'fish-and-spices'
  });
  pool.on('error', error => console.error(JSON.stringify({ level: 'error', event: 'postgres_pool_error', message: error.message })));
  return pool;
}

export async function withTransaction(pool, operation) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await operation(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
