create table fas_location_consents (
  id uuid primary key default gen_random_uuid(),
  customer_user_id uuid not null references fas_customer_users(id) on delete restrict,
  location_collection_consent boolean not null,
  precise_location_consent boolean not null default false,
  collection_purpose text not null,
  location_source text not null check (location_source in ('device_permission', 'user_entered', 'map_pin')),
  consent_text_version text not null,
  consented_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  check (not precise_location_consent or location_collection_consent),
  check (withdrawn_at is null or withdrawn_at >= consented_at)
);
create index fas_location_consents_user_idx on fas_location_consents (customer_user_id, consented_at desc);

create table fas_locations (
  id uuid primary key default gen_random_uuid(),
  location_type text not null check (location_type in (
    'visitor_approximate', 'contact', 'organisation_registered', 'farm', 'facility',
    'warehouse', 'stock', 'pickup', 'delivery', 'port', 'inspection'
  )),
  location_source text not null check (location_source in (
    'ip_approximate', 'device_permission', 'user_entered', 'map_pin',
    'document_verified', 'inspection_verified', 'administrator_entered'
  )),
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  country_name text,
  region text,
  district text,
  city text,
  postal_code text,
  address_line text,
  port_name text,
  latitude numeric(9,6) check (latitude is null or latitude between -90 and 90),
  longitude numeric(9,6) check (longitude is null or longitude between -180 and 180),
  accuracy_metres numeric(12,2) check (accuracy_metres is null or accuracy_metres > 0),
  user_confirmed boolean not null default false,
  verification_status text not null default 'unverified' check (verification_status in (
    'unverified', 'user_confirmed', 'documents_reviewed', 'inspection_verified', 'rejected', 'expired'
  )),
  verified_by uuid references administrator_users(id) on delete set null,
  verified_at timestamptz,
  verification_method text,
  location_purpose text not null,
  consent_record_id uuid references consent_records(id) on delete set null,
  location_consent_id uuid references fas_location_consents(id) on delete set null,
  detected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check ((latitude is null) = (longitude is null)),
  check (location_source <> 'ip_approximate' or (latitude is null and longitude is null and accuracy_metres is null)),
  check (location_source not in ('device_permission', 'map_pin') or verification_status in ('unverified', 'user_confirmed', 'rejected', 'expired')),
  check (verification_status not in ('documents_reviewed', 'inspection_verified') or (verified_by is not null and verified_at is not null and verification_method is not null))
);
create trigger fas_locations_updated before update on fas_locations for each row execute function set_updated_at();
create index fas_locations_broad_area_idx on fas_locations (country_code, region, district, city) where archived_at is null;
create index fas_locations_coordinates_idx on fas_locations (latitude, longitude) where latitude is not null and archived_at is null;

create table fas_user_locations (
  user_id uuid not null references fas_customer_users(id) on delete restrict,
  location_id uuid not null references fas_locations(id) on delete restrict,
  relationship_type text not null check (relationship_type in ('contact', 'saved', 'farm', 'facility', 'warehouse', 'pickup', 'delivery')),
  is_primary boolean not null default false,
  active_from timestamptz not null default now(),
  active_to timestamptz,
  primary key (user_id, location_id),
  check (active_to is null or active_to > active_from)
);
create unique index fas_user_locations_primary_idx on fas_user_locations (user_id, relationship_type) where is_primary and active_to is null;

create table fas_organisation_locations (
  organisation_id uuid not null references organisations(id) on delete restrict,
  location_id uuid not null references fas_locations(id) on delete restrict,
  relationship_type text not null check (relationship_type in ('registered_office', 'contact', 'farm', 'facility', 'warehouse', 'stock', 'pickup', 'delivery', 'port')),
  is_primary boolean not null default false,
  active_from timestamptz not null default now(),
  active_to timestamptz,
  primary key (organisation_id, location_id),
  check (active_to is null or active_to > active_from)
);
create unique index fas_organisation_locations_primary_idx on fas_organisation_locations (organisation_id, relationship_type) where is_primary and active_to is null;

create table fas_lead_locations (
  lead_id uuid not null references leads(id) on delete cascade,
  location_id uuid not null references fas_locations(id) on delete restrict,
  relationship_type text not null check (relationship_type in ('origin', 'destination', 'stock', 'pickup', 'delivery', 'port', 'access_approximate')),
  created_at timestamptz not null default now(),
  primary key (lead_id, location_id, relationship_type)
);

