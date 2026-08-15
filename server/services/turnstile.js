export async function verifyTurnstile({ token, remoteIp, config, fetcher = fetch }) {
  if (config.turnstileDevBypass && token === 'development-bypass') return true;
  if (!token || !config.turnstileSecretKey) return false;
  const body = new URLSearchParams({ secret: config.turnstileSecretKey, response: token });
  if (remoteIp) body.set('remoteip', remoteIp);
  const response = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body, signal: AbortSignal.timeout(8_000) });
  if (!response.ok) return false;
  const result = await response.json();
  const expectedHostname = new URL(config.appOrigin).hostname;
  const officialStagingTestKeys = config.nodeEnv === 'staging'
    && config.turnstileSiteKey === '1x00000000000000000000AA'
    && config.turnstileSecretKey === '1x0000000000000000000000000000000AA';
  return result.success === true && (officialStagingTestKeys || !result.hostname || result.hostname === expectedHostname);
}
