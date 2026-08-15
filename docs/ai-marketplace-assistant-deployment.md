# FishAndSpices AI Marketplace Assistant Deployment

Deploy AI assistant changes to staging first, verify, then promote to production.

This runbook extends the existing platform deployment process in `docs/deployment.md`.

## 1) Environment variables

Add these variables to Railway (staging and production with environment-specific values):

- `OPENAI_API_KEY`
- `AI_ASSISTANT_ENABLED` (`true` or `false`)
- `AI_ASSISTANT_DEFAULT_MODE` (`text_only`, `voice_enabled`, `maintenance`)
- `AI_ASSISTANT_DEFAULT_MODEL` (for Responses API)
- `AI_ASSISTANT_MAX_TURNS_ANON` (integer)
- `AI_ASSISTANT_MAX_TURNS_AUTH` (integer)
- `AI_ASSISTANT_RATE_LIMIT_PER_MINUTE_IP` (integer)
- `AI_ASSISTANT_RATE_LIMIT_PER_MINUTE_USER` (integer)
- `AI_ASSISTANT_ALLOWED_ORIGINS` (comma-separated)
- `AI_ASSISTANT_LOG_SENSITIVE_CONTENT` (`false` in production)

Optional voice/realtime controls:

- `AI_VOICE_ENABLED` (`true` or `false`)
- `AI_REALTIME_ENABLED` (`true` or `false`)
- `AI_TTS_MODEL` (default `gpt-4o-mini-tts`)
- `AI_STT_MODEL` (default `gpt-transcribe`)

## 2) Database migration order

1. Create additive migration for assistant tables (for example `006_ai_assistant_core.sql`).
2. Ensure migration is idempotent and reversible where practical.
3. Commit migration with route/service code in same release.

Railway will execute migration through existing predeploy command:

- `npm run migrate`

## 3) Staging rollout checklist

1. Set `AI_ASSISTANT_ENABLED=true` and `AI_ASSISTANT_DEFAULT_MODE=text_only` in staging.
2. Deploy revision and verify `GET /api/health` remains healthy.
3. Verify anonymous chat flow:
   - listing search and detail responses work,
   - write actions are blocked with authorization error.
4. Verify authenticated chat flow:
   - save item works,
   - contact request works,
   - quote creation works.
5. Verify audit entries and tool-call telemetry are written.
6. Validate Malayalam/Hindi/English prompts and responses.
7. If voice is enabled in staging, verify bounded STT/TTS endpoints.

## 4) Production promotion checklist

Promote only after staging passes.

1. Confirm same git revision promoted from staging.
2. Confirm production env vars are set and secrets are not logged.
3. Keep initial mode as `text_only` for first production cut.
4. Run controlled smoke tests with a production-safe test account.
5. Monitor for 30-60 minutes before enabling `voice_enabled` mode.

## 5) Rollback strategy

Fast rollback options (in this order):

1. Set `AI_ASSISTANT_ENABLED=false` (disables assistant routes quickly).
2. Set `AI_ASSISTANT_DEFAULT_MODE=maintenance` (soft disable with fallback messaging).
3. Redeploy previous stable revision.

Database rollback is usually not required for additive schemas; keep old schema compatible with prior app versions.

## 6) Post-deploy monitoring

Monitor at minimum:

- request success rate and p95 latency for `/api/v1/ai/*`,
- tool call failures by error code,
- auth failures and CSRF failures,
- conversation volume split by anonymous vs authenticated,
- conversion actions started/completed (contact requests, quotes).

## 7) Security verification after deploy

1. Confirm no OpenAI key exposure in client scripts.
2. Confirm anonymous write attempts are blocked.
3. Confirm rate limits are active.
4. Confirm audit rows exist for AI-mediated write actions.
