import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { DuplicateSubmissionError } from '../server/services/leads.js';
import { fishBuyer } from './lead-validation.test.js';

const config = loadConfig({ NODE_ENV: 'test', APP_ORIGIN: 'http://localhost:3000', SESSION_SECRET: 'test-session-secret' });
const pool = { query: vi.fn() };
const origin = 'http://localhost:3000';
const services = overrides => ({
  consumeRateLimit: vi.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 60 }),
  verifyTurnstile: vi.fn().mockResolvedValue(true),
  createLead: vi.fn().mockResolvedValue({ reference: 'FAS-B-20260815-ABCDEFGHIJ' }),
  ...overrides
});
const apiPayload = () => ({ ...fishBuyer, formStartedAt: Date.now() - 5_000 });

describe('POST /api/v1/leads', () => {
  it('returns only success and a public reference after insertion', async () => {
    const appServices = services();
    const response = await request(createApp({ config, pool, services: appServices })).post('/api/v1/leads').set('origin', origin).send(apiPayload()).expect(201);
    expect(response.body).toEqual({ success: true, reference: 'FAS-B-20260815-ABCDEFGHIJ' });
    expect(JSON.stringify(response.body)).not.toMatch(/internal|uuid|database|password/i);
  });

  it('rejects cross-origin and non-JSON requests', async () => {
    const app = createApp({ config, pool, services: services() });
    await request(app).post('/api/v1/leads').set('origin', 'https://attacker.invalid').send(apiPayload()).expect(403);
    await request(app).post('/api/v1/leads').set('origin', origin).type('form').send({ role: 'buyer' }).expect(415);
  });

  it('rejects Turnstile failure before insertion', async () => {
    const appServices = services({ verifyTurnstile: vi.fn().mockResolvedValue(false) });
    await request(createApp({ config, pool, services: appServices })).post('/api/v1/leads').set('origin', origin).send(apiPayload()).expect(422);
    expect(appServices.createLead).not.toHaveBeenCalled();
  });

  it('enforces database-backed rate limiting', async () => {
    const appServices = services({ consumeRateLimit: vi.fn().mockResolvedValue({ allowed: false, retryAfterSeconds: 30 }) });
    const response = await request(createApp({ config, pool, services: appServices })).post('/api/v1/leads').set('origin', origin).send(apiPayload()).expect(429);
    expect(response.headers['retry-after']).toBe('30');
  });

  it('rejects oversized JSON', async () => {
    const response = await request(createApp({ config, pool, services: services() })).post('/api/v1/leads').set('origin', origin).send({ ...apiPayload(), additionalNotes: 'x'.repeat(60_000) }).expect(413);
    expect(response.body).not.toHaveProperty('stack');
  });

  it('returns conflict for a duplicate submission', async () => {
    const appServices = services({ createLead: vi.fn().mockRejectedValue(new DuplicateSubmissionError()) });
    await request(createApp({ config, pool, services: appServices })).post('/api/v1/leads').set('origin', origin).send(apiPayload()).expect(409);
  });
});
