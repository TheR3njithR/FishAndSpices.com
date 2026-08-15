import { describe, expect, it } from 'vitest';
import { loadConfig } from '../server/config.js';

describe('hosted environment configuration', () => {
  it('uses secure hosted behavior and disables bypass in staging', () => {
    const config = loadConfig({
      NODE_ENV: 'staging',
      APP_ORIGIN: 'https://staging.example.com',
      DATABASE_URL: 'postgresql://private-host/database',
      SESSION_SECRET: 'staging-session-secret',
      OTP_SECRET: 'staging-otp-secret',
      TURNSTILE_DEV_BYPASS: 'true'
    });
    expect(config).toMatchObject({ nodeEnv: 'staging', isProduction: true, turnstileDevBypass: false });
  });

  it('requires Turnstile credentials in production', () => {
    expect(() => loadConfig({
      NODE_ENV: 'production',
      APP_ORIGIN: 'https://example.com',
      DATABASE_URL: 'postgresql://private-host/database',
      SESSION_SECRET: 'production-session-secret',
      OTP_SECRET: 'production-otp-secret'
    })).toThrow(/TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY/);
  });

  it('rejects the development OTP adapter in hosted environments', () => {
    expect(() => loadConfig({
      NODE_ENV: 'staging', APP_ORIGIN: 'https://staging.example.com',
      DATABASE_URL: 'postgresql://private-host/database', SESSION_SECRET: 'session-secret',
      OTP_SECRET: 'otp-secret', OTP_PROVIDER: 'development'
    })).toThrow(/development is not allowed/);
  });
});