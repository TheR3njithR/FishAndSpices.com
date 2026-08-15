-- Marketplace V1 schema expansion. Additive and backward compatible.

create function fas_slugify(value text) returns text language sql immutable as $$
  select trim(both '-' from regexp_replace(lower(coalesce(value, '')), '[^a-z0-9]+', '-', 'g'));
$$;

alter table leads
  add column if not exists marketplace_title text,
  add column if not exists marketplace_slug text,
  add column if not exists marketplace_visibility text not null default 'PRIVATE'
    check (marketplace_visibility in ('PUBLIC', 'PRIVATE', 'PUBLIC_AND_MATCHING')),
  add column if not exists marketplace_moderation_status text not null default 'PENDING_REVIEW'
    check (marketplace_moderation_status in ('PENDING_REVIEW', 'APPROVED', 'REJECTED')),
  add column if not exists marketplace_status text not null default 'PENDING_REVIEW'
    check (marketplace_status in ('DRAFT', 'PENDING_VERIFICATION', 'PENDING_REVIEW', 'ACTIVE', 'PAUSED', 'MATCHED', 'CLOSED', 'SOLD', 'EXPIRED', 'REJECTED', 'ARCHIVED')),
  add column if not exists marketplace_verification_level text not null default 'CONTACT_VERIFIED'
    check (marketplace_verification_level in ('UNVERIFIED', 'CONTACT_VERIFIED', 'IDENTITY_VERIFIED', 'BUSINESS_VERIFIED', 'TRADE_VERIFIED')),
  add column if not exists marketplace_price_visibility text not null default 'QUOTE_ON_REQUEST'
    check (marketplace_price_visibility in ('PUBLIC', 'QUOTE_ON_REQUEST', 'PRIVATE')),
  add column if not exists marketplace_availability_type text,
  add column if not exists marketplace_is_urgent boolean not null default false,
  add column if not exists marketplace_published_at timestamptz,
  add column if not exists marketplace_expires_at timestamptz,
  add column if not exists marketplace_last_activity_at timestamptz not null default now();

create unique index if not exists leads_marketplace_slug_unique_idx
  on leads (marketplace_slug) where marketplace_slug is not null;

create index if not exists leads_marketplace_public_idx on leads (
  marketplace_visibility,
  marketplace_moderation_status,
  marketplace_status,
  submitted_at desc
);

create index if not exists leads_marketplace_expiry_idx on leads (marketplace_expires_at);

update leads
set
  marketplace_title = coalesce(marketplace_title, case
    when lead_role = 'buyer' then concat(product, ' Wanted')
    else concat(product, ' Available')
  end),
  marketplace_slug = coalesce(marketplace_slug,
    fas_slugify(concat(product, '-', case when lead_role = 'buyer' then coalesce(destination, 'requirement') else coalesce(origin, 'listing') end, '-', right(public_reference, 6)))
  ),
  marketplace_visibility = 'PRIVATE',
  marketplace_moderation_status = 'APPROVED',
  marketplace_status = case when archived_at is null then 'ACTIVE' else 'ARCHIVED' end,
  marketplace_published_at = coalesce(marketplace_published_at, submitted_at),
  marketplace_expires_at = coalesce(marketplace_expires_at, submitted_at + interval '90 days'),
  marketplace_last_activity_at = coalesce(marketplace_last_activity_at, submitted_at),
  marketplace_verification_level = case
    when verification_status = 'Verified' then 'BUSINESS_VERIFIED'
    when verification_status = 'In review' then 'IDENTITY_VERIFIED'
    else 'CONTACT_VERIFIED'
  end
where marketplace_title is null
   or marketplace_slug is null
   or marketplace_published_at is null
   or marketplace_expires_at is null
   or marketplace_visibility <> 'PRIVATE'
   or marketplace_moderation_status <> 'APPROVED'
   or marketplace_status not in ('ACTIVE', 'ARCHIVED');

alter table seller_offers
  add column if not exists moq_unit text,
  add column if not exists availability_type text
    check (availability_type is null or availability_type in ('READY_STOCK', 'AVAILABLE_WEEKLY', 'HARVESTING_SOON', 'PRE_ORDER', 'MADE_TO_ORDER')),
  add column if not exists seller_response_rate numeric(5,2) check (seller_response_rate is null or (seller_response_rate >= 0 and seller_response_rate <= 100));

