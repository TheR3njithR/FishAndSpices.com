import { Router } from 'express';
import { requireAuthentication, requireCsrf, sessionCookieName, sessionCookieOptions } from '../auth-middleware.js';
import { loginAdministrator, revokeSession, rotateCsrf } from '../services/auth.js';

export function createAuthRouter({ config, pool, services = {} }) {
  const router = Router();
  const login = services.loginAdministrator || loginAdministrator;
  const authenticate = requireAuthentication({ pool, config });

  router.post('/login', async (request, response, next) => {
    try {
      const result = await login({
        pool, email: request.body?.email, password: request.body?.password,
        ip: request.ip, userAgent: request.get('user-agent'), config
      });
      response.cookie(sessionCookieName(config), result.sessionToken, sessionCookieOptions(config, result.expiresAt));
      response.json({ success: true, user: result.user, csrfToken: result.csrfToken, expiresAt: result.expiresAt });
    } catch (error) {
      if (error.retryAfterSeconds) response.set('retry-after', String(error.retryAfterSeconds));
      next(error);
    }
  });

  router.get('/session', authenticate, async (request, response, next) => {
    try {
      const csrfToken = await rotateCsrf(pool, request.adminSession.sessionId);
      response.json({ success: true, user: request.adminSession.user, csrfToken, expiresAt: request.adminSession.expiresAt });
    } catch (error) {
      next(error);
    }
  });

  router.post('/logout', authenticate, requireCsrf, async (request, response, next) => {
    try {
      await revokeSession({ pool, session: request.adminSession, config, ip: request.ip });
      response.clearCookie(sessionCookieName(config), { httpOnly: true, secure: config.isProduction, sameSite: 'strict', path: '/' });
      response.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
