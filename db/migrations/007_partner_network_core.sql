-- Partner Network core schema. Additive and backward compatible.

-- Expand rate-limit scopes for partner endpoints and AI assistant scopes.
alter table rate_limit_buckets
  drop constraint if exists rate_limit_buckets_scope_check;

alter table rate_limit_buckets
  add constraint rate_limit_buckets_scope_check
  check (scope in (
    'lead_submission',
    'admin_login',
    'ai_chat_anon',
    'ai_chat_auth',
    'ai_realtime_session',
    'partner_application',
    'partner_referral_capture',
    'partner_campaign_create',
    'partner_payout_request'
  ));

create table if not exists fas_partner_commission_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  currency text not null default 'INR' check (currency in ('INR', 'AED', 'USD', 'EUR', 'GBP')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_until is null or effective_until > effective_from)
);
create trigger fas_partner_commission_plans_updated before update on fas_partner_commission_plans
for each row execute function set_updated_at();
create index if not exists fas_partner_commission_plans_status_idx
  on fas_partner_commission_plans (status, effective_from desc);

create table if not exists fas_partners (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique,
  user_id uuid references fas_customer_users(id) on delete set null,
  partner_code citext not null unique,
  partner_type text not null check (partner_type in (
    'INFLUENCER',
    'FIELD_AGENT',
    'FPO',
    'COOPERATIVE',
    'CONSULTANT',
    'TRADE_ASSOCIATION',
    'WHATSAPP_ADMIN',
    'TELEGRAM_ADMIN',
    'AFFILIATE',
    'SALES_PARTNER',
    'OTHER'
  )),
  display_name text not null,
  legal_name text,
  contact_person text,
  email citext not null,
  phone text not null,
  whatsapp_number text,
  country text,
  state text,
  district text,
  city text,
  address text,
  instagram_handle text,
  youtube_channel text,
  facebook_page text,
  website text,
  primary_platform text,
  niche text,
  follower_count bigint check (follower_count is null or follower_count >= 0),
  notes text,
  status text not null default 'PENDING' check (status in ('PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED', 'INACTIVE')),
  verification_status text not null default 'PENDING' check (verification_status in ('PENDING', 'VERIFIED', 'REJECTED')),
  kyc_status text not null default 'PENDING' check (kyc_status in ('PENDING', 'VERIFIED', 'REJECTED')),
  partner_tier text check (partner_tier is null or partner_tier in ('STARTER', 'SILVER', 'GOLD', 'PLATINUM')),
  commission_plan_id uuid references fas_partner_commission_plans(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz,
  suspended_at timestamptz,
  check (partner_code::text ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$')
);
create trigger fas_partners_updated before update on fas_partners
for each row execute function set_updated_at();
create unique index if not exists fas_partners_user_unique_idx
  on fas_partners (user_id)
  where user_id is not null;
create index if not exists fas_partners_status_idx
  on fas_partners (status, created_at desc);
create index if not exists fas_partners_type_idx
  on fas_partners (partner_type, status);
create index if not exists fas_partners_location_idx
  on fas_partners (country, state, district, city);

create table if not exists fas_partner_settings (
  setting_key text primary key,
  setting_value text not null,
  updated_by uuid references administrator_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger fas_partner_settings_updated before update on fas_partner_settings
for each row execute function set_updated_at();

create table if not exists fas_partner_campaigns (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references fas_partners(id) on delete cascade,
  name text not null,
  campaign_code text not null,
  landing_page text not null,
  utm_campaign text,
  utm_source text,
  utm_medium text,
  utm_content text,
  utm_term text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'PAUSED', 'ARCHIVED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (partner_id, campaign_code)
);
create trigger fas_partner_campaigns_updated before update on fas_partner_campaigns
for each row execute function set_updated_at();
create index if not exists fas_partner_campaigns_partner_idx
  on fas_partner_campaigns (partner_id, created_at desc);

create table if not exists fas_partner_referral_clicks (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references fas_partners(id) on delete cascade,
  referral_code text not null,
  campaign_id uuid references fas_partner_campaigns(id) on delete set null,
  session_id text,
  visitor_hash text,
  landing_page text not null,
  referrer_url text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  ip_hash text,
  user_agent_hash text,
  country text,
  region text,
  city text,
  created_at timestamptz not null default now()
);
create index if not exists fas_partner_referral_clicks_partner_idx
  on fas_partner_referral_clicks (partner_id, created_at desc);
create index if not exists fas_partner_referral_clicks_campaign_idx
  on fas_partner_referral_clicks (campaign_id, created_at desc)
  where campaign_id is not null;
create index if not exists fas_partner_referral_clicks_code_idx
  on fas_partner_referral_clicks (lower(referral_code), created_at desc);

create table if not exists fas_partner_referral_attributions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  partner_id uuid not null references fas_partners(id) on delete cascade,
  referral_code text not null,
  campaign_id uuid references fas_partner_campaigns(id) on delete set null,
  landing_url text not null,
  source_domain text,
  source_page text,
  referrer_url text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  initial_timestamp timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > initial_timestamp)
);
create index if not exists fas_partner_referral_attributions_partner_idx
  on fas_partner_referral_attributions (partner_id, initial_timestamp desc);
create index if not exists fas_partner_referral_attributions_expiry_idx
  on fas_partner_referral_attributions (expires_at);

create table if not exists fas_partner_referrals (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references fas_partners(id) on delete restrict,
  referred_user_id uuid not null references fas_customer_users(id) on delete restrict,
  attribution_id uuid references fas_partner_referral_attributions(id) on delete set null,
  referral_code text not null,
  registration_timestamp timestamptz not null default now(),
  user_role text,
  otp_verified_at timestamptz,
  profile_completed_at timestamptz,
  qualification_status text not null default 'PENDING' check (qualification_status in ('PENDING', 'QUALIFIED', 'DISQUALIFIED', 'UNDER_REVIEW')),
  fraud_status text not null default 'CLEAR' check (fraud_status in ('CLEAR', 'FLAGGED', 'BLOCKED', 'REVIEWED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (referred_user_id)
);
create trigger fas_partner_referrals_updated before update on fas_partner_referrals
for each row execute function set_updated_at();
create index if not exists fas_partner_referrals_partner_idx
  on fas_partner_referrals (partner_id, created_at desc);
create index if not exists fas_partner_referrals_status_idx
  on fas_partner_referrals (qualification_status, fraud_status, created_at desc);

create table if not exists fas_partner_events (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references fas_partners(id) on delete cascade,
  referred_user_id uuid references fas_customer_users(id) on delete set null,
  referral_id uuid references fas_partner_referrals(id) on delete set null,
  event_type text not null check (event_type in (
    'REGISTRATION',
    'OTP_VERIFIED',
    'PROFILE_COMPLETED',
    'SELLER_VERIFIED',
    'BUYER_VERIFIED',
    'SELLER_LISTING_CREATED',
    'BUYER_REQUIREMENT_CREATED',
    'RFQ_CREATED',
    'QUOTE_SUBMITTED',
    'MATCH_CREATED',
    'TRANSACTION_CREATED',
    'TRANSACTION_CONFIRMED',
    'FIRST_TRANSACTION_COMPLETED',
    'REPEAT_TRANSACTION_COMPLETED'
  )),
  entity_type text,
  entity_id text,
  event_value numeric(18,2),
  user_role text,
  metadata_json jsonb,
  dedupe_key text not null,
  occurred_at timestamptz not null default now(),
  processed_at timestamptz,
  qualification_status text not null default 'PENDING' check (qualification_status in ('PENDING', 'QUALIFIED', 'DISQUALIFIED', 'UNDER_REVIEW')),
  commission_generated boolean not null default false,
  created_at timestamptz not null default now(),
  unique (dedupe_key)
);
create index if not exists fas_partner_events_partner_idx
  on fas_partner_events (partner_id, created_at desc);
create index if not exists fas_partner_events_user_idx
  on fas_partner_events (referred_user_id, created_at desc)
  where referred_user_id is not null;
create index if not exists fas_partner_events_type_idx
  on fas_partner_events (event_type, created_at desc);

create table if not exists fas_partner_commission_rules (
  id uuid primary key default gen_random_uuid(),
  commission_plan_id uuid not null references fas_partner_commission_plans(id) on delete cascade,
  event_type text not null,
  partner_type text,
  user_role text,
  category text,
  amount numeric(18,2) not null check (amount >= 0),
  currency text not null default 'INR' check (currency in ('INR', 'AED', 'USD', 'EUR', 'GBP')),
  maximum_per_user integer check (maximum_per_user is null or maximum_per_user > 0),
  maximum_per_month integer check (maximum_per_month is null or maximum_per_month > 0),
  requires_admin_approval boolean not null default false,
  cooling_period_days integer not null default 0 check (cooling_period_days >= 0 and cooling_period_days <= 90),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
  priority integer not null default 100,
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_until is null or effective_until > effective_from)
);
create trigger fas_partner_commission_rules_updated before update on fas_partner_commission_rules
for each row execute function set_updated_at();
create index if not exists fas_partner_commission_rules_lookup_idx
  on fas_partner_commission_rules (commission_plan_id, event_type, status, priority desc);

create table if not exists fas_partner_commissions (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references fas_partners(id) on delete cascade,
  referred_user_id uuid references fas_customer_users(id) on delete set null,
  partner_event_id uuid not null references fas_partner_events(id) on delete cascade,
  commission_rule_id uuid not null references fas_partner_commission_rules(id) on delete restrict,
  amount numeric(18,2) not null check (amount >= 0),
  currency text not null default 'INR' check (currency in ('INR', 'AED', 'USD', 'EUR', 'GBP')),
  status text not null check (status in ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'PAYABLE', 'PAID', 'REVERSED')),
  pending_until timestamptz,
  approved_at timestamptz,
  approved_by uuid references administrator_users(id) on delete set null,
  rejected_at timestamptz,
  rejected_by uuid references administrator_users(id) on delete set null,
  rejection_reason text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (partner_event_id)
);
create trigger fas_partner_commissions_updated before update on fas_partner_commissions
for each row execute function set_updated_at();
create index if not exists fas_partner_commissions_partner_status_idx
  on fas_partner_commissions (partner_id, status, created_at desc);
create index if not exists fas_partner_commissions_user_idx
  on fas_partner_commissions (referred_user_id, created_at desc)
  where referred_user_id is not null;

create table if not exists fas_partner_fraud_flags (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references fas_partners(id) on delete cascade,
  referred_user_id uuid references fas_customer_users(id) on delete set null,
  event_id uuid references fas_partner_events(id) on delete set null,
  flag_type text not null check (flag_type in (
    'DUPLICATE_PHONE',
    'DUPLICATE_EMAIL',
    'DUPLICATE_DEVICE',
    'SUSPICIOUS_IP_PATTERN',
    'SELF_REFERRAL',
    'HIGH_VELOCITY_REGISTRATION',
    'INCOMPLETE_PROFILE',
    'INVALID_PHONE',
    'REPEATED_FAKE_LISTINGS',
    'SUSPICIOUS_TRANSACTION',
    'MANUAL_FLAG'
  )),
  severity text not null default 'MEDIUM' check (severity in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  description text not null,
  status text not null default 'OPEN' check (status in ('OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED')),
  reviewed_by uuid references administrator_users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists fas_partner_fraud_flags_partner_idx
  on fas_partner_fraud_flags (partner_id, status, created_at desc);

create table if not exists fas_partner_payouts (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references fas_partners(id) on delete cascade,
  payout_reference text not null unique,
  amount numeric(18,2) not null check (amount >= 0),
  currency text not null default 'INR' check (currency in ('INR', 'AED', 'USD', 'EUR', 'GBP')),
  payment_method text not null check (payment_method in ('UPI', 'BANK_TRANSFER', 'OTHER')),
  payment_reference text,
  status text not null check (status in ('PENDING', 'APPROVED', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED')),
  requested_at timestamptz,
  approved_at timestamptz,
  paid_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger fas_partner_payouts_updated before update on fas_partner_payouts
for each row execute function set_updated_at();
create index if not exists fas_partner_payouts_partner_idx
  on fas_partner_payouts (partner_id, created_at desc);

create table if not exists fas_partner_payout_items (
  payout_id uuid not null references fas_partner_payouts(id) on delete cascade,
  commission_id uuid not null references fas_partner_commissions(id) on delete restrict,
  amount numeric(18,2) not null check (amount >= 0),
  created_at timestamptz not null default now(),
  primary key (payout_id, commission_id),
  unique (commission_id)
);

insert into fas_partner_settings (setting_key, setting_value) values
  ('referral_cookie_days', '30'),
  ('minimum_payout_amount', '500'),
  ('default_currency', 'INR'),
  ('partner_application_enabled', 'true'),
  ('partner_auto_approval', 'false'),
  ('fraud_review_threshold', 'HIGH'),
  ('commission_hold_period_days', '7'),
  ('payout_frequency', 'monthly')
on conflict (setting_key) do nothing;

insert into fas_partner_commission_plans (
  name,
  description,
  currency,
  status,
  effective_from
) values (
  'Kerala Launch Partner Plan',
  'Sample configurable launch plan for partner rewards. Values are editable in admin settings.',
  'INR',
  'ACTIVE',
  now()
)
on conflict do nothing;

with plan as (
  select id from fas_partner_commission_plans
  where name = 'Kerala Launch Partner Plan'
  order by created_at asc
  limit 1
)
insert into fas_partner_commission_rules (
  commission_plan_id,
  event_type,
  amount,
  currency,
  requires_admin_approval,
  cooling_period_days,
  status,
  priority,
  effective_from
)
select plan.id, event_type, amount, 'INR', false, cooling_days, 'ACTIVE', priority, now()
from plan
cross join (
  values
    ('OTP_VERIFIED', 20.00::numeric, 0, 500),
    ('SELLER_VERIFIED', 50.00::numeric, 0, 490),
    ('BUYER_VERIFIED', 100.00::numeric, 0, 480),
    ('SELLER_LISTING_CREATED', 50.00::numeric, 0, 470),
    ('BUYER_REQUIREMENT_CREATED', 100.00::numeric, 0, 460),
    ('FIRST_TRANSACTION_COMPLETED', 500.00::numeric, 7, 450)
) as rules(event_type, amount, cooling_days, priority)
where not exists (
  select 1 from fas_partner_commission_rules existing
  where existing.commission_plan_id = plan.id
    and existing.event_type = rules.event_type
);
