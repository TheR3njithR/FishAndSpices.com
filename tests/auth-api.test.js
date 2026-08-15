import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';

const config = loadConfig({ NODE_ENV: 'test', APP_ORIGIN: 'http://localhost:3000', SESSION_SECRET: 'auth-test-secret' });
const origin = 'http://localhost:3000';
const user = { id: '00000000-0000-4000-8000-000000000001', email: 'admin@example.com', displayName: 'Admin', role: 'super_admin' };
const pool = rows => ({ query: vi.fn().mockResolvedValue({ rowCount: rows?.length || 0, rows: rows || [] }) });

function app({ loginAdministrator, sessionRows = [] } = {}) {
  return createApp({
    config,
    pool: pool(sessionRows),
    services: { loginAdministrator }
  });
}

describe('administrator authentication', () => {
  it('sets a strict HTTP-only session cookie on successful login', async () => {
    const loginAdministrator = vi.fn().mockResolvedValue({ sessionToken: 'opaque-session-token', csrfToken: 'csrf-token', expiresAt: new Date(Date.now() + 3600000), user });
    const response = await request(app({ loginAdministrator })).post('/api/v1/auth/login').set('origin', origin).send({ email: user.email, password: 'not-returned' }).expect(200);
    expect(response.body).toMatchObject({ success: true, user, csrfToken: 'csrf-token' });
    expect(response.headers['set-cookie'][0]).toMatch(/fas_admin_session=.*HttpOnly.*SameSite=Strict/i);
    expect(response.body).not.toHaveProperty('sessionToken');
  });

  it('rejects failed login without exposing internals', async () => {
    const error = Object.assign(new Error('Invalid email or password.'), { status: 401 });
    const response = await request(app({ loginAdministrator: vi.fn().mockRejectedValue(error) })).post('/api/v1/auth/login').set('origin', origin).send({ email: user.email, password: 'wrong' }).expect(401);
    expect(response.body.error).toBe('Invalid email or password.');
    expect(response.body).not.toHaveProperty('stack');
  });

  it('returns retry guidance when login is rate limited', async () => {
    const error = Object.assign(new Error('Too many login attempts. Please wait and retry.'), { status: 429, retryAfterSeconds: 120 });
    const response = await request(app({ loginAdministrator: vi.fn().mockRejectedValue(error) })).post('/api/v1/auth/login').set('origin', origin).send({ email: user.email, password: 'wrong' }).expect(429);
    expect(response.headers['retry-after']).toBe('120');
  });

  it('rejects unauthenticated and expired sessions', async () => {
    await request(app()).get('/api/v1/admin/overview').expect(401);
    await request(app({ sessionRows: [] })).get('/api/v1/admin/overview').set('cookie', 'fas_admin_session=expired').expect(401);
  });

  it('enforces administrator roles for audit history', async () => {
    const reviewerSession = [{
      session_id: '00000000-0000-4000-8000-000000000002', csrf_token_hash: 'hash', expires_at: new Date(Date.now() + 3600000),
      id: user.id, email: user.email, display_name: user.displayName, role: 'reviewer'
    }];
    await request(app({ sessionRows: reviewerSession })).get('/api/v1/admin/audit').set('cookie', 'fas_admin_session=valid').expect(403);
  });
});
