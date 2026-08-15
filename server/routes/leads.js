import { Router } from 'express';
import { LeadValidationError, validateLead } from '../validation/lead.js';
import { consumeRateLimit } from '../services/rate-limit.js';
import { createLead, DuplicateSubmissionError } from '../services/leads.js';
import { deriveApproximateLocation } from '../services/location.js';
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
      return response.status(201).json({ success: true, reference: result.reference });
    } catch (error) {
      if (error instanceof LeadValidationError) return response.status(422).json({ success: false, error: error.message, fields: error.fields });
      if (error instanceof DuplicateSubmissionError) return response.status(409).json({ success: false, error: error.message });
      next(error);
    }
  });

  return router;
}
