import { Router } from 'express';
import { LeadValidationError, validateLead } from '../validation/lead.js';
import { consumeRateLimit } from '../services/rate-limit.js';
import { createLead, DuplicateSubmissionError } from '../services/leads.js';
import { deriveApproximateLocation } from '../services/location.js';
import {
  emitPartnerEvent,
  linkReferralToUserFromCookie,
  partnerReferralCookieName
} from '../services/partner-network.js';
import { verifyTurnstile } from '../services/turnstile.js';

export function createLeadRouter({ config, pool, services = {} }) {
  const router = Router();
  const validate = services.validateLead || validateLead;
  const rateLimit = services.consumeRateLimit || consumeRateLimit;
  const turnstile = services.verifyTurnstile || verifyTurnstile;
  const insert = services.createLead || createLead;
  const approximateLocation = services.deriveApproximateLocation || deriveApproximateLocation;

  router.post('/', async (request, response, next) => {
    if (!request.is('application/json')) return response.status(415).json({ success: false, error: 'Use application/json.' });
    if (!pool) return response.status(503).json({ success: false, error: 'Lead storage is unavailable.' });
    try {
      const limit = await rateLimit(pool, 'lead_submission', request.ip, config);
      if (!limit.allowed) {
        response.set('retry-after', String(limit.retryAfterSeconds));
        return response.status(429).json({ success: false, error: 'Too many submissions. Please wait and retry.' });
      }
      const { data, turnstileToken } = validate(request.body);
      const human = await turnstile({ token: turnstileToken, remoteIp: request.ip, config, fetcher: services.fetch || fetch });
      if (!human) return response.status(422).json({ success: false, error: 'Human verification failed. Please retry.' });
      const result = await insert({
        pool, data, requestIp: request.ip, config, fetcher: services.fetch || fetch,
        approximateLocation: approximateLocation(request, config)
      });

      if (config.partnerNetworkEnabled && result.userId) {
        try {
          const referralCookieToken = request.cookies[partnerReferralCookieName(config)] || null;
          await linkReferralToUserFromCookie({
            pool,
            config,
            userId: result.userId,
            referralCookieToken,
            userRole: data.role
          });

          await emitPartnerEvent({
            pool,
            config,
            userId: result.userId,
            eventType: 'REGISTRATION',
            entityType: 'lead',
            entityId: result.leadId,
            userRole: data.role,
            metadata: {
              source: 'lead_form',
              leadReference: result.reference,
              category: data.category
            },
            dedupeKey: `partner:registration:${result.userId}`
          });

          await emitPartnerEvent({
            pool,
            config,
            userId: result.userId,
            eventType: data.role === 'buyer' ? 'BUYER_REQUIREMENT_CREATED' : 'SELLER_LISTING_CREATED',
            entityType: 'lead',
            entityId: result.leadId,
            userRole: data.role,
            metadata: {
              source: 'lead_form',
              leadReference: result.reference,
              category: data.category
            },
            dedupeKey: `partner:${data.role}:${result.leadId}`
          });
        } catch (partnerError) {
          console.warn(JSON.stringify({
            level: 'warn',
            event: 'partner_lead_hook_failed',
            message: partnerError.message,
            leadReference: result.reference
          }));
        }
      }

      return response.status(201).json({ success: true, reference: result.reference });
    } catch (error) {
      if (error instanceof LeadValidationError) return response.status(422).json({ success: false, error: error.message, fields: error.fields });
      if (error instanceof DuplicateSubmissionError) return response.status(409).json({ success: false, error: error.message });
      next(error);
    }
  });

  return router;
}
