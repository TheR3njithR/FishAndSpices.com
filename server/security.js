import { createHash, createHmac, randomBytes } from 'node:crypto';

export const sha256 = value => createHash('sha256').update(String(value)).digest('hex');
export const keyedHash = (value, secret) => createHmac('sha256', secret).update(String(value)).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export function publicLeadReference(role, date = new Date()) {
  const day = date.toISOString().slice(0, 10).replaceAll('-', '');
  return `FAS-${role === 'buyer' ? 'B' : 'S'}-${day}-${randomBytes(7).toString('base64url').replace(/[^a-z0-9]/gi, '').slice(0, 10).toUpperCase()}`;
}

export function safeEqualOrigin(requestOrigin, configuredOrigin) {
  if (!requestOrigin || !configuredOrigin) return false;
  try {
    return new URL(requestOrigin).origin === new URL(configuredOrigin).origin;
  } catch {
    return false;
  }
}
