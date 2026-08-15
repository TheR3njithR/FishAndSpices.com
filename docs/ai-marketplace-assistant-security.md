# FishAndSpices AI Marketplace Assistant Security

## 1) Security goals

- Prevent data leakage and privilege escalation.
- Preserve existing auth, CSRF, and RBAC protections.
- Keep OpenAI long-lived secrets server side only.
- Ensure full auditability for all AI-assisted actions.

## 2) Threat model

Primary threats:

1. Prompt injection leading to unauthorized tool execution.
2. Anonymous user attempting authenticated actions.
3. Cross-site request forgery on write operations.
4. Exfiltration of PII through model prompts or logs.
5. Replay/abuse of realtime credentials.
6. Over-broad admin tool exposure.

## 3) Core controls

### 3.1 Identity and authorization

- Reuse existing `requireCustomerAuthentication` and `requireCustomerCsrf` for customer writes.
- Reuse existing admin auth middleware and role checks for admin assistant surfaces.
- Compute tool allowlist per request from actor class (anonymous/customer/admin).
- Deny by default for unknown tools.

### 3.2 Secret management

- `OPENAI_API_KEY` is loaded only in server runtime.
- Never return `OPENAI_API_KEY` to browser, logs, or analytics payloads.
- For browser realtime, issue short-lived credentials via server endpoint only.
- Apply standard Railway secret hygiene and do not commit `.env` values.

### 3.3 Tool-call hardening

- Strict JSON schema on all function tools.
- `additionalProperties: false` to block payload smuggling.
- UUID and enum validation at handler boundary even after schema validation.
- Idempotency keys for write actions where duplicate submission risk exists.

### 3.4 Prompt-injection resistance

- System instruction states that policy is server-authoritative.
- Assistant is not trusted to authorize tools; server authorizes each call.
- Tool descriptions avoid hidden control text and are narrowly scoped.
- External content is treated as untrusted input and never as policy.

### 3.5 Data minimization

- Send only required fields to model for each turn.
- Redact or hash identifiers in telemetry where full value is not needed.
- Avoid sending full internal records when summaries suffice.

## 4) Realtime-specific controls

- Create ephemeral credentials with user safety identifier and actor context.
- Bind each credential issuance to session metadata and short TTL.
- Rate-limit session creation by IP, anonymous token, and account id.
- Disable direct client-initiated server tool execution; route through backend.

## 5) Audit and forensic readiness

For each assistant interaction capture:

- who: anonymous token hash or user id,
- when: request timestamp and duration,
- what: tool attempted, args hash, result status,
- why blocked: policy rule and error code,
- trace ids: API request id and model response id.

Store immutable audit rows for sensitive operations:

- contact request creation,
- quote creation,
- admin moderation changes triggered by AI workflows.

## 6) Abuse prevention and safety

- Layered limits:
  - per-IP,
  - per-anonymous token,
  - per-authenticated account,
  - per-tool mutation path.
- Automatic cooldown on repeated policy violations.
- Safety identifier propagation to OpenAI requests.
- Optional moderation checks for high-risk user content before tool execution.

## 7) Privacy and retention

- Conversation retention defaults should be explicit and documented.
- Separate operational logs from conversational content.
- Retain minimally necessary fields for fraud, abuse, and compliance.
- Support deletion workflows keyed by customer identity.

## 8) Security checklist for release

Pre-staging:

1. Verify no key exposure in client bundles.
2. Verify tool policy denies write operations for anonymous users.
3. Verify CSRF failures return 403 on all AI-mediated writes.
4. Verify audit log entries are written for every tool call.
5. Verify realtime credential endpoint enforces rate limits and auth context.

Pre-production:

1. Replay staging abuse tests (prompt injection, privilege escalation attempts).
2. Validate alerting for tool error spikes and auth failures.
3. Confirm rollback switch for AI routes and realtime session issuance.
