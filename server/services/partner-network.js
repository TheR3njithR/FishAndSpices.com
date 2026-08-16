import { withTransaction } from '../db.js';
import { consumeRateLimit } from './rate-limit.js';
import { keyedHash, randomToken } from '../security.js';

const PARTNER_CODE = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PARTNER_TYPES = new Set([
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
]);
const PARTNER_STATUSES = new Set(['PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED', 'INACTIVE']);
const COMMISSION_STATUSES = new Set(['PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'PAYABLE', 'PAID', 'REVERSED']);
const EVENT_TYPES = new Set([
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
]);

const DEFAULT_SETTINGS = Object.freeze({
  referral_cookie_days: '30',
  minimum_payout_amount: '500',
  default_currency: 'INR',
  partner_application_enabled: 'true',
  partner_auto_approval: 'false',
  fraud_review_threshold: 'HIGH',
  commission_hold_period_days: '7',
  payout_frequency: 'monthly'
});

function partnerError(message, status = 422) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function asText(value, { max = 160, required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw partnerError('A required field is missing.');
    return null;
  }
  if (typeof value !== 'string') throw partnerError('Invalid text input.');
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    if (required) throw partnerError('A required field is empty.');
    return null;
  }
  if (normalized.length > max) throw partnerError('A text field is too long.');
  return normalized;
}

function asOptionalUuid(value, label = 'identifier') {
  if (value === undefined || value === null || value === '') return null;
  if (!UUID.test(String(value))) throw partnerError(`Invalid ${label}.`, 400);
  return String(value);
}

function asInteger(value, { min = 0, max = 1_000_000, fallback = null } = {}) {
  if (value === undefined || value === null || value === '') return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) throw partnerError('Invalid number.');
  if (numeric < min || numeric > max) throw partnerError(`Number must be between ${min} and ${max}.`);
  return numeric;
}

function asNumber(value, { min = 0, max = 1_000_000_000 } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < min || numeric > max) throw partnerError('Invalid amount.');
  return numeric;
}

function asBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return value === true || String(value).toLowerCase() === 'true';
}

function normalizePartnerType(value) {
  const normalized = asText(value, { max: 40, required: true })?.toUpperCase();
  if (!PARTNER_TYPES.has(normalized)) throw partnerError('Invalid partner type.');
  return normalized;
}

function normalizePartnerStatus(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = asText(value, { max: 20, required: true })?.toUpperCase();
  if (!PARTNER_STATUSES.has(normalized)) throw partnerError('Invalid partner status.');
  return normalized;
}

function normalizeCommissionStatus(value) {
  const normalized = asText(value, { max: 30, required: true })?.toUpperCase();
  if (!COMMISSION_STATUSES.has(normalized)) throw partnerError('Invalid commission status.');
  return normalized;
}

function normalizeCodeSeed(value) {
  const seed = String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return seed.slice(0, 24) || 'PARTNER';
}

export function normalizePartnerCode(value) {
  const code = normalizeCodeSeed(value).replace(/-/g, '');
  const trimmed = code.slice(0, 16);
  if (!PARTNER_CODE.test(trimmed)) throw partnerError('Invalid partner code format.');
  return trimmed;
}

function randomSuffix(length = 4) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < length; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export function partnerReferralCookieName(config) {
  return config.isProduction ? '__Host-fas_partner_ref' : 'fas_partner_ref';
}

export function partnerReferralCookieOptions(config, days) {
  const maxAge = Math.max(1, Number(days) || 30) * 24 * 60 * 60 * 1000;
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge
  };
}

function newPartnerPublicId() {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `FASP-${stamp}-${randomSuffix(8)}`;
}

export async function getPartnerSettings(pool) {
  const result = await pool.query('select setting_key as key, setting_value as value from fas_partner_settings');
  const map = { ...DEFAULT_SETTINGS };
  for (const row of result.rows) map[row.key] = row.value;
  return map;
}

export async function setPartnerSettings(pool, { updates, adminUserId }) {
  if (!updates || typeof updates !== 'object') throw partnerError('No settings updates provided.');
  const allowed = new Set([
    'referral_cookie_days',
    'minimum_payout_amount',
    'default_currency',
    'partner_application_enabled',
    'partner_auto_approval',
    'fraud_review_threshold',
    'commission_hold_period_days',
    'payout_frequency'
  ]);
  const entries = Object.entries(updates).filter(([key]) => allowed.has(key));
  if (!entries.length) throw partnerError('No supported settings updates provided.');
  await withTransaction(pool, async client => {
    for (const [key, value] of entries) {
      await client.query(`
        insert into fas_partner_settings (setting_key, setting_value, updated_by)
        values ($1,$2,$3)
        on conflict (setting_key)
        do update set setting_value = excluded.setting_value, updated_by = excluded.updated_by
      `, [key, String(value), adminUserId || null]);
    }
  });
  return getPartnerSettings(pool);
}

export async function generatePartnerCode(pool, preferredSeed = 'PARTNER') {
  const base = normalizeCodeSeed(preferredSeed).replace(/-/g, '').slice(0, 10) || 'PARTNER';
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const candidate = `${base}${attempt === 0 ? '' : randomSuffix(4)}`.slice(0, 16);
    if (!PARTNER_CODE.test(candidate)) continue;
    const exists = await pool.query('select 1 from fas_partners where partner_code = $1 limit 1', [candidate]);
    if (!exists.rowCount) return candidate;
  }
  throw partnerError('Unable to generate a unique partner code right now.', 503);
}

function normalizePartnerInput(payload = {}, { forUpdate = false } = {}) {
  const clean = {
    partnerType: payload.partnerType !== undefined ? normalizePartnerType(payload.partnerType) : null,
    displayName: payload.displayName !== undefined ? asText(payload.displayName, { max: 120, required: !forUpdate }) : null,
    legalName: payload.legalName !== undefined ? asText(payload.legalName, { max: 160 }) : null,
    contactPerson: payload.contactPerson !== undefined ? asText(payload.contactPerson, { max: 120 }) : null,
    email: payload.email !== undefined ? asText(payload.email, { max: 200, required: !forUpdate })?.toLowerCase() : null,
    phone: payload.phone !== undefined ? asText(payload.phone, { max: 40, required: !forUpdate }) : null,
    whatsappNumber: payload.whatsappNumber !== undefined ? asText(payload.whatsappNumber, { max: 40 }) : null,
    country: payload.country !== undefined ? asText(payload.country, { max: 80 }) : null,
    state: payload.state !== undefined ? asText(payload.state, { max: 80 }) : null,
    district: payload.district !== undefined ? asText(payload.district, { max: 80 }) : null,
    city: payload.city !== undefined ? asText(payload.city, { max: 80 }) : null,
    address: payload.address !== undefined ? asText(payload.address, { max: 240 }) : null,
    instagramHandle: payload.instagramHandle !== undefined ? asText(payload.instagramHandle, { max: 120 }) : null,
    youtubeChannel: payload.youtubeChannel !== undefined ? asText(payload.youtubeChannel, { max: 200 }) : null,
    facebookPage: payload.facebookPage !== undefined ? asText(payload.facebookPage, { max: 200 }) : null,
    website: payload.website !== undefined ? asText(payload.website, { max: 240 }) : null,
    primaryPlatform: payload.primaryPlatform !== undefined ? asText(payload.primaryPlatform, { max: 80 }) : null,
    niche: payload.niche !== undefined ? asText(payload.niche, { max: 120 }) : null,
    followerCount: payload.followerCount !== undefined ? asInteger(payload.followerCount, { min: 0, max: 1_000_000_000, fallback: null }) : null,
    notes: payload.notes !== undefined ? asText(payload.notes, { max: 2000 }) : null,
    status: payload.status !== undefined ? normalizePartnerStatus(payload.status) : null,
    verificationStatus: payload.verificationStatus !== undefined ? asText(payload.verificationStatus, { max: 20 })?.toUpperCase() : null,
    kycStatus: payload.kycStatus !== undefined ? asText(payload.kycStatus, { max: 20 })?.toUpperCase() : null,
    commissionPlanId: payload.commissionPlanId !== undefined ? asOptionalUuid(payload.commissionPlanId, 'commission plan') : null,
    userId: payload.userId !== undefined ? asOptionalUuid(payload.userId, 'user') : null,
  partnerTier: payload.partnerTier !== undefined ? (asText(payload.partnerTier, { max: 20 })?.toUpperCase() || null) : null,
    partnerCode: payload.partnerCode !== undefined && payload.partnerCode !== null && payload.partnerCode !== ''
      ? normalizePartnerCode(payload.partnerCode)
      : null
  };

  if (!forUpdate) {
    if (!clean.partnerType) throw partnerError('Partner type is required.');
    if (!clean.displayName) throw partnerError('Display name is required.');
    if (!clean.email) throw partnerError('Email is required.');
    if (!clean.phone) throw partnerError('Phone is required.');
  }

  if (clean.verificationStatus && !['PENDING', 'VERIFIED', 'REJECTED'].includes(clean.verificationStatus)) {
    throw partnerError('Invalid verification status.');
  }
  if (clean.kycStatus && !['PENDING', 'VERIFIED', 'REJECTED'].includes(clean.kycStatus)) {
    throw partnerError('Invalid KYC status.');
  }
  if (clean.partnerTier && !['STARTER', 'SILVER', 'GOLD', 'PLATINUM'].includes(clean.partnerTier)) {
    throw partnerError('Invalid partner tier.');
  }

  return clean;
}

