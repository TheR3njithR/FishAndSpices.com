import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';

const config = loadConfig({ NODE_ENV: 'test', APP_ORIGIN: 'http://localhost:3000', PORT: '3000' });

describe('health endpoint', () => {
  it('reports the application without exposing infrastructure secrets', async () => {
    const response = await request(createApp({ config, pool: null })).get('/api/health').expect(200);
    expect(response.body).toEqual({ status: 'degraded', application: 'available', database: 'not_configured' });
    expect(JSON.stringify(response.body)).not.toMatch(/url|password|secret/i);
  });

  it('serves the existing homepage through Express', async () => {
    const response = await request(createApp({ config, pool: null })).get('/').expect(200);
    expect(response.text).toContain('Fish <span>&amp;</span> Spices');
  });
});
