import { randomInt } from 'node:crypto';
import { withTransaction } from '../db.js';
import { keyedHash, randomToken, sha256 } from '../security.js';
import { maskIdentity, normalizeEmail, normalizeMobile } from './identity.js';
import { deliverOneTimeCode } from './otp-delivery.js';

const GENERIC_CHALLENGE_MESSAGE = 'If delivery is available for that contact, a one-time code has been sent.';

function normalizeDestination(type, value) {
  if (type === 'email') return normalizeEmail(value);
  if (type === 'mobile') return normalizeMobile(value);
  return null;
}

function authError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function authEvent(client, config, { userId = null, type = null, destination = null, ip = null, eventType }) {
  await client.query(`insert into fas_customer_authentication_events (
    user_id, identity_type, destination_hash, ip_hash, event_type
  ) values ($1,$2,$3,$4,$5)`, [
    userId, type, destination ? keyedHash(destination, config.otpSecret) : null,
    keyedHash(ip || 'unknown', config.sessionSecret), eventType
  ]);
}

async function consumeCustomerRateLimit(client, { scope, identifier, limit, windowMs, config, now }) {
  const identifierHash = keyedHash(identifier || 'unknown', config.otpSecret);
  const windowStartedAt = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const expiresAt = new Date(windowStartedAt.getTime() + windowMs * 2);
  const result = await client.query(`insert into fas_customer_auth_rate_limits (
    scope, identifier_hash, window_started_at, request_count, expires_at
  ) values ($1,$2,$3,1,$4)
  on conflict (scope, identifier_hash, window_started_at)
  do update set request_count = fas_customer_auth_rate_limits.request_count + 1
  returning request_count`, [scope, identifierHash, windowStartedAt, expiresAt]);
  return {
    allowed: result.rows[0].request_count <= limit,
    retryAfterSeconds: Math.max(1, Math.ceil((windowStartedAt.getTime() + windowMs - now.getTime()) / 1000))
  };
}

