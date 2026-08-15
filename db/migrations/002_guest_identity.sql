create table fas_customer_users (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'guest' check (status in ('guest', 'contact_verified', 'account_activated', 'business_submitted', 'business_verified', 'restricted', 'suspended')),
  display_name text,
  preferred_contact_method text check (preferred_contact_method is null or preferred_contact_method in ('mobile', 'email')),
  locale text,
  country text,
  last_successful_authentication_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  restricted_at timestamptz,
  suspended_at timestamptz,
  archived_at timestamptz
);
create trigger fas_customer_users_updated before update on fas_customer_users for each row execute function set_updated_at();

create table fas_user_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references fas_customer_users(id) on delete restrict,
  identity_type text not null check (identity_type in ('mobile', 'email')),
  normalized_value text not null,
  masked_value text not null,
  verification_status text not null default 'unverified' check (verification_status in ('unverified', 'verified', 'revoked')),
  verified_at timestamptz,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((verification_status = 'verified') = (verified_at is not null))
);
create trigger fas_user_identities_updated before update on fas_user_identities for each row execute function set_updated_at();
create index fas_user_identities_lookup_idx on fas_user_identities (identity_type, normalized_value);
create unique index fas_user_identities_verified_unique_idx on fas_user_identities (identity_type, normalized_value) where verification_status = 'verified';
create unique index fas_user_identities_primary_unique_idx on fas_user_identities (user_id) where is_primary and verification_status <> 'revoked';

create table fas_organisation_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references fas_customer_users(id) on delete restrict,
  organisation_id uuid not null references organisations(id) on delete restrict,
  role text not null,
  membership_status text not null default 'pending' check (membership_status in ('pending', 'active', 'revoked')),
  verification_status text not null default 'unverified' check (verification_status in ('unverified', 'pending', 'verified', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, organisation_id)
);
create trigger fas_organisation_members_updated before update on fas_organisation_members for each row execute function set_updated_at();

create table fas_customer_authentication_challenges (
  id uuid primary key default gen_random_uuid(),
  identity_type text not null check (identity_type in ('mobile', 'email')),
  normalized_destination text not null,
  purpose text not null check (purpose in ('sign_in', 'claim_history')),
  secret_hash text not null,
  expires_at timestamptz not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  maximum_attempts integer not null check (maximum_attempts between 1 and 10),
  consumed_at timestamptz,
  superseded_at timestamptz,
  requested_ip_hash text,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);
create index fas_customer_challenges_destination_idx on fas_customer_authentication_challenges (identity_type, normalized_destination, created_at desc);
create index fas_customer_challenges_active_idx on fas_customer_authentication_challenges (id, expires_at) where consumed_at is null and superseded_at is null;

create table fas_customer_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references fas_customer_users(id) on delete cascade,
  token_hash text not null unique,
  csrf_token_hash text not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  absolute_expires_at timestamptz not null,
  last_used_at timestamptz not null default now(),
  revoked_at timestamptz,
  device_label text,
  ip_hash text,
  user_agent_hash text,
  check (expires_at > issued_at),
  check (absolute_expires_at >= expires_at)
);
create index fas_customer_sessions_active_idx on fas_customer_sessions (token_hash, expires_at) where revoked_at is null;

create table fas_customer_authentication_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references fas_customer_users(id) on delete set null,
  identity_type text check (identity_type is null or identity_type in ('mobile', 'email')),
  destination_hash text,
  ip_hash text,
  event_type text not null check (event_type in ('challenge_requested', 'challenge_rate_limited', 'challenge_delivery_unavailable', 'verification_succeeded', 'verification_failed', 'verification_locked', 'verification_replayed', 'session_expired', 'logout', 'suspicious_claim')),
  created_at timestamptz not null default now()
);
create index fas_customer_auth_events_destination_idx on fas_customer_authentication_events (destination_hash, created_at desc);
create index fas_customer_auth_events_ip_idx on fas_customer_authentication_events (ip_hash, created_at desc);

create table fas_customer_auth_rate_limits (
  scope text not null check (scope in ('otp_request', 'otp_verify', 'otp_resend', 'history_claim')),
  identifier_hash text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 1 check (request_count > 0),
  expires_at timestamptz not null,
  primary key (scope, identifier_hash, window_started_at)
);
create index fas_customer_auth_rate_limits_expiry_idx on fas_customer_auth_rate_limits (expires_at);

alter table leads add column customer_user_id uuid references fas_customer_users(id) on delete restrict;
create index fas_leads_customer_user_idx on leads (customer_user_id, submitted_at desc) where customer_user_id is not null;

create table fas_identity_claim_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references fas_customer_users(id) on delete restrict,
  identity_id uuid not null references fas_user_identities(id) on delete restrict,
  lead_id uuid references leads(id) on delete restrict,
  event_type text not null check (event_type in ('identity_claimed', 'identity_verified', 'historical_record_linked', 'claim_review_requested')),
  reason text not null,
  linking_method text not null check (linking_method in ('verified_identity', 'administrator_review')),
  administrator_id uuid references administrator_users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (user_id, identity_id, lead_id, event_type)
);
create index fas_identity_claim_audit_user_idx on fas_identity_claim_audit (user_id, created_at desc);

create table fas_identity_claim_review_queue (
  id uuid primary key default gen_random_uuid(),
  claiming_user_id uuid not null references fas_customer_users(id) on delete restrict,
  identity_id uuid not null references fas_user_identities(id) on delete restrict,
  lead_id uuid not null references leads(id) on delete restrict,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references administrator_users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (claiming_user_id, identity_id, lead_id)
);

create table fas_user_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references fas_customer_users(id) on delete restrict,
  verification_type text not null check (verification_type in ('contact_confirmed', 'business_checked', 'bank_beneficiary_checked', 'product_documents_checked', 'facility_assessed', 'transaction_completed', 'protected_order')),
  checked_by_type text not null check (checked_by_type in ('system', 'administrator', 'provider')),
  checked_by_administrator uuid references administrator_users(id) on delete set null,
  scope text not null,
  verified_at timestamptz,
  expires_at timestamptz,
  status text not null check (status in ('pending', 'confirmed', 'failed', 'expired', 'revoked')),
  evidence_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at is null or verified_at is null or expires_at > verified_at)
);
create trigger fas_user_verifications_updated before update on fas_user_verifications for each row execute function set_updated_at();
create index fas_user_verifications_user_idx on fas_user_verifications (user_id, verification_type, created_at desc);

alter table contacts alter column business_email drop not null;
alter table contacts alter column telephone drop not null;
alter table contacts add constraint fas_contacts_identity_present check (business_email is not null or telephone is not null);
alter table buyer_requirements alter column buyer_type drop not null;
alter table buyer_requirements alter column commercial_purpose drop not null;
alter table buyer_requirements alter column purchase_frequency drop not null;
alter table buyer_requirements alter column required_date drop not null;
alter table buyer_requirements alter column incoterm drop not null;
alter table buyer_requirements alter column sample_requirement drop not null;
alter table buyer_requirements alter column inspection_requirement drop not null;
alter table seller_offers alter column seller_type drop not null;
alter table seller_offers alter column availability_date drop not null;
alter table seller_offers alter column minimum_order drop not null;
alter table seller_offers alter column delivery_capability drop not null;
alter table fish_specifications alter column product_form drop not null;
alter table spice_specifications alter column product_form drop not null;
