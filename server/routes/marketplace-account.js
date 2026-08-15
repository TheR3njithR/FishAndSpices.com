import { Router } from 'express';
import { requireCustomerAuthentication, requireCustomerCsrf } from '../customer-auth-middleware.js';
import {
  createContactRequest,
  createQuote,
  getMarketplaceDashboard,
  removeMarketplaceItem,
  saveMarketplaceItem
} from '../services/marketplace-account.js';

export function createMarketplaceAccountRouter({ config, pool, services = {} }) {
  const router = Router();
  const authenticate = requireCustomerAuthentication({ pool, config });

  const postContactRequest = services.createContactRequest || createContactRequest;
  const postQuote = services.createQuote || createQuote;
  const saveItem = services.saveMarketplaceItem || saveMarketplaceItem;
  const removeItem = services.removeMarketplaceItem || removeMarketplaceItem;
  const getDashboard = services.getMarketplaceDashboard || getMarketplaceDashboard;

  router.post('/contact-requests', authenticate, requireCustomerCsrf, async (request, response, next) => {
    try {
      const contactRequest = await postContactRequest(pool, {
        userId: request.customerSession.userId,
        targetLeadId: request.body?.targetLeadId,
        message: request.body?.message
      });
      response.status(201).json({ success: true, contactRequest });
    } catch (error) {
      next(error);
    }
  });

  router.post('/quotes', authenticate, requireCustomerCsrf, async (request, response, next) => {
    try {
      const quote = await postQuote(pool, {
        userId: request.customerSession.userId,
        requirementLeadId: request.body?.requirementLeadId,
        sellerLeadId: request.body?.sellerLeadId,
        quantity: request.body?.quantity,
        unit: request.body?.unit,
        unitPrice: request.body?.unitPrice,
        currency: request.body?.currency,
        deliveryTerms: request.body?.deliveryTerms,
        deliveryTime: request.body?.deliveryTime,
        validUntil: request.body?.validUntil,
        notes: request.body?.notes
      });
      response.status(201).json({ success: true, quote });
    } catch (error) {
      next(error);
    }
  });

  router.post('/saved-items', authenticate, requireCustomerCsrf, async (request, response, next) => {
    try {
      const savedItem = await saveItem(pool, {
        userId: request.customerSession.userId,
        leadId: request.body?.leadId
      });
      response.status(201).json({ success: true, savedItem });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/saved-items/:leadId', authenticate, requireCustomerCsrf, async (request, response, next) => {
    try {
      const result = await removeItem(pool, {
        userId: request.customerSession.userId,
        leadId: request.params.leadId
      });
      response.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  router.get('/account/dashboard', authenticate, async (request, response, next) => {
    try {
      const dashboard = await getDashboard(pool, { userId: request.customerSession.userId });
      response.json({ success: true, dashboard });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
