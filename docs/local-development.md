# Local development

## Prerequisites

- Node.js 22 or newer
- PostgreSQL 15 or newer

## Configure and run

```powershell
npm ci
Copy-Item .env.example .env
npm run migrate
$env:ADMIN_BOOTSTRAP_EMAIL='admin@example.com'
$env:ADMIN_BOOTSTRAP_PASSWORD='use-a-unique-16-character-or-longer-password'
npm run bootstrap-admin
npm run dev
```

Use a local database and local-only secret values. Do not reuse staging or production credentials. The app listens on `http://localhost:3000` by default.

`TURNSTILE_DEV_BYPASS=true` permits the browser to send `development-bypass` only outside production. Production configuration rejects the bypass regardless of that variable.

## Verification

```powershell
npm test
npm run check
```

Automated tests use mocked infrastructure and do not create remote records. Run staging smoke tests against Railway before promotion.