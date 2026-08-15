# Railway deployment

Deploy to staging, verify there, and only then promote the same reviewed revision to production.

## Required service variables

- `NODE_ENV=staging` in staging and `NODE_ENV=production` in production
- `APP_ORIGIN` set to the exact HTTPS origin without a trailing slash
- `DATABASE_URL` and `DATABASE_UNPOOLED_URL` as Railway references to PostgreSQL
- `SESSION_SECRET` generated from at least 32 random bytes
- `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` valid for the deployed hostname (mandatory in production; staging submissions remain closed until configured)
- `BUSINESS_WHATSAPP_NUMBER`, `BUSINESS_EMAIL` and optional notification provider values

Never set `TURNSTILE_DEV_BYPASS` in staging or production. Do not print or commit secret values.

## GitHub Actions CI/CD

Workflows live in `.github/workflows/`:

- `ci.yml` runs on pull requests and pushes to `main` and `release/**`, executing `npm ci`, `npm run check`, `npm test`, and `npm audit --omit=dev`.
- `deploy-staging.yml` deploys to Railway staging after a successful push CI run on `main` or `release/**` (and can also be triggered manually).
- `promote-production.yml` is manual-only and requires an explicit `PROMOTE` confirmation plus staging evidence before deploying to production.

Set these GitHub repository secrets before enabling deployment workflows:

- `RAILWAY_TOKEN`
- `RAILWAY_PROJECT_ID`
- `RAILWAY_STAGING_SERVICE`
- `RAILWAY_STAGING_ENVIRONMENT`
- `RAILWAY_PRODUCTION_SERVICE`
- `RAILWAY_PRODUCTION_ENVIRONMENT`

If GitHub Environments are used, map the staging and production secrets to the corresponding environment scopes.

## Staging release

1. Create a Railway staging environment from the existing project without replacing production services.
2. Reference the staging PostgreSQL variables from the web service and set the exact staging `APP_ORIGIN`.
3. Deploy the GitHub revision. `railway.toml` runs `npm ci`, `npm run migrate`, `npm start`, and checks `/api/health`.
4. Bootstrap a staging-only administrator through a controlled terminal, then unset its bootstrap password.
5. Verify health, homepage assets, login/session/logout, unauthorized rejection, and all four buyer/seller journeys.
6. Verify each test lead's related organisation, contact, role detail, category specification and consent rows; test status, interaction, verification and match operations.
7. Remove only records identified by their test public references with `CONFIRM_TEST_CLEANUP=true`, `TEST_PUBLIC_REFERENCES` and `npm run cleanup-test-data`. Test administrator cleanup accepts only `@example.invalid`. Do not truncate shared tables.
8. Inspect application and PostgreSQL logs for secret leakage, failed migrations and unexpected 4xx/5xx responses.

## Production promotion

Promote only after staging passes. Configure production-specific database references, origin, session secret and Turnstile keys. Apply migrations through predeploy and repeat health, authentication and one controlled submission check.

Custom-domain DNS is an external change: request Railway's exact CNAME/TXT records, report them for review, and do not alter DNS without explicit authorization.