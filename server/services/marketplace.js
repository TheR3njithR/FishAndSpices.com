const PUBLIC_VISIBILITY = ['PUBLIC', 'PUBLIC_AND_MATCHING'];
const PUBLIC_STATUSES = ['ACTIVE', 'MATCHED'];

function normalizeText(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized || null;
}

function buildListingFilters(filters = {}) {
  const values = [];
  const conditions = [
    'l.archived_at is null',
    `l.marketplace_visibility = any($${values.push(PUBLIC_VISIBILITY)}::text[])`,
    "l.marketplace_moderation_status = 'APPROVED'",
    `l.marketplace_status = any($${values.push(PUBLIC_STATUSES)}::text[])`,
    '(l.marketplace_expires_at is null or l.marketplace_expires_at > now())'
  ];

  const role = normalizeText(filters.role);
  if (role) {
    values.push(role.toLowerCase());
    conditions.push(`l.lead_role = $${values.length}`);
  }

  const category = normalizeText(filters.category);
  if (category) {
    values.push(category.toLowerCase());
    conditions.push(`lower(l.category) = $${values.length}`);
  }

  const product = normalizeText(filters.product);
  if (product) {
    values.push(product.toLowerCase());
    conditions.push(`lower(l.product) = $${values.length}`);
  }

  const country = normalizeText(filters.country);
  if (country) {
    values.push(country.toLowerCase());
    conditions.push(`lower(o.country) = $${values.length}`);
  }

  const query = normalizeText(filters.query);
  if (query) {
    values.push(`%${query}%`);
    const marker = `$${values.length}`;
    conditions.push(`(
      lower(l.product) like lower(${marker})
      or lower(coalesce(l.marketplace_title, '')) like lower(${marker})
      or lower(o.country) like lower(${marker})
      or lower(coalesce(fs.common_name, '')) like lower(${marker})
      or lower(coalesce(ss.spice, '')) like lower(${marker})
    )`);
  }

  return { values, whereSql: conditions.join(' and ') };
}

function sortSql(sort) {
  switch (sort) {
    case 'oldest':
      return 'coalesce(l.marketplace_published_at, l.submitted_at) asc';
    case 'quantity_desc':
      return 'l.quantity desc, coalesce(l.marketplace_published_at, l.submitted_at) desc';
    case 'quantity_asc':
      return 'l.quantity asc, coalesce(l.marketplace_published_at, l.submitted_at) desc';
    case 'newest':
    default:
      return 'coalesce(l.marketplace_published_at, l.submitted_at) desc';
  }
}

function mapListingSummary(row) {
  const expectedPrice = row.expectedPrice === null || row.expectedPrice === undefined
    ? null
    : Number(row.expectedPrice);
  return {
    slug: row.slug,
    reference: row.publicReference,
    role: row.role,
    title: row.title,
    category: row.category,
    product: row.product,
    quantity: Number(row.quantity),
    unit: row.unit,
    location: row.location,
    country: row.country,
    verificationStatus: row.verificationStatus,
    verificationLevel: row.verificationLevel,
    isUrgent: row.isUrgent,
    publishedAt: row.publishedAt,
    expiresAt: row.expiresAt,
    productForm: row.productForm,
    grade: row.grade,
    sizeDescription: row.sizeDescription,
    requiredDate: row.requiredDate,
    availabilityDate: row.availabilityDate,
    imageUrl: row.imageUrl,
    thumbnailUrl: row.thumbnailUrl,
    price: row.priceVisibility === 'PUBLIC' && Number.isFinite(expectedPrice)
      ? { amount: expectedPrice, unit: row.priceUnit || null }
      : null
  };
}

function mapListingDetail(row) {
  return {
    ...mapListingSummary(row),
    status: row.status,
    visibility: row.visibility,
    priceVisibility: row.priceVisibility,
    destination: row.destination,
    origin: row.origin,
    deliveryLocation: row.deliveryLocation,
    packingRequirements: row.packingRequirements,
    qualityRequirements: row.qualityRequirements,
    certificationRequirements: row.certificationRequirements,
    deliveryCapability: row.deliveryCapability,
    exportCapability: row.exportCapability,
    packingCapability: row.packingCapability,
    recurringCapacity: row.recurringCapacity,
    sampleRequirement: row.sampleRequirement,
    inspectionRequirement: row.inspectionRequirement
  };
}

const BASE_FROM = `
  from leads l
  join organisations o on o.id = l.organisation_id
  left join buyer_requirements br on br.lead_id = l.id
  left join seller_offers so on so.lead_id = l.id
  left join fish_specifications fs on fs.lead_id = l.id
  left join spice_specifications ss on ss.lead_id = l.id
  left join lateral (
    select image_url, thumbnail_url
    from fas_listing_images images
    where images.lead_id = l.id and images.status = 'active'
    order by images.sort_order asc, images.created_at asc
    limit 1
  ) img on true
`;

