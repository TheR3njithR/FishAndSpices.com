# Partner Network Partner Guide

## 1) Getting started

The Partner Network lets approved partners refer users and track qualification outcomes through transparent dashboards.

Partner pages:

- `/partners` (program overview)
- `/partners/apply` (application form)
- `/partners/terms` (program terms)
- `/partner/dashboard`
- `/partner/referrals`
- `/partner/earnings`

## 2) Application and approval

1. Submit your profile at `/partners/apply`.
2. Admin reviews profile quality, relevance, and trust signals.
3. Approved partners get:
   - unique `partnerCode`,
   - campaign tools,
   - referral and earnings dashboards.

## 3) Referral tracking model

Referral attribution uses first-valid capture logic:

- a valid referral link records click metadata,
- attribution token is retained for the configured window,
- first valid token is preserved to prevent overwrite abuse.

When referred users complete milestone events (for example OTP verification), eligible events may generate commission entries.

## 4) Dashboard interpretation

### `/partner/dashboard`

- profile and status,
- clicks and registrations,
- verification and conversion milestones,
- pending/payable/paid totals.

### `/partner/referrals`

- referred user list,
- role and registration timestamp,
- verification and qualification state,
- location summary where available.

### `/partner/earnings`

- commission ledger entries,
- event basis,
- payout status progression.

## 5) Payout lifecycle

Commissions typically move through:

`PENDING` -> `UNDER_REVIEW`/`APPROVED` -> `PAYABLE` -> `PAID`

Progression can be delayed by:

- cooling period settings,
- admin review requirements,
- open fraud flags.

## 6) Good partner practices

- Share accurate program information only.
- Avoid misleading rate or outcome promises.
- Focus on genuine trade-intent users.
- Keep campaign targeting high quality to reduce fraud flags.

## 7) Important notes

- Partner status must remain `ACTIVE` for normal crediting.
- Commission values and rules are configurable by admins.
- Program terms can be updated for policy or compliance reasons.
