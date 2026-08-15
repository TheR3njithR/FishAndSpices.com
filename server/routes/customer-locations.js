import { Router } from 'express';
import { requireCustomerAuthentication, requireCustomerCsrf } from '../customer-auth-middleware.js';
import {
  archiveCustomerLocation, correctCustomerLocation, createCustomerLocation,
  listCustomerLocations, LocationValidationError, requestLocationChange, validateLeadLocation
} from '../services/location.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireUuid(value, label) {
  if (!UUID.test(String(value))) {
    const error = new Error(`Invalid ${label}.`);
    error.status = 400;
    throw error;
  }
}

function validatedLocation(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    const error = new Error('The request body must be an object.');
    error.status = 422;
    throw error;
  }
  const unknown = Object.keys(body).filter(key => !['location', 'organisationId'].includes(key));
  if (unknown.length) {
    const error = new Error(`Unknown fields are not accepted: ${unknown.slice(0, 5).join(', ')}.`);
    error.status = 422;
    throw error;
  }
  if (body.organisationId !== undefined && body.organisationId !== null) requireUuid(body.organisationId, 'organisation identifier');
  const requestedType = String(body.location?.locationType || '');
  const role = ['delivery', 'port'].includes(requestedType) ? 'buyer' : 'seller';
  try {
    return { location: validateLeadLocation(body.location, role), organisationId: body.organisationId || null };
  } catch (error) {
    if (error instanceof LocationValidationError) error.status = 422;
    throw error;
  }
}

export function createCustomerLocationRouter({ config, pool }) {
  const router = Router();
  router.use(requireCustomerAuthentication({ pool, config }));

  router.get('/', async (request, response, next) => {
    try {
      const locations = await listCustomerLocations(pool, request.customerSession.userId);
      response.json({ success: true, locations });
    } catch (error) {
      next(error);
    }
  });

  router.post('/', requireCustomerCsrf, async (request, response, next) => {
    try {
      const input = validatedLocation(request.body);
      const location = await createCustomerLocation({ pool, userId: request.customerSession.userId, ...input });
      response.status(201).json({ success: true, location });
    } catch (error) {
      next(error);
    }
  });

  router.put('/:locationId', requireCustomerCsrf, async (request, response, next) => {
    try {
      requireUuid(request.params.locationId, 'location identifier');
      const input = validatedLocation(request.body);
      if (input.location.device || input.location.mapPin) {
        return response.status(422).json({ success: false, error: 'Add a new precise location instead of replacing an existing location.' });
      }
      const result = await correctCustomerLocation({
        pool, userId: request.customerSession.userId, locationId: request.params.locationId, ...input
      });
      response.json({ success: true, replacementLocationId: result.replacementId, previousRetained: result.previousRetained });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:locationId/archive', requireCustomerCsrf, async (request, response, next) => {
    try {
      requireUuid(request.params.locationId, 'location identifier');
      const unknown = Object.keys(request.body || {});
      if (unknown.length) return response.status(422).json({ success: false, error: 'Archive requests do not accept additional fields.' });
      const result = await archiveCustomerLocation({ pool, userId: request.customerSession.userId, locationId: request.params.locationId });
      response.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:locationId/requests', requireCustomerCsrf, async (request, response, next) => {
    try {
      requireUuid(request.params.locationId, 'location identifier');
      const unknown = Object.keys(request.body || {}).filter(key => !['requestType', 'reason'].includes(key));
      if (unknown.length) return response.status(422).json({ success: false, error: 'Unknown request fields are not accepted.' });
      const changeRequest = await requestLocationChange({
        pool, userId: request.customerSession.userId, locationId: request.params.locationId,
        requestType: request.body?.requestType, reason: request.body?.reason
      });
      response.status(202).json({ success: true, request: changeRequest });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
