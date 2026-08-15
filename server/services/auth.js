import bcrypt from 'bcryptjs';
import { keyedHash, randomToken, sha256 } from '../security.js';
import { consumeRateLimit } from './rate-limit.js';

const DUMMY_PASSWORD_HASH = bcrypt.hashSync('constant-time-password-placeholder', 12);
export const SESSION_HOURS = 8;

async function authEvent(pool, { administratorId = null, emailHash = null, ipHash = null, eventType }) {
  await pool.query(`insert into authentication_events (administrator_id, email_hash, ip_hash, event_type)
    values ($1,$2,$3,$4)`, [administratorId, emailHash, ipHash, eventType]);
}

export async function loginAdministrator({ pool, email, password, ip, userAgent, config, now = new Date() }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const emailHash = keyedHash(normalizedEmail, config.sessionSecret);
  const ipHash = keyedHash(ip || 'unknown', config.sessionSecret);
  const limit = await consumeRateLimit(pool, 'admin_login', `${ipHash}:${emailHash}`, config, now);
  if (!limit.allowed) {
    await authEvent(pool, { emailHash, ipHash, eventType: 'login_rate_limited' });
    const error = new Error('Too many login attempts. Please wait and retry.');
    error.status = 429;
    error.retryAfterSeconds = limit.retryAfterSeconds;
    throw error;
  }

  const result = await pool.query(`select id, email, password_hash, display_name, role, active
    from administrator_users where email = $1 limit 1`, [normalizedEmail]);
  const user = result.rows[0];
  const validPassword = await bcrypt.compare(String(password || ''), user?.password_hash || DUMMY_PASSWORD_HASH);
  if (!user || !user.active || !validPassword) {
    await authEvent(pool, { administratorId: user?.id || null, emailHash, ipHash, eventType: 'login_failed' });
    const error = new Error('Invalid email or password.');
    error.status = 401;
    throw error;
  }

  const sessionToken = randomToken(32);
  const csrfToken = randomToken(24);
  const expiresAt = new Date(now.getTime() + SESSION_HOURS * 60 * 60 * 1000);
  await pool.query(`insert into administrator_sessions (
    administrator_id, token_hash, csrf_token_hash, ip_hash, user_agent_hash, expires_at
  ) values ($1,$2,$3,$4,$5,$6)`, [user.id, sha256(sessionToken), sha256(csrfToken), ipHash, keyedHash(userAgent || '', config.sessionSecret), expiresAt]);
  await pool.query('update administrator_users set last_login_at = $1 where id = $2', [now, user.id]);
  await authEvent(pool, { administratorId: user.id, emailHash, ipHash, eventType: 'login_succeeded' });
  return { sessionToken, csrfToken, expiresAt, user: { id: user.id, email: user.email, displayName: user.display_name, role: user.role } };
}

export async function resolveSession({ pool, sessionToken, now = new Date() }) {
  if (!sessionToken) return null;
  const result = await pool.query(`
    select s.id as session_id, s.csrf_token_hash, s.expires_at, u.id, u.email, u.display_name, u.role
    from administrator_sessions s
    join administrator_users u on u.id = s.administrator_id
    where s.token_hash = $1 and s.revoked_at is null and s.expires_at > $2 and u.active = true
    limit 1
  `, [sha256(sessionToken), now]);
  if (!result.rowCount) return null;
  const row = result.rows[0];
  return {
    sessionId: row.session_id,
    csrfTokenHash: row.csrf_token_hash,
    expiresAt: row.expires_at,
    user: { id: row.id, email: row.email, displayName: row.display_name, role: row.role }
  };
}

export async function rotateCsrf(pool, sessionId) {
  const csrfToken = randomToken(24);
  await pool.query('update administrator_sessions set csrf_token_hash = $1, last_seen_at = now() where id = $2', [sha256(csrfToken), sessionId]);
  return csrfToken;
}

export async function revokeSession({ pool, session, config, ip }) {
  await pool.query('update administrator_sessions set revoked_at = now() where id = $1 and revoked_at is null', [session.sessionId]);
  await authEvent(pool, {
    administratorId: session.user.id,
    emailHash: keyedHash(session.user.email, config.sessionSecret),
    ipHash: keyedHash(ip || 'unknown', config.sessionSecret),
    eventType: 'logout'
  });
}

export function verifyCsrf(session, csrfToken) {
  return Boolean(csrfToken) && sha256(csrfToken) === session.csrfTokenHash;
}
