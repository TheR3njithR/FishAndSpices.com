# Testing

`tests/marketing-ai.test.js` covers fail-safe defaults, model routing, cached-token costing, warning projection, budget hard stop, structured schema acceptance/rejection, deterministic mock provider behavior, tool allowlists, simulation bypass, and unauthenticated access.

The existing suite covers administrator RBAC/CSRF, marketplace APIs, partner idempotency, authentication, privacy-conscious locations, lead validation, and matching. Tests never call a paid AI provider.

Validation commands:

```powershell
npm ci
npm run check
npm test
npm run migrate
```

Run migration validation against an isolated/staging database before production. Manually verify `/admin/marketing-ai` at mobile and desktop sizes, queue one Director task, run one worker cycle, inspect the run/cost ledger, and confirm that approving generated content does not publish it.