create table if not exists fas_marketplace_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null unique,
  parent_id uuid references fas_marketplace_categories(id) on delete set null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger fas_marketplace_categories_updated before update on fas_marketplace_categories for each row execute function set_updated_at();

create table if not exists fas_marketplace_products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references fas_marketplace_categories(id) on delete restrict,
  slug text not null unique,
  name text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category_id, name)
);
create trigger fas_marketplace_products_updated before update on fas_marketplace_products for each row execute function set_updated_at();

create table if not exists fas_marketplace_product_aliases (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references fas_marketplace_products(id) on delete cascade,
  alias text not null,
  normalized_alias text generated always as (fas_slugify(alias)) stored,
  created_at timestamptz not null default now(),
  unique (product_id, normalized_alias)
);
create index if not exists fas_marketplace_product_alias_lookup_idx on fas_marketplace_product_aliases (normalized_alias);

create table if not exists fas_listing_images (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  image_url text not null,
  thumbnail_url text,
  alt_text text,
  mime_type text,
  file_size_bytes integer check (file_size_bytes is null or file_size_bytes > 0),
  width_px integer check (width_px is null or width_px > 0),
  height_px integer check (height_px is null or height_px > 0),
  sort_order integer not null default 0,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  unique (lead_id, image_url)
);
create index if not exists fas_listing_images_lead_idx on fas_listing_images (lead_id, sort_order, created_at);

create table if not exists fas_contact_requests (
  id uuid primary key default gen_random_uuid(),
  requester_user_id uuid not null references fas_customer_users(id) on delete restrict,
  target_lead_id uuid not null references leads(id) on delete cascade,
  target_role text not null check (target_role in ('buyer', 'seller')),
  message text,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'DECLINED', 'CANCELLED', 'CLOSED')),
  consent_status text not null default 'PENDING' check (consent_status in ('PENDING', 'GRANTED', 'REVOKED', 'DECLINED')),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger fas_contact_requests_updated before update on fas_contact_requests for each row execute function set_updated_at();
create index if not exists fas_contact_requests_target_idx on fas_contact_requests (target_lead_id, created_at desc);
create index if not exists fas_contact_requests_requester_idx on fas_contact_requests (requester_user_id, created_at desc);