const SUMMARY_SELECT = `
  select
    l.public_reference as "publicReference",
    l.marketplace_slug as slug,
    coalesce(l.marketplace_title, case when l.lead_role = 'buyer' then l.product || ' Wanted' else l.product || ' Available' end) as title,
    l.lead_role as role,
    l.category,
    l.product,
    l.quantity,
    l.unit,
    l.marketplace_status as status,
    l.marketplace_visibility as visibility,
    l.marketplace_verification_level as "verificationLevel",
    l.marketplace_price_visibility as "priceVisibility",
    l.verification_status as "verificationStatus",
    l.marketplace_is_urgent as "isUrgent",
    coalesce(l.marketplace_published_at, l.submitted_at) as "publishedAt",
    l.marketplace_expires_at as "expiresAt",
    o.country,
    l.destination,
    l.origin,
    case when l.lead_role = 'buyer' then l.destination else l.origin end as location,
    br.required_date as "requiredDate",
    br.delivery_location as "deliveryLocation",
    br.packing_requirements as "packingRequirements",
    br.quality_requirements as "qualityRequirements",
    br.certification_requirements as "certificationRequirements",
    br.sample_requirement as "sampleRequirement",
    br.inspection_requirement as "inspectionRequirement",
    so.availability_date as "availabilityDate",
    so.expected_price as "expectedPrice",
    so.price_unit as "priceUnit",
    so.delivery_capability as "deliveryCapability",
    so.export_capability as "exportCapability",
    so.packing_capability as "packingCapability",
    so.recurring_capacity as "recurringCapacity",
    coalesce(fs.product_form, ss.product_form) as "productForm",
    fs.size_description as "sizeDescription",
    ss.grade,
    img.image_url as "imageUrl",
    img.thumbnail_url as "thumbnailUrl"
`;

export async function listMarketplaceCategories(pool) {
  const result = await pool.query(`
    select c.slug, c.name, c.sort_order as "sortOrder", c.parent_id as "parentId", c.is_active as "isActive",
      count(p.id)::int as "productCount"
    from fas_marketplace_categories c
    left join fas_marketplace_products p on p.category_id = c.id and p.is_active = true
    where c.is_active = true
    group by c.id, c.slug, c.name, c.sort_order, c.parent_id, c.is_active
    order by c.sort_order asc, c.name asc
  `);
  return result.rows;
}

export async function listMarketplaceProducts(pool, filters = {}) {
  const values = [];
  const conditions = ['p.is_active = true'];

  const categorySlug = normalizeText(filters.categorySlug);
  if (categorySlug) {
    values.push(categorySlug.toLowerCase());
    conditions.push(`lower(c.slug) = $${values.length}`);
  }

  const query = normalizeText(filters.query);
  if (query) {
    values.push(`%${query}%`);
    const marker = `$${values.length}`;
    conditions.push(`(
      lower(p.name) like lower(${marker})
      or lower(p.slug) like lower(${marker})
      or exists (
        select 1 from fas_marketplace_product_aliases a
        where a.product_id = p.id and lower(a.alias) like lower(${marker})
      )
    )`);
  }

  const limit = Number.isFinite(Number(filters.limit)) ? Math.max(1, Math.min(Math.trunc(Number(filters.limit)), 200)) : 100;
  values.push(limit);

  const result = await pool.query(`
    select p.slug, p.name, p.sort_order as "sortOrder", c.slug as "categorySlug", c.name as "categoryName"
    from fas_marketplace_products p
    join fas_marketplace_categories c on c.id = p.category_id
    where ${conditions.join(' and ')}
    order by c.sort_order asc, p.sort_order asc, p.name asc
    limit $${values.length}
  `, values);

  return result.rows;
}

export async function listMarketplaceListings(pool, filters = {}) {
  const page = Number.isFinite(Number(filters.page)) ? Math.max(1, Math.trunc(Number(filters.page))) : 1;
  const pageSize = Number.isFinite(Number(filters.pageSize)) ? Math.min(100, Math.max(1, Math.trunc(Number(filters.pageSize)))) : 20;
  const offset = (page - 1) * pageSize;

  const base = buildListingFilters(filters);

  const countResult = await pool.query(`
    select count(*)::int as total
    ${BASE_FROM}
    where ${base.whereSql}
  `, base.values);
  const total = countResult.rows[0]?.total || 0;

  const values = [...base.values, pageSize, offset];
  const sort = sortSql(filters.sort);
  const result = await pool.query(`
    ${SUMMARY_SELECT}
    ${BASE_FROM}
    where ${base.whereSql}
    order by ${sort}
    limit $${values.length - 1} offset $${values.length}
  `, values);

  return {
    listings: result.rows.map(mapListingSummary),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize)
    }
  };
}

export async function getMarketplaceListingBySlug(pool, { slug, role } = {}) {
  const normalizedSlug = normalizeText(slug);
  if (!normalizedSlug) return null;

  const base = buildListingFilters({ role });
  const values = [...base.values, normalizedSlug.toLowerCase()];

  const result = await pool.query(`
    ${SUMMARY_SELECT}
    ${BASE_FROM}
    where ${base.whereSql} and lower(l.marketplace_slug) = $${values.length}
    limit 1
  `, values);

  if (!result.rowCount) return null;
  return mapListingDetail(result.rows[0]);
}
