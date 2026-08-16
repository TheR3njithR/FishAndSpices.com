# Partner Commission Engine

## 1) Purpose

The commission engine converts qualified partner-attributed lifecycle events into auditable commission records.

It is designed to be:

- additive,
- idempotent,
- configurable through data,
- safe for review, fraud controls, and payout operations.

## 2) Data model

Core tables:

- `fas_partner_events`
- `fas_partner_commission_plans`
- `fas_partner_commission_rules`
- `fas_partner_commissions`
- `fas_partner_fraud_flags`
- `fas_partner_payouts`
- `fas_partner_payout_items`

## 3) Event to commission flow

1. A lifecycle action triggers `emitPartnerEvent(...)`.
2. Event is inserted with unique `dedupe_key`.
3. Active partner + commission plan is resolved.
4. Rules are filtered by:
   - `event_type`
   - partner type
   - optional user role
   - effective window
   - active status
5. Rule limits are enforced:
   - `maximum_per_user`
   - `maximum_per_month`
6. Commission is inserted once per event (`unique(partner_event_id)`).
7. Event is marked processed with qualification outcome.

## 4) Status semantics

### Commission statuses

- `PENDING`: waiting for cooling period to pass.
- `UNDER_REVIEW`: requires admin approval before payable.
- `APPROVED`: explicitly approved by admin.
- `PAYABLE`: ready for payout batching.
- `PAID`: settled through payout.
- `REJECTED`: disqualified with reason.
- `REVERSED`: previously granted commission reversed.

### Payout statuses

- `PENDING`, `APPROVED`, `PROCESSING`, `PAID`, `FAILED`, `CANCELLED`.

Failed/cancelled payout flows can return unpaid included commissions to `PAYABLE`.

## 5) Idempotency and anti-duplication

Two protections are used:

- unique event `dedupe_key` in `fas_partner_events`,
- unique `partner_event_id` in `fas_partner_commissions`.

This prevents duplicate rewards from repeated API calls or retried actions.

## 6) Fraud interaction

Open fraud flags for a partner or referred user can block pending commission maturity.

Automatic maturity (`maturePendingCommissions`) only advances entries when review blockers are clear.

## 7) Configuration points

Global settings (`fas_partner_settings`) influence behavior:

- referral cookie duration,
- minimum payout amount,
- hold period defaults,
- application and auto-approval toggles.

Plan and rule records control commercial logic without code changes.

## 8) Extension points (P1/P2)

- transaction and settlement event sources,
- partner payout self-service requests,
- dispute workflows and approvals,
- campaign-level weighted incentives,
- export/reconciliation pipelines.
