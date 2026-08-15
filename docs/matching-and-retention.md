# Matching, retention and evidence

## Deterministic matching

`GET /api/v1/admin/leads/:id/match-suggestions` is available only to authenticated administrators. It filters active seller leads to the same category and product, then scores:

- Same category and product: mandatory, 20 points
- Quantity compatibility: 15 points
- Product form: 10 points
- Grade or size compatibility: 10 points
- Availability by required date: 10 points
- Delivery or export capability: 10 points
- Packing capability: 5 points
- Certification compatibility: 5 points
- Seller verification: up to 15 points

The endpoint returns factors and explicit conflicts but does not insert a match or introduce parties. An administrator must review the proposal, create a match record, collect both consents and only then record an introduction. PostgreSQL prevents cross-category and incorrect-role matches.

## Retention

Recommended starting policy, subject to legal review:

- Unqualified or rejected leads: archive after 12 months; delete or irreversibly anonymise after 24 months unless fraud/safety/legal retention applies.
- Active leads and interactions: review after 24 months of inactivity.
- Match and commercial outcome records: retain up to 7 years where required for contractual, tax or dispute records.
- Consent and audit records: retain for the period needed to demonstrate lawful handling and administrative accountability.

Implement scheduled retention only after the business approves jurisdiction-specific periods. Record archival/deletion actions in `audit_log` and support correction/deletion requests through the published contact address.

## Future evidence uploads

This phase accepts text statements about evidence availability only. It must not accept passports, national IDs, bank statements, certificates, laboratory files or other sensitive documents.

A later upload phase should use private object storage, short-lived signed upload URLs issued by an authenticated server endpoint, MIME/size allowlists, malware scanning, object paths unrelated to public references, per-object authorization, encryption, retention jobs, download audit events and administrator-only signed downloads. Never use a public bucket for lead evidence.
