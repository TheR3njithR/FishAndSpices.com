import { Router } from 'express';
import { requireCustomerAuthentication, requireCustomerCsrf } from '../customer-auth-middleware.js';
import { consumeRateLimit } from '../services/rate-limit.js';
import {
  buildPartnerReferralLink,
  createPartnerCampaign,
  getPartnerByUserId,
  getPartnerDetail,
  getPartnerSettings,
  listPartnerCampaigns,
  listPartnerEarnings,
  listPartnerPayouts,
  listPartnerReferrals
} from '../services/partner-network.js';

function enabled(config, response) {
  if (!config.partnerNetworkEnabled) {
    response.status(404).json({ success: false, error: 'Partner network is unavailable.' });
    return false;
  }
  return true;
}

async function resolveOwnedPartner({ pool, userId }) {
  return getPartnerByUserId(pool, userId);
}

function parsePage(query) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.max(1, Math.min(100, Number(query.pageSize) || 20));
  return { page, pageSize };
}

export function createPartnerDashboardRouter({ config, pool }) {
  const router = Router();
  const authenticate = requireCustomerAuthentication({ pool, config });

  router.use(authenticate);

  router.get('/dashboard', async (request, response, next) => {
    try {
      if (!enabled(config, response)) return;
      const partner = await resolveOwnedPartner({ pool, userId: request.customerSession.userId });
      if (!partner) return response.status(404).json({ success: false, error: 'Partner account not found.' });
      const detail = await getPartnerDetail(pool, partner.id, { page: 1, pageSize: 10 });
      response.json({ success: true, ...detail });
    } catch (error) {
      next(error);
    }
  });

  router.get('/profile', async (request, response, next) => {
    try {
      if (!enabled(config, response)) return;
      const partner = await resolveOwnedPartner({ pool, userId: request.customerSession.userId });
      if (!partner) return response.status(404).json({ success: false, error: 'Partner account not found.' });
      response.json({ success: true, partner });
    } catch (error) {
      next(error);
    }
  });

  router.get('/referrals', async (request, response, next) => {
    try {
      if (!enabled(config, response)) return;
      const partner = await resolveOwnedPartner({ pool, userId: request.customerSession.userId });
      if (!partner) return response.status(404).json({ success: false, error: 'Partner account not found.' });
      const paging = parsePage(request.query);
      const payload = await listPartnerReferrals(pool, partner.id, paging);
      response.json({ success: true, partner, ...payload });
    } catch (error) {
      next(error);
    }
  });

  router.get('/earnings', async (request, response, next) => {
    try {
      if (!enabled(config, response)) return;
      const partner = await resolveOwnedPartner({ pool, userId: request.customerSession.userId });
      if (!partner) return response.status(404).json({ success: false, error: 'Partner account not found.' });
      const paging = parsePage(request.query);
      const payload = await listPartnerEarnings(pool, partner.id, paging);
      response.json({ success: true, partner, ...payload });
    } catch (error) {
      next(error);
    }
  });

  router.get('/campaigns', async (request, response, next) => {
    try {
      if (!enabled(config, response)) return;
      const partner = await resolveOwnedPartner({ pool, userId: request.customerSession.userId });
      if (!partner) return response.status(404).json({ success: false, error: 'Partner account not found.' });
      const campaigns = await listPartnerCampaigns(pool, partner.id);
      response.json({ success: true, partner, campaigns });
    } catch (error) {
      next(error);
    }
  });

  router.post('/campaigns', requireCustomerCsrf, async (request, response, next) => {
    try {
      if (!enabled(config, response)) return;
      const partner = await resolveOwnedPartner({ pool, userId: request.customerSession.userId });
      if (!partner) return response.status(404).json({ success: false, error: 'Partner account not found.' });

      const limit = await consumeRateLimit(pool, 'partner_campaign_create', `${partner.id}:${request.ip}`, config);
      if (!limit.allowed) {
        response.set('retry-after', String(limit.retryAfterSeconds));
        return response.status(429).json({ success: false, error: 'Too many campaign changes. Please retry later.' });
      }

      const campaign = await createPartnerCampaign(pool, partner.id, request.body || {});
      response.status(201).json({ success: true, campaign });
    } catch (error) {
      next(error);
    }
  });

  router.get('/links', async (request, response, next) => {
    try {
      if (!enabled(config, response)) return;
      const partner = await resolveOwnedPartner({ pool, userId: request.customerSession.userId });
      if (!partner) return response.status(404).json({ success: false, error: 'Partner account not found.' });

      const campaigns = await listPartnerCampaigns(pool, partner.id);
      const links = campaigns.map(campaign => ({
        campaignId: campaign.id,
        campaignCode: campaign.campaignCode,
        name: campaign.name,
        url: buildPartnerReferralLink({
          appOrigin: config.appOrigin,
          partnerCode: partner.partnerCode,
          landingPage: campaign.landingPage,
          campaign: campaign.campaignCode,
          utm: {
            source: campaign.utmSource,
            medium: campaign.utmMedium,
            campaign: campaign.utmCampaign,
            content: campaign.utmContent,
            term: campaign.utmTerm
          }
        })
      }));

      const defaultLink = buildPartnerReferralLink({
        appOrigin: config.appOrigin,
        partnerCode: partner.partnerCode,
        landingPage: request.query.landingPage || '/partners'
      });

      response.json({ success: true, defaultLink, links });
    } catch (error) {
      next(error);
    }
  });

  router.get('/payouts', async (request, response, next) => {
    try {
      if (!enabled(config, response)) return;
      const partner = await resolveOwnedPartner({ pool, userId: request.customerSession.userId });
      if (!partner) return response.status(404).json({ success: false, error: 'Partner account not found.' });
      const paging = parsePage(request.query);
      const payload = await listPartnerPayouts(pool, { partnerId: partner.id, ...paging });
      response.json({ success: true, ...payload });
    } catch (error) {
      next(error);
    }
  });

  router.get('/settings', async (_request, response, next) => {
    try {
      if (!enabled(config, response)) return;
      response.json({ success: true, settings: await getPartnerSettings(pool) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
