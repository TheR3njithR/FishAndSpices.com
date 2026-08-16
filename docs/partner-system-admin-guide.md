# Partner Network Admin Guide

## 1) Scope

This guide covers day-to-day administration of the FishAndSpices Partner Network module:

- partner onboarding and status control,
- settings and commission governance,
- fraud review and payout operations,
- analytics and reconciliation checks.

## 2) Admin surfaces

Primary pages:

- `/admin/partners`
- `/admin/partner-settings`
- `/admin/partner-settings/commission-plans`

Primary APIs:

- `GET /api/v1/admin/partners/overview`
- `GET /api/v1/admin/partners`
- `GET /api/v1/admin/partners/:id`
- `PATCH /api/v1/admin/partners/:id`
- `POST /api/v1/admin/partners/:id/regenerate-code`
- `GET/PATCH /api/v1/admin/partners/settings`
- `GET/POST/PATCH commission plan and rule endpoints`
- `GET /api/v1/admin/partners/commissions`
- `PATCH /api/v1/admin/partners/commissions/:commissionId/status`
- `GET/POST/PATCH payout endpoints`

## 3) Core workflows

### 3.1 Review partner applications

1. Open `/admin/partners`.
2. Filter by `PENDING` status.
3. Validate profile quality and contact authenticity.
4. Set status to `ACTIVE` (approve) or `REJECTED`.
5. Regenerate code if required for policy or naming updates.

### 3.2 Configure payout and attribution policy

1. Open `/admin/partner-settings`.
2. Set:
   - `referral_cookie_days`
   - `minimum_payout_amount`
   - `commission_hold_period_days`
   - `partner_application_enabled`
   - `partner_auto_approval`
3. Save settings and log operational reason in internal change records.

### 3.3 Manage commission plans

1. Open `/admin/partner-settings/commission-plans`.
2. Create or edit plan definitions.
3. Add event rules by priority.
4. Set cooling period and approval requirements for sensitive milestones.
5. Keep legacy plans `INACTIVE` instead of deleting to preserve audit trails.

### 3.4 Review and settle commissions

1. Review `/api/v1/admin/partners/commissions` by status.
2. Approve or reject disputed lines.
3. Move eligible records to `PAYABLE`.
4. Create payout batches from payable commissions.
5. Mark payout outcomes (`PAID`, `FAILED`, `CANCELLED`) with references.

## 4) Fraud and risk handling

Fraud indicators are recorded in `fas_partner_fraud_flags` and can block pending commission maturity.

Typical flags:

- self-referral,
- duplicate identity overlaps,
- unusually high registration velocity,
- manual review flags.

Recommended process:

1. Inspect related referrals and event history.
2. Capture review notes and resolution outcome.
3. Only release blocked commissions when signals are resolved.

## 5) Audit and traceability

Administrative changes are written to `audit_log` for partner settings, status transitions, plan/rule edits, commission actions, and payout operations.

Operational practice:

- Always include reason context in notes fields where available.
- Keep plan changes additive and versioned via status/effective windows.
- Avoid destructive edits to historical financial records.

## 6) Rollout and safety checklist

Before enabling in production:

1. Verify `PARTNER_NETWORK_ENABLED=true` in staging.
2. Validate referral capture, link, event, commission, payout paths.
3. Test role/CSRF enforcement for admin mutations.
4. Confirm fraud flags influence payout readiness.
5. Promote configuration and deploy after staging sign-off.
