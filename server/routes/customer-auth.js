import { Router } from 'express';
import {
  customerSessionCookieName, customerSessionCookieOptions,
  requireCustomerAuthentication, requireCustomerCsrf
} from '../customer-auth-middleware.js';
import {
  requestChallenge, revokeCustomerSession, revokeCustomerSessionToken, rotateCustomerCsrf, verifyChallenge
} from '../services/customer-auth.js';

export function createCustomerAuthRouter({ config, pool, services = {} }) {
  const router = Router();
  const requestCode = services.requestChallenge || requestChallenge;
  const verifyCode = services.verifyChallenge || verifyChallenge;
  const authenticate = requireCustomerAuthentication({ pool, config });

  router.post('/challenges', async (request, response, next) => {
    try {
      const result = await requestCode({
        pool, type: request.body?.type, destination: request.body?.destination,
        purpose: request.body?.purpose, ip: request.ip, config, fetcher: services.fetch || fetch
      });
      return response.status(202).json(result);
    } catch (error) {
      if (error.retryAfterSeconds) response.set('retry-after', String(error.retryAfterSeconds));
      next(error);
    }
  });

  router.post('/verify', async (request, response, next) => {
    try {
      await revokeCustomerSessionToken(pool, request.cookies[customerSessionCookieName(config)]);
      const result = await verifyCode({
        pool, challengeId: request.body?.challengeId, code: request.body?.code,
        ip: request.ip, userAgent: request.get('user-agent'), config
      });
      response.cookie(customerSessionCookieName(config), result.sessionToken, customerSessionCookieOptions(config, result.expiresAt));
      response.json({ success: true, csrfToken: result.csrfToken, expiresAt: result.expiresAt, claimedRecords: result.claims.linked, claimsNeedingReview: result.claims.review });
    } catch (error) {
      if (error.retryAfterSeconds) response.set('retry-after', String(error.retryAfterSeconds));
      next(error);
    }
  });

  router.get('/session', authenticate, async (request, response, next) => {
    try {
      const csrfToken = await rotateCustomerCsrf(pool, request.customerSession.sessionId);
      response.json({
        success: true,
        user: { displayName: request.customerSession.displayName, status: request.customerSession.status },
        verificationLevel: request.customerSession.status === 'guest' ? 'Unconfirmed' : 'Contact confirmed',
        csrfToken, expiresAt: request.customerSession.expiresAt
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/logout', authenticate, requireCustomerCsrf, async (request, response, next) => {
    try {
      await revokeCustomerSession(pool, request.customerSession.sessionId);
      response.clearCookie(customerSessionCookieName(config), { httpOnly: true, secure: config.isProduction, sameSite: 'strict', path: '/' });
      response.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
