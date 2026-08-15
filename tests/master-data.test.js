import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { sha256 } from '../server/security.js';

const config = loadConfig({ NODE_ENV: 'test', APP_ORIGIN: 'http://localhost:3000', SESSION_SECRET: 'master-test-secret' });
const origin = 'http://localhost:3000';
const csrfToken = 'csrf-token';
const optionId = '00000000-0000-4000-8000-0000000000cc';

function session(role) {
  return {
    session_id: '00000000-0000-4000-8000-000000000002', csrf_token_hash: sha256(csrfToken),
    expires_at: new Date(Date.now() + 3600000), id: '00000000-0000-4000-8000-000000000001',
    email: 'admin@example.com', display_name: 'Admin', role
  };
}

function makePool({ role, optionsRows = [], insertRow, updateRow } = {}) {
  return {
    query: vi.fn(async sql => {
      if (/from administrator_sessions/i.test(sql)) return { rowCount: role ? 1 : 0, rows: role ? [session(role)] : [] };
      if (/insert into fas_master_options/i.test(sql)) return { rowCount: 1, rows: [insertRow] };
      if (/update fas_master_options/i.test(sql)) return { rowCount: updateRow ? 1 : 0, rows: updateRow ? [updateRow] : [] };
      if (/from fas_master_options/i.test(sql)) return { rowCount: optionsRows.length, rows: optionsRows };
      if (/insert into audit_log/i.test(sql)) return { rowCount: 1, rows: [] };
      return { rowCount: 0, rows: [] };
    })
  };
}

const cookie = 'fas_admin_session=valid';
const authed = (app, method, path) => request(app)[method](path)
  .set('origin', origin).set('cookie', cookie).set('x-csrf-token', csrfToken);

describe('public options endpoint', () => {
  it('returns active options grouped by set', async () => {
    const app = createApp({ config, pool: makePool({ optionsRows: [
      { set_key: 'countries', value: 'IN', label: 'India' },
      { set_key: 'incoterms', value: 'FOB', label: 'FOB' }
    ] }) });
    const response = await request(app).get('/api/v1/options').expect(200);
    expect(response.body.options.countries).toEqual([{ value: 'IN', label: 'India' }]);
    expect(response.body.options.incoterms).toEqual([{ value: 'FOB', label: 'FOB' }]);
  });
});

describe('admin master-data authorization', () => {
  it('requires authentication to read options', async () => {
    await request(createApp({ config, pool: makePool({}) })).get('/api/v1/admin/options').expect(401);
  });

  it('forbids a reviewer from creating an option', async () => {
    await authed(createApp({ config, pool: makePool({ role: 'reviewer' }) }), 'post', '/api/v1/admin/options')
      .send({ setKey: 'incoterms', value: 'DDU', label: 'DDU' }).expect(403);
  });

  it('forbids a reviewer from updating an option', async () => {
    await authed(createApp({ config, pool: makePool({ role: 'reviewer' }) }), 'patch', `/api/v1/admin/options/${optionId}`)
      .send({ isActive: false }).expect(403);
  });
});

describe('admin master-data validation', () => {
  it('rejects an unknown option set', async () => {
    await authed(createApp({ config, pool: makePool({ role: 'administrator' }) }), 'post', '/api/v1/admin/options')
      .send({ setKey: 'colours', value: 'red', label: 'Red' }).expect(422);
  });

  it('rejects an invalid ISO country code', async () => {
    await authed(createApp({ config, pool: makePool({ role: 'administrator' }) }), 'post', '/api/v1/admin/options')
      .send({ setKey: 'countries', value: 'ZZ', label: 'Nowhere' }).expect(422);
  });

  it('creates a valid option', async () => {
    const insertRow = { id: optionId, set_key: 'incoterms', value: 'DDU', label: 'DDU', sort_order: 8, is_active: true };
    const response = await authed(createApp({ config, pool: makePool({ role: 'administrator', insertRow }) }), 'post', '/api/v1/admin/options')
      .send({ setKey: 'incoterms', value: 'DDU', label: 'DDU', sortOrder: 8 }).expect(201);
    expect(response.body.option).toMatchObject({ value: 'DDU', label: 'DDU', isActive: true });
  });

  it('deactivates an option', async () => {
    const updateRow = { id: optionId, set_key: 'countries', value: 'US', label: 'United States', sort_order: 2, is_active: false };
    const response = await authed(createApp({ config, pool: makePool({ role: 'administrator', updateRow }) }), 'patch', `/api/v1/admin/options/${optionId}`)
      .send({ isActive: false }).expect(200);
    expect(response.body.option.isActive).toBe(false);
  });
});
