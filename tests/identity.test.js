import { describe, expect, it, vi } from 'vitest';
import { createGuestIdentity, normalizeEmail, normalizeMobile } from '../server/services/identity.js';

const lead = {
  fullName: 'Test Buyer', phone: '9876543210', businessEmail: 'BUYER@Example.com',
  country: 'India'
};

describe('guest identity association', () => {
  it('normalizes email and Indian mobile values', () => {
    expect(normalizeEmail(' BUYER@Example.com ')).toBe('buyer@example.com');
    expect(normalizeMobile('9876543210', 'IN')).toBe('+919876543210');
  });

  it('associates one unambiguous verified owner without authenticating the browser', async () => {
    const client = { query: vi.fn().mockResolvedValueOnce({ rows: [{ user_id: 'verified-user' }], rowCount: 1 }) };
    await expect(createGuestIdentity(client, lead)).resolves.toEqual({ userId: 'verified-user', associatedBy: 'verified_identity' });
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it('creates a separate guest when supplied verified identities conflict', async () => {
    const client = { query: vi.fn(async sql => {
      if (sql.includes('select distinct user_id')) return { rows: [{ user_id: 'user-a' }, { user_id: 'user-b' }], rowCount: 2 };
      if (sql.includes('insert into fas_customer_users')) return { rows: [{ id: 'new-guest' }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    }) };
    const result = await createGuestIdentity(client, lead);
    expect(result).toEqual({ userId: 'new-guest', associatedBy: 'new_guest' });
    expect(client.query.mock.calls.filter(([sql]) => sql.includes('insert into fas_user_identities'))).toHaveLength(2);
  });
});
