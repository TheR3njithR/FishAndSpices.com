import { Router } from 'express';
import {
  getMarketplaceListingBySlug,
  listMarketplaceCategories,
  listMarketplaceListings,
  listMarketplaceProducts
} from '../services/marketplace.js';

const VALID_SORTS = new Set(['newest', 'oldest', 'quantity_desc', 'quantity_asc']);
const VALID_ROLES = new Set(['buyer', 'seller']);

function requestError(message, status = 422) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeText(value, { max = 120 } = {}) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw requestError('Invalid query parameter.');
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  if (normalized.length > max) throw requestError('A query parameter is too long.');
  return normalized;
}

function positiveInt(value, { fallback, min = 1, max = 100 } = {}) {
  if (value === undefined || value === null || value === '') return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) throw requestError('Pagination values must be whole numbers.');
  if (numeric < min || numeric > max) throw requestError(`Pagination values must be between ${min} and ${max}.`);
  return numeric;
}

function parseListFilters(query, forcedRole = null) {
  const role = forcedRole || normalizeText(query.role, { max: 10 })?.toLowerCase() || null;
  if (role && !VALID_ROLES.has(role)) throw requestError('Invalid role filter.');

  const category = normalizeText(query.category, { max: 20 })?.toLowerCase() || null;

  const sort = normalizeText(query.sort, { max: 20 })?.toLowerCase() || 'newest';
  if (!VALID_SORTS.has(sort)) throw requestError('Invalid sort option.');

  return {
    role,
    category,
    product: normalizeText(query.product, { max: 120 }),
    country: normalizeText(query.country, { max: 80 }),
    query: normalizeText(query.q, { max: 120 }),
    sort,
    page: positiveInt(query.page, { fallback: 1, min: 1, max: 10_000 }),
    pageSize: positiveInt(query.pageSize, { fallback: 20, min: 1, max: 100 })
  };
}

export function createMarketplaceRouter({ pool, services = {} }) {
  const router = Router();

  const listCategories = services.listMarketplaceCategories || listMarketplaceCategories;
  const listProducts = services.listMarketplaceProducts || listMarketplaceProducts;
  const listListings = services.listMarketplaceListings || listMarketplaceListings;
  const getBySlug = services.getMarketplaceListingBySlug || getMarketplaceListingBySlug;

  router.get('/categories', async (_request, response, next) => {
    try {
      response.json({ success: true, categories: await listCategories(pool) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/products', async (request, response, next) => {
    try {
      const filters = {
        categorySlug: normalizeText(request.query.category, { max: 80 }),
        query: normalizeText(request.query.q, { max: 120 }),
        limit: positiveInt(request.query.limit, { fallback: 100, min: 1, max: 200 })
      };
      response.json({ success: true, products: await listProducts(pool, filters) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/marketplace', async (request, response, next) => {
    try {
      const payload = await listListings(pool, parseListFilters(request.query));
      response.json({ success: true, ...payload });
    } catch (error) {
      next(error);
    }
  });

  router.get('/buyer-requirements', async (request, response, next) => {
    try {
      const payload = await listListings(pool, parseListFilters(request.query, 'buyer'));
      response.json({ success: true, ...payload });
    } catch (error) {
      next(error);
    }
  });

  router.get('/seller-listings', async (request, response, next) => {
    try {
      const payload = await listListings(pool, parseListFilters(request.query, 'seller'));
      response.json({ success: true, ...payload });
    } catch (error) {
      next(error);
    }
  });

  router.get('/buyer-requirements/:slug', async (request, response, next) => {
    try {
      const listing = await getBySlug(pool, {
        role: 'buyer',
        slug: normalizeText(request.params.slug, { max: 180 })
      });
      if (!listing) return response.status(404).json({ success: false, error: 'Requirement not found.' });
      response.json({ success: true, listing });
    } catch (error) {
      next(error);
    }
  });

  router.get('/seller-listings/:slug', async (request, response, next) => {
    try {
      const listing = await getBySlug(pool, {
        role: 'seller',
        slug: normalizeText(request.params.slug, { max: 180 })
      });
      if (!listing) return response.status(404).json({ success: false, error: 'Listing not found.' });
      response.json({ success: true, listing });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
