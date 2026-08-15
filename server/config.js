const requiredInHostedEnvironment = [
  'DATABASE_URL',
  'APP_ORIGIN',
  'SESSION_SECRET',
  'OTP_SECRET'
];
const requiredInProduction = [
  'TURNSTILE_SITE_KEY',
  'TURNSTILE_SECRET_KEY'
];

export function loadConfig(environment = process.env) {
  const nodeEnv = environment.NODE_ENV || 'development';
  const isHosted = nodeEnv === 'production' || nodeEnv === 'staging';
  if (isHosted) {
    const required = nodeEnv === 'production' ? [...requiredInHostedEnvironment, ...requiredInProduction] : requiredInHostedEnvironment;
    const missing = required.filter(name => !environment[name]);
    if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    if (environment.OTP_PROVIDER === 'development') throw new Error('OTP_PROVIDER=development is not allowed in hosted environments.');
    if (environment.APPROXIMATE_LOCATION_PROVIDER === 'signed_proxy' && !environment.LOCATION_PROXY_SECRET) {
      throw new Error('LOCATION_PROXY_SECRET is required for the signed location proxy provider.');
    }
  }

  const approximateLocationProvider = environment.APPROXIMATE_LOCATION_PROVIDER || '';
  if (approximateLocationProvider && approximateLocationProvider !== 'signed_proxy') {
    throw new Error('APPROXIMATE_LOCATION_PROVIDER must be empty or signed_proxy.');
  }

  return Object.freeze({
    nodeEnv,
    isProduction: isHosted,
    port: Number(environment.PORT || 3000),
    appOrigin: environment.APP_ORIGIN || `http://localhost:${environment.PORT || 3000}`,
    databaseUrl: environment.DATABASE_URL || '',
    databaseUnpooledUrl: environment.DATABASE_UNPOOLED_URL || environment.DATABASE_URL || '',
    sessionSecret: environment.SESSION_SECRET || 'development-only-session-secret-change-me',
    turnstileSiteKey: environment.TURNSTILE_SITE_KEY || '',
    turnstileSecretKey: environment.TURNSTILE_SECRET_KEY || '',
    turnstileDevBypass: !isHosted && environment.TURNSTILE_DEV_BYPASS === 'true',
    businessWhatsappNumber: environment.BUSINESS_WHATSAPP_NUMBER || '918700732197',
    businessEmail: environment.BUSINESS_EMAIL || 'AuthenticKeralaSpice@gmail.com',
    adminNotificationEmail: environment.ADMIN_NOTIFICATION_EMAIL || '',
    emailProvider: environment.EMAIL_PROVIDER || '',
    otpProvider: environment.OTP_PROVIDER || '',
    otpSecret: environment.OTP_SECRET || environment.SESSION_SECRET || 'development-only-otp-secret-change-me',
    otpLifetimeMinutes: Math.min(15, Math.max(3, Number(environment.OTP_LIFETIME_MINUTES || 10))),
    otpMaximumAttempts: Math.min(10, Math.max(3, Number(environment.OTP_MAXIMUM_ATTEMPTS || 5))),
    otpResendDelaySeconds: Math.max(30, Number(environment.OTP_RESEND_DELAY_SECONDS || 60)),
    customerSessionIdleHours: Math.min(24, Math.max(1, Number(environment.CUSTOMER_SESSION_IDLE_HOURS || 8))),
    customerSessionLifetimeDays: Math.min(30, Math.max(1, Number(environment.CUSTOMER_SESSION_LIFETIME_DAYS || 14))),
    resendApiKey: environment.RESEND_API_KEY || '',
    emailFrom: environment.EMAIL_FROM || '',
    approximateLocationProvider,
    locationProxySecret: environment.LOCATION_PROXY_SECRET || '',
    locationRetentionDays: Math.max(1, Number(environment.LOCATION_RETENTION_DAYS || 365)),
    trustProxy: environment.TRUST_PROXY === undefined ? 1 : Number(environment.TRUST_PROXY)
  });
}
