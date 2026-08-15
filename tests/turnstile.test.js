import { describe, expect, it, vi } from 'vitest';
import { verifyTurnstile } from '../server/services/turnstile.js';

const response = hostname => vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ success: true, hostname })
});

describe('Turnstile hostname verification', () => {
  it('accepts the official dummy pair hostname only in staging', async () => {
    const testKeys = {
      nodeEnv: 'staging', appOrigin: 'https://staging.example.com',
      turnstileSiteKey: '1x00000000000000000000AA',
      turnstileSecretKey: '1x0000000000000000000000000000000AA'
    };
    expect(await verifyTurnstile({ token: 'XXXX.DUMMY.TOKEN.XXXX', config: testKeys, fetcher: response('localhost') })).toBe(true);
    expect(await verifyTurnstile({ token: 'XXXX.DUMMY.TOKEN.XXXX', config: { ...testKeys, nodeEnv: 'production' }, fetcher: response('localhost') })).toBe(false);
  });

  it('enforces the configured hostname for non-test keys', async () => {
    const config = { nodeEnv: 'staging', appOrigin: 'https://staging.example.com', turnstileSiteKey: 'real-site', turnstileSecretKey: 'real-secret' };
    expect(await verifyTurnstile({ token: 'token', config, fetcher: response('other.example.com') })).toBe(false);
    expect(await verifyTurnstile({ token: 'token', config, fetcher: response('staging.example.com') })).toBe(true);
  });
});