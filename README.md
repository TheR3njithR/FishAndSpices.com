# Fish & Spices

Managed B2B lead-qualification platform for fish, seafood and spices. Express serves the approved frontend and versioned APIs; Railway PostgreSQL stores private lead, administrator, verification, matching, consent and audit records.

## Local development

Requires Node.js 22 or newer and PostgreSQL. From this directory:

```powershell
npm ci
Copy-Item .env.example .env
npm run migrate
npm run bootstrap-admin
npm run dev
```

Set a strong local `SESSION_SECRET`, database URL, and one-time `ADMIN_BOOTSTRAP_EMAIL` / `ADMIN_BOOTSTRAP_PASSWORD` environment values before bootstrapping. `TURNSTILE_DEV_BYPASS=true` works only when `NODE_ENV` is not `production`.

## Architecture

- `server/` - Express composition, security middleware, versioned routes and PostgreSQL services
- `db/migrations/` - checksum-protected, additive PostgreSQL migrations
- `scripts/migrate.mjs` - advisory-locked migration runner used during Railway predeploy
- `scripts/bootstrap-admin.mjs` - explicit administrator creation or password rotation
- `admin/` - cookie-authenticated operational dashboard
- `assets/js/lead-form.js` - four public qualification journeys posting to `POST /api/v1/leads`
- `tests/` - validation, transaction, API, authentication and deterministic matching tests
- `docs/` - local operation, database, deployment, matching and retention guidance

## Security model

Public lead submission enforces same-origin JSON, a 48 KB body limit, strict schema validation, a honeypot, minimum completion time, Cloudflare Turnstile and persistent hashed rate limits. Related records are inserted in one transaction and the response exposes only a non-sequential public reference.

Administrator access uses bcrypt password hashes, revocable database sessions, strict HTTP-only cookies, CSRF tokens, active-user and role checks, login throttling and audit records. Never expose database URLs, session secrets, Turnstile secrets or administrator bootstrap passwords to browser code.

## Commands

```powershell
npm test
npm run check
npm run migrate
npm run bootstrap-admin
npm start
```

See [docs/local-development.md](docs/local-development.md), [docs/database.md](docs/database.md), [docs/deployment.md](docs/deployment.md) and [docs/PASSWORDLESS_IDENTITY.md](docs/PASSWORDLESS_IDENTITY.md). Production submissions remain unavailable until Railway database references, strong session and OTP secrets, the exact application origin and valid Turnstile keys are configured. Customer OTP delivery also requires a configured delivery provider; the platform reports it as unavailable rather than simulating delivery.

## Security review and production approval

- [docs/SECURITY_AUDIT_HANDOFF.md](docs/SECURITY_AUDIT_HANDOFF.md) is the white-box handoff for an independent security agency.
- [docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md) is the release-gate checklist and current readiness decision.
- [SECURITY.md](SECURITY.md) defines private vulnerability reporting and coordinated disclosure.

Passing automated tests does not establish that the application cannot be compromised. Production approval requires the gates in the readiness document, including a review of the exact committed release revision and a retest of corrected security findings.