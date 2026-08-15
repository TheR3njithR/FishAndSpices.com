# Guest-first identity and passwordless access

## Public submission

Buying requirements and selling offers do not require registration. A successful submission transaction creates or safely associates an internal user, stores contact snapshots, creates the lead and role/category records, records consent, and returns only the public lead reference.

A guest is an internal ownership identity, not an authenticated session. Submitting matching contact information never authenticates the browser and never exposes whether an account exists.

## Conservative association and deduplication

- A submission may associate directly only when one supplied normalized identity is already verified.
- Otherwise each successful submission receives a new guest user. This deliberately avoids silently attaching a lead through an unverified email/mobile value.
- Browser retries remain bounded by the existing unique submission key and lead rate limit.
- Names, company names, and public references are never identity evidence.
- After OTP verification, records with the same identity type and normalized value are eligible for claiming.
- A guest-owned record is linked automatically only when its owner has no conflicting verified identity.
- Conflicts are inserted into `identity_claim_review_queue`; no ownership changes until administrator review.
- Claim audit rows make automatic and manual linking idempotent and attributable.
- Existing leads remain valid with `leads.user_id` null. No historical ownership is fabricated. Such records require a verified normalized contact match or administrator review before linking.

## Passwordless delivery

Customer routes use one-time codes. Codes are generated cryptographically, stored only as keyed hashes, expire quickly, have attempt limits, are single-use, and supersede earlier active challenges. Request and verification abuse controls use keyed IP/contact hashes rather than retained raw IP addresses.

Supported adapters:

- `EMAIL_PROVIDER=resend`: email OTP delivery using `RESEND_API_KEY` and `EMAIL_FROM`.
- `OTP_PROVIDER=development`: returns the test code only in explicitly configured local/test environments. Configuration is rejected in staging or production.
- Mobile OTP: provider abstraction is ready, but a real SMS provider must be selected and connected before mobile delivery works.

When no applicable provider is configured, the API and UI explicitly report delivery as unavailable. They do not claim a message was sent.

## Environment variables

Required in hosted environments:

- `OTP_SECRET`: independent high-entropy secret for OTP hashing and destination abuse hashes.
- Existing `SESSION_SECRET`, `DATABASE_URL`, and `APP_ORIGIN` remain required.

Passwordless policy:

- `OTP_PROVIDER`
- `OTP_LIFETIME_MINUTES` (default 10, bounded 3-15)
- `OTP_MAXIMUM_ATTEMPTS` (default 5, bounded 3-10)
- `OTP_RESEND_DELAY_SECONDS` (default 60, minimum 30)
- `CUSTOMER_SESSION_IDLE_HOURS` (default 8)
- `CUSTOMER_SESSION_LIFETIME_DAYS` (default 14)

Email delivery:

- `EMAIL_PROVIDER=resend`
- `RESEND_API_KEY`
- `EMAIL_FROM`

A future mobile adapter will require provider name, API credentials, and sender identity variables selected for that provider. Do not set placeholder credentials in Railway.

## Routes

- `POST /api/v1/leads`: guest-first lead submission.
- `POST /api/v1/customer-auth/challenges`: request a generic, non-enumerating one-time code challenge.
- `POST /api/v1/customer-auth/verify`: consume a challenge and rotate into a customer session.
- `GET /api/v1/customer-auth/session`: get customer session and rotate CSRF.
- `POST /api/v1/customer-auth/logout`: revoke the customer session.
- `GET /api/v1/me/leads`: list only authenticated customer-owned leads.
- `GET /api/v1/me/leads/:publicReference`: read one owned lead; the reference alone grants no access.
- `POST /api/v1/me/claim-history`: idempotently claim eligible matching history with CSRF.

Administrator routes, sessions, cookies, password authentication, and role authorization remain separate.

## Verification ladder

`user_verifications` supports contact confirmation, business checks, bank-beneficiary checks, product-document checks, facility assessment, completed transactions, and future protected orders. Contact confirmation alone must not be presented as broad supplier verification.

Protected payments, escrow, document upload/storage, quotations, orders, disputes, reviews, and transaction history are not implemented in this phase. Those actions must require additional verification when introduced.
