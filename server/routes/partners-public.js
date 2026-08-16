import { Router } from 'express';
import { customerSessionCookieName } from '../customer-auth-middleware.js';
import { resolveCustomerSession } from '../services/customer-auth.js';
import { consumeRateLimit } from '../services/rate-limit.js';
import {
  captureReferralAttribution,
  createPartner,
  getPartnerSettings,
  partnerReferralCookieName,
  partnerReferralCookieOptions
} from '../services/partner-network.js';

function normalizeText(value, { max = 2000, required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) {
      const error = new Error('A required field is missing.');
      error.status = 422;
      throw error;
    }
    return null;
  }
  if (typeof value !== 'string') {
    const error = new Error('Invalid text input.');
    error.status = 422;
    throw error;
  }
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    if (required) {
      const error = new Error('A required field is empty.');
      error.status = 422;
      throw error;
    }
    return null;
  }
  if (normalized.length > max) {
    const error = new Error('A text field is too long.');
    error.status = 422;
    throw error;
  }
  return normalized;
}

async function resolveOptionalCustomerSession({ request, pool, config }) {
  const token = request.cookies[customerSessionCookieName(config)];
  if (!token) return null;
  return resolveCustomerSession({ pool, sessionToken: token, config });
}

export function createPartnersPublicRouter({ config, pool }) {
  const router = Router();

  router.post('/apply', async (request, response, next) => {
    try {
      if (!config.partnerNetworkEnabled) return response.status(404).json({ success: false, error: 'Partner network is unavailable.' });

      const settings = await getPartnerSettings(pool);
      const publicApplicationsEnabled = String(settings.partner_application_enabled || config.partnerPublicApplicationsEnabled) === 'true';
      if (!publicApplicationsEnabled) {
        return response.status(503).json({ success: false, error: 'Partner applications are temporarily closed.' });
      }

      const rate = await consumeRateLimit(pool, 'partner_application', request.ip, config);
      if (!rate.allowed) {
        response.set('retry-after', String(rate.retryAfterSeconds));
        return response.status(429).json({ success: false, error: 'Too many applications submitted. Please retry later.' });
      }

      const existingSession = await resolveOptionalCustomerSession({ request, pool, config });
      const autoApproveFromSettings = String(settings.partner_auto_approval || config.partnerAutoApproval) === 'true';

      const partner = await createPartner(pool, {
        userId: existingSession?.userId || null,
        partnerType: request.body?.partnerType,
        displayName: request.body?.displayName,
        legalName: request.body?.legalName,
        contactPerson: request.body?.contactPerson,
        email: request.body?.email,
        phone: request.body?.phone,
        whatsappNumber: request.body?.whatsappNumber,
        country: request.body?.country,
        state: request.body?.state,
        district: request.body?.district,
        city: request.body?.city,
        address: request.body?.address,
        instagramHandle: request.body?.instagramHandle,
        youtubeChannel: request.body?.youtubeChannel,
        facebookPage: request.body?.facebookPage,
        website: request.body?.website,
        primaryPlatform: request.body?.primaryPlatform,
        niche: request.body?.niche,
        followerCount: request.body?.followerCount,
        notes: request.body?.notes,
        partnerTier: request.body?.partnerTier
      }, {
        autoApprove: autoApproveFromSettings
      });

      return response.status(201).json({ success: true, partner });
    } catch (error) {
      next(error);
    }
  });

  router.post('/referrals/capture', async (request, response, next) => {
    try {
      if (!config.partnerNetworkEnabled) {
        return response.status(404).json({ success: false, error: 'Partner referral capture is unavailable.' });
      }

      const referralCode = normalizeText(request.body?.ref || request.query?.ref, { max: 40, required: false });
      const captureRequest = {
        ip: request.ip,
        path: request.path,
        hostname: request.hostname,
        cookies: request.cookies,
        get: header => request.get(header),
        query: {
          ...request.query,
          ref: referralCode || request.query?.ref,
          campaign: request.body?.campaign || request.query?.campaign,
          campaign_code: request.body?.campaignCode || request.query?.campaign_code,
          utm_source: request.body?.utmSource || request.query?.utm_source,
          utm_medium: request.body?.utmMedium || request.query?.utm_medium,
          utm_campaign: request.body?.utmCampaign || request.query?.utm_campaign,
          utm_term: request.body?.utmTerm || request.query?.utm_term,
          utm_content: request.body?.utmContent || request.query?.utm_content,
          sid: request.body?.sid || request.query?.sid
        },
        originalUrl: normalizeText(request.body?.landingPage || request.originalUrl || request.url, { max: 500 }) || '/'
      };

      const capture = await captureReferralAttribution({
        pool,
        request: captureRequest,
        config
      });

      if (capture.captured && capture.token) {
        response.cookie(
          partnerReferralCookieName(config),
          capture.token,
          partnerReferralCookieOptions(config, capture.attributionDays || config.partnerReferralCookieDays)
        );
      }

      response.json({
        success: true,
        captured: capture.captured,
        preserved: Boolean(capture.preserved),
        partnerCode: capture.partnerCode || null,
        reason: capture.reason || null,
        expiresAt: capture.expiresAt || null
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
