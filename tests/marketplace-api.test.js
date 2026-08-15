import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';

const config = loadConfig({ NODE_ENV: 'test', APP_ORIGIN: 'http://localhost:3000', SESSION_SECRET: 'test-session-secret' });
const pool = { query: vi.fn() };

function buildServices(overrides = {}) {
  return {
    listMarketplaceCategories: vi.fn().mockResolvedValue([
      { slug: 'fish-seafood', name: 'Fish & Seafood', sortOrder: 10, parentId: null, isActive: true, productCount: 14 }
    ]),
    listMarketplaceProducts: vi.fn().mockResolvedValue([
      { slug: 'varal', name: 'Varal', categorySlug: 'fish-seafood', categoryName: 'Fish & Seafood', sortOrder: 10 }
    ]),
    listMarketplaceListings: vi.fn().mockResolvedValue({
      listings: [{ slug: 'varal-xyz123', role: 'seller', product: 'Varal', title: 'Varal Available' }],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 }
    }),
    getMarketplaceListingBySlug: vi.fn().mockResolvedValue({ slug: 'varal-xyz123', role: 'seller', title: 'Varal Available' }),
    ...overrides
  };
}

describe('GET marketplace APIs', () => {
  it('returns public category and product catalog results', async () => {
    const services = buildServices();
    const app = createApp({ config, pool, services });

    const categories = await request(app).get('/api/v1/categories').expect(200);
    expect(categories.body.success).toBe(true);
    expect(categories.body.categories).toHaveLength(1);
    expect(services.listMarketplaceCategories).toHaveBeenCalledWith(pool);

    const products = await request(app)
      .get('/api/v1/products')
      .query({ category: 'fish-seafood', q: 'vara', limit: 20 })
      .expect(200);

    expect(products.body.success).toBe(true);
    expect(products.body.products[0].slug).toBe('varal');
    expect(services.listMarketplaceProducts).toHaveBeenCalledWith(pool, {
      categorySlug: 'fish-seafood',
      query: 'vara',
      limit: 20
    });
  });

  it('returns marketplace listings with validated filters and pagination', async () => {
    const services = buildServices();
    const app = createApp({ config, pool, services });

    const response = await request(app)
      .get('/api/v1/marketplace')
      .query({ category: 'fish', q: 'kerala', country: 'IN', sort: 'newest', page: 2, pageSize: 12 })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.listings).toHaveLength(1);
    expect(services.listMarketplaceListings).toHaveBeenCalledWith(pool, {
      role: null,
      category: 'fish',
      product: null,
      country: 'IN',
      query: 'kerala',
      sort: 'newest',
      page: 2,
      pageSize: 12
    });
  });

  it('forces role-specific listing surfaces and detail lookups', async () => {
    const services = buildServices();
    const app = createApp({ config, pool, services });

    await request(app).get('/api/v1/buyer-requirements').query({ page: 1 }).expect(200);
    expect(services.listMarketplaceListings).toHaveBeenCalledWith(pool, {
      role: 'buyer',
      category: null,
      product: null,
      country: null,
      query: null,
      sort: 'newest',
      page: 1,
      pageSize: 20
    });

    await request(app).get('/api/v1/seller-listings/varal-xyz123').expect(200);
    expect(services.getMarketplaceListingBySlug).toHaveBeenCalledWith(pool, { role: 'seller', slug: 'varal-xyz123' });
  });

  it('returns 404 for missing listing detail and rejects invalid sort', async () => {
    const services = buildServices({ getMarketplaceListingBySlug: vi.fn().mockResolvedValue(null) });
    const app = createApp({ config, pool, services });

    const missing = await request(app).get('/api/v1/buyer-requirements/missing-slug').expect(404);
    expect(missing.body).toMatchObject({ success: false, error: 'Requirement not found.' });

    const invalid = await request(app).get('/api/v1/marketplace').query({ sort: 'random' }).expect(422);
    expect(invalid.body.success).toBe(false);
    expect(invalid.body.error).toBe('Invalid sort option.');
  });
});
