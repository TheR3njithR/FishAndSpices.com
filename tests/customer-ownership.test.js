import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../server/app.js';

const config = {
  nodeEnv: 'test', isProduction: false, appOrigin: 'http://localhost', trustProxy: 1,
  sessionSecret: 'session-test-secret', otpSecret: 'otp-test-secret',
  customerSessionIdleHours: 8, customerSessionLifetimeDays: 14,
  turnstileDevBypass: false, turnstileSiteKey: '', businessWhatsappNumber: '', businessEmail: ''
};

function ownershipPool() {
  return {
    query: vi.fn(async (sql, params = []) => {
      if (sql.includes('from fas_customer_sessions')) return { rows: [{
        session_id: 'session-1', user_id: 'user-1', csrf_token_hash: 'unused',
        expires_at: new Date(Date.now() + 60_000), absolute_expires_at: new Date(Date.now() + 120_000),
        status: 'contact_verified', display_name: 'Buyer'
      }], rowCount: 1 };
      if (sql.startsWith('update fas_customer_sessions')) return { rows: [], rowCount: 1 };
      if (sql.includes('from fas_locations l') && sql.includes('join fas_user_locations')) return { rows: params[0] === 'user-1' ? [{
        id: 'location-1', location_type: 'delivery', location_source: 'user_entered', country_code: 'IN',
        country_name: 'India', region: 'Kerala', district: 'Ernakulam', city: 'Kochi', postal_code: '682001',
        address_line: null, port_name: null, latitude: null, longitude: null, accuracy_metres: null,
        user_confirmed: true, verification_status: 'user_confirmed', location_purpose: 'Saved commercial location', created_at: new Date()
      }] : [], rowCount: params[0] === 'user-1' ? 1 : 0 };
      if (sql.includes('from leads where customer_user_id = $1 and public_reference')) {
        if (params[0] === 'user-1' && params[1] === 'FAS-B-20260815-OWNED0001') return { rows: [{
          public_reference: params[1], lead_role: 'buyer', category: 'fish', product: 'Tuna',
          quantity: '100', unit: 'kg', verification_status: 'Pending', match_status: 'Not reviewed',
          follow_up_status: 'New', submitted_at: new Date()
        }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('from leads where customer_user_id = $1')) return { rows: [{
        public_reference: 'FAS-B-20260815-OWNED0001', lead_role: 'buyer', category: 'fish', product: 'Tuna',
        quantity: '100', unit: 'kg', verification_status: 'Pending', match_status: 'Not reviewed',
        follow_up_status: 'New', submitted_at: new Date()
      }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    })
  };
}

describe('customer-owned lead APIs', () => {
  it('rejects unauthenticated history access', async () => {
    await request(createApp({ config, pool: ownershipPool() })).get('/api/v1/me/leads').expect(401);
  });

  it('returns only leads selected by the authenticated user ID', async () => {
    const pool = ownershipPool();
    const response = await request(createApp({ config, pool })).get('/api/v1/me/leads')
      .set('Cookie', 'fas_customer_session=opaque-token').expect(200);
    expect(response.body.leads).toHaveLength(1);
    expect(response.body.leads[0]).toMatchObject({ reference: 'FAS-B-20260815-OWNED0001', status: 'Submitted' });
    expect(pool.query.mock.calls.some(([, params]) => params?.[0] === 'user-1')).toBe(true);
  });

  it('does not expose another user lead even when its public reference is known', async () => {
    await request(createApp({ config, pool: ownershipPool() }))
      .get('/api/v1/me/leads/FAS-S-20260815-OTHER001')
      .set('Cookie', 'fas_customer_session=opaque-token').expect(404);
  });

  it('requires CSRF for history claiming', async () => {
    await request(createApp({ config, pool: ownershipPool() }))
      .post('/api/v1/me/claim-history').set('Origin', config.appOrigin)
      .set('Cookie', 'fas_customer_session=opaque-token').send({}).expect(403);
  });

  it('rejects unauthenticated location access', async () => {
    await request(createApp({ config, pool: ownershipPool() })).get('/api/v1/me/locations').expect(401);
  });

  it('returns locations selected by the authenticated user ID only', async () => {
    const pool = ownershipPool();
    const response = await request(createApp({ config, pool })).get('/api/v1/me/locations')
      .set('Cookie', 'fas_customer_session=opaque-token').expect(200);
    expect(response.body.locations).toHaveLength(1);
    expect(response.body.locations[0]).toMatchObject({ id: 'location-1', countryCode: 'IN', city: 'Kochi' });
    const locationQuery = pool.query.mock.calls.find(([sql]) => sql.includes('from fas_locations l'));
    expect(locationQuery[1]).toEqual(['user-1']);
  });
});