create table if not exists fas_quotes (
  id uuid primary key default gen_random_uuid(),
  requirement_lead_id uuid not null references leads(id) on delete cascade,
  seller_user_id uuid not null references fas_customer_users(id) on delete restrict,
  seller_lead_id uuid references leads(id) on delete set null,
  quantity numeric(18,3) not null check (quantity > 0),
  unit text not null,
  unit_price numeric(18,2) check (unit_price is null or unit_price > 0),
  currency text not null default 'INR',
  delivery_terms text,
  delivery_time text,
  valid_until date,
  notes text,
  status text not null default 'SUBMITTED' check (status in ('SUBMITTED', 'VIEWED', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'EXPIRED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (currency in ('INR', 'AED', 'USD', 'EUR', 'GBP'))
);
create trigger fas_quotes_updated before update on fas_quotes for each row execute function set_updated_at();
create index if not exists fas_quotes_requirement_idx on fas_quotes (requirement_lead_id, created_at desc);
create index if not exists fas_quotes_seller_idx on fas_quotes (seller_user_id, created_at desc);

create table if not exists fas_saved_items (
  user_id uuid not null references fas_customer_users(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, lead_id)
);
create index if not exists fas_saved_items_lead_idx on fas_saved_items (lead_id, created_at desc);

create table if not exists fas_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid references fas_customer_users(id) on delete set null,
  lead_id uuid not null references leads(id) on delete cascade,
  reason text not null,
  details text,
  status text not null default 'OPEN' check (status in ('OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger fas_reports_updated before update on fas_reports for each row execute function set_updated_at();
create index if not exists fas_reports_lead_idx on fas_reports (lead_id, created_at desc);

create table if not exists fas_listing_status_history (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  previous_status text,
  new_status text not null,
  actor_type text not null check (actor_type in ('customer', 'administrator', 'system')),
  actor_user_id uuid references fas_customer_users(id) on delete set null,
  actor_admin_id uuid references administrator_users(id) on delete set null,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index if not exists fas_listing_status_history_lead_idx on fas_listing_status_history (lead_id, created_at desc);

create table if not exists fas_admin_notes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  administrator_id uuid not null references administrator_users(id) on delete restrict,
  note text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger fas_admin_notes_updated before update on fas_admin_notes for each row execute function set_updated_at();
create index if not exists fas_admin_notes_lead_idx on fas_admin_notes (lead_id, created_at desc);

insert into fas_marketplace_categories (slug, name, sort_order) values
  ('fish-seafood', 'Fish & Seafood', 10),
  ('spices', 'Spices', 20),
  ('agricultural-products', 'Agricultural Products', 30),
  ('processed-foods', 'Processed Foods', 40)
on conflict (slug) do nothing;

with category_map as (
  select id, slug from fas_marketplace_categories
), products(category_slug, slug, name, sort_order) as (
  values
    ('fish-seafood', 'varal', 'Varal', 10),
    ('fish-seafood', 'karimeen', 'Karimeen', 20),
    ('fish-seafood', 'pomfret', 'Pomfret', 30),
    ('fish-seafood', 'seabass', 'Seabass', 40),
    ('fish-seafood', 'shrimp', 'Shrimp', 50),
    ('fish-seafood', 'prawns', 'Prawns', 60),
    ('fish-seafood', 'crab', 'Crab', 70),
    ('fish-seafood', 'tuna', 'Tuna', 80),
    ('fish-seafood', 'sardine', 'Sardine', 90),
    ('fish-seafood', 'mackerel', 'Mackerel', 100),
    ('fish-seafood', 'dry-fish', 'Dry Fish', 110),
    ('fish-seafood', 'frozen-seafood', 'Frozen Seafood', 120),
    ('fish-seafood', 'live-fish', 'Live Fish', 130),
    ('fish-seafood', 'other-fish-seafood', 'Other', 999),
    ('spices', 'black-pepper', 'Black Pepper', 10),
    ('spices', 'cardamom', 'Cardamom', 20),
    ('spices', 'turmeric', 'Turmeric', 30),
    ('spices', 'ginger', 'Ginger', 40),
    ('spices', 'nutmeg', 'Nutmeg', 50),
    ('spices', 'clove', 'Clove', 60),
    ('spices', 'cinnamon', 'Cinnamon', 70),
    ('spices', 'chilli', 'Chilli', 80),
    ('spices', 'cumin', 'Cumin', 90),
    ('spices', 'coriander', 'Coriander', 100),
    ('spices', 'spice-powders', 'Spice Powders', 110),
    ('spices', 'other-spices', 'Other', 999),
    ('agricultural-products', 'banana', 'Banana', 10),
    ('agricultural-products', 'plantain', 'Plantain', 20),
    ('agricultural-products', 'pineapple', 'Pineapple', 30),
    ('agricultural-products', 'papaya', 'Papaya', 40),
    ('agricultural-products', 'jackfruit', 'Jackfruit', 50),
    ('agricultural-products', 'vegetables', 'Vegetables', 60),
    ('agricultural-products', 'coconut', 'Coconut', 70),
    ('agricultural-products', 'arecanut', 'Arecanut', 80),
    ('agricultural-products', 'coffee', 'Coffee', 90),
    ('agricultural-products', 'tea', 'Tea', 100),
    ('agricultural-products', 'rice', 'Rice', 110),
    ('agricultural-products', 'pulses', 'Pulses', 120),
    ('agricultural-products', 'other-agri', 'Other', 999),
    ('processed-foods', 'pickles', 'Pickles', 10),
    ('processed-foods', 'dry-fish-products', 'Dry Fish Products', 20),
    ('processed-foods', 'spice-mixes', 'Spice Mixes', 30),
    ('processed-foods', 'powders', 'Powders', 40),
    ('processed-foods', 'value-added-products', 'Value-added Products', 50),
    ('processed-foods', 'other-processed-foods', 'Other', 999)
)
insert into fas_marketplace_products (category_id, slug, name, sort_order)
select cm.id, p.slug, p.name, p.sort_order
from products p
join category_map cm on cm.slug = p.category_slug
on conflict (slug) do update set
  category_id = excluded.category_id,
  name = excluded.name,
  sort_order = excluded.sort_order;

insert into fas_marketplace_product_aliases (product_id, alias)
select mp.id, aliases.alias
from fas_marketplace_products mp
join lateral (
  values
    (case when mp.slug = 'black-pepper' then 'kurumulaku' end),
    (case when mp.slug = 'varal' then 'snakehead' end),
    (case when mp.slug = 'karimeen' then 'pearl spot' end)
) as aliases(alias) on aliases.alias is not null
on conflict (product_id, normalized_alias) do nothing;
