import { describe, expect, it, vi } from 'vitest';
import { createLead } from '../server/services/leads.js';
import { fishBuyer } from './lead-validation.test.js';

function transactionPool(failAtQuery) {
  let operation = 0;
  const query = vi.fn(async sql => {
    if (sql === 'begin' || sql === 'commit' || sql === 'rollback') return { rows: [], rowCount: 0 };
    operation += 1;
    if (operation === failAtQuery) throw new Error('simulated insert failure');
    if (/returning id/i.test(sql)) return { rows: [{ id: `00000000-0000-4000-8000-${String(operation).padStart(12, '0')}` }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
  const client = { query, release: vi.fn() };
  return { pool: { connect: vi.fn().mockResolvedValue(client), query: vi.fn().mockResolvedValue({ rows: [] }) }, client };
}

const config = {
  sessionSecret: 'transaction-test-secret', appOrigin: 'https://fishandspices.com',
  adminNotificationEmail: '', emailProvider: ''
};

describe('lead database transaction', () => {
  it('commits all related inserts together', async () => {
    const { pool, client } = transactionPool(999);
    const result = await createLead({ pool, data: fishBuyer, requestIp: '127.0.0.1', config });
    expect(result.reference).toMatch(/^FAS-B-\d{8}-[A-Z0-9]{8,10}$/);
    expect(client.query).toHaveBeenCalledWith('commit');
    expect(client.query).not.toHaveBeenCalledWith('rollback');
  });

  it('rolls back when any related insert fails', async () => {
    const { pool, client } = transactionPool(4);
    await expect(createLead({ pool, data: fishBuyer, requestIp: '127.0.0.1', config })).rejects.toThrow('simulated insert failure');
    expect(client.query).toHaveBeenCalledWith('rollback');
    expect(client.query).not.toHaveBeenCalledWith('commit');
  });

  it('rolls back when guest identity creation fails', async () => {
    const { pool, client } = transactionPool(3);
    await expect(createLead({ pool, data: fishBuyer, requestIp: '127.0.0.1', config })).rejects.toThrow('simulated insert failure');
    expect(client.query).toHaveBeenCalledWith('rollback');
  });

  it('rolls back guest identity and contact records when lead insertion fails', async () => {
    const query = vi.fn(async sql => {
      if (sql === 'begin' || sql === 'commit' || sql === 'rollback') return { rows: [], rowCount: 0 };
      if (/insert into leads/i.test(sql)) throw new Error('simulated lead insert failure');
      if (/select user_id from fas_user_identities/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/returning id/i.test(sql)) return { rows: [{ id: crypto.randomUUID() }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const client = { query, release: vi.fn() };
    const pool = { connect: vi.fn().mockResolvedValue(client), query: vi.fn().mockResolvedValue({ rows: [] }) };
    await expect(createLead({ pool, data: fishBuyer, requestIp: '127.0.0.1', config })).rejects.toThrow('simulated lead insert failure');
    expect(client.query).toHaveBeenCalledWith('rollback');
    expect(client.query).not.toHaveBeenCalledWith('commit');
  });

  it('commits guest identity, lead, consent and manual location together', async () => {
    const { pool, client } = transactionPool(999);
    await createLead({
      pool, requestIp: '127.0.0.1', config,
      data: { ...fishBuyer, location: {
        countryCode: 'IN', countryName: 'India', region: 'Kerala', district: 'Ernakulam', city: 'Kochi',
        postalCode: '682001', addressLine: null, portName: null, locationType: 'delivery',
        locationCollectionConsent: true, preciseLocationConsent: false, device: null, mapPin: null,
        consentTextVersion: 'location-v1-2026-08-15'
      } }
    });
    expect(client.query.mock.calls.some(([sql]) => sql.includes('insert into fas_locations'))).toBe(true);
    expect(client.query.mock.calls.some(([sql]) => sql.includes('insert into fas_lead_locations'))).toBe(true);
    expect(client.query).toHaveBeenCalledWith('commit');
  });

  it('rolls back the full guest transaction when location storage fails', async () => {
    const query = vi.fn(async sql => {
      if (sql === 'begin' || sql === 'commit' || sql === 'rollback') return { rows: [], rowCount: 0 };
      if (/insert into fas_locations/i.test(sql)) throw new Error('simulated location insert failure');
      if (/select user_id from fas_user_identities/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/returning id/i.test(sql)) return { rows: [{ id: crypto.randomUUID() }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const client = { query, release: vi.fn() };
    const pool = { connect: vi.fn().mockResolvedValue(client), query: vi.fn().mockResolvedValue({ rows: [] }) };
    await expect(createLead({
      pool, requestIp: '127.0.0.1', config,
      data: { ...fishBuyer, location: {
        countryCode: 'IN', countryName: 'India', region: 'Kerala', district: null, city: 'Kochi',
        postalCode: null, addressLine: null, portName: null, locationType: 'delivery',
        locationCollectionConsent: true, preciseLocationConsent: false, device: null, mapPin: null
      } }
    })).rejects.toThrow('simulated location insert failure');
    expect(client.query).toHaveBeenCalledWith('rollback');
    expect(client.query).not.toHaveBeenCalledWith('commit');
  });
});
