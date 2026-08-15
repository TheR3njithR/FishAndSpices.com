import { Router } from 'express';
import { createAdminRouter } from './admin.js';
import { createAiAssistantRouter } from './ai-assistant.js';
import { createAuthRouter } from './auth.js';
import { createCustomerAuthRouter } from './customer-auth.js';
import { createCustomerLocationRouter } from './customer-locations.js';
import { createLeadRouter } from './leads.js';
import { createMarketplaceAccountRouter } from './marketplace-account.js';
import { createMarketplaceRouter } from './marketplace.js';
import { createMeRouter } from './me.js';
import { deriveApproximateLocation } from '../services/location.js';
import { getPublicOptions } from '../services/master-data.js';

export function createApiRouter({ config, pool, services }) {
  const router = Router();

  router.get('/health', async (_request, response) => {
    if (!pool) return response.status(config.isProduction ? 503 : 200).json({ status: 'degraded', application: 'available', database: 'not_configured' });
    try {
      await pool.query('select 1');
      response.json({ status: 'ok', application: 'available', database: 'available' });
    } catch {
      response.status(503).json({ status: 'degraded', application: 'available', database: 'unavailable' });
    }
  });

  router.get('/v1/options', async (_request, response, next) => {
    try {
      response.set('Cache-Control', 'no-store');
      response.json({ success: true, options: await getPublicOptions(pool) });
    } catch (error) { next(error); }
  });

  router.get('/v1/public-config', (request, response) => response.json({
    turnstileSiteKey: config.turnstileSiteKey,
    turnstileDevelopmentBypass: config.turnstileDevBypass,
    businessWhatsappNumber: config.businessWhatsappNumber,
    businessEmail: config.businessEmail,
    approximateLocation: deriveApproximateLocation(request, config)
  }));
  router.use('/v1/leads', createLeadRouter({ config, pool, services }));
  if (pool) router.use('/v1', createMarketplaceRouter({ pool, services }));
  if (pool) {
    router.use('/v1/ai', createAiAssistantRouter({ config, pool, services }));
    router.use('/v1', createMarketplaceAccountRouter({ config, pool, services }));
    router.use('/v1/auth', createAuthRouter({ config, pool, services }));
    router.use('/v1/customer-auth', createCustomerAuthRouter({ config, pool, services }));
    router.use('/v1/me/locations', createCustomerLocationRouter({ config, pool }));
    router.use('/v1/me', createMeRouter({ config, pool }));
    router.use('/v1/admin', createAdminRouter({ config, pool }));
  }

  return router;
}