function mapPartnerRow(row) {
  return {
    id: row.id,
    publicId: row.public_id,
    userId: row.user_id,
    partnerCode: row.partner_code,
    partnerType: row.partner_type,
    displayName: row.display_name,
    legalName: row.legal_name,
    contactPerson: row.contact_person,
    email: row.email,
    phone: row.phone,
    whatsappNumber: row.whatsapp_number,
    country: row.country,
    state: row.state,
    district: row.district,
    city: row.city,
    address: row.address,
    instagramHandle: row.instagram_handle,
    youtubeChannel: row.youtube_channel,
    facebookPage: row.facebook_page,
    website: row.website,
    primaryPlatform: row.primary_platform,
    niche: row.niche,
    followerCount: row.follower_count === null ? null : Number(row.follower_count),
    notes: row.notes,
    status: row.status,
    verificationStatus: row.verification_status,
    kycStatus: row.kyc_status,
  partnerTier: row.partner_tier,
    commissionPlanId: row.commission_plan_id,
    approvedAt: row.approved_at,
    suspendedAt: row.suspended_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function createPartner(pool, payload, { autoApprove = false } = {}) {
  const clean = normalizePartnerInput(payload, { forUpdate: false });
  const status = clean.status || (autoApprove ? 'ACTIVE' : 'PENDING');
  const verificationStatus = clean.verificationStatus || 'PENDING';
  const kycStatus = clean.kycStatus || 'PENDING';
  const partnerCode = clean.partnerCode || await generatePartnerCode(pool, clean.displayName);

  const result = await pool.query(`
    insert into fas_partners (
      public_id, user_id, partner_code, partner_type, display_name, legal_name, contact_person,
      email, phone, whatsapp_number, country, state, district, city, address,
      instagram_handle, youtube_channel, facebook_page, website, primary_platform,
      niche, follower_count, notes, status, verification_status, kyc_status,
      commission_plan_id, approved_at, partner_tier
    ) values (
      $1,$2,$3,$4,$5,$6,$7,
      $8,$9,$10,$11,$12,$13,$14,$15,
      $16,$17,$18,$19,$20,
      $21,$22,$23,$24,$25,$26,
      $27,$28,$29
    ) returning *
  `, [
    newPartnerPublicId(),
    clean.userId,
    partnerCode,
    clean.partnerType,
    clean.displayName,
    clean.legalName,
    clean.contactPerson,
    clean.email,
    clean.phone,
    clean.whatsappNumber,
    clean.country,
    clean.state,
    clean.district,
    clean.city,
    clean.address,
    clean.instagramHandle,
    clean.youtubeChannel,
    clean.facebookPage,
    clean.website,
    clean.primaryPlatform,
    clean.niche,
    clean.followerCount,
    clean.notes,
    status,
    verificationStatus,
    kycStatus,
    clean.commissionPlanId,
    status === 'ACTIVE' ? new Date() : null,
  clean.partnerTier
  ]);
  return mapPartnerRow(result.rows[0]);
}

export async function updatePartner(pool, partnerId, payload) {
  if (!UUID.test(String(partnerId))) throw partnerError('Invalid partner identifier.', 400);
  const clean = normalizePartnerInput(payload, { forUpdate: true });

  const updates = [];
  const values = [];
  const set = (column, value) => {
    values.push(value);
    updates.push(`${column} = $${values.length}`);
  };

  if (clean.userId !== null || payload.userId !== undefined) set('user_id', clean.userId);
  if (clean.partnerCode) set('partner_code', clean.partnerCode);
  if (clean.partnerType) set('partner_type', clean.partnerType);
  if (clean.displayName !== null || payload.displayName !== undefined) set('display_name', clean.displayName);
  if (clean.legalName !== null || payload.legalName !== undefined) set('legal_name', clean.legalName);
  if (clean.contactPerson !== null || payload.contactPerson !== undefined) set('contact_person', clean.contactPerson);
  if (clean.email !== null || payload.email !== undefined) set('email', clean.email);
  if (clean.phone !== null || payload.phone !== undefined) set('phone', clean.phone);
  if (clean.whatsappNumber !== null || payload.whatsappNumber !== undefined) set('whatsapp_number', clean.whatsappNumber);
  if (clean.country !== null || payload.country !== undefined) set('country', clean.country);
  if (clean.state !== null || payload.state !== undefined) set('state', clean.state);
  if (clean.district !== null || payload.district !== undefined) set('district', clean.district);
  if (clean.city !== null || payload.city !== undefined) set('city', clean.city);
  if (clean.address !== null || payload.address !== undefined) set('address', clean.address);
  if (clean.instagramHandle !== null || payload.instagramHandle !== undefined) set('instagram_handle', clean.instagramHandle);
  if (clean.youtubeChannel !== null || payload.youtubeChannel !== undefined) set('youtube_channel', clean.youtubeChannel);
  if (clean.facebookPage !== null || payload.facebookPage !== undefined) set('facebook_page', clean.facebookPage);
  if (clean.website !== null || payload.website !== undefined) set('website', clean.website);
  if (clean.primaryPlatform !== null || payload.primaryPlatform !== undefined) set('primary_platform', clean.primaryPlatform);
  if (clean.niche !== null || payload.niche !== undefined) set('niche', clean.niche);
  if (clean.followerCount !== null || payload.followerCount !== undefined) set('follower_count', clean.followerCount);
  if (clean.notes !== null || payload.notes !== undefined) set('notes', clean.notes);
  if (clean.verificationStatus) set('verification_status', clean.verificationStatus);
  if (clean.kycStatus) set('kyc_status', clean.kycStatus);
  if (clean.partnerTier !== null || payload.partnerTier !== undefined) set('partner_tier', clean.partnerTier);
  if (clean.commissionPlanId !== null || payload.commissionPlanId !== undefined) set('commission_plan_id', clean.commissionPlanId);

  if (clean.status) {
    set('status', clean.status);
    if (clean.status === 'ACTIVE') set('approved_at', new Date());
    if (clean.status === 'SUSPENDED') set('suspended_at', new Date());
  }

  if (!updates.length) throw partnerError('No supported partner changes provided.');
  values.push(partnerId);

  const result = await pool.query(`
    update fas_partners
    set ${updates.join(', ')}
    where id = $${values.length}
    returning *
  `, values);
  if (!result.rowCount) throw partnerError('Partner not found.', 404);
  return mapPartnerRow(result.rows[0]);
}

export async function regeneratePartnerCode(pool, partnerId) {
  if (!UUID.test(String(partnerId))) throw partnerError('Invalid partner identifier.', 400);
  const partner = await pool.query('select display_name from fas_partners where id = $1 limit 1', [partnerId]);
  if (!partner.rowCount) throw partnerError('Partner not found.', 404);
  const code = await generatePartnerCode(pool, partner.rows[0].display_name);
  const result = await pool.query('update fas_partners set partner_code = $1 where id = $2 returning *', [code, partnerId]);
  return mapPartnerRow(result.rows[0]);
}

export async function listPartners(pool, query = {}) {
  const page = asInteger(query.page, { min: 1, max: 100_000, fallback: 1 });
  const pageSize = asInteger(query.pageSize, { min: 1, max: 100, fallback: 20 });
  const offset = (page - 1) * pageSize;

  const where = ['1=1'];
  const values = [];
  const add = (clause, value) => {
    values.push(value);
    where.push(clause.replace('?', `$${values.length}`));
  };

  const status = normalizePartnerStatus(query.status, null);
  if (status) add('p.status = ?', status);

  if (query.partnerType) add('p.partner_type = ?', normalizePartnerType(query.partnerType));
  if (query.country) add("lower(coalesce(p.country, '')) like lower(?)", `%${asText(query.country, { max: 80 })}%`);
  if (query.state) add("lower(coalesce(p.state, '')) like lower(?)", `%${asText(query.state, { max: 80 })}%`);
  if (query.district) add("lower(coalesce(p.district, '')) like lower(?)", `%${asText(query.district, { max: 80 })}%`);
  if (query.commissionPlanId) add('p.commission_plan_id = ?', asOptionalUuid(query.commissionPlanId, 'commission plan'));
  if (query.fromDate) add('p.created_at >= ?', new Date(query.fromDate));
  if (query.toDate) add('p.created_at < ?', new Date(query.toDate));
  if (query.search) {
    const text = `%${asText(query.search, { max: 120 })}%`;
    values.push(text, text, text, text, text, text);
    where.push(`(
      p.display_name ilike $${values.length - 5}
      or p.email::text ilike $${values.length - 4}
      or coalesce(p.phone, '') ilike $${values.length - 3}
      or p.partner_code::text ilike $${values.length - 2}
      or coalesce(p.instagram_handle, '') ilike $${values.length - 1}
      or coalesce(p.youtube_channel, '') ilike $${values.length}
    )`);
  }

  const whereSql = where.join(' and ');

  const count = await pool.query(`select count(*)::int as total from fas_partners p where ${whereSql}`, values);
  const total = count.rows[0]?.total || 0;

  const resultValues = [...values, pageSize, offset];
  const rows = await pool.query(`
    select
      p.*,
      coalesce(clicks.clicks, 0)::int as clicks,
      coalesce(refs.registrations, 0)::int as registrations,
      coalesce(events.verified_users, 0)::int as verified_users,
      coalesce(events.verified_sellers, 0)::int as verified_sellers,
      coalesce(events.verified_buyers, 0)::int as verified_buyers,
      coalesce(events.seller_listings, 0)::int as seller_listings,
      coalesce(events.buyer_requirements, 0)::int as buyer_requirements,
      coalesce(events.transactions, 0)::int as completed_transactions,
      coalesce(commission.total_commission, 0)::numeric as total_commission,
      coalesce(commission.pending_amount, 0)::numeric as pending_amount,
      coalesce(commission.payable_amount, 0)::numeric as payable_amount,
      coalesce(commission.paid_amount, 0)::numeric as paid_amount
    from fas_partners p
    left join lateral (
      select count(*) as clicks
      from fas_partner_referral_clicks c
      where c.partner_id = p.id
    ) clicks on true
    left join lateral (
      select count(*) as registrations
      from fas_partner_referrals r
      where r.partner_id = p.id
    ) refs on true
    left join lateral (
      select
        count(*) filter (where e.event_type = 'OTP_VERIFIED') as verified_users,
        count(*) filter (where e.event_type = 'SELLER_VERIFIED') as verified_sellers,
        count(*) filter (where e.event_type = 'BUYER_VERIFIED') as verified_buyers,
        count(*) filter (where e.event_type = 'SELLER_LISTING_CREATED') as seller_listings,
        count(*) filter (where e.event_type = 'BUYER_REQUIREMENT_CREATED') as buyer_requirements,
        count(*) filter (where e.event_type in ('FIRST_TRANSACTION_COMPLETED', 'REPEAT_TRANSACTION_COMPLETED')) as transactions
      from fas_partner_events e
      where e.partner_id = p.id
    ) events on true
    left join lateral (
      select
        sum(c.amount) as total_commission,
        sum(c.amount) filter (where c.status in ('PENDING', 'UNDER_REVIEW', 'APPROVED')) as pending_amount,
        sum(c.amount) filter (where c.status = 'PAYABLE') as payable_amount,
        sum(c.amount) filter (where c.status = 'PAID') as paid_amount
      from fas_partner_commissions c
      where c.partner_id = p.id
    ) commission on true
    where ${whereSql}
    order by p.created_at desc
    limit $${resultValues.length - 1} offset $${resultValues.length}
  `, resultValues);

  return {
    total,
    page,
    pageSize,
    partners: rows.rows.map(row => ({
      ...mapPartnerRow(row),
      metrics: {
        clicks: row.clicks,
        registrations: row.registrations,
        verifiedUsers: row.verified_users,
        verifiedSellers: row.verified_sellers,
        verifiedBuyers: row.verified_buyers,
        listings: row.seller_listings,
        buyerRequirements: row.buyer_requirements,
        completedTransactions: row.completed_transactions,
        totalCommission: Number(row.total_commission || 0),
        pending: Number(row.pending_amount || 0),
        payable: Number(row.payable_amount || 0),
        paid: Number(row.paid_amount || 0)
      }
    }))
  };
}

export async function getPartnerDetail(pool, partnerId, { page = 1, pageSize = 20 } = {}) {
  if (!UUID.test(String(partnerId))) throw partnerError('Invalid partner identifier.', 400);
  await maturePendingCommissions(pool);

  const partner = await pool.query('select * from fas_partners where id = $1 limit 1', [partnerId]);
  if (!partner.rowCount) throw partnerError('Partner not found.', 404);

  const summary = await pool.query(`
    select
      coalesce(clicks.clicks, 0)::int as clicks,
      coalesce(refs.registrations, 0)::int as registrations,
      coalesce(events.otp_verified, 0)::int as otp_verified,
      coalesce(events.profile_completed, 0)::int as profile_completed,
      coalesce(events.buyer_verified, 0)::int as buyer_verified,
      coalesce(events.seller_verified, 0)::int as seller_verified,
      coalesce(events.listings, 0)::int as listings,
      coalesce(events.requirements, 0)::int as requirements,
      coalesce(events.matches, 0)::int as matches,
      coalesce(events.transactions, 0)::int as transactions,
      coalesce(commissions.pending, 0)::numeric as pending,
      coalesce(commissions.payable, 0)::numeric as payable,
      coalesce(commissions.paid, 0)::numeric as paid,
      coalesce(commissions.lifetime, 0)::numeric as lifetime
    from fas_partners p
    left join lateral (select count(*) as clicks from fas_partner_referral_clicks c where c.partner_id = p.id) clicks on true
    left join lateral (select count(*) as registrations from fas_partner_referrals r where r.partner_id = p.id) refs on true
    left join lateral (
      select
        count(*) filter (where event_type = 'OTP_VERIFIED') as otp_verified,
        count(*) filter (where event_type = 'PROFILE_COMPLETED') as profile_completed,
        count(*) filter (where event_type = 'BUYER_VERIFIED') as buyer_verified,
        count(*) filter (where event_type = 'SELLER_VERIFIED') as seller_verified,
        count(*) filter (where event_type = 'SELLER_LISTING_CREATED') as listings,
        count(*) filter (where event_type = 'BUYER_REQUIREMENT_CREATED') as requirements,
        count(*) filter (where event_type = 'MATCH_CREATED') as matches,
        count(*) filter (where event_type in ('FIRST_TRANSACTION_COMPLETED','REPEAT_TRANSACTION_COMPLETED')) as transactions
      from fas_partner_events e
      where e.partner_id = p.id
    ) events on true
    left join lateral (
      select
        sum(amount) filter (where status in ('PENDING','UNDER_REVIEW','APPROVED')) as pending,
        sum(amount) filter (where status = 'PAYABLE') as payable,
        sum(amount) filter (where status = 'PAID') as paid,
        sum(amount) as lifetime
      from fas_partner_commissions c
      where c.partner_id = p.id
    ) commissions on true
    where p.id = $1
  `, [partnerId]);

  const refs = await listPartnerReferrals(pool, partnerId, { page, pageSize });
  const earnings = await listPartnerEarnings(pool, partnerId, { page, pageSize });
  const payouts = await listPartnerPayouts(pool, { partnerId, page, pageSize });
  const fraud = await pool.query(`
    select id, flag_type as "flagType", severity, description, status,
      reviewed_by as "reviewedBy", reviewed_at as "reviewedAt", created_at as "createdAt"
    from fas_partner_fraud_flags
    where partner_id = $1
    order by created_at desc
    limit 50
  `, [partnerId]);

  return {
    partner: mapPartnerRow(partner.rows[0]),
    performance: {
      clicks: summary.rows[0].clicks,
      registrations: summary.rows[0].registrations,
      otpVerified: summary.rows[0].otp_verified,
      profileCompleted: summary.rows[0].profile_completed,
      verifiedBuyers: summary.rows[0].buyer_verified,
      verifiedSellers: summary.rows[0].seller_verified,
      listings: summary.rows[0].listings,
      buyerRequirements: summary.rows[0].requirements,
      matches: summary.rows[0].matches,
      transactions: summary.rows[0].transactions,
      pending: Number(summary.rows[0].pending || 0),
      payable: Number(summary.rows[0].payable || 0),
      paid: Number(summary.rows[0].paid || 0),
      lifetime: Number(summary.rows[0].lifetime || 0)
    },
    referrals: refs,
    commissions: earnings,
    payouts,
    fraudFlags: fraud.rows
  };
}

export async function listCommissionPlans(pool) {
  const result = await pool.query(`
    select p.*, count(r.id)::int as rule_count
    from fas_partner_commission_plans p
    left join fas_partner_commission_rules r on r.commission_plan_id = p.id and r.status <> 'ARCHIVED'
    group by p.id
    order by p.created_at desc
  `);
  return result.rows.map(row => ({
    id: row.id,
    name: row.name,
    description: row.description,
    currency: row.currency,
    status: row.status,
    effectiveFrom: row.effective_from,
    effectiveUntil: row.effective_until,
    ruleCount: row.rule_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

export async function createCommissionPlan(pool, payload) {
  const name = asText(payload.name, { max: 160, required: true });
  const description = asText(payload.description, { max: 2000 });
  const currency = (asText(payload.currency, { max: 5 }) || 'INR').toUpperCase();
  const status = (asText(payload.status, { max: 20 }) || 'ACTIVE').toUpperCase();
  const effectiveFrom = payload.effectiveFrom ? new Date(payload.effectiveFrom) : new Date();
  const effectiveUntil = payload.effectiveUntil ? new Date(payload.effectiveUntil) : null;
  const result = await pool.query(`
    insert into fas_partner_commission_plans (name, description, currency, status, effective_from, effective_until)
    values ($1,$2,$3,$4,$5,$6)
    returning *
  `, [name, description, currency, status, effectiveFrom, effectiveUntil]);
  return result.rows[0];
}

export async function updateCommissionPlan(pool, planId, payload) {
  if (!UUID.test(String(planId))) throw partnerError('Invalid plan identifier.', 400);
  const updates = [];
  const values = [];
  const set = (column, value) => {
    values.push(value);
    updates.push(`${column} = $${values.length}`);
  };

  if (payload.name !== undefined) set('name', asText(payload.name, { max: 160, required: true }));
  if (payload.description !== undefined) set('description', asText(payload.description, { max: 2000 }));
  if (payload.currency !== undefined) set('currency', asText(payload.currency, { max: 5, required: true }).toUpperCase());
  if (payload.status !== undefined) set('status', asText(payload.status, { max: 20, required: true }).toUpperCase());
  if (payload.effectiveFrom !== undefined) set('effective_from', payload.effectiveFrom ? new Date(payload.effectiveFrom) : new Date());
  if (payload.effectiveUntil !== undefined) set('effective_until', payload.effectiveUntil ? new Date(payload.effectiveUntil) : null);

  if (!updates.length) throw partnerError('No supported plan updates provided.');
  values.push(planId);

  const result = await pool.query(`
    update fas_partner_commission_plans
    set ${updates.join(', ')}
    where id = $${values.length}
    returning *
  `, values);
  if (!result.rowCount) throw partnerError('Commission plan not found.', 404);
  return result.rows[0];
}

export async function listCommissionRules(pool, planId) {
  if (!UUID.test(String(planId))) throw partnerError('Invalid plan identifier.', 400);
  const result = await pool.query(`
    select * from fas_partner_commission_rules
    where commission_plan_id = $1
    order by priority desc, created_at asc
  `, [planId]);
  return result.rows;
}

export async function createCommissionRule(pool, planId, payload) {
  if (!UUID.test(String(planId))) throw partnerError('Invalid plan identifier.', 400);
  const eventType = asText(payload.eventType, { max: 60, required: true }).toUpperCase();
  if (!EVENT_TYPES.has(eventType)) throw partnerError('Invalid commission event type.');
  const partnerType = payload.partnerType ? normalizePartnerType(payload.partnerType) : null;
  const userRole = asText(payload.userRole, { max: 60 });
  const category = asText(payload.category, { max: 60 });
  const amount = asNumber(payload.amount, { min: 0, max: 1_000_000_000 });
  const currency = (asText(payload.currency, { max: 5 }) || 'INR').toUpperCase();
  const maximumPerUser = asInteger(payload.maximumPerUser, { min: 1, max: 10_000, fallback: null });
  const maximumPerMonth = asInteger(payload.maximumPerMonth, { min: 1, max: 10_000, fallback: null });
  const requiresAdminApproval = asBoolean(payload.requiresAdminApproval, false);
  const coolingPeriodDays = asInteger(payload.coolingPeriodDays, { min: 0, max: 90, fallback: 0 });
  const status = (asText(payload.status, { max: 20 }) || 'ACTIVE').toUpperCase();
  const priority = asInteger(payload.priority, { min: 1, max: 10_000, fallback: 100 });
  const effectiveFrom = payload.effectiveFrom ? new Date(payload.effectiveFrom) : new Date();
  const effectiveUntil = payload.effectiveUntil ? new Date(payload.effectiveUntil) : null;

  const result = await pool.query(`
    insert into fas_partner_commission_rules (
      commission_plan_id, event_type, partner_type, user_role, category, amount, currency,
      maximum_per_user, maximum_per_month, requires_admin_approval, cooling_period_days,
      status, priority, effective_from, effective_until
    ) values (
      $1,$2,$3,$4,$5,$6,$7,
      $8,$9,$10,$11,
      $12,$13,$14,$15
    ) returning *
  `, [
    planId,
    eventType,
    partnerType,
    userRole,
    category,
    amount,
    currency,
    maximumPerUser,
    maximumPerMonth,
    requiresAdminApproval,
    coolingPeriodDays,
    status,
    priority,
    effectiveFrom,
    effectiveUntil
  ]);
  return result.rows[0];
}

export async function updateCommissionRule(pool, ruleId, payload) {
  if (!UUID.test(String(ruleId))) throw partnerError('Invalid rule identifier.', 400);
  const updates = [];
  const values = [];
  const set = (column, value) => {
    values.push(value);
    updates.push(`${column} = $${values.length}`);
  };

  if (payload.eventType !== undefined) {
    const eventType = asText(payload.eventType, { max: 60, required: true }).toUpperCase();
    if (!EVENT_TYPES.has(eventType)) throw partnerError('Invalid commission event type.');
    set('event_type', eventType);
  }
  if (payload.partnerType !== undefined) set('partner_type', payload.partnerType ? normalizePartnerType(payload.partnerType) : null);
  if (payload.userRole !== undefined) set('user_role', asText(payload.userRole, { max: 60 }));
  if (payload.category !== undefined) set('category', asText(payload.category, { max: 60 }));
  if (payload.amount !== undefined) set('amount', asNumber(payload.amount, { min: 0, max: 1_000_000_000 }));
  if (payload.currency !== undefined) set('currency', asText(payload.currency, { max: 5, required: true }).toUpperCase());
  if (payload.maximumPerUser !== undefined) set('maximum_per_user', asInteger(payload.maximumPerUser, { min: 1, max: 10_000, fallback: null }));
  if (payload.maximumPerMonth !== undefined) set('maximum_per_month', asInteger(payload.maximumPerMonth, { min: 1, max: 10_000, fallback: null }));
  if (payload.requiresAdminApproval !== undefined) set('requires_admin_approval', asBoolean(payload.requiresAdminApproval, false));
  if (payload.coolingPeriodDays !== undefined) set('cooling_period_days', asInteger(payload.coolingPeriodDays, { min: 0, max: 90, fallback: 0 }));
  if (payload.status !== undefined) set('status', asText(payload.status, { max: 20, required: true }).toUpperCase());
  if (payload.priority !== undefined) set('priority', asInteger(payload.priority, { min: 1, max: 10_000, fallback: 100 }));
  if (payload.effectiveFrom !== undefined) set('effective_from', payload.effectiveFrom ? new Date(payload.effectiveFrom) : new Date());
  if (payload.effectiveUntil !== undefined) set('effective_until', payload.effectiveUntil ? new Date(payload.effectiveUntil) : null);

  if (!updates.length) throw partnerError('No supported rule updates provided.');
  values.push(ruleId);

  const result = await pool.query(`
    update fas_partner_commission_rules
    set ${updates.join(', ')}
    where id = $${values.length}
    returning *
  `, values);
  if (!result.rowCount) throw partnerError('Commission rule not found.', 404);
  return result.rows[0];
}

function normalizeReferralCode(value) {
  const cleaned = String(value || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  if (!cleaned || cleaned.length < 3 || cleaned.length > 32) return null;
  if (!PARTNER_CODE.test(cleaned)) return null;
  return cleaned;
}

function normalizeLandingPage(value) {
  if (!value) return '/';
  if (typeof value !== 'string') return '/';
  const trimmed = value.slice(0, 500).trim();
  return trimmed || '/';
}

async function resolveActivePartnerByCode(pool, code) {
  const result = await pool.query(`
    select id, partner_code as "partnerCode", partner_type as "partnerType", status, commission_plan_id as "commissionPlanId",
      user_id as "userId", email::text as email, phone
    from fas_partners
    where partner_code = $1
    limit 1
  `, [code]);
  const partner = result.rows[0] || null;
  if (!partner || partner.status !== 'ACTIVE') return null;
  return partner;
}

async function resolveAttributionByToken(pool, token, config, now = new Date()) {
  if (!token) return null;
  const tokenHash = keyedHash(token, config.sessionSecret);
  const result = await pool.query(`
    select a.*, p.status as partner_status
    from fas_partner_referral_attributions a
    join fas_partners p on p.id = a.partner_id
    where a.token_hash = $1
      and a.expires_at > $2
    limit 1
  `, [tokenHash, now]);
  if (!result.rowCount) return null;
  const row = result.rows[0];
  if (row.partner_status !== 'ACTIVE') return null;
  return row;
}

export async function captureReferralAttribution({ pool, request, config, now = new Date() }) {
  if (!config.partnerNetworkEnabled) return { captured: false, ignored: true, reason: 'disabled' };

  const settings = await getPartnerSettings(pool);
  const existingToken = request.cookies[partnerReferralCookieName(config)] || null;
  const existing = await resolveAttributionByToken(pool, existingToken, config, now);

  const incomingCode = normalizeReferralCode(request.query?.ref);
  const landingPage = normalizeLandingPage(request.originalUrl || request.url || '/');
  const referrerUrl = asText(request.get('referer'), { max: 500 });
  const utmSource = asText(request.query?.utm_source, { max: 120 });
  const utmMedium = asText(request.query?.utm_medium, { max: 120 });
  const utmCampaign = asText(request.query?.utm_campaign, { max: 160 });
  const utmTerm = asText(request.query?.utm_term, { max: 160 });
  const utmContent = asText(request.query?.utm_content, { max: 160 });
  const sessionId = asText(request.query?.sid, { max: 120 });
  const country = asText(request.get('x-fas-country-name'), { max: 120 });
  const region = asText(request.get('x-fas-region'), { max: 120 });
  const city = asText(request.get('x-fas-city'), { max: 120 });

  await consumeRateLimit(pool, 'partner_referral_capture', `${request.ip || 'unknown'}:${request.get('user-agent') || 'na'}`, config, now);

  if (!incomingCode) {
    if (existing) return { captured: false, preserved: true, partnerCode: existing.referral_code };
    return { captured: false, ignored: true, reason: 'invalid_referral_code' };
  }

  const partner = await resolveActivePartnerByCode(pool, incomingCode);
  if (!partner) {
    if (existing) return { captured: false, preserved: true, partnerCode: existing.referral_code };
    return { captured: false, ignored: true, reason: 'unknown_or_inactive_partner' };
  }

  const campaignCode = normalizeReferralCode(request.query?.campaign || request.query?.campaign_code);
  let campaignId = null;
  if (campaignCode) {
    const campaign = await pool.query(`
      select id
      from fas_partner_campaigns
      where partner_id = $1 and upper(campaign_code) = $2 and status = 'ACTIVE'
      limit 1
    `, [partner.id, campaignCode]);
    campaignId = campaign.rows[0]?.id || null;
  }

  await pool.query(`
    insert into fas_partner_referral_clicks (
      partner_id, referral_code, campaign_id, session_id, visitor_hash, landing_page,
      referrer_url, utm_source, utm_medium, utm_campaign, utm_term, utm_content,
      ip_hash, user_agent_hash, country, region, city
    ) values (
      $1,$2,$3,$4,$5,$6,
      $7,$8,$9,$10,$11,$12,
      $13,$14,$15,$16,$17
    )
  `, [
    partner.id,
    partner.partnerCode,
    campaignId,
    sessionId,
    keyedHash(`${request.ip || 'unknown'}:${request.get('user-agent') || ''}:${landingPage}`, config.sessionSecret),
    landingPage,
    referrerUrl,
    utmSource,
    utmMedium,
    utmCampaign,
    utmTerm,
    utmContent,
    keyedHash(request.ip || 'unknown', config.sessionSecret),
    keyedHash(request.get('user-agent') || '', config.sessionSecret),
    country,
    region,
    city
  ]);

  if (existing) {
    return {
      captured: false,
      preserved: true,
      partnerCode: existing.referral_code,
      incomingCode: partner.partnerCode
    };
  }

  const referralDays = Math.max(1, Number(settings.referral_cookie_days || config.partnerReferralCookieDays || 30));
  const expiresAt = new Date(now.getTime() + referralDays * 24 * 60 * 60 * 1000);
  const token = randomToken(24);
  const tokenHash = keyedHash(token, config.sessionSecret);

  await pool.query(`
    insert into fas_partner_referral_attributions (
      token_hash, partner_id, referral_code, campaign_id, landing_url,
      source_domain, source_page, referrer_url, utm_source, utm_medium, utm_campaign,
      utm_content, utm_term, initial_timestamp, expires_at
    ) values (
      $1,$2,$3,$4,$5,
      $6,$7,$8,$9,$10,$11,
      $12,$13,$14,$15
    )
  `, [
    tokenHash,
    partner.id,
    partner.partnerCode,
    campaignId,
    landingPage,
    request.hostname || null,
    request.path || null,
    referrerUrl,
    utmSource,
    utmMedium,
    utmCampaign,
    utmContent,
    utmTerm,
    now,
    expiresAt
  ]);

  return {
    captured: true,
    token,
    expiresAt,
    partnerCode: partner.partnerCode,
    attributionDays: referralDays
  };
}

async function upsertFraudFlag(pool, { partnerId, referredUserId, eventId = null, flagType, severity = 'MEDIUM', description }) {
  await pool.query(`
    insert into fas_partner_fraud_flags (
      partner_id, referred_user_id, event_id, flag_type, severity, description, status
    ) values ($1,$2,$3,$4,$5,$6,'OPEN')
  `, [partnerId, referredUserId, eventId, flagType, severity, description]);
}

async function applyReferralFraudChecks(pool, { partner, userId, referralId, eventId = null }) {
  if (!partner || !userId) return;
  if (partner.userId && partner.userId === userId) {
    await upsertFraudFlag(pool, {
      partnerId: partner.id,
      referredUserId: userId,
      eventId,
      flagType: 'SELF_REFERRAL',
      severity: 'HIGH',
      description: 'Partner account appears to refer its own linked user account.'
    });
  }

  const identities = await pool.query(`
    select identity_type, normalized_value
    from fas_user_identities
    where user_id = $1 and verification_status in ('verified', 'unverified')
  `, [userId]);

  const emailIdentity = identities.rows.find(row => row.identity_type === 'email')?.normalized_value || null;
  const mobileIdentity = identities.rows.find(row => row.identity_type === 'mobile')?.normalized_value || null;

  if (emailIdentity && partner.email && emailIdentity.toLowerCase() === String(partner.email).toLowerCase()) {
    await upsertFraudFlag(pool, {
      partnerId: partner.id,
      referredUserId: userId,
      eventId,
      flagType: 'DUPLICATE_EMAIL',
      severity: 'MEDIUM',
      description: 'Referred user email matches partner email.'
    });
  }

  if (mobileIdentity && partner.phone) {
    const normalizedPartnerPhone = String(partner.phone).replace(/\s+/g, '');
    const normalizedUserPhone = String(mobileIdentity).replace(/\s+/g, '');
    if (normalizedPartnerPhone === normalizedUserPhone) {
      await upsertFraudFlag(pool, {
        partnerId: partner.id,
        referredUserId: userId,
        eventId,
        flagType: 'DUPLICATE_PHONE',
        severity: 'MEDIUM',
        description: 'Referred user phone matches partner phone.'
      });
    }
  }

  if (referralId) {
    const recent = await pool.query(`
      select count(*)::int as total
      from fas_partner_referrals
      where partner_id = $1 and created_at >= now() - interval '1 day'
    `, [partner.id]);
    if ((recent.rows[0]?.total || 0) > 75) {
      await upsertFraudFlag(pool, {
        partnerId: partner.id,
        referredUserId: userId,
        eventId,
        flagType: 'HIGH_VELOCITY_REGISTRATION',
        severity: 'HIGH',
        description: 'High registration velocity detected for this partner in the last 24 hours.'
      });
    }
  }
}

export async function linkReferralToUserFromCookie({ pool, config, userId, referralCookieToken, userRole = null, now = new Date() }) {
  if (!config.partnerNetworkEnabled || !userId || !referralCookieToken) return null;
  const existing = await pool.query(`
    select r.id, r.partner_id as "partnerId", r.referred_user_id as "userId", r.referral_code as "referralCode"
    from fas_partner_referrals r
    where r.referred_user_id = $1
    limit 1
  `, [userId]);
  if (existing.rowCount) return existing.rows[0];

  const attribution = await resolveAttributionByToken(pool, referralCookieToken, config, now);
  if (!attribution) return null;

  return withTransaction(pool, async client => {
    const duplicate = await client.query('select id from fas_partner_referrals where referred_user_id = $1 limit 1', [userId]);
    if (duplicate.rowCount) return { id: duplicate.rows[0].id, duplicated: true };

    const inserted = await client.query(`
      insert into fas_partner_referrals (
        partner_id, referred_user_id, attribution_id, referral_code,
        registration_timestamp, user_role, qualification_status, fraud_status
      ) values ($1,$2,$3,$4,$5,$6,'PENDING','CLEAR')
      returning id, partner_id as "partnerId", referred_user_id as "userId", referral_code as "referralCode"
    `, [
      attribution.partner_id,
      userId,
      attribution.id,
      attribution.referral_code,
      now,
      userRole
    ]);

    await client.query(`
      update fas_partner_referral_attributions
      set consumed_at = coalesce(consumed_at, $1)
      where id = $2
    `, [now, attribution.id]);

    const partner = await client.query(`
      select id, user_id as "userId", email::text as email, phone
      from fas_partners
      where id = $1
      limit 1
    `, [attribution.partner_id]);

    await applyReferralFraudChecks(client, {
      partner: partner.rows[0],
      userId,
      referralId: inserted.rows[0].id
    });

    return inserted.rows[0];
  });
}

async function markEventProcessed(pool, eventId, { qualificationStatus, commissionGenerated }) {
  await pool.query(`
    update fas_partner_events
    set processed_at = now(), qualification_status = $2, commission_generated = $3
    where id = $1
  `, [eventId, qualificationStatus, commissionGenerated]);
}

async function evaluateAndCreateCommission(pool, { eventId, partnerId, userId, eventType, userRole, occurredAt = new Date() }) {
  const partnerResult = await pool.query(`
    select id, status, partner_type as "partnerType", commission_plan_id as "commissionPlanId"
    from fas_partners
    where id = $1
    limit 1
  `, [partnerId]);
  const partner = partnerResult.rows[0];
  if (!partner || partner.status !== 'ACTIVE' || !partner.commissionPlanId) {
    await markEventProcessed(pool, eventId, { qualificationStatus: 'DISQUALIFIED', commissionGenerated: false });
    return null;
  }

  const rules = await pool.query(`
    select *
    from fas_partner_commission_rules
    where commission_plan_id = $1
      and event_type = $2
      and status = 'ACTIVE'
      and effective_from <= $3
      and (effective_until is null or effective_until > $3)
      and (partner_type is null or partner_type = $4)
      and (user_role is null or lower(user_role) = lower($5))
    order by priority desc, amount desc, created_at asc
  `, [partner.commissionPlanId, eventType, occurredAt, partner.partnerType, userRole || null]);

  if (!rules.rowCount) {
    await markEventProcessed(pool, eventId, { qualificationStatus: 'DISQUALIFIED', commissionGenerated: false });
    return null;
  }

  for (const rule of rules.rows) {
    if (rule.maximum_per_user && userId) {
      const perUser = await pool.query(`
        select count(*)::int as total
        from fas_partner_commissions c
        where c.commission_rule_id = $1
          and c.referred_user_id = $2
          and c.status <> 'REJECTED'
      `, [rule.id, userId]);
      if ((perUser.rows[0]?.total || 0) >= rule.maximum_per_user) continue;
    }

    if (rule.maximum_per_month) {
      const monthCount = await pool.query(`
        select count(*)::int as total
        from fas_partner_commissions c
        where c.commission_rule_id = $1
          and c.partner_id = $2
          and date_trunc('month', c.created_at) = date_trunc('month', $3::timestamptz)
          and c.status <> 'REJECTED'
      `, [rule.id, partnerId, occurredAt]);
      if ((monthCount.rows[0]?.total || 0) >= rule.maximum_per_month) continue;
    }

    const pendingUntil = rule.cooling_period_days > 0
      ? new Date(occurredAt.getTime() + rule.cooling_period_days * 24 * 60 * 60 * 1000)
      : null;
    const status = pendingUntil
      ? 'PENDING'
      : rule.requires_admin_approval
        ? 'UNDER_REVIEW'
        : 'PAYABLE';

    const created = await pool.query(`
      insert into fas_partner_commissions (
        partner_id, referred_user_id, partner_event_id, commission_rule_id,
        amount, currency, status, pending_until
      ) values ($1,$2,$3,$4,$5,$6,$7,$8)
      on conflict (partner_event_id) do nothing
      returning *
    `, [
      partnerId,
      userId,
      eventId,
      rule.id,
      rule.amount,
      rule.currency,
      status,
      pendingUntil
    ]);

    if (created.rowCount) {
      await markEventProcessed(pool, eventId, { qualificationStatus: 'QUALIFIED', commissionGenerated: true });
      return created.rows[0];
    }

    return null;
  }

  await markEventProcessed(pool, eventId, { qualificationStatus: 'DISQUALIFIED', commissionGenerated: false });
  return null;
}

export async function maturePendingCommissions(pool, now = new Date()) {
  await pool.query(`
    update fas_partner_commissions c
    set status = case
      when r.requires_admin_approval then 'UNDER_REVIEW'
      else 'PAYABLE'
    end
    from fas_partner_commission_rules r
    where c.commission_rule_id = r.id
      and c.status = 'PENDING'
      and c.pending_until is not null
      and c.pending_until <= $1
      and not exists (
        select 1
        from fas_partner_fraud_flags f
        where f.partner_id = c.partner_id
          and (f.referred_user_id is null or f.referred_user_id = c.referred_user_id)
          and f.status in ('OPEN', 'REVIEWING')
      )
  `, [now]);
}

export async function emitPartnerEvent({
  pool,
  config,
  userId,
  eventType,
  entityType = null,
  entityId = null,
  eventValue = null,
  metadata = null,
  userRole = null,
  dedupeKey = null,
  occurredAt = new Date()
}) {
  if (!config.partnerNetworkEnabled || !userId) return { recorded: false, reason: 'disabled_or_missing_user' };
  const normalizedType = asText(eventType, { max: 60, required: true }).toUpperCase();
  if (!EVENT_TYPES.has(normalizedType)) throw partnerError('Unsupported partner event type.');

  const referral = await pool.query(`
    select r.id as "referralId", r.partner_id as "partnerId", p.status as "partnerStatus"
    from fas_partner_referrals r
    join fas_partners p on p.id = r.partner_id
    where r.referred_user_id = $1
    limit 1
  `, [userId]);
  if (!referral.rowCount) return { recorded: false, reason: 'user_not_referred' };

  const partnerRef = referral.rows[0];
  if (partnerRef.partnerStatus !== 'ACTIVE') return { recorded: false, reason: 'partner_not_active' };

  const key = dedupeKey || `${partnerRef.partnerId}:${userId}:${normalizedType}:${entityType || 'none'}:${entityId || 'none'}`;
  const insert = await pool.query(`
    insert into fas_partner_events (
      partner_id, referred_user_id, referral_id, event_type,
      entity_type, entity_id, event_value, user_role, metadata_json,
      dedupe_key, occurred_at, qualification_status, commission_generated
    ) values (
      $1,$2,$3,$4,
      $5,$6,$7,$8,$9,
      $10,$11,'PENDING',false
    )
    on conflict (dedupe_key) do nothing
    returning id
  `, [
    partnerRef.partnerId,
    userId,
    partnerRef.referralId,
    normalizedType,
    entityType,
    entityId,
    eventValue,
    userRole,
    metadata,
    key,
    occurredAt
  ]);

  if (!insert.rowCount) return { recorded: false, duplicate: true };
  await evaluateAndCreateCommission(pool, {
    eventId: insert.rows[0].id,
    partnerId: partnerRef.partnerId,
    userId,
    eventType: normalizedType,
    userRole,
    occurredAt
  });

  await applyReferralFraudChecks(pool, {
    partner: { id: partnerRef.partnerId },
    userId,
    eventId: insert.rows[0].id
  }).catch(() => {});

  return { recorded: true, eventId: insert.rows[0].id };
}

export async function markPartnerReferralOtpVerified(pool, userId, at = new Date()) {
  if (!userId) return;
  await pool.query(`
    update fas_partner_referrals
    set otp_verified_at = coalesce(otp_verified_at, $2),
      updated_at = now()
    where referred_user_id = $1
  `, [userId, at]);
}

export async function listCommissions(pool, query = {}) {
  await maturePendingCommissions(pool);
  const page = asInteger(query.page, { min: 1, max: 100_000, fallback: 1 });
  const pageSize = asInteger(query.pageSize, { min: 1, max: 100, fallback: 25 });
  const offset = (page - 1) * pageSize;

  const where = ['1=1'];
  const values = [];
  const add = (clause, value) => {
    values.push(value);
    where.push(clause.replace('?', `$${values.length}`));
  };

  if (query.partnerId) add('c.partner_id = ?', asOptionalUuid(query.partnerId, 'partner'));
  if (query.status) add('c.status = ?', normalizeCommissionStatus(query.status));

  const totalResult = await pool.query(`
    select count(*)::int as total
    from fas_partner_commissions c
    where ${where.join(' and ')}
  `, values);

  const valuesWithPage = [...values, pageSize, offset];
  const rows = await pool.query(`
    select
      c.id,
      c.partner_id as "partnerId",
      p.display_name as "partnerName",
      c.referred_user_id as "referredUserId",
      c.partner_event_id as "partnerEventId",
      e.event_type as "eventType",
      c.commission_rule_id as "commissionRuleId",
      c.amount,
      c.currency,
      c.status,
      c.pending_until as "pendingUntil",
      c.approved_at as "approvedAt",
      c.rejected_at as "rejectedAt",
      c.rejection_reason as "rejectionReason",
      c.paid_at as "paidAt",
      c.created_at as "createdAt",
      c.updated_at as "updatedAt"
    from fas_partner_commissions c
    join fas_partners p on p.id = c.partner_id
    join fas_partner_events e on e.id = c.partner_event_id
    where ${where.join(' and ')}
    order by c.created_at desc
    limit $${valuesWithPage.length - 1} offset $${valuesWithPage.length}
  `, valuesWithPage);

  return {
    total: totalResult.rows[0]?.total || 0,
    page,
    pageSize,
    commissions: rows.rows.map(row => ({
      ...row,
      amount: Number(row.amount)
    }))
  };
}

export async function updateCommissionStatus(pool, commissionId, { status, reason = null, adminUserId = null }) {
  if (!UUID.test(String(commissionId))) throw partnerError('Invalid commission identifier.', 400);
  const normalizedStatus = normalizeCommissionStatus(status);
  const allowed = new Set(['APPROVED', 'REJECTED', 'PAYABLE', 'PAID', 'REVERSED', 'UNDER_REVIEW']);
  if (!allowed.has(normalizedStatus)) throw partnerError('Unsupported commission transition.');

  const fields = ['status = $1'];
  const values = [normalizedStatus];

  if (normalizedStatus === 'APPROVED') {
    fields.push('approved_at = now()', 'approved_by = $2', 'rejected_at = null', 'rejected_by = null', 'rejection_reason = null');
    values.push(adminUserId || null);
  } else if (normalizedStatus === 'REJECTED') {
    fields.push('rejected_at = now()', 'rejected_by = $2', 'rejection_reason = $3');
    values.push(adminUserId || null, asText(reason, { max: 400, required: true }));
  } else if (normalizedStatus === 'PAID') {
    fields.push('paid_at = now()');
  }

  values.push(commissionId);
  const result = await pool.query(`
    update fas_partner_commissions
    set ${fields.join(', ')}
    where id = $${values.length}
    returning *
  `, values);
  if (!result.rowCount) throw partnerError('Commission not found.', 404);
  return result.rows[0];
}

function payoutReference() {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `PAY-${stamp}-${randomSuffix(7)}`;
}

export async function listPartnerPayouts(pool, { partnerId = null, page = 1, pageSize = 20 } = {}) {
  const where = ['1=1'];
  const values = [];
  if (partnerId) {
    values.push(asOptionalUuid(partnerId, 'partner'));
    where.push(`partner_id = $${values.length}`);
  }
  const safePage = Math.max(1, Number(page) || 1);
  const safeSize = Math.max(1, Math.min(100, Number(pageSize) || 20));
  const offset = (safePage - 1) * safeSize;
  const count = await pool.query(`select count(*)::int as total from fas_partner_payouts where ${where.join(' and ')}`, values);
  const rows = await pool.query(`
    select *
    from fas_partner_payouts
    where ${where.join(' and ')}
    order by created_at desc
    limit $${values.length + 1} offset $${values.length + 2}
  `, [...values, safeSize, offset]);
  return {
    total: count.rows[0]?.total || 0,
    page: safePage,
    pageSize: safeSize,
    payouts: rows.rows
  };
}

export async function createManualPayout(pool, {
  partnerId,
  paymentMethod,
  notes = null,
  commissionIds = null,
  requestedAt = new Date()
}) {
  const id = asOptionalUuid(partnerId, 'partner');
  if (!id) throw partnerError('Partner is required.', 422);
  const method = asText(paymentMethod, { max: 40, required: true }).toUpperCase();
  if (!['UPI', 'BANK_TRANSFER', 'OTHER'].includes(method)) throw partnerError('Invalid payout method.');

  const settings = await getPartnerSettings(pool);
  const minimum = Number(settings.minimum_payout_amount || 0);

  return withTransaction(pool, async client => {
    const filter = commissionIds?.length
      ? `and c.id = any($2::uuid[])`
      : '';
    const payable = await client.query(`
      select c.id, c.amount, c.currency
      from fas_partner_commissions c
      where c.partner_id = $1
        and c.status = 'PAYABLE'
        ${filter}
      order by c.created_at asc
      for update
    `, commissionIds?.length ? [id, commissionIds] : [id]);

    if (!payable.rowCount) throw partnerError('No payable commissions found for payout.', 409);

    const total = payable.rows.reduce((sum, row) => sum + Number(row.amount), 0);
    if (total < minimum) {
      throw partnerError(`Minimum payout amount is ${minimum}.`, 409);
    }

    const currency = payable.rows[0].currency;
    const payout = await client.query(`
      insert into fas_partner_payouts (
        partner_id, payout_reference, amount, currency, payment_method, status, requested_at, notes
      ) values ($1,$2,$3,$4,$5,'APPROVED',$6,$7)
      returning *
    `, [id, payoutReference(), total, currency, method, requestedAt, asText(notes, { max: 2000 })]);

    for (const commission of payable.rows) {
      await client.query(`
        insert into fas_partner_payout_items (payout_id, commission_id, amount)
        values ($1,$2,$3)
      `, [payout.rows[0].id, commission.id, commission.amount]);
    }

    return payout.rows[0];
  });
}

export async function markPayoutStatus(pool, payoutId, { status, paymentReference = null, notes = null }) {
  if (!UUID.test(String(payoutId))) throw partnerError('Invalid payout identifier.', 400);
  const normalized = asText(status, { max: 20, required: true }).toUpperCase();
  if (!['PENDING', 'APPROVED', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED'].includes(normalized)) {
    throw partnerError('Invalid payout status.');
  }

  return withTransaction(pool, async client => {
    const payout = await client.query('select * from fas_partner_payouts where id = $1 for update', [payoutId]);
    if (!payout.rowCount) throw partnerError('Payout not found.', 404);

    const updated = await client.query(`
      update fas_partner_payouts
      set status = $1,
          payment_reference = coalesce($2, payment_reference),
          notes = coalesce($3, notes),
          approved_at = case when $1 in ('APPROVED','PROCESSING','PAID') then coalesce(approved_at, now()) else approved_at end,
          paid_at = case when $1 = 'PAID' then coalesce(paid_at, now()) else paid_at end
      where id = $4
      returning *
    `, [normalized, asText(paymentReference, { max: 200 }), asText(notes, { max: 2000 }), payoutId]);

    if (normalized === 'PAID') {
      await client.query(`
        update fas_partner_commissions c
        set status = 'PAID', paid_at = now()
        from fas_partner_payout_items i
        where i.payout_id = $1
          and c.id = i.commission_id
          and c.status = 'PAYABLE'
      `, [payoutId]);
    }

    if (normalized === 'FAILED' || normalized === 'CANCELLED') {
      await client.query(`
        update fas_partner_commissions c
        set status = 'PAYABLE'
        from fas_partner_payout_items i
        where i.payout_id = $1
          and c.id = i.commission_id
          and c.status <> 'PAID'
      `, [payoutId]);
    }

    return updated.rows[0];
  });
}

export async function listPartnerReferrals(pool, partnerId, { page = 1, pageSize = 20 } = {}) {
  if (!UUID.test(String(partnerId))) throw partnerError('Invalid partner identifier.', 400);
  const safePage = Math.max(1, Number(page) || 1);
  const safeSize = Math.max(1, Math.min(100, Number(pageSize) || 20));
  const offset = (safePage - 1) * safeSize;

  const total = await pool.query('select count(*)::int as total from fas_partner_referrals where partner_id = $1', [partnerId]);
  const result = await pool.query(`
    select
      r.id,
      r.referred_user_id as "referredUserId",
      r.referral_code as "referralCode",
      r.registration_timestamp as "registrationTimestamp",
      r.user_role as "userRole",
      r.otp_verified_at as "otpVerifiedAt",
      r.profile_completed_at as "profileCompletedAt",
      r.qualification_status as "qualificationStatus",
      r.fraud_status as "fraudStatus",
      l.country_code as "countryCode",
      l.region,
      l.district,
      l.city
    from fas_partner_referrals r
    left join lateral (
      select country_code, region, district, city
      from fas_locations l
      join fas_user_locations ul on ul.location_id = l.id
      where ul.user_id = r.referred_user_id
        and ul.active_to is null
        and l.archived_at is null
      order by l.created_at desc
      limit 1
    ) l on true
    where r.partner_id = $1
    order by r.created_at desc
    limit $2 offset $3
  `, [partnerId, safeSize, offset]);

  return {
    total: total.rows[0]?.total || 0,
    page: safePage,
    pageSize: safeSize,
    referrals: result.rows
  };
}

export async function listPartnerEarnings(pool, partnerId, { page = 1, pageSize = 20 } = {}) {
  if (!UUID.test(String(partnerId))) throw partnerError('Invalid partner identifier.', 400);
  await maturePendingCommissions(pool);
  const safePage = Math.max(1, Number(page) || 1);
  const safeSize = Math.max(1, Math.min(100, Number(pageSize) || 20));
  const offset = (safePage - 1) * safeSize;

  const total = await pool.query('select count(*)::int as total from fas_partner_commissions where partner_id = $1', [partnerId]);
  const rows = await pool.query(`
    select
      c.id,
      c.created_at as "date",
      e.event_type as "activity",
      c.referred_user_id as "referredUserId",
      c.amount,
      c.currency,
      c.status,
      c.pending_until as "pendingUntil"
    from fas_partner_commissions c
    join fas_partner_events e on e.id = c.partner_event_id
    where c.partner_id = $1
    order by c.created_at desc
    limit $2 offset $3
  `, [partnerId, safeSize, offset]);

  const summary = await pool.query(`
    select
      sum(amount) filter (where status in ('PENDING','UNDER_REVIEW','APPROVED')) as pending,
      sum(amount) filter (where status = 'APPROVED') as approved,
      sum(amount) filter (where status = 'PAYABLE') as payable,
      sum(amount) filter (where status = 'PAID') as paid,
      sum(amount) as lifetime
    from fas_partner_commissions
    where partner_id = $1
  `, [partnerId]);

  return {
    total: total.rows[0]?.total || 0,
    page: safePage,
    pageSize: safeSize,
    summary: {
      pending: Number(summary.rows[0]?.pending || 0),
      approved: Number(summary.rows[0]?.approved || 0),
      payable: Number(summary.rows[0]?.payable || 0),
      paid: Number(summary.rows[0]?.paid || 0),
      lifetime: Number(summary.rows[0]?.lifetime || 0)
    },
    ledger: rows.rows.map(row => ({ ...row, amount: Number(row.amount) }))
  };
}

export async function createPartnerCampaign(pool, partnerId, payload) {
  if (!UUID.test(String(partnerId))) throw partnerError('Invalid partner identifier.', 400);
  const name = asText(payload.name, { max: 120, required: true });
  const campaignCode = normalizePartnerCode(payload.campaignCode || name);
  const landingPage = normalizeLandingPage(payload.landingPage || '/');
  const utmCampaign = asText(payload.utmCampaign, { max: 160 }) || campaignCode.toLowerCase();
  const utmSource = asText(payload.utmSource, { max: 120 });
  const utmMedium = asText(payload.utmMedium, { max: 120 });
  const utmContent = asText(payload.utmContent, { max: 160 });
  const utmTerm = asText(payload.utmTerm, { max: 160 });

  const result = await pool.query(`
    insert into fas_partner_campaigns (
      partner_id, name, campaign_code, landing_page, utm_campaign,
      utm_source, utm_medium, utm_content, utm_term, status
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ACTIVE')
    returning *
  `, [partnerId, name, campaignCode, landingPage, utmCampaign, utmSource, utmMedium, utmContent, utmTerm]);
  return result.rows[0];
}

export async function listPartnerCampaigns(pool, partnerId) {
  if (!UUID.test(String(partnerId))) throw partnerError('Invalid partner identifier.', 400);
  const rows = await pool.query(`
    select
      c.*,
      coalesce(clicks.clicks, 0)::int as clicks,
      coalesce(regs.registrations, 0)::int as registrations,
      coalesce(qualified.qualified_users, 0)::int as qualified_users,
      coalesce(txn.transactions, 0)::int as transactions,
      coalesce(comm.commission, 0)::numeric as commission
    from fas_partner_campaigns c
    left join lateral (
      select count(*) as clicks from fas_partner_referral_clicks x where x.campaign_id = c.id
    ) clicks on true
    left join lateral (
      select count(*) as registrations
      from fas_partner_referrals r
      join fas_partner_referral_attributions a on a.id = r.attribution_id
      where r.partner_id = c.partner_id and a.campaign_id = c.id
    ) regs on true
    left join lateral (
      select count(*) as qualified_users
      from fas_partner_events e
      where e.partner_id = c.partner_id and e.qualification_status = 'QUALIFIED'
        and e.metadata_json ->> 'campaignId' = c.id::text
    ) qualified on true
    left join lateral (
      select count(*) as transactions
      from fas_partner_events e
      where e.partner_id = c.partner_id
        and e.event_type in ('FIRST_TRANSACTION_COMPLETED','REPEAT_TRANSACTION_COMPLETED')
        and e.metadata_json ->> 'campaignId' = c.id::text
    ) txn on true
    left join lateral (
      select sum(amount) as commission
      from fas_partner_commissions cm
      join fas_partner_events e on e.id = cm.partner_event_id
      where cm.partner_id = c.partner_id
        and e.metadata_json ->> 'campaignId' = c.id::text
    ) comm on true
    where c.partner_id = $1
    order by c.created_at desc
  `, [partnerId]);

  return rows.rows.map(row => ({
    id: row.id,
    name: row.name,
    campaignCode: row.campaign_code,
    landingPage: row.landing_page,
    utmCampaign: row.utm_campaign,
    utmSource: row.utm_source,
    utmMedium: row.utm_medium,
    utmContent: row.utm_content,
    utmTerm: row.utm_term,
    status: row.status,
    createdAt: row.created_at,
    performance: {
      clicks: row.clicks,
      registrations: row.registrations,
      qualifiedUsers: row.qualified_users,
      transactions: row.transactions,
      commission: Number(row.commission || 0)
    }
  }));
}

export function buildPartnerReferralLink({ appOrigin, partnerCode, landingPage = '/', campaign = null, utm = {} }) {
  const code = normalizePartnerCode(partnerCode);
  const base = new URL(appOrigin || 'https://fishandspices.com');
  const target = new URL(landingPage || '/', base);
  target.searchParams.set('ref', code);
  if (campaign) target.searchParams.set('campaign', normalizePartnerCode(campaign));
  if (utm.source) target.searchParams.set('utm_source', String(utm.source));
  if (utm.medium) target.searchParams.set('utm_medium', String(utm.medium));
  if (utm.campaign) target.searchParams.set('utm_campaign', String(utm.campaign));
  if (utm.content) target.searchParams.set('utm_content', String(utm.content));
  if (utm.term) target.searchParams.set('utm_term', String(utm.term));
  return target.toString();
}

export async function getPartnerNetworkOverview(pool) {
  await maturePendingCommissions(pool);
  const result = await pool.query(`
    with events as (
      select
        count(*) filter (where event_type = 'OTP_VERIFIED') as verified_users,
        count(*) filter (where event_type = 'BUYER_VERIFIED') as buyer_verified,
        count(*) filter (where event_type = 'SELLER_VERIFIED') as seller_verified,
        count(*) filter (where event_type = 'SELLER_LISTING_CREATED') as listings,
        count(*) filter (where event_type = 'BUYER_REQUIREMENT_CREATED') as rfqs,
        count(*) filter (where event_type in ('FIRST_TRANSACTION_COMPLETED','REPEAT_TRANSACTION_COMPLETED')) as transactions
      from fas_partner_events
    ),
    commissions as (
      select
        sum(amount) as total,
        sum(amount) filter (where status in ('PENDING','UNDER_REVIEW','APPROVED')) as pending,
        sum(amount) filter (where status = 'PAYABLE') as payable,
        sum(amount) filter (where status = 'PAID') as paid
      from fas_partner_commissions
    )
    select
      (select count(*)::int from fas_partners) as total_partners,
      (select count(*)::int from fas_partners where status = 'ACTIVE') as active_partners,
      (select count(*)::int from fas_partner_referral_clicks) as clicks,
      (select count(*)::int from fas_partner_referrals) as registrations,
      events.verified_users,
      events.buyer_verified,
      events.seller_verified,
      events.listings,
      events.rfqs,
      events.transactions,
      commissions.total,
      commissions.pending,
      commissions.payable,
      commissions.paid
    from events, commissions
  `);

  const row = result.rows[0];
  return {
    totalPartners: row.total_partners || 0,
    activePartners: row.active_partners || 0,
    clicks: row.clicks || 0,
    registrations: row.registrations || 0,
    verifiedUsers: row.verified_users || 0,
    verifiedBuyers: row.buyer_verified || 0,
    verifiedSellers: row.seller_verified || 0,
    listings: row.listings || 0,
    buyerRequirements: row.rfqs || 0,
    completedTransactions: row.transactions || 0,
    commissionCost: Number(row.total || 0),
    pendingCommission: Number(row.pending || 0),
    payableCommission: Number(row.payable || 0),
    paidCommission: Number(row.paid || 0)
  };
}

export async function getPartnerByUserId(pool, userId) {
  if (!userId) return null;
  const result = await pool.query(`
    select *
    from fas_partners
    where user_id = $1
    limit 1
  `, [userId]);
  if (!result.rowCount) return null;
  return mapPartnerRow(result.rows[0]);
}
