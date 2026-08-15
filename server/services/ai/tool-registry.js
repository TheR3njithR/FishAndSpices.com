import {
  getMarketplaceListingBySlug,
  listMarketplaceCategories,
  listMarketplaceListings,
  listMarketplaceProducts
} from '../marketplace.js';
import {
  createContactRequest,
  createQuote,
  getMarketplaceDashboard,
  removeMarketplaceItem,
  saveMarketplaceItem
} from '../marketplace-account.js';

const LISTING_ROLES = new Set(['buyer', 'seller']);
const LISTING_SORTS = new Set(['newest', 'oldest', 'quantity_desc', 'quantity_asc']);

function requestError(message, status = 422) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function optionalText(value, { max = 160 } = {}) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw requestError('Invalid text input.');
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  if (normalized.length > max) throw requestError('Text input is too long.');
  return normalized;
}

function optionalInt(value, fallback, min, max) {
  if (value === undefined || value === null || value === '') return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) throw requestError('Invalid numeric input.');
  if (numeric < min || numeric > max) throw requestError(`Number must be between ${min} and ${max}.`);
  return numeric;
}

function parseListingFilters(args = {}) {
  const role = optionalText(args.role, { max: 20 })?.toLowerCase() || null;
  if (role && !LISTING_ROLES.has(role)) throw requestError('Invalid role filter.');

  const sort = optionalText(args.sort, { max: 30 })?.toLowerCase() || 'newest';
  if (!LISTING_SORTS.has(sort)) throw requestError('Invalid sort option.');

  return {
    role,
    category: optionalText(args.category, { max: 120 }),
    product: optionalText(args.product, { max: 120 }),
    country: optionalText(args.country, { max: 120 }),
    query: optionalText(args.query, { max: 160 }),
    sort,
    page: optionalInt(args.page, 1, 1, 10_000),
    pageSize: optionalInt(args.pageSize, 20, 1, 100)
  };
}

export function buildAssistantToolDefinitions({ allowWrites }) {
  const baseTools = [
    {
      type: 'function',
      name: 'marketplace_list_categories',
      description: 'List active marketplace categories with product counts.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false
      }
    },
    {
      type: 'function',
      name: 'marketplace_list_products',
      description: 'List marketplace products filtered by optional category slug or query.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          category: { type: ['string', 'null'] },
          query: { type: ['string', 'null'] },
          limit: { type: ['integer', 'null'] }
        },
        required: ['category', 'query', 'limit'],
        additionalProperties: false
      }
    },
    {
      type: 'function',
      name: 'marketplace_search_listings',
      description: 'Search public buyer requirements and seller listings.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          role: { type: ['string', 'null'], enum: ['buyer', 'seller', null] },
          category: { type: ['string', 'null'] },
          product: { type: ['string', 'null'] },
          country: { type: ['string', 'null'] },
          query: { type: ['string', 'null'] },
          sort: { type: ['string', 'null'], enum: ['newest', 'oldest', 'quantity_desc', 'quantity_asc', null] },
          page: { type: ['integer', 'null'] },
          pageSize: { type: ['integer', 'null'] }
        },
        required: ['role', 'category', 'product', 'country', 'query', 'sort', 'page', 'pageSize'],
        additionalProperties: false
      }
    },
    {
      type: 'function',
      name: 'marketplace_get_listing_detail',
      description: 'Get details for a listing by role and slug.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          role: { type: 'string', enum: ['buyer', 'seller'] },
          slug: { type: 'string' }
        },
        required: ['role', 'slug'],
        additionalProperties: false
      }
    }
  ];

  if (!allowWrites) return baseTools;

  return [
    ...baseTools,
    {
      type: 'function',
      name: 'marketplace_create_contact_request',
      description: 'Create a contact request for a listing on behalf of the authenticated user.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          targetLeadId: { type: 'string' },
          message: { type: ['string', 'null'] }
        },
        required: ['targetLeadId', 'message'],
        additionalProperties: false
      }
    },
    {
      type: 'function',
      name: 'marketplace_create_quote',
      description: 'Create a quote for a buyer requirement as the authenticated user.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          requirementLeadId: { type: 'string' },
          sellerLeadId: { type: ['string', 'null'] },
          quantity: { type: 'number' },
          unit: { type: 'string' },
          unitPrice: { type: ['number', 'null'] },
          currency: { type: ['string', 'null'] },
          deliveryTerms: { type: ['string', 'null'] },
          deliveryTime: { type: ['string', 'null'] },
          validUntil: { type: ['string', 'null'] },
          notes: { type: ['string', 'null'] }
        },
        required: ['requirementLeadId', 'sellerLeadId', 'quantity', 'unit', 'unitPrice', 'currency', 'deliveryTerms', 'deliveryTime', 'validUntil', 'notes'],
        additionalProperties: false
      }
    },
    {
      type: 'function',
      name: 'marketplace_save_item',
      description: 'Save a public listing for the authenticated user.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          leadId: { type: 'string' }
        },
        required: ['leadId'],
        additionalProperties: false
      }
    },
    {
      type: 'function',
      name: 'marketplace_remove_saved_item',
      description: 'Remove a saved listing for the authenticated user.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          leadId: { type: 'string' }
        },
        required: ['leadId'],
        additionalProperties: false
      }
    },
    {
      type: 'function',
      name: 'marketplace_get_dashboard',
      description: 'Get the authenticated user marketplace dashboard summary.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false
      }
    }
  ];
}

