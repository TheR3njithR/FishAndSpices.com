# FishAndSpices AI Marketplace Assistant Admin Guide

## 1) Admin responsibilities

Platform administrators are responsible for:

- monitoring assistant health and usage,
- reviewing abuse and policy violations,
- validating conversion quality,
- applying controlled rollbacks when needed.

## 2) Admin surface (planned)

Recommended admin endpoints under `/api/v1/admin/ai-assistant`:

- `GET /overview`
  - request volume, success rate, median latency, tool-call counts.

- `GET /tools`
  - per-tool invocation counts, failure rates, top error codes.

- `GET /conversations`
  - filtered conversation list by channel, locale, actor type, status.

- `GET /events`
  - abuse and safety events, policy blocks, rate-limit triggers.

- `POST /controls/kill-switch`
  - enable or disable assistant globally.

- `POST /controls/mode`
  - switch between `text_only`, `voice_enabled`, and `maintenance`.

All endpoints must keep existing admin auth + CSRF + role checks.

## 3) Daily operational checks

1. Check `/api/health` and assistant overview metrics.
2. Review tool failure spikes and auth errors.
3. Inspect top unresolved user intents (where no valid tool path was executed).
4. Sample multilingual responses for tone and factual correctness.
5. Confirm conversion handoffs (contact requests, quote submissions) are completing.

## 4) Incident runbooks

### A) Sudden 5xx or timeout spike

1. Set assistant mode to `maintenance` (or enable kill switch).
2. Keep static marketplace browsing available.
3. Inspect upstream OpenAI error rates and local DB latency.
4. Roll back to previous stable revision if issue is release-related.

### B) Unauthorized tool attempts increase

1. Review policy-block event feed.
2. Confirm anonymous actor cannot call write tools.
3. Tighten rate limits for offending IPs/tokens.
4. Review prompt content for abuse patterns.

### C) Incorrect multilingual output trend

1. Verify locale hints and language detection behavior.
2. Update system prompt constraints for language preference.
3. Add regression fixtures for Malayalam/Hindi/English switching.

## 5) Quality evaluation cadence

Weekly scorecard:

- assistant response acceptance rate,
- successful conversion rate after assistant interaction,
- tool error rate by tool,
- median and p95 latency,
- abuse-event rate,
- manual QA pass rate for multilingual interactions.

## 6) Manual verification scripts

Minimum admin smoke checks before approving production promotion:

1. Anonymous user can browse listings through assistant but cannot create contact requests.
2. Authenticated user can create contact request via assistant path.
3. Authenticated user can create quote via assistant path.
4. Tool failures are returned as friendly messages and logged with error codes.
5. Kill switch disables assistant endpoints without affecting core marketplace APIs.

## 7) Data access controls

- Limit raw conversation access to required admin roles only.
- Redact sensitive data in default admin list views.
- Require explicit action for full payload inspection.
- Log all admin reads of full conversation content.
