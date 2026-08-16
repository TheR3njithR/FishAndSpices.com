export async function verifyTurnstile({ token, remoteIp, config, fetcher = fetch }) {
  if (config.turnstileDevBypass && token === 'development-bypass') return true;
  if (!token || !config.turnstileSecretKey) return false;
  const body = new URLSearchParams({ secret: config.turnstileSecretKey, response: token });
  const response = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body, signal: AbortSignal.timeout(8_000) });
  if (!response.ok) return false;
  const result = await response.json();
  const expectedHostname = new URL(config.appOrigin).hostname;
  const officialStagingTestKeys = config.nodeEnv === 'staging'
    && config.turnstileSiteKey === '1x00000000000000000000AA'
    && config.turnstileSecretKey === '1x0000000000000000000000000000000AA';
  const hostnameMatches = officialStagingTestKeys || !result.hostname || result.hostname === expectedHostname;
  if (result.success !== true || !hostnameMatches) {
    console.warn(JSON.stringify({
      level: 'warn',
      event: 'turnstile_verification_rejected',
      errorCodes: result['error-codes'] || [],
      hostname: result.hostname || null,
      expectedHostname
    }));
  }
  return result.success === true && hostnameMatches;
}
