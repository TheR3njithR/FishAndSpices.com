import { keyedHash } from '../security.js';

const policies = {
  lead_submission: { limit: 5, windowMs: 60_000 },
  admin_login: { limit: 8, windowMs: 15 * 60_000 },
  ai_chat_anon: { limit: 20, windowMs: 60_000 },
  ai_chat_auth: { limit: 60, windowMs: 60_000 },
  ai_realtime_session: { limit: 10, windowMs: 5 * 60_000 }
};

export async function consumeRateLimit(pool, scope, identifier, config, now = new Date()) {
  const policy = policies[scope];
  if (!policy) throw new Error(`Unknown rate-limit scope: ${scope}`);
  const identifierHash = keyedHash(identifier || 'unknown', config.sessionSecret);
  const windowStartedAt = new Date(Math.floor(now.getTime() / policy.windowMs) * policy.windowMs);
  const expiresAt = new Date(windowStartedAt.getTime() + policy.windowMs * 2);
  const result = await pool.query(`
    insert into rate_limit_buckets (scope, identifier_hash, window_started_at, request_count, expires_at)
    values ($1, $2, $3, 1, $4)
    on conflict (scope, identifier_hash, window_started_at)
    do update set request_count = rate_limit_buckets.request_count + 1
    returning request_count
  `, [scope, identifierHash, windowStartedAt, expiresAt]);
  if (Math.random() < 0.02) pool.query('delete from rate_limit_buckets where expires_at < now()').catch(() => {});
  return { allowed: result.rows[0].request_count <= policy.limit, retryAfterSeconds: Math.ceil((windowStartedAt.getTime() + policy.windowMs - now.getTime()) / 1000), identifierHash };
}
