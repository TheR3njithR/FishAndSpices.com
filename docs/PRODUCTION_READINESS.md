# Production readiness

Assessment date: 2026-08-15

Current decision: **NOT YET APPROVED FOR PRODUCTION**

The application is operational on Railway staging and has meaningful automated and browser verification. That is not equivalent to a security certification. Production promotion must wait until every blocking gate below has evidence and an accountable approver.

## Current verified baseline

- Railway staging baseline deployment `3685a14d-bbd1-4a4c-8d04-17d4aa6aba51` completed successfully before the release candidate was committed.
- The release candidate is committed and tagged (`v3.0.0-rc.3`) and builds from a pinned `Dockerfile` (`builder = "DOCKERFILE"`); staging deployment `29775be6-9e55-45e0-b4c2-8f29e3144f4f` from that build is healthy.
- Migrations `001`, `002` and `003` are applied in staging and protected by stored SHA-256 checksums.
- `npm test` passes 127 tests across 15 test files.
- `npm run check` resolves all local HTML assets and syntax-checks JavaScript.
- Editor diagnostics reported no errors at the assessment date.
- `npm audit --omit=dev` reported zero known production dependency vulnerabilities.
- Live staging health returned `status=ok` and `database=available`.
- Live headers included CSP, one-year HSTS with subdomains, `nosniff`, frame protection and strict-origin referrer policy.
- A controlled staging lead verified transactional guest identity, consent and manual location storage; the exact test records were subsequently removed.
- Approximate access location remains fail-closed because no trusted signed proxy is configured.
- Production, DNS and the public-domain route were not changed during staging verification.

## Blocking release gates

| Gate | Current state | Required evidence |
| --- | --- | --- |
| Reproducible source revision | **Addressed; pending prod pipeline**: committed and tagged `v3.0.0-rc.3`, built from a pinned `Dockerfile` so all build paths produce the same Node runtime | Deploy only reviewed, tagged revisions; confirm the Railway service builder is Dockerfile for dashboard-triggered rebuilds |
| Independent security review | **Blocked** | White-box review, authenticated API test and external staging penetration test against the release candidate; remediate and retest High/Critical findings |
| Production domain and request path | **Blocked**: staging is Railway Hikari; the current public domain was not verified as the same path | Document DNS/TLS/proxy chain, trusted proxy count, origin, header stripping and final hostname before changing DNS |
| Production secrets | **Unverified** | Generate unique production `SESSION_SECRET`, `OTP_SECRET`, Turnstile keys and provider credentials; record owner, rotation and recovery without recording values |
| Customer OTP delivery | **Unverified/incomplete** | Select and test approved email/mobile providers, sender identity, bounce/failure handling and anti-abuse behavior; mobile delivery is not currently implemented |
| Administrator access | **Needs review** | Confirm named accounts, strong unique passwords, role matrix, offboarding, emergency access and whether MFA or an identity-aware access layer is required |
| Authorization model | **Hardened; pending external retest**: `reviewer` is read-only and all administrator mutations require the `administrator`/`super_admin` roles | Independent IDOR/BOLA and privilege-escalation testing across every admin/customer endpoint |
| CSP hardening | **Needs work**: live CSP permits `'unsafe-inline'` for scripts and styles | Remove inline script/style dependencies where practical and adopt nonces or hashes; retest Turnstile and all pages |
| Backup and restore | **Unverified** | Record backup schedule/retention and complete a restore into an isolated database with row-count and integrity checks |
| Monitoring and alerting | **Unverified** | Define alerts for 5xx, auth abuse, OTP abuse, migration failures, database saturation and notification failures; verify log retention and access |
| Incident response | **Blocked** | Name contacts, severity levels, containment/rotation steps, evidence preservation, notification decision process and recovery test |
| Privacy/legal approval | **Blocked outside engineering** | Counsel review of privacy notice, consent, retention, cross-border processing and deletion restrictions for operating jurisdictions |
| Data retention automation | **Not implemented** | Approve periods, implement auditable archive/deletion jobs, legal holds and dry-run reporting |
| Dependency and supply chain controls | **Needs work** | Add CI tests, dependency audit, lockfile enforcement, secret scanning, SAST and an SBOM for each release |
| Capacity and abuse testing | **Unverified** | Rate-limit/concurrency tests, database connection limits, payload stress within authorization, and agreed non-destructive availability testing |

## Production configuration gate

Verify names and policy without exporting secret values:

- `NODE_ENV=production`
- exact HTTPS `APP_ORIGIN`, without a trailing slash;
- private Railway `DATABASE_URL` and migration URL;
- independent high-entropy `SESSION_SECRET` and `OTP_SECRET`;
- production Turnstile site/secret keys for the exact hostname;
- approved OTP/email provider and sender settings;
- correct `TRUST_PROXY` for the measured production path;
- approximate location disabled unless a controlled proxy strips spoofable headers and signs custom `x-fas-*` headers;
- no `TURNSTILE_DEV_BYPASS`, development OTP adapter or bootstrap password variable;
- backup, alerting and log-access settings owned by named operators.

## Release procedure

1. Freeze scope and commit the complete candidate. Record the Git SHA and dependency lockfile hash.
2. Run `npm ci`, `npm audit --omit=dev`, `npm test` and `npm run check` in clean CI.
3. Generate an SBOM and run secret/SAST scans. Triage every result.
4. Deploy the exact SHA to staging. Confirm migration checksums and health.
5. Give the independent agency the handoff in `SECURITY_AUDIT_HANDOFF.md`, synthetic accounts and written authorization.
6. Fix findings in source control, rerun all checks, deploy staging and obtain agency retest evidence.
7. Test backup restoration, incident contacts, alerts, administrator offboarding and OTP provider failure modes.
8. Obtain engineering, security, operations and legal sign-off.
9. Promote the reviewed revision to production. Do not rebuild from an uncommitted workstation tree.
10. Run controlled production smoke tests, remove exact test records, monitor logs and retain release evidence.

## Approval record

Complete this table for the release candidate. A blank row is not approval.

| Responsibility | Name/organisation | Decision | Date | Evidence link |
| --- | --- | --- | --- | --- |
| Engineering owner |  |  |  |  |
| Independent security reviewer |  |  |  |  |
| Railway/database operations |  |  |  |  |
| Privacy/legal reviewer |  |  |  |  |
| Business release owner |  |  |  |  |