export async function executeAssistantToolCall({ name, args = {}, pool, userId = null }) {
  switch (name) {
    case 'marketplace_list_categories': {
      return { ok: true, data: await listMarketplaceCategories(pool) };
    }
    case 'marketplace_list_products': {
      const filters = {
        categorySlug: optionalText(args.category, { max: 80 }),
        query: optionalText(args.query, { max: 120 }),
        limit: optionalInt(args.limit, 100, 1, 200)
      };
      return { ok: true, data: await listMarketplaceProducts(pool, filters) };
    }
    case 'marketplace_search_listings': {
      const payload = await listMarketplaceListings(pool, parseListingFilters(args));
      return { ok: true, data: payload };
    }
    case 'marketplace_get_listing_detail': {
      const role = optionalText(args.role, { max: 10 })?.toLowerCase();
      if (!LISTING_ROLES.has(role)) throw requestError('Invalid role filter.');
      const slug = optionalText(args.slug, { max: 180 });
      if (!slug) throw requestError('Listing slug is required.');
      const listing = await getMarketplaceListingBySlug(pool, { role, slug });
      if (!listing) throw requestError('Listing not found.', 404);
      return { ok: true, data: listing };
    }
    case 'marketplace_create_contact_request': {
      if (!userId) throw requestError('Authentication required for contact requests.', 401);
      const contactRequest = await createContactRequest(pool, {
        userId,
        targetLeadId: args.targetLeadId,
        message: args.message
      });
      return { ok: true, data: contactRequest };
    }
    case 'marketplace_create_quote': {
      if (!userId) throw requestError('Authentication required for quote creation.', 401);
      const quote = await createQuote(pool, {
        userId,
        requirementLeadId: args.requirementLeadId,
        sellerLeadId: args.sellerLeadId,
        quantity: args.quantity,
        unit: args.unit,
        unitPrice: args.unitPrice,
        currency: args.currency,
        deliveryTerms: args.deliveryTerms,
        deliveryTime: args.deliveryTime,
        validUntil: args.validUntil,
        notes: args.notes
      });
      return { ok: true, data: quote };
    }
    case 'marketplace_save_item': {
      if (!userId) throw requestError('Authentication required for saved items.', 401);
      const savedItem = await saveMarketplaceItem(pool, { userId, leadId: args.leadId });
      return { ok: true, data: savedItem };
    }
    case 'marketplace_remove_saved_item': {
      if (!userId) throw requestError('Authentication required for saved items.', 401);
      const removedItem = await removeMarketplaceItem(pool, { userId, leadId: args.leadId });
      return { ok: true, data: removedItem };
    }
    case 'marketplace_get_dashboard': {
      if (!userId) throw requestError('Authentication required for dashboard access.', 401);
      const dashboard = await getMarketplaceDashboard(pool, { userId });
      return { ok: true, data: dashboard };
    }
    default:
      throw requestError(`Unsupported assistant tool: ${name}`, 400);
  }
}