create table fas_buyer_requirement_locations (
  buyer_lead_id uuid not null references buyer_requirements(lead_id) on delete cascade,
  location_id uuid not null references fas_locations(id) on delete restrict,
  relationship_type text not null check (relationship_type in ('destination', 'delivery', 'port')),
  created_at timestamptz not null default now(),
  primary key (buyer_lead_id, location_id, relationship_type)
);

create table fas_seller_offer_locations (
  seller_lead_id uuid not null references seller_offers(lead_id) on delete cascade,
  location_id uuid not null references fas_locations(id) on delete restrict,
  relationship_type text not null check (relationship_type in ('origin', 'stock', 'pickup', 'farm', 'facility', 'warehouse', 'port')),
  created_at timestamptz not null default now(),
  primary key (seller_lead_id, location_id, relationship_type)
);

create table fas_business_sites (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete restrict,
  site_type text not null check (site_type in ('farm', 'facility', 'warehouse', 'landing_centre', 'processing_facility', 'pickup_point')),
  name text not null,
  status text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger fas_business_sites_updated before update on fas_business_sites for each row execute function set_updated_at();

create table fas_business_site_locations (
  site_id uuid not null references fas_business_sites(id) on delete restrict,
  location_id uuid not null references fas_locations(id) on delete restrict,
  version_number integer not null check (version_number > 0),
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  is_current boolean not null default true,
  primary key (site_id, location_id),
  unique (site_id, version_number),
  check (valid_to is null or valid_to > valid_from),
  check (is_current = (valid_to is null))
);
create unique index fas_business_site_current_location_idx on fas_business_site_locations (site_id) where is_current;

alter table consent_records add column location_collection_consent boolean not null default false;
alter table consent_records add column precise_location_consent boolean not null default false;
alter table consent_records add column location_collection_purpose text;
alter table consent_records add column location_source text check (location_source is null or location_source in ('ip_approximate', 'device_permission', 'user_entered', 'map_pin'));
alter table consent_records add column location_consent_text_version text;
alter table consent_records add column location_consent_time timestamptz;
alter table consent_records add column location_consent_withdrawn_at timestamptz;
alter table consent_records add constraint fas_consent_precise_location_requires_collection check (not precise_location_consent or location_collection_consent);
alter table consent_records add constraint fas_consent_location_withdrawal_order check (location_consent_withdrawn_at is null or location_consent_time is null or location_consent_withdrawn_at >= location_consent_time);

create table fas_location_risk_events (
  id uuid primary key default gen_random_uuid(),
  customer_user_id uuid references fas_customer_users(id) on delete set null,
  organisation_id uuid references organisations(id) on delete set null,
  lead_id uuid references leads(id) on delete cascade,
  claimed_location_id uuid references fas_locations(id) on delete set null,
  comparison_location_id uuid references fas_locations(id) on delete set null,
  signal_type text not null check (signal_type in (
    'claimed_country_differs_from_access_country', 'unusual_access_country_change',
    'facility_pin_address_difference', 'shared_precise_facility_location',
    'pickup_location_changed_after_quotation', 'delivery_location_changed_after_confirmation',
    'bank_change_with_location_anomaly'
  )),
  reason text not null,
  evidence_source text not null,
  status text not null default 'open' check (status in ('open', 'dismissed', 'resolved')),
  resolution_notes text,
  reviewed_by uuid references administrator_users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status = 'open') = (reviewed_at is null)),
  check (status = 'open' or reviewed_by is not null)
);
create index fas_location_risk_events_review_idx on fas_location_risk_events (status, created_at desc);
create index fas_location_risk_events_lead_idx on fas_location_risk_events (lead_id, created_at desc);

create table fas_location_change_requests (
  id uuid primary key default gen_random_uuid(),
  customer_user_id uuid not null references fas_customer_users(id) on delete restrict,
  location_id uuid not null references fas_locations(id) on delete restrict,
  request_type text not null check (request_type in ('correction', 'archive', 'deletion', 'restricted_retention')),
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'completed')),
  retention_reason text,
  reviewed_by uuid references administrator_users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger fas_location_change_requests_updated before update on fas_location_change_requests for each row execute function set_updated_at();
create index fas_location_change_requests_user_idx on fas_location_change_requests (customer_user_id, created_at desc);
