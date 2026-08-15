import { describe, expect, it, vi } from 'vitest';
import { requestChallenge, resolveCustomerSession, revokeCustomerSessionToken, verifyChallenge } from '../server/services/customer-auth.js';
import { deliverOneTimeCode } from '../server/services/otp-delivery.js';
import { keyedHash } from '../server/security.js';

const now = new Date('2026-08-15T12:00:00.000Z');
const config = {
  isProduction: false,
  otpProvider: 'development',
  otpSecret: 'otp-test-secret',
  sessionSecret: 'session-test-secret',
  otpLifetimeMinutes: 10,
  otpMaximumAttempts: 5,
  otpResendDelaySeconds: 60,
  customerSessionIdleHours: 8,
  customerSessionLifetimeDays: 14,
  emailProvider: '', resendApiKey: '', emailFrom: ''
};

function transactionalPool(handler) {
  const query = vi.fn(async (sql, params) => {
    if (sql === 'begin' || sql === 'commit' || sql === 'rollback') return { rows: [], rowCount: 0 };
    return handler(sql, params);
  });
  const client = { query, release: vi.fn() };
  return { pool: { connect: vi.fn().mockResolvedValue(client), query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) }, client };
}

function challenge(overrides = {}) {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    identity_type: 'email', normalized_destination: 'buyer@example.com', purpose: 'sign_in',
    secret_hash: 'not-the-submitted-code', expires_at: new Date(now.getTime() + 60_000),
    attempt_count: 0, maximum_attempts: 5, consumed_at: null, superseded_at: null,
    ...overrides
  };
}

function verifyPool(storedChallenge) {
  return transactionalPool((sql) => {
    if (sql.includes('insert into fas_customer_auth_rate_limits')) return { rows: [{ request_count: 1 }], rowCount: 1 };
    if (sql.includes('from fas_customer_authentication_challenges where id')) return { rows: storedChallenge ? [storedChallenge] : [], rowCount: storedChallenge ? 1 : 0 };
    return { rows: [], rowCount: 1 };
  });
}

describe('customer one-time authentication', () => {
  it('generates and stores only a hashed OTP', async () => {
    let storedHash;
    const { pool } = transactionalPool((sql, params) => {
      if (sql.includes('insert into fas_customer_auth_rate_limits')) return { rows: [{ request_count: 1 }], rowCount: 1 };
      if (sql.includes('select created_at from fas_customer_authentication_challenges')) return { rows: [], rowCount: 0 };
      if (sql.includes('insert into fas_customer_authentication_challenges')) storedHash = params[4];
      return { rows: [], rowCount: 1 };
    });
    const result = await requestChallenge({ pool, type: 'email', destination: 'Buyer@Example.com', ip: '127.0.0.1', config, now });
    expect(result.testCode).toMatch(/^\d{6}$/);
    expect(storedHash).toMatch(/^[a-f0-9]{64}$/);
    expect(storedHash).not.toBe(result.testCode);
    expect(result.maskedDestination).not.toBe('buyer@example.com');
  });

  it('commits incorrect attempts so brute-force limits cannot be bypassed', async () => {
    const { pool, client } = verifyPool(challenge());
    await expect(verifyChallenge({ pool, challengeId: challenge().id, code: '123456', ip: '127.0.0.1', userAgent: 'test', config, now })).rejects.toThrow(/incorrect/);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('attempt_count = attempt_count + 1'), [challenge().id]);
    expect(client.query).toHaveBeenCalledWith('commit');
    expect(client.query).not.toHaveBeenCalledWith('rollback');
  });

  it('rejects expired, exhausted, and replayed challenges', async () => {
    const expired = verifyPool(challenge({ expires_at: new Date(now.getTime() - 1) }));
    await expect(verifyChallenge({ pool: expired.pool, challengeId: challenge().id, code: '123456', config, now })).rejects.toThrow(/expired/);
    const exhausted = verifyPool(challenge({ attempt_count: 5 }));
    await expect(verifyChallenge({ pool: exhausted.pool, challengeId: challenge().id, code: '123456', config, now })).rejects.toThrow(/Maximum/);
    const replayed = verifyPool(challenge({ consumed_at: now }));
    await expect(verifyChallenge({ pool: replayed.pool, challengeId: challenge().id, code: '123456', config, now })).rejects.toThrow(/no longer available/);
  });

  it('authenticates once and links only unambiguous matching history', async () => {
    const code = '482901';
    const stored = challenge({ secret_hash: keyedHash(`${challenge().id}:${code}`, config.otpSecret) });
    const { pool, client } = transactionalPool((sql) => {
      if (sql.includes('insert into fas_customer_auth_rate_limits')) return { rows: [{ request_count: 1 }], rowCount: 1 };
      if (sql.includes('from fas_customer_authentication_challenges where id')) return { rows: [stored], rowCount: 1 };
      if (sql.includes('from fas_user_identities ui join fas_customer_users') && sql.includes("verification_status = 'verified'")) {
        return { rows: [{ identity_id: 'identity-1', user_id: 'user-1' }], rowCount: 1 };
      }
      if (sql.includes('select distinct l.id')) return { rows: [
        { id: 'lead-safe', user_id: 'guest-1', has_conflict: false },
        { id: 'lead-ambiguous', user_id: 'guest-2', has_conflict: true }
      ], rowCount: 2 };
      if (sql.includes('insert into fas_customer_sessions')) return { rows: [{ id: 'session-1' }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const result = await verifyChallenge({ pool, challengeId: stored.id, code, ip: '127.0.0.1', userAgent: 'test', config, now });
    expect(result.sessionToken).toBeTruthy();
    expect(result.csrfToken).toBeTruthy();
    expect(result.claims).toEqual({ linked: 1, review: 1 });
    expect(client.query).toHaveBeenCalledWith('update leads set customer_user_id = $1 where id = $2 and customer_user_id = $3', ['user-1', 'lead-safe', 'guest-1']);
    expect(client.query.mock.calls.some(([sql]) => sql.includes('fas_identity_claim_review_queue'))).toBe(true);
  });

  it('enforces resend delay without replacing the active challenge', async () => {
    const { pool, client } = transactionalPool((sql) => {
      if (sql.includes('insert into fas_customer_auth_rate_limits')) return { rows: [{ request_count: 1 }], rowCount: 1 };
      if (sql.includes('select created_at from fas_customer_authentication_challenges')) return { rows: [{ created_at: new Date(now.getTime() - 10_000) }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    await expect(requestChallenge({ pool, type: 'mobile', destination: '+919876543210', ip: '127.0.0.1', config, now })).rejects.toThrow(/wait/);
    expect(client.query.mock.calls.some(([sql]) => sql.includes('insert into fas_customer_authentication_challenges'))).toBe(false);
  });

  it('never permits the development delivery adapter in production', async () => {
    await expect(deliverOneTimeCode({ type: 'email', destination: 'buyer@example.com', code: '123456', config: { ...config, isProduction: true } })).rejects.toThrow(/cannot run/);
  });

  it('rejects expired sessions and revokes prior tokens during rotation', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await expect(resolveCustomerSession({ pool, sessionToken: 'expired-token', config, now })).resolves.toBeNull();
    await revokeCustomerSessionToken(pool, 'old-token');
    expect(pool.query).toHaveBeenLastCalledWith(expect.stringContaining('revoked_at = now()'), [expect.stringMatching(/^[a-f0-9]{64}$/)]);
  });
});
