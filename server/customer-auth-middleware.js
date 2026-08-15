import { resolveCustomerSession, verifyCustomerCsrf } from './services/customer-auth.js';

export const customerSessionCookieName = config => config.isProduction ? '__Host-fas_customer_session' : 'fas_customer_session';

export function customerSessionCookieOptions(config, expiresAt) {
  return { httpOnly: true, secure: config.isProduction, sameSite: 'strict', path: '/', expires: expiresAt };
}

export function requireCustomerAuthentication({ pool, config }) {
  return async (request, response, next) => {
    try {
      const session = await resolveCustomerSession({
        pool, config, sessionToken: request.cookies[customerSessionCookieName(config)]
      });
      if (!session) return response.status(401).json({ success: false, error: 'Authentication required.' });
      request.customerSession = session;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireCustomerCsrf(request, response, next) {
  if (!verifyCustomerCsrf(request.customerSession, request.get('x-csrf-token'))) {
    return response.status(403).json({ success: false, error: 'Invalid CSRF token.' });
  }
  next();
}
