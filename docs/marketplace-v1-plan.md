# Marketplace V1 Plan

Prepared for: FishAndSpices.com

## Objectives

- Upgrade the current lead platform into a production-ready marketplace for fish, seafood, spices, agricultural products, and processed food products.
- Preserve existing useful functionality: lead capture, admin moderation workflow, location consent, passwordless customer identity, security controls, and Railway deployment.
- Keep browsing open to anonymous visitors and require verification only for protected interactions.

## Current Architecture Snapshot

- Runtime: Node.js 22, Express 5, PostgreSQL.
- Deployment: Railway with Dockerfile build and `npm run migrate` predeploy.
- Existing public flows: buyer/seller intake forms posting to `POST /api/v1/leads`.
- Existing security: strict JSON API, origin checks, Turnstile, rate limiting, server-side validation, CSRF/session protections.
- Existing account model: passwordless customer auth via OTP challenge/verify endpoints.
- Existing admin model: private dashboard for lead review, verification checks, and matching.
- Existing data model: `leads`, `buyer_requirements`, `seller_offers`, `fish_specifications`, `spice_specifications`, `matches`, verification and consent records.

## Target Architecture

### Reuse and Extension Strategy

- Reuse `leads` as canonical marketplace entity spine to avoid unnecessary duplication.
- Treat `buyer_requirements` as buyer-side marketplace records and `seller_offers` as seller-side marketplace records.
- Add marketplace-oriented fields to `leads` for visibility, moderation, lifecycle status, slug, title, publish/expiry timestamps.
- Add catalog and interaction tables for categories/products, quotes, contact requests, saved items, reports, images, status history, and admin notes.
- Keep old private records private by default.

### Public Surfaces

- `/` upgraded homepage with marketplace-first messaging and live previews.
- `/marketplace` combined discovery/search page.
- `/buyers` buyer requirements search page.
- `/suppliers` seller offers search page.
- `/requirement/:slug` buyer requirement detail page.
- `/product/:slug` seller listing detail page.

### Protected Interactions

- Contact seller / contact buyer -> authenticated contact request.
- Send quote -> authenticated quote submission.
- Save item -> authenticated saved item API.

## Migration Strategy

1. Add additive migration `005_marketplace_v1.sql`.
2. Add new fields and tables with conservative defaults.
3. Backfill existing rows:
	- default visibility: `PRIVATE`.
	- default moderation: `APPROVED` for legacy operational continuity.
	- lifecycle derived from archive state.
4. Create indexes for marketplace queries and filters.
5. Avoid destructive changes; no dropping production tables.

## API Plan

### Public API

- `GET /api/v1/categories`
- `GET /api/v1/products`
- `GET /api/v1/marketplace`
- `GET /api/v1/buyer-requirements`
- `GET /api/v1/seller-listings`
- `GET /api/v1/buyer-requirements/:slug`
- `GET /api/v1/seller-listings/:slug`

### Authenticated Customer API

- `POST /api/v1/contact-requests`
- `POST /api/v1/quotes`
- `POST /api/v1/saved-items`
- `DELETE /api/v1/saved-items/:leadId`
- `GET /api/v1/account/dashboard`

### Admin API Extension

- moderation/status transitions for listing visibility and lifecycle.
- review queues for contact requests, quotes, and reports.

## UI Plan

1. Homepage rewrite with:
	- buy/sell headline and CTAs.
	- marketplace search bar.
	- latest buyers/suppliers previews with empty states.
2. Marketplace pages with URL query filters and pagination.
3. Detail pages with protected interaction CTAs.
4. Keep existing buy/sell forms and add explicit visibility choice.
5. Extend account dashboard to show listings, requirements, contact requests, and quotes.

## SEO and Content Plan

- Add metadata and canonical tags for new pages.
- Keep account/admin pages `noindex`.
- Update sitemap and robots for public marketplace URLs.
- Add no-fake-data empty states instead of fabricated activity.

## Security and Privacy Plan

- Enforce visibility server-side in all public APIs.
- Never expose contact details in public endpoints.
- Keep moderation gate before publication when configured.
- Keep OTP/session/CSRF protections for protected actions.
- Validate quote/contact request payloads server-side.

## Risks

- Existing lead workflows must remain functional while adding marketplace endpoints.
- Legacy records may have incomplete fields for fully public cards.
- Additional migrations increase deployment risk if not tested in staging.

## Rollback Strategy

- Schema changes are additive and non-destructive.
- Application rollback can use previous deployment image while keeping new columns/tables unused.
- If a feature must be disabled, hide UI entry points and gate API routes while preserving data.

## Implementation Order

1. Migration + server model extensions.
2. Public marketplace APIs.
3. Protected interaction APIs.
4. New pages and homepage refresh.
5. Account/admin extensions.
6. SEO + test coverage.
7. Staging deploy and verification.

