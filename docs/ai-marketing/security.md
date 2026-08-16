# Security Review

## Mitigations

- Admin access: existing hashed sessions, strict cookies, CSRF, roles, and audit records
- Prompt injection: system/application/untrusted context separation; marketplace text is data, not instructions
- Tool escalation: database allow/deny lists plus server-side policy checks
- Database risk: controlled parameterized services; agents receive no arbitrary SQL tool
- Secrets/PII: server-only keys and aggregate/minimized marketplace metrics
- SSRF/shell: no arbitrary URL, network, filesystem, or shell tool
- XSS: admin UI escapes all AI and database text; no generated HTML insertion
- Spending: global/per-agent limits, run limits, concurrency lock, hard stop, ledger
- Retry storms: bounded task attempts, exponential delay, provider timeout
- Scheduler duplication: task and successful-run idempotency keys plus row locks
- Privilege escalation: super-admin-only kill switch; administrator-only workflow mutations
- Hidden reasoning: only structured output and concise rationale summaries are stored/displayed
- Retention: raw responses have an expiry timestamp; structured audit and costs remain

## Residual risks

The repository-wide CSP still permits inline script/style for legacy pages. Provider pricing estimates need periodic review. Production promotion still requires the broader project security, backup/restore, monitoring, incident-response, and privacy gates documented in `docs/PRODUCTION_READINESS.md`.
