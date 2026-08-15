import { describe, expect, it, vi } from 'vitest';
import { coarseLocationForAnalytics, correctCustomerLocation, deriveApproximateLocation, storeLeadLocations } from '../server/services/location.js';

const requestWith = headers => ({ get: name => headers[name.toLowerCase()] });
const config = { approximateLocationProvider: 'signed_proxy', locationProxySecret: 'trusted-secret' };

describe('privacy-conscious location service', () => {
  it('accepts coarse country data only from the configured signed proxy', () => {
    const detectedAt = new Date('2026-08-15T12:00:00Z');
    expect(deriveApproximateLocation(requestWith({
      'x-fas-location-proxy-token': 'trusted-secret', 'x-fas-country-code': 'IN',
      'x-fas-country-name': 'India', 'x-fas-region': 'Kerala', 'x-fas-city': 'Kochi'
    }), config, detectedAt)).toEqual({
      countryCode: 'IN', countryName: 'India', region: 'Kerala', city: 'Kochi', timeZone: null,
      source: 'ip_approximate', detectedAt
    });
  });

  it('rejects spoofed, unsigned, disabled, and invalid location headers', () => {
    expect(deriveApproximateLocation(requestWith({ 'cf-ipcountry': 'IN', 'x-fas-country-code': 'IN' }), config)).toBeNull();
    expect(deriveApproximateLocation(requestWith({ 'x-fas-location-proxy-token': 'wrong', 'x-fas-country-code': 'IN' }), config)).toBeNull();
    expect(deriveApproximateLocation(requestWith({ 'x-fas-location-proxy-token': 'trusted-secret', 'x-fas-country-code': 'XX' }), config)).toBeNull();
    expect(deriveApproximateLocation(requestWith({ 'x-fas-location-proxy-token': 'trusted-secret', 'x-fas-country-code': 'IN' }), { ...config, approximateLocationProvider: '' })).toBeNull();
  });

  it('keeps analytics coarse and excludes precise coordinates', () => {
    expect(coarseLocationForAnalytics({ countryCode: 'IN', region: 'Kerala', city: 'Kochi', latitude: 9.9, longitude: 76.2 })).toEqual({
      countryCode: 'IN', region: 'Kerala', city: 'Kochi'
    });
  });

  it('stores map pins as unverified and creates a review-only mismatch signal', async () => {
    let sequence = 0;
    const client = { query: vi.fn(async sql => {
      if (/returning id/i.test(sql)) return { rows: [{ id: `location-${++sequence}` }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    }) };
    await storeLeadLocations(client, {
      role: 'buyer', userId: 'user-1', organisationId: 'org-1', leadId: 'lead-1', consentRecordId: 'consent-1',
      location: {
        countryCode: 'IN', countryName: 'India', region: 'Kerala', district: null, city: 'Kochi', postalCode: null,
        addressLine: null, portName: null, locationType: 'delivery',
        mapPin: { latitude: 9.9, longitude: 76.2, accuracyMetres: 30, userConfirmed: true }, device: null
      },
      approximateLocation: { countryCode: 'AE', countryName: 'United Arab Emirates', region: 'Dubai', city: 'Dubai', detectedAt: new Date() }
    });
    const locationInserts = client.query.mock.calls.filter(([sql]) => sql.includes('insert into fas_locations'));
    expect(locationInserts).toHaveLength(3);
    expect(locationInserts[1][1]).toEqual(expect.arrayContaining(['map_pin', 'unverified']));
    const riskSql = client.query.mock.calls.find(([sql]) => sql.includes('insert into fas_location_risk_events'))?.[0];
    expect(riskSql).toContain('manual review only');
    expect(riskSql).not.toMatch(/fraud|blocked|suspended/i);
  });

  it('denies cross-user correction before creating a replacement', async () => {
    const client = { query: vi.fn(async sql => {
      if (['begin', 'rollback'].includes(sql)) return { rows: [], rowCount: 0 };
      if (sql.includes('join fas_user_locations')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    }), release: vi.fn() };
    const pool = { connect: vi.fn().mockResolvedValue(client) };
    await expect(correctCustomerLocation({
      pool, userId: 'other-user', locationId: 'location-1', location: { countryCode: 'IN' }
    })).rejects.toMatchObject({ status: 404 });
    expect(client.query).toHaveBeenCalledWith('rollback');
    expect(client.query.mock.calls.some(([sql]) => sql.includes('insert into fas_locations'))).toBe(false);
  });

  it('audits corrections and retains the previous location when history references it', async () => {
    const client = { query: vi.fn(async sql => {
      if (['begin', 'commit'].includes(sql)) return { rows: [], rowCount: 0 };
      if (sql.includes('join fas_user_locations')) return { rows: [{ location_source: 'user_entered' }], rowCount: 1 };
      if (sql.includes('insert into fas_location_consents')) return { rows: [{ id: 'consent-2' }], rowCount: 1 };
      if (sql.includes('insert into fas_locations')) return { rows: [{ id: 'location-2' }], rowCount: 1 };
      if (sql.includes('select exists(')) return { rows: [{ retained: true }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    }), release: vi.fn() };
    const pool = { connect: vi.fn().mockResolvedValue(client) };
    const location = {
      countryCode: 'IN', countryName: 'India', region: 'Kerala', district: null, city: 'Kochi', postalCode: null,
      addressLine: null, portName: null, locationType: 'delivery', locationCollectionConsent: true,
      preciseLocationConsent: false, consentTextVersion: 'location-v1-2026-08-15', device: null, mapPin: null
    };
    await expect(correctCustomerLocation({ pool, userId: 'user-1', locationId: 'location-1', location })).resolves.toEqual({
      replacementId: 'location-2', previousRetained: true
    });
    expect(client.query.mock.calls.some(([sql]) => sql.includes("'customer_location_corrected'"))).toBe(true);
    expect(client.query.mock.calls.some(([sql]) => sql.includes('update fas_locations set archived_at'))).toBe(false);
    expect(client.query).toHaveBeenCalledWith('commit');
  });
});