import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { sha256 } from '../server/security.js';

const config = loadConfig({ NODE_ENV: 'test', APP_ORIGIN: 'http://localhost:3000', SESSION_SECRET: 'marketplace-account-secret' });
const origin = 'http://localhost:3000';
const csrfToken = 'customer-csrf-token';

function sessionPool() {
  return {
    query: vi.fn(async sql => {
      if (sql.includes('from fas_customer_sessions')) {
        return {
          rowCount: 1,
          rows: [{
            session_id: 'session-1',
            user_id: 'user-1',
            csrf_token_hash: sha256(csrfToken),
            expires_at: new Date(Date.now() + 60_000),
            absolute_expires_at: new Date(Date.now() + 120_000),
            status: 'contact_verified',
            display_name: 'Customer'
          }]
        };
      }
      if (sql.startsWith('update fas_customer_sessions set last_used_at')) return { rowCount: 1, rows: [] };
      return { rowCount: 0, rows: [] };
    })
  };
}

function createServices(overrides = {}) {
  return {
    createContactRequest: vi.fn().mockResolvedValue({ id: 'contact-1', status: 'PENDING' }),
    createQuote: vi.fn().mockResolvedValue({ id: 'quote-1', status: 'SUBMITTED' }),
    saveMarketplaceItem: vi.fn().mockResolvedValue({ saved: true, leadId: '00000000-0000-4000-8000-000000000010' }),
    removeMarketplaceItem: vi.fn().mockResolvedValue({ removed: true, leadId: '00000000-0000-4000-8000-000000000010' }),
    getMarketplaceDashboard: vi.fn().mockResolvedValue({ summary: { totalListings: 0 }, myListings: [], savedItems: [], contactRequests: [], quotesSent: [], quotesReceived: [] }),
    ...overrides
  };
}

describe('authenticated marketplace account APIs', () => {
  it('rejects unauthenticated access', async () => {
    const app = createApp({ config, pool: sessionPool(), services: createServices() });
    await request(app).get('/api/v1/account/dashboard').expect(401);
    await request(app).post('/api/v1/contact-requests').set('origin', origin).send({}).expect(401);
  });

  it('requires CSRF for marketplace mutations', async () => {
    const app = createApp({ config, pool: sessionPool(), services: createServices() });
    await request(app)
      .post('/api/v1/saved-items')
      .set('origin', origin)
      .set('cookie', 'fas_customer_session=valid')
      .send({ leadId: '00000000-0000-4000-8000-000000000010' })
      .expect(403);
  });

  it('creates contact requests and quotes through service handlers', async () => {
    const services = createServices();
    const pool = sessionPool();
    const app = createApp({ config, pool, services });

    await request(app)
      .post('/api/v1/contact-requests')
      .set('origin', origin)
      .set('cookie', 'fas_customer_session=valid')
      .set('x-csrf-token', csrfToken)
      .send({ targetLeadId: '00000000-0000-4000-8000-000000000011', message: 'Please share details' })
      .expect(201);

    expect(services.createContactRequest).toHaveBeenCalledWith(pool, {
      userId: 'user-1',
      targetLeadId: '00000000-0000-4000-8000-000000000011',
      message: 'Please share details'
    });

    await request(app)
      .post('/api/v1/quotes')
      .set('origin', origin)
      .set('cookie', 'fas_customer_session=valid')
      .set('x-csrf-token', csrfToken)
      .send({ requirementLeadId: '00000000-0000-4000-8000-000000000012', quantity: 100, unit: 'kg' })
      .expect(201);

    expect(services.createQuote).toHaveBeenCalledWith(pool, expect.objectContaining({
      userId: 'user-1',
      requirementLeadId: '00000000-0000-4000-8000-000000000012',
      quantity: 100,
      unit: 'kg'
    }));
  });

  it('saves and removes saved items through service handlers', async () => {
    const services = createServices();
    const pool = sessionPool();
    const app = createApp({ config, pool, services });

    await request(app)
      .post('/api/v1/saved-items')
      .set('origin', origin)
      .set('cookie', 'fas_customer_session=valid')
      .set('x-csrf-token', csrfToken)
      .send({ leadId: '00000000-0000-4000-8000-000000000010' })
      .expect(201);

    await request(app)
      .delete('/api/v1/saved-items/00000000-0000-4000-8000-000000000010')
      .set('origin', origin)
      .set('cookie', 'fas_customer_session=valid')
      .set('x-csrf-token', csrfToken)
      .expect(200);

    expect(services.saveMarketplaceItem).toHaveBeenCalledWith(pool, {
      userId: 'user-1',
      leadId: '00000000-0000-4000-8000-000000000010'
    });
    expect(services.removeMarketplaceItem).toHaveBeenCalledWith(pool, {
      userId: 'user-1',
      leadId: '00000000-0000-4000-8000-000000000010'
    });
  });

  it('returns account dashboard payload', async () => {
    const services = createServices();
    const pool = sessionPool();
    const app = createApp({ config, pool, services });

    const response = await request(app)
      .get('/api/v1/account/dashboard')
      .set('cookie', 'fas_customer_session=valid')
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(services.getMarketplaceDashboard).toHaveBeenCalledWith(pool, { userId: 'user-1' });
  });
});
