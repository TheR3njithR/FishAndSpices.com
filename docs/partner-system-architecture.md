# FishAndSpices Partner Network Architecture

## 1) Existing application audit

### Stack and runtime

- Backend: Node.js 22, Express 5 ESM, PostgreSQL (`pg`) with parameterized SQL.
- Frontend: static HTML + vanilla JavaScript + shared CSS (`assets/css/styles.css`, `assets/css/pages.css`) with page-level scripts.
- Auth:
  - Administrator auth: password + session cookie + CSRF (`server/auth-middleware.js`, `server/services/auth.js`).
  - Customer auth: OTP challenge/verify + session cookie + CSRF (`server/customer-auth-middleware.js`, `server/services/customer-auth.js`).
- Security middleware: Helmet, same-origin checks on mutable `/api` requests, strict JSON, structured error handling (`server/app.js`, `server/middleware.js`).
- Rate limiting: database-backed bucket model (`server/services/rate-limit.js`).
- Migration system: additive SQL migrations in `db/migrations`, transactional advisory lock runner (`scripts/migrate.mjs`).
- Deployment: Railway with `npm run migrate` predeploy and `/api/health` healthcheck (`railway.toml`).

### API and routing model

- API is mounted under `/api` and versioned under `/api/v1` (`server/routes/api.js`).
- Existing route modules are domain-oriented (leads, admin, marketplace, customer auth, me, AI assistant).
- Existing service modules encapsulate business logic and are injected into routes for testability.

### Data and lifecycle entities already present

- User/identity/session:
  - `fas_customer_users`, `fas_user_identities`, `fas_customer_sessions`, `fas_customer_authentication_challenges`.
- Intake and qualification:
  - `leads`, `buyer_requirements`, `seller_offers`, `fish_specifications`, `spice_specifications`, `consent_records`.
- Marketplace and conversion surfaces:
  - `fas_contact_requests`, `fas_quotes`, `fas_saved_items`, `fas_reports`, listing metadata on `leads`.
- Operations and audit:
  - `administrator_users`, `administrator_sessions`, `audit_log`, `fas_location_risk_events`.
- Master data:
  - `fas_master_options` with admin-managed set values.

### Observed constraints relevant to partner system

- No ORM; all partner features should follow existing SQL-service patterns.
- Existing platform currently has no dedicated order/payment transaction table; lifecycle signals are currently strongest around leads, requirements, listings, quotes, matches, and account verification.
- Same-origin protection applies to mutable API endpoints, so referral capture should use GET-safe capture or first-party same-origin calls.
- Current admin UI is static page + API and should be extended in the same style.

## 2) Reusable integration points

### Referral attribution entry points

- Public page landings with `?ref=CODE` can be captured in browser and/or GET API calls.
- Lead submission payload already carries `sourcePage`, `referrer`, and UTM fields from `assets/js/lead-form.js` and `server/validation/lead.js`.

### User linkage points

- Guest user creation and identity linking in `server/services/identity.js` and `server/services/leads.js`.
- OTP verification and identity confirmation in `server/services/customer-auth.js`.

### Event emission candidates

- `createLead`: registration-like acquisition and role-specific events.
- `verifyChallenge`: OTP verification event.
- Marketplace account actions (`createContactRequest`, `createQuote`, saved items) for qualified engagement.
- Admin matching actions (`/api/v1/admin/matches`) for progression signals.

### Authorization model reuse

- Admin Partner APIs reuse admin session + CSRF middleware.
- Partner-facing dashboard APIs reuse customer session auth and enforce ownership by `partner.user_id` server-side.

## 3) Partner Network domain design (additive)

The Partner Network is modeled as first-party acquisition attribution and commission accounting, not as a replacement for existing users/leads/marketplace entities.

### New domain families

- Partner identity and profile (`fas_partners`, statuses, partner types, referral code).
- Attribution and clicks (`fas_partner_referral_clicks`, `fas_partner_referral_attributions`, `fas_partner_referrals`).
- Event ledger (`fas_partner_events`) generated from existing lifecycle actions.
- Commission engine (`fas_partner_commission_plans`, `fas_partner_commission_rules`, `fas_partner_commissions`).
- Fraud review (`fas_partner_fraud_flags`).
- Payout accounting (`fas_partner_payouts`).
- Campaigns and deep-link analytics (`fas_partner_campaigns`).
- Global partner settings (`fas_partner_settings`).

### Design principles

- No destructive changes to current production tables.
- Reuse `uuid`, `timestamptz`, and check-constraint style already used in the schema.
- Use privacy-safe hashing for IP/agent-derived identifiers where retained.
- Enforce idempotency via deterministic uniqueness keys and/or unique constraints.
- Keep commission rules configurable in data; do not hardcode reward values.

## 4) Required changes by layer

### Database

- Add one additive migration for partner schema and indexes.
- Add optional nullable attribution fields to existing entities only where needed.
- Add uniqueness constraints preventing double commission generation.

### Backend services

- `PartnerReferralService`:
  - validates referral code,
  - captures first valid attribution cookie/token,
  - records referral clicks,
  - links attribution to user on first qualifying registration/link event.
- `PartnerEventService`:
  - writes immutable partner events from platform lifecycle hooks.
- `PartnerCommissionService`:
  - selects active rules,
  - applies partner/user/event filters,
  - enforces duplicate prevention and limits,
  - creates pending/review/payable commissions,
  - applies cooling period.
- `PartnerAnalyticsService`:
  - computes partner/admin KPIs and paginated tables.

### API routes

- Public:
  - partner application submission,
  - referral capture endpoint,
  - referral deep-link campaign generation metadata.
- Admin:
  - partner CRUD/status,
  - commission plan/rule CRUD,
  - commission review actions,
  - payout tracking actions,
  - fraud flag review,
  - analytics and CSV export.
- Partner (authenticated):
  - own profile summary,
  - own referrals/events/earnings/payouts/campaign views,
  - own campaign link + QR generation.

### Frontend pages

- Public:
  - `/partners`, `/partners/apply`, `/partners/terms`.
- Admin:
  - `/admin/partners`, `/admin/partner-settings`, `/admin/partner-settings/commission-plans`.
- Partner:
  - `/partner/dashboard`, `/partner/referrals`, `/partner/earnings`.

All pages should follow existing static HTML + page-script + existing design tokens.

## 5) Migration and rollout strategy

1. Add additive migration for all partner tables and indexes.
2. Add feature flags in config/env:
   - `PARTNER_NETWORK_ENABLED`
   - `PARTNER_PUBLIC_APPLICATIONS_ENABLED`
   - `PARTNER_PAYOUT_REQUESTS_ENABLED`
3. Deploy backend routes/services with flags defaulting to safe/disabled as needed.
4. Add referral capture in public frontend with first-valid attribution behavior.
5. Wire event emission in existing lead/auth/marketplace/admin match flows.
6. Enable admin management screens, then partner dashboard screens.
7. Run staging migrations and smoke test end-to-end scenario before production promotion.

## 6) Reuse vs new implementation decisions

- Reuse existing:
  - session auth, CSRF, middleware, logging style, error handling, audit logging table,
  - lead and marketplace lifecycle surfaces,
  - migration runner and deployment path.
- New:
  - partner/acquisition schema,
  - commission/rule engine,
  - partner-specific admin and partner-facing APIs/UI,
  - campaign and payout accounting surfaces.

## 7) Known gaps and compatibility note

- A dedicated transaction/order completion table is not currently present in this codebase. Partner event support will include transaction event types, but first implementation will hook to available validated lifecycle milestones and remain forward-compatible for future transaction integration.
