import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { sha256 } from '../server/security.js';

const config = loadConfig({ NODE_ENV: 'test', APP_ORIGIN: 'http://localhost:3000', SESSION_SECRET: 'rbac-test-secret' });
const origin = 'http://localhost:3000';
const leadId = '00000000-0000-4000-8000-0000000000aa';
const matchId = '00000000-0000-4000-8000-0000000000bb';
const csrfToken = 'csrf-token';

function session(role) {
  return [{
    session_id: '00000000-0000-4000-8000-000000000002', csrf_token_hash: sha256(csrfToken),
    expires_at: new Date(Date.now() + 3600000), id: '00000000-0000-4000-8000-000000000001',
    email: 'admin@example.com', display_name: 'Admin', role
  }];
}

function app(role) {
  return createApp({ config, pool: { query: vi.fn().mockResolvedValue({ rowCount: 1, rows: session(role) }) } });
}

const mutations = [
  ['patch', `/api/v1/admin/leads/${leadId}`, { verificationStatus: 'Verified' }],
  ['post', `/api/v1/admin/leads/${leadId}/interactions`, { direction: 'Outbound', contactMethod: 'Email', summary: 'Called' }],
  ['post', `/api/v1/admin/leads/${leadId}/verification`, {}],
  ['post', '/api/v1/admin/matches', { buyerLeadId: leadId, sellerLeadId: matchId, score: 80, explanation: 'Aligned' }],
  ['patch', `/api/v1/admin/matches/${matchId}`, { status: 'Reviewing' }],
  ['patch', `/api/v1/admin/location-risk-events/${matchId}`, { status: 'dismissed', notes: 'Reviewed' }]
];

describe('administrator role authorization', () => {
  it.each(mutations)('forbids a reviewer from %s %s', async (method, path) => {
    await request(app('reviewer'))[method](path)
      .set('origin', origin).set('cookie', 'fas_admin_session=valid').set('x-csrf-token', csrfToken)
      .send({}).expect(403);
  });

  it('allows a reviewer to read the overview', async () => {
    await request(app('reviewer')).get('/api/v1/admin/overview')
      .set('cookie', 'fas_admin_session=valid').expect(200);
  });
});

describe('administrator mutation validation', () => {
  const post = (path, body) => request(app('administrator')).post(path)
    .set('origin', origin).set('cookie', 'fas_admin_session=valid').set('x-csrf-token', csrfToken).send(body);
  const patch = (path, body) => request(app('administrator')).patch(path)
    .set('origin', origin).set('cookie', 'fas_admin_session=valid').set('x-csrf-token', csrfToken).send(body);

  it('rejects an unsupported contact method', async () => {
    await post(`/api/v1/admin/leads/${leadId}/interactions`, { direction: 'Outbound', contactMethod: 'Telepathy', summary: 'x' }).expect(422);
  });

  it('rejects an invalid verification status', async () => {
    await post(`/api/v1/admin/leads/${leadId}/verification`, { identityStatus: 'Maybe' }).expect(422);
  });

  it('rejects an out-of-range match score', async () => {
    await post('/api/v1/admin/matches', { buyerLeadId: leadId, sellerLeadId: matchId, score: 250, explanation: 'x' }).expect(422);
  });

  it('rejects a non-numeric match score', async () => {
    await post('/api/v1/admin/matches', { buyerLeadId: leadId, sellerLeadId: matchId, score: 'high', explanation: 'x' }).expect(422);
  });

  it('rejects an invalid match status transition value', async () => {
    await patch(`/api/v1/admin/matches/${matchId}`, { status: 'Teleported' }).expect(422);
  });

  it('rejects a non-boolean match consent', async () => {
    await patch(`/api/v1/admin/matches/${matchId}`, { buyerConsent: 'yes' }).expect(422);
  });

  it('rejects an unsupported match field', async () => {
    await patch(`/api/v1/admin/matches/${matchId}`, { secretFlag: true }).expect(422);
  });
});
