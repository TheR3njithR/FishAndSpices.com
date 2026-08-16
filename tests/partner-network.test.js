import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { keyedHash } from '../server/security.js';
import { captureReferralAttribution, emitPartnerEvent } from '../server/services/partner-network.js';

const config = loadConfig({
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://localhost:3000',
  SESSION_SECRET: 'partner-network-test-secret',
  PARTNER_NETWORK_ENABLED: 'true'
});

describe('partner attribution capture', () => {
  it('preserves first valid attribution when a new referral arrives', async () => {
    let attributionInserts = 0;

    const pool = {
      query: vi.fn(async (sql, params) => {
        if (sql.includes('insert into rate_limit_buckets')) return { rowCount: 1, rows: [{ request_count: 1 }] };
        if (sql.includes('select setting_key as key')) return { rowCount: 1, rows: [{ key: 'referral_cookie_days', value: '30' }] };
        if (sql.includes('from fas_partner_referral_attributions a')) {
          const tokenHash = params[0];
          if (tokenHash === keyedHash('existing-token', config.sessionSecret)) {
            return {
              rowCount: 1,
              rows: [{
                id: '00000000-0000-4000-8000-000000000111',
                partner_id: '00000000-0000-4000-8000-000000000101',
                referral_code: 'OLDCODE',
                expires_at: new Date(Date.now() + 86_400_000),
                partner_status: 'ACTIVE'
              }]
            };
          }
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('from fas_partners') && sql.includes('partner_code = $1')) {
          return {
            rowCount: 1,
            rows: [{
              id: '00000000-0000-4000-8000-000000000102',
              partnerCode: 'NEWCODE',
              partnerType: 'INFLUENCER',
              status: 'ACTIVE',
              commissionPlanId: null,
              userId: null,
              email: 'new@example.com',
              phone: '+910000000000'
            }]
          };
        }
        if (sql.includes('insert into fas_partner_referral_clicks')) return { rowCount: 1, rows: [] };
        if (sql.includes('insert into fas_partner_referral_attributions')) {
          attributionInserts += 1;
          return { rowCount: 1, rows: [] };
        }
        return { rowCount: 0, rows: [] };
      })
    };

    const fakeRequest = {
      query: { ref: 'NEWCODE' },
      cookies: { [config.isProduction ? '__Host-fas_partner_ref' : 'fas_partner_ref']: 'existing-token' },
      originalUrl: '/partners?ref=NEWCODE',
      url: '/partners?ref=NEWCODE',
      path: '/partners',
      hostname: 'fishandspices.com',
      ip: '127.0.0.1',
      get: header => {
        const normalized = String(header || '').toLowerCase();
        if (normalized === 'user-agent') return 'Vitest';
        if (normalized === 'referer') return 'https://example.com/post';
        return undefined;
      }
    };

    const outcome = await captureReferralAttribution({ pool, request: fakeRequest, config });
    expect(outcome.captured).toBe(false);
    expect(outcome.preserved).toBe(true);
    expect(outcome.partnerCode).toBe('OLDCODE');
    expect(outcome.incomingCode).toBe('NEWCODE');
    expect(attributionInserts).toBe(0);
  });
});

describe('partner commission idempotency', () => {
  it('creates only one commission for duplicate event dedupe key submissions', async () => {
    const state = {
      eventsByDedupe: new Map(),
      commissionsByEvent: new Set()
    };

    const pool = {
      query: vi.fn(async (sql, params = []) => {
        if (sql.includes('select r.id as "referralId", r.partner_id as "partnerId"')) {
          return {
            rowCount: 1,
            rows: [{
              referralId: '00000000-0000-4000-8000-000000000201',
              partnerId: '00000000-0000-4000-8000-000000000202',
              partnerStatus: 'ACTIVE'
            }]
          };
        }

        if (sql.includes('insert into fas_partner_events')) {
          const dedupeKey = params[9];
          if (state.eventsByDedupe.has(dedupeKey)) return { rowCount: 0, rows: [] };
          const eventId = `event-${state.eventsByDedupe.size + 1}`;
          state.eventsByDedupe.set(dedupeKey, eventId);
          return { rowCount: 1, rows: [{ id: eventId }] };
        }

        if (sql.includes('select id, status, partner_type as "partnerType"')) {
          return {
            rowCount: 1,
            rows: [{
              id: '00000000-0000-4000-8000-000000000202',
              status: 'ACTIVE',
              partnerType: 'INFLUENCER',
              commissionPlanId: '00000000-0000-4000-8000-000000000203'
            }]
          };
        }

        if (sql.includes('from fas_partner_commission_rules')) {
          return {
            rowCount: 1,
            rows: [{
              id: '00000000-0000-4000-8000-000000000204',
              amount: 100,
              currency: 'INR',
              requires_admin_approval: false,
              cooling_period_days: 0,
              maximum_per_user: null,
              maximum_per_month: null
            }]
          };
        }

        if (sql.includes('insert into fas_partner_commissions')) {
          const eventId = params[2];
          if (state.commissionsByEvent.has(eventId)) return { rowCount: 0, rows: [] };
          state.commissionsByEvent.add(eventId);
          return { rowCount: 1, rows: [{ id: `commission-${eventId}` }] };
        }

        if (sql.includes('update fas_partner_events')) return { rowCount: 1, rows: [] };
        if (sql.includes('from fas_user_identities')) return { rowCount: 0, rows: [] };
        return { rowCount: 0, rows: [] };
      })
    };

    const first = await emitPartnerEvent({
      pool,
      config,
      userId: '00000000-0000-4000-8000-000000000299',
      eventType: 'QUOTE_SUBMITTED',
      entityType: 'quote',
      entityId: 'quote-1',
      dedupeKey: 'same-event-key'
    });

    const second = await emitPartnerEvent({
      pool,
      config,
      userId: '00000000-0000-4000-8000-000000000299',
      eventType: 'QUOTE_SUBMITTED',
      entityType: 'quote',
      entityId: 'quote-1',
      dedupeKey: 'same-event-key'
    });

    expect(first.recorded).toBe(true);
    expect(second.duplicate).toBe(true);
    expect(state.eventsByDedupe.size).toBe(1);
    expect(state.commissionsByEvent.size).toBe(1);
  });
});

describe('partner auth boundaries', () => {
  it('enforces admin and customer authentication on partner APIs', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rowCount: 0, rows: [] }) };
    const app = createApp({ config, pool, services: {} });

    await request(app).get('/api/v1/admin/partners/overview').expect(401);
    await request(app).get('/api/v1/partner/dashboard').expect(401);
  });
});
