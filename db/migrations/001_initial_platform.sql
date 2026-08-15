create extension if not exists pgcrypto;
create extension if not exists citext;

create function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table administrator_users (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  password_hash text not null check (length(password_hash) >= 50),
  display_name text not null,
  role text not null check (role in ('administrator', 'super_admin', 'reviewer')),
  active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger administrator_users_updated before update on administrator_users for each row execute function set_updated_at();

create table administrator_sessions (
  id uuid primary key default gen_random_uuid(),
  administrator_id uuid not null references administrator_users(id) on delete cascade,
  token_hash text not null unique,
  csrf_token_hash text not null,
  ip_hash text,
  user_agent_hash text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  check (expires_at > created_at)
);
create index administrator_sessions_active_idx on administrator_sessions (token_hash, expires_at) where revoked_at is null;

create table authentication_events (
  id uuid primary key default gen_random_uuid(),
  administrator_id uuid references administrator_users(id) on delete set null,
  email_hash text,
  ip_hash text,
  event_type text not null check (event_type in ('login_succeeded', 'login_failed', 'login_rate_limited', 'logout', 'session_expired', 'session_revoked')),
  created_at timestamptz not null default now()
);
create index authentication_events_email_time_idx on authentication_events (email_hash, created_at desc);
create index authentication_events_ip_time_idx on authentication_events (ip_hash, created_at desc);

create table organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 2 and 200),
  organisation_type text not null,
  registration_status text not null,
  registration_number text,
  gst_status text,
  website text,
  country text not null,
  state text,
  district text,
  city text,
  export_capability text,
  verification_status text not null default 'Pending' check (verification_status in ('Pending', 'In review', 'Verified', 'Rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger organisations_updated before update on organisations for each row execute function set_updated_at();

create table contacts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete restrict,
  full_name text not null,
  job_title text,
  business_email citext not null check (business_email::text ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),
  telephone text not null,
  whatsapp text,
  preferred_contact_method text not null default 'WhatsApp or telephone',
  country text not null,
  city text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger contacts_updated before update on contacts for each row execute function set_updated_at();

create table leads (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete restrict,
  contact_id uuid not null references contacts(id) on delete restrict,
  public_reference text not null unique check (public_reference ~ '^FAS-[BS]-[0-9]{8}-[A-Z0-9]{8,12}$'),
  lead_role text not null check (lead_role in ('buyer', 'seller')),
  category text not null check (category in ('fish', 'spices')),
  product text not null,
  quantity numeric(18,3) not null check (quantity > 0),
  unit text not null check (unit in ('kg', 'metric tonnes', 'pieces', 'cartons', 'bags', 'litres', 'Other')),
  origin text,
  destination text,
  source_domain text,
  source_page text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  verification_status text not null default 'Pending' check (verification_status in ('Pending', 'In review', 'Verified', 'Rejected')),
  match_status text not null default 'Not reviewed' check (match_status in ('Not reviewed', 'Potential match', 'Introduced', 'Closed')),
  follow_up_status text not null default 'New' check (follow_up_status in ('New', 'Contacted', 'Follow-up due', 'Closed')),
  priority text not null default 'Normal' check (priority in ('Low', 'Normal', 'High', 'Urgent')),
  assigned_administrator uuid references administrator_users(id) on delete set null,
  submission_key_hash text not null unique,
  submission_ip_hash text,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create trigger leads_updated before update on leads for each row execute function set_updated_at();
create index leads_role_idx on leads (lead_role);
create index leads_category_idx on leads (category);
create index leads_product_idx on leads (lower(product));
create index leads_country_idx on organisations (country);
create index leads_destination_idx on leads (destination);
create index leads_verification_idx on leads (verification_status);
create index leads_match_idx on leads (match_status);
create index leads_follow_up_idx on leads (follow_up_status);
create index leads_submitted_idx on leads (submitted_at desc);
create index leads_assigned_idx on leads (assigned_administrator) where assigned_administrator is not null;

create table buyer_requirements (
  lead_id uuid primary key references leads(id) on delete cascade,
  buyer_type text not null,
  commercial_purpose text not null,
  purchase_frequency text not null,
  required_date date not null,
  destination text not null,
  delivery_location text not null,
  incoterm text not null,
  sample_requirement text not null,
  inspection_requirement text not null,
  packing_requirements text,
  quality_requirements text,
  certification_requirements text,
  payment_expectations text,
  additional_notes text
);

create table seller_offers (
  lead_id uuid primary key references leads(id) on delete cascade,
  seller_type text not null,
  authority_confirmed boolean not null check (authority_confirmed),
  current_quantity numeric(18,3) not null check (current_quantity > 0),
  recurring_capacity text,
  availability_date date not null,
  minimum_order numeric(18,3) not null check (minimum_order > 0),
  expected_price numeric(18,2) check (expected_price is null or expected_price > 0),
  price_unit text,
  packing_capability text,
  storage_capability text,
  delivery_capability text not null,
  inspection_availability text,
  export_capability text,
  additional_notes text
);

create table fish_specifications (
  lead_id uuid primary key references leads(id) on delete cascade,
  common_name text not null,
  scientific_name text,
  production_method text,
  water_type text,
  product_form text not null,
  cut_processing_form text,
  condition text,
  size_minimum numeric(18,3) check (size_minimum is null or size_minimum >= 0),
  size_maximum numeric(18,3) check (size_maximum is null or size_maximum >= 0),
  size_unit text,
  size_description text,
  glazing_requirement text,
  cold_chain_requirement text,
  freezing_capability text,
  storage_requirement text,
  shelf_life_requirement text,
  harvest_catch_information text,
  laboratory_requirements text,
  licence_requirements text,
  check (size_maximum is null or size_minimum is null or size_maximum >= size_minimum)
);

create table spice_specifications (
  lead_id uuid primary key references leads(id) on delete cascade,
  spice text not null,
  variety text,
  origin text,
  product_form text not null,
  grade text,
  density_value text,
  density_unit text,
  moisture text,
  size_requirement text,
  foreign_matter text,
  curcumin text,
  volatile_oil text,
  microbiology text,
  pesticide_residues text,
  aflatoxin text,
  salmonella text,
  steam_sterilisation text,
  laboratory_report_requirement text,
  certification_requirement text,
  private_label_requirement text
);

create table verification_checks (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  identity_status text not null default 'Unchecked' check (identity_status in ('Unchecked', 'Pending', 'Confirmed', 'Failed')),
  organisation_registration_status text not null default 'Unchecked' check (organisation_registration_status in ('Unchecked', 'Pending', 'Confirmed', 'Failed')),
  gst_status text not null default 'Unchecked' check (gst_status in ('Unchecked', 'Pending', 'Confirmed', 'Failed', 'Not applicable')),
  licence_status text not null default 'Unchecked' check (licence_status in ('Unchecked', 'Pending', 'Confirmed', 'Failed', 'Not applicable')),
  certification_status text not null default 'Unchecked' check (certification_status in ('Unchecked', 'Pending', 'Confirmed', 'Failed', 'Not applicable')),
  product_evidence_status text not null default 'Unchecked' check (product_evidence_status in ('Unchecked', 'Pending', 'Confirmed', 'Failed')),
  facility_evidence_status text not null default 'Unchecked' check (facility_evidence_status in ('Unchecked', 'Pending', 'Confirmed', 'Failed', 'Not applicable')),
  laboratory_evidence_status text not null default 'Unchecked' check (laboratory_evidence_status in ('Unchecked', 'Pending', 'Confirmed', 'Failed', 'Not applicable')),
  bank_information_status text not null default 'Unchecked' check (bank_information_status in ('Unchecked', 'Pending', 'Confirmed', 'Failed')),
  overall_outcome text not null default 'Pending' check (overall_outcome in ('Pending', 'In review', 'Verified', 'Rejected')),
  notes text,
  administrator_id uuid not null references administrator_users(id) on delete restrict,
  checked_at timestamptz not null default now(),
  check (overall_outcome <> 'Verified' or (identity_status = 'Confirmed' and organisation_registration_status = 'Confirmed'))
);
create index verification_checks_lead_idx on verification_checks (lead_id, checked_at desc);

create table matches (
  id uuid primary key default gen_random_uuid(),
  buyer_lead_id uuid not null references leads(id) on delete restrict,
  seller_lead_id uuid not null references leads(id) on delete restrict,
  match_score numeric(5,2) not null check (match_score between 0 and 100),
  match_explanation jsonb not null,
  status text not null default 'Proposed' check (status in ('Proposed', 'Reviewing', 'Consented', 'Introduced', 'Declined', 'Closed')),
  buyer_consent boolean not null default false,
  seller_consent boolean not null default false,
  introduction_date timestamptz,
  quotation_status text,
  sample_status text,
  inspection_status text,
  negotiation_status text,
  transaction_status text,
  estimated_value numeric(18,2) check (estimated_value is null or estimated_value >= 0),
  platform_revenue numeric(18,2) check (platform_revenue is null or platform_revenue >= 0),
  outcome text,
  created_by uuid not null references administrator_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (buyer_lead_id, seller_lead_id),
  check (buyer_lead_id <> seller_lead_id),
  check (introduction_date is null or (buyer_consent and seller_consent))
);
create trigger matches_updated before update on matches for each row execute function set_updated_at();
create index matches_buyer_idx on matches (buyer_lead_id);
create index matches_seller_idx on matches (seller_lead_id);

create function enforce_match_compatibility() returns trigger language plpgsql as $$
declare buyer_role text; seller_role text; buyer_category text; seller_category text;
begin
  select lead_role, category into buyer_role, buyer_category from leads where id = new.buyer_lead_id;
  select lead_role, category into seller_role, seller_category from leads where id = new.seller_lead_id;
  if buyer_role is distinct from 'buyer' or seller_role is distinct from 'seller' then
    raise exception 'Match must connect one buyer lead to one seller lead';
  end if;
  if buyer_category is distinct from seller_category then
    raise exception 'Match categories must be identical';
  end if;
  return new;
end;
$$;
create trigger matches_compatibility before insert or update of buyer_lead_id, seller_lead_id on matches for each row execute function enforce_match_compatibility();

create table lead_interactions (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  contact_method text not null,
  direction text not null check (direction in ('Inbound', 'Outbound')),
  summary text not null,
  outcome text,
  next_action text,
  follow_up_date timestamptz,
  administrator_id uuid not null references administrator_users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index lead_interactions_lead_idx on lead_interactions (lead_id, created_at desc);
create index lead_interactions_follow_up_idx on lead_interactions (follow_up_date) where follow_up_date is not null;

create table consent_records (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  privacy_policy_version text not null,
  terms_version text not null,
  commercial_contact_consent boolean not null,
  matching_consent boolean not null,
  consent_time timestamptz not null default now(),
  consent_source text not null
);
create index consent_records_lead_idx on consent_records (lead_id, consent_time desc);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  administrator_id uuid references administrator_users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_identifier text not null,
  previous_values jsonb,
  new_values jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_entity_idx on audit_log (entity_type, entity_identifier, created_at desc);
create index audit_log_admin_idx on audit_log (administrator_id, created_at desc);

create table product_catalogue (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('fish', 'spices')),
  product_name text not null,
  scientific_name text,
  alternative_names text[] not null default '{}',
  active boolean not null default true,
  display_order integer not null default 0 check (display_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category, product_name)
);
create trigger product_catalogue_updated before update on product_catalogue for each row execute function set_updated_at();

create table rate_limit_buckets (
  scope text not null check (scope in ('lead_submission', 'admin_login')),
  identifier_hash text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 1 check (request_count > 0),
  expires_at timestamptz not null,
  primary key (scope, identifier_hash, window_started_at)
);
create index rate_limit_expiry_idx on rate_limit_buckets (expires_at);

create table notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  channel text not null check (channel in ('email', 'webhook')),
  provider text,
  status text not null check (status in ('pending', 'sent', 'failed', 'not_configured')),
  attempt_count integer not null default 0,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger notification_deliveries_updated before update on notification_deliveries for each row execute function set_updated_at();

insert into product_catalogue (category, product_name, scientific_name, alternative_names, display_order) values
('fish', 'Varal / snakehead', 'Channa striata', array['Varal', 'Snakehead'], 10),
('fish', 'Karimeen / pearl spot', 'Etroplus suratensis', array['Karimeen', 'Pearl spot'], 20),
('fish', 'Marine fish', null, array[]::text[], 30),
('fish', 'Freshwater fish', null, array[]::text[], 40),
('fish', 'Shrimp / prawns', null, array['Shrimp', 'Prawns'], 50),
('fish', 'Crab', null, array[]::text[], 60),
('fish', 'Dried fish', null, array[]::text[], 70),
('fish', 'Frozen seafood', null, array[]::text[], 80),
('fish', 'Value-added seafood', null, array[]::text[], 90),
('spices', 'Black pepper', 'Piper nigrum', array['Peppercorn'], 10),
('spices', 'Cardamom', 'Elettaria cardamomum', array['Green cardamom'], 20),
('spices', 'Turmeric', 'Curcuma longa', array['Haldi'], 30),
('spices', 'Ginger', 'Zingiber officinale', array[]::text[], 40),
('spices', 'Chilli', 'Capsicum annuum', array['Red chilli'], 50),
('spices', 'Cumin', 'Cuminum cyminum', array['Jeera'], 60),
('spices', 'Coriander', 'Coriandrum sativum', array['Coriander seed'], 70),
('spices', 'Nutmeg and mace', 'Myristica fragrans', array['Nutmeg', 'Mace'], 80),
('spices', 'Cloves', 'Syzygium aromaticum', array['Clove'], 90),
('spices', 'Fennel', 'Foeniculum vulgare', array['Fennel seed'], 100),
('spices', 'Fenugreek', 'Trigonella foenum-graecum', array['Methi'], 110),
('spices', 'Spice powders', null, array['Value-added spice products'], 120)
on conflict (category, product_name) do nothing;