export async function requestChallenge({ pool, type, destination, purpose = 'sign_in', ip, config, fetcher, now = new Date() }) {
  const normalized = normalizeDestination(type, destination);
  if (!normalized) throw authError('Enter a valid mobile number or email address.', 422);
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const challengeId = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + config.otpLifetimeMinutes * 60_000);

  const stored = await withTransaction(pool, async client => {
    const limit = await consumeCustomerRateLimit(client, {
      scope: 'otp_request', identifier: `${ip}:${type}:${normalized}`,
      limit: 5, windowMs: 15 * 60_000, config, now
    });
    if (!limit.allowed) {
      await authEvent(client, config, { type, destination: normalized, ip, eventType: 'challenge_rate_limited' });
      const error = authError('Too many code requests. Please wait and retry.', 429);
      error.retryAfterSeconds = limit.retryAfterSeconds;
      throw error;
    }
    const recent = await client.query(`select created_at from fas_customer_authentication_challenges
      where identity_type = $1 and normalized_destination = $2 and purpose = $3
      order by created_at desc limit 1`, [type, normalized, purpose]);
    if (recent.rows.length && now.getTime() - new Date(recent.rows[0].created_at).getTime() < config.otpResendDelaySeconds * 1000) {
      const error = authError('Please wait before requesting another code.', 429);
      error.retryAfterSeconds = config.otpResendDelaySeconds;
      throw error;
    }
    await client.query(`update fas_customer_authentication_challenges set superseded_at = $1
      where identity_type = $2 and normalized_destination = $3 and purpose = $4
        and consumed_at is null and superseded_at is null`, [now, type, normalized, purpose]);
    await client.query(`insert into fas_customer_authentication_challenges (
      id, identity_type, normalized_destination, purpose, secret_hash, expires_at,
      maximum_attempts, requested_ip_hash, created_at
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
      challengeId, type, normalized, purpose, keyedHash(`${challengeId}:${code}`, config.otpSecret),
      expiresAt, config.otpMaximumAttempts, keyedHash(ip || 'unknown', config.sessionSecret), now
    ]);
    await authEvent(client, config, { type, destination: normalized, ip, eventType: 'challenge_requested' });
    return true;
  });

  if (!stored) throw authError('Unable to create a sign-in challenge.', 503);
  const delivery = await deliverOneTimeCode({ type, destination: normalized, code, config, fetcher });
  if (!delivery.delivered) {
    await authEvent(pool, config, { type, destination: normalized, ip, eventType: 'challenge_delivery_unavailable' });
  }
  return {
    success: true,
    challengeId,
    message: GENERIC_CHALLENGE_MESSAGE,
    maskedDestination: maskIdentity(type, normalized),
    deliveryAvailable: delivery.delivered,
    expiresAt,
    ...(delivery.testCode ? { testCode: delivery.testCode } : {})
  };
}

async function resolveVerifiedUser(client, { type, destination, displayName, now }) {
  const existing = await client.query(`select ui.id as identity_id, ui.user_id
    from fas_user_identities ui join fas_customer_users u on u.id = ui.user_id
    where ui.identity_type = $1 and ui.normalized_value = $2 and ui.verification_status = 'verified'
      and u.status not in ('restricted', 'suspended') limit 1`, [type, destination]);
  if (existing.rowCount) return existing.rows[0];

  const guest = await client.query(`select ui.id as identity_id, ui.user_id
    from fas_user_identities ui join fas_customer_users u on u.id = ui.user_id
    where ui.identity_type = $1 and ui.normalized_value = $2 and ui.verification_status = 'unverified'
      and u.status = 'guest' order by ui.created_at asc limit 1 for update`, [type, destination]);
  if (guest.rowCount) {
    await client.query(`update fas_user_identities set verification_status = 'verified', verified_at = $1, is_primary = true
      where id = $2`, [now, guest.rows[0].identity_id]);
    await client.query(`update fas_customer_users set status = 'contact_verified', last_successful_authentication_at = $1
      where id = $2`, [now, guest.rows[0].user_id]);
    return guest.rows[0];
  }

  const user = await client.query(`insert into fas_customer_users (
    status, display_name, preferred_contact_method, last_successful_authentication_at
  ) values ('contact_verified',$1,$2,$3) returning id`, [displayName || null, type, now]);
  const identity = await client.query(`insert into fas_user_identities (
    user_id, identity_type, normalized_value, masked_value, verification_status, verified_at, is_primary
  ) values ($1,$2,$3,$4,'verified',$5,true) returning id`, [
    user.rows[0].id, type, destination, maskIdentity(type, destination), now
  ]);
  return { user_id: user.rows[0].id, identity_id: identity.rows[0].id };
}

async function claimEligibleHistory(client, { userId, identityId, type, destination, now }) {
  const candidates = await client.query(`select distinct l.id, l.customer_user_id as user_id,
      exists(select 1 from fas_user_identities conflict
        where conflict.user_id = l.customer_user_id and conflict.verification_status = 'verified'
          and not (conflict.identity_type = $1 and conflict.normalized_value = $2)) as has_conflict
    from leads l join fas_user_identities ui on ui.user_id = l.customer_user_id
    where ui.identity_type = $1 and ui.normalized_value = $2 and l.customer_user_id <> $3`, [type, destination, userId]);
  let linked = 0;
  let review = 0;
  for (const lead of candidates.rows) {
    if (lead.has_conflict) {
      await client.query(`insert into fas_identity_claim_review_queue (claiming_user_id, identity_id, lead_id, reason)
        values ($1,$2,$3,'Conflicting verified identity on existing owner') on conflict do nothing`, [userId, identityId, lead.id]);
      await client.query(`insert into fas_identity_claim_audit (user_id, identity_id, lead_id, event_type, reason, linking_method, created_at)
        values ($1,$2,$3,'claim_review_requested','Conflicting verified identity','administrator_review',$4) on conflict do nothing`, [userId, identityId, lead.id, now]);
      review += 1;
      continue;
    }
    await client.query('update leads set customer_user_id = $1 where id = $2 and customer_user_id = $3', [userId, lead.id, lead.user_id]);
    await client.query(`insert into fas_identity_claim_audit (user_id, identity_id, lead_id, event_type, reason, linking_method, created_at)
      values ($1,$2,$3,'historical_record_linked','Matching verified normalized identity','verified_identity',$4) on conflict do nothing`, [userId, identityId, lead.id, now]);
    linked += 1;
  }
  return { linked, review };
}

export async function verifyChallenge({ pool, challengeId, code, ip, userAgent, config, now = new Date() }) {
  const outcome = await withTransaction(pool, async client => {
    const limit = await consumeCustomerRateLimit(client, {
      scope: 'otp_verify', identifier: `${ip}:${challengeId}`,
      limit: config.otpMaximumAttempts + 2, windowMs: 15 * 60_000, config, now
    });
    if (!limit.allowed) return { failure: ['Too many verification attempts. Please wait and retry.', 429] };

    const result = await client.query(`select * from fas_customer_authentication_challenges where id = $1 for update`, [challengeId]);
    const challenge = result.rows[0];
    if (!challenge || challenge.consumed_at || challenge.superseded_at) {
      await authEvent(client, config, { ip, eventType: 'verification_replayed' });
      return { failure: ['This code is invalid or no longer available.', 401] };
    }
    if (new Date(challenge.expires_at) <= now) return { failure: ['This code has expired. Request a new code.', 401] };
    if (challenge.attempt_count >= challenge.maximum_attempts) return { failure: ['Maximum verification attempts reached. Request a new code.', 429] };

    const valid = keyedHash(`${challenge.id}:${String(code || '')}`, config.otpSecret) === challenge.secret_hash;
    if (!valid) {
      await client.query('update fas_customer_authentication_challenges set attempt_count = attempt_count + 1 where id = $1', [challenge.id]);
      await authEvent(client, config, { type: challenge.identity_type, destination: challenge.normalized_destination, ip, eventType: challenge.attempt_count + 1 >= challenge.maximum_attempts ? 'verification_locked' : 'verification_failed' });
      return { failure: ['The code is incorrect or no longer available.', 401] };
    }

    await client.query('update fas_customer_authentication_challenges set consumed_at = $1 where id = $2', [now, challenge.id]);
    const identity = await resolveVerifiedUser(client, {
      type: challenge.identity_type, destination: challenge.normalized_destination, now
    });
    await client.query(`insert into fas_identity_claim_audit (
      user_id, identity_id, event_type, reason, linking_method, created_at
    ) values ($1,$2,'identity_verified','Successful one-time-code verification','verified_identity',$3)
    on conflict do nothing`, [identity.user_id, identity.identity_id, now]);
    const claims = await claimEligibleHistory(client, {
      userId: identity.user_id, identityId: identity.identity_id,
      type: challenge.identity_type, destination: challenge.normalized_destination, now
    });
    const sessionToken = randomToken(32);
    const csrfToken = randomToken(24);
    const expiresAt = new Date(now.getTime() + config.customerSessionIdleHours * 60 * 60_000);
    const absoluteExpiresAt = new Date(now.getTime() + config.customerSessionLifetimeDays * 24 * 60 * 60_000);
    const session = await client.query(`insert into fas_customer_sessions (
      user_id, token_hash, csrf_token_hash, expires_at, absolute_expires_at, ip_hash, user_agent_hash
    ) values ($1,$2,$3,$4,$5,$6,$7) returning id`, [
      identity.user_id, sha256(sessionToken), sha256(csrfToken), expiresAt, absoluteExpiresAt,
      keyedHash(ip || 'unknown', config.sessionSecret), keyedHash(userAgent || '', config.sessionSecret)
    ]);
    await authEvent(client, config, { userId: identity.user_id, type: challenge.identity_type, destination: challenge.normalized_destination, ip, eventType: 'verification_succeeded' });
    return { result: { sessionId: session.rows[0].id, sessionToken, csrfToken, expiresAt, absoluteExpiresAt, userId: identity.user_id, claims } };
  });
  if (outcome.failure) throw authError(...outcome.failure);
  return outcome.result;
}

export async function resolveCustomerSession({ pool, sessionToken, config, now = new Date() }) {
  if (!sessionToken) return null;
  const result = await pool.query(`select s.id as session_id, s.user_id, s.csrf_token_hash,
      s.expires_at, s.absolute_expires_at, u.status, u.display_name
    from fas_customer_sessions s join fas_customer_users u on u.id = s.user_id
    where s.token_hash = $1 and s.revoked_at is null and s.expires_at > $2
      and s.absolute_expires_at > $2 and u.status not in ('restricted', 'suspended') limit 1`, [sha256(sessionToken), now]);
  if (!result.rowCount) return null;
  const row = result.rows[0];
  const nextIdleExpiry = new Date(Math.min(
    now.getTime() + config.customerSessionIdleHours * 60 * 60_000,
    new Date(row.absolute_expires_at).getTime()
  ));
  await pool.query('update fas_customer_sessions set last_used_at = $1, expires_at = $2 where id = $3', [now, nextIdleExpiry, row.session_id]);
  return { sessionId: row.session_id, userId: row.user_id, csrfTokenHash: row.csrf_token_hash, expiresAt: nextIdleExpiry, absoluteExpiresAt: row.absolute_expires_at, status: row.status, displayName: row.display_name };
}

export async function rotateCustomerCsrf(pool, sessionId) {
  const csrfToken = randomToken(24);
  await pool.query('update fas_customer_sessions set csrf_token_hash = $1 where id = $2', [sha256(csrfToken), sessionId]);
  return csrfToken;
}

export async function revokeCustomerSession(pool, sessionId) {
  await pool.query('update fas_customer_sessions set revoked_at = now() where id = $1 and revoked_at is null', [sessionId]);
}

export async function revokeCustomerSessionToken(pool, sessionToken) {
  if (!sessionToken) return;
  await pool.query('update fas_customer_sessions set revoked_at = now() where token_hash = $1 and revoked_at is null', [sha256(sessionToken)]);
}

export function verifyCustomerCsrf(session, token) {
  return Boolean(token) && sha256(token) === session.csrfTokenHash;
}

export async function claimHistory({ pool, session, config, now = new Date() }) {
  return withTransaction(pool, async client => {
    const identity = await client.query(`select id, identity_type, normalized_value from fas_user_identities
      where user_id = $1 and verification_status = 'verified' order by is_primary desc, verified_at asc limit 1`, [session.userId]);
    if (!identity.rowCount) throw authError('A verified contact is required.', 403);
    const row = identity.rows[0];
    return claimEligibleHistory(client, { userId: session.userId, identityId: row.id, type: row.identity_type, destination: row.normalized_value, now });
  });
}
