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

const aiAssistantModes = new Set(['text_only', 'voice_enabled', 'maintenance']);

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function boundedInt(value, fallback, min, max) {
  const numeric = Number(value ?? fallback);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(numeric)));
}

export function loadConfig(environment = process.env) {
  const nodeEnv = environment.NODE_ENV || 'development';
  const isHosted = nodeEnv === 'production' || nodeEnv === 'staging';
  const aiAssistantEnabled = normalizeBoolean(environment.AI_ASSISTANT_ENABLED, false);
  const aiAssistantDefaultMode = environment.AI_ASSISTANT_DEFAULT_MODE || 'text_only';
  if (isHosted) {
    const required = nodeEnv === 'production' ? [...requiredInHostedEnvironment, ...requiredInProduction] : requiredInHostedEnvironment;
    const missing = required.filter(name => !environment[name]);
    if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    if (environment.OTP_PROVIDER === 'development') throw new Error('OTP_PROVIDER=development is not allowed in hosted environments.');
    if (environment.APPROXIMATE_LOCATION_PROVIDER === 'signed_proxy' && !environment.LOCATION_PROXY_SECRET) {
      throw new Error('LOCATION_PROXY_SECRET is required for the signed location proxy provider.');
    }
    if (aiAssistantEnabled && !environment.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required when AI_ASSISTANT_ENABLED=true in hosted environments.');
    }
  }

  const approximateLocationProvider = environment.APPROXIMATE_LOCATION_PROVIDER || '';
  if (approximateLocationProvider && approximateLocationProvider !== 'signed_proxy') {
    throw new Error('APPROXIMATE_LOCATION_PROVIDER must be empty or signed_proxy.');
  }
  if (!aiAssistantModes.has(aiAssistantDefaultMode)) {
    throw new Error('AI_ASSISTANT_DEFAULT_MODE must be one of text_only, voice_enabled, maintenance.');
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
    openaiApiKey: environment.OPENAI_API_KEY || '',
    aiAssistantEnabled,
    aiAssistantDefaultMode,
    aiAssistantDefaultModel: environment.AI_ASSISTANT_DEFAULT_MODEL || 'gpt-5.6',
    aiAssistantRealtimeModel: environment.AI_ASSISTANT_REALTIME_MODEL || 'gpt-realtime-2.1',
    aiAssistantVoice: environment.AI_ASSISTANT_VOICE || 'marin',
    aiAssistantMaxToolRounds: boundedInt(environment.AI_ASSISTANT_MAX_TOOL_ROUNDS, 4, 1, 8),
    aiAssistantHistoryLength: boundedInt(environment.AI_ASSISTANT_HISTORY_LENGTH, 16, 4, 40),
    aiVoiceEnabled: normalizeBoolean(environment.AI_VOICE_ENABLED, false),
    aiRealtimeEnabled: normalizeBoolean(environment.AI_REALTIME_ENABLED, false),
    aiTtsModel: environment.AI_TTS_MODEL || 'gpt-4o-mini-tts',
    aiSttModel: environment.AI_STT_MODEL || 'gpt-transcribe',
    approximateLocationProvider,
    locationProxySecret: environment.LOCATION_PROXY_SECRET || '',
    locationRetentionDays: Math.max(1, Number(environment.LOCATION_RETENTION_DAYS || 365)),
    trustProxy: environment.TRUST_PROXY === undefined ? 1 : Number(environment.TRUST_PROXY)
  });
}
