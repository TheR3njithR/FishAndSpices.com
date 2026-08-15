import { resolveSession, verifyCsrf } from './services/auth.js';

export const sessionCookieName = config => config.isProduction ? '__Host-fas_admin_session' : 'fas_admin_session';

export function sessionCookieOptions(config, expiresAt) {
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'strict',
    path: '/',
    expires: expiresAt
  };
}

export function requireAuthentication({ pool, config, roles = null }) {
  return async (request, response, next) => {
    try {
      const session = await resolveSession({ pool, sessionToken: request.cookies[sessionCookieName(config)] });
      if (!session) return response.status(401).json({ success: false, error: 'Authentication required.' });
      if (roles && !roles.includes(session.user.role)) return response.status(403).json({ success: false, error: 'Insufficient administrator role.' });
      request.adminSession = session;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireCsrf(request, response, next) {
  if (!verifyCsrf(request.adminSession, request.get('x-csrf-token'))) {
    return response.status(403).json({ success: false, error: 'Invalid CSRF token.' });
  }
  next();
}
