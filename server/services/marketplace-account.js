import { withTransaction } from '../db.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PUBLIC_VISIBILITY = ['PUBLIC', 'PUBLIC_AND_MATCHING'];
const PUBLIC_STATUSES = ['ACTIVE', 'MATCHED'];
const CURRENCIES = new Set(['INR', 'AED', 'USD', 'EUR', 'GBP']);

function requestError(message, status = 422) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function requireUuid(value, label) {
  if (!UUID.test(String(value || ''))) throw requestError(`Invalid ${label}.`, 400);
  return String(value);
}

function optionalText(value, { label, max = 2000 } = {}) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw requestError(`Invalid ${label}.`);
  const clean = value.replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  if (clean.length > max) throw requestError(`${label} is too long.`);
  return clean;
}

function requiredText(value, { label, max = 120 } = {}) {
  const clean = optionalText(value, { label, max });
  if (!clean) throw requestError(`${label} is required.`);
  return clean;
}

function positiveNumber(value, { label, max = 1_000_000_000 } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric > max) throw requestError(`Invalid ${label}.`);
  return numeric;
}

function optionalDate(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw requestError(`Invalid ${label}.`);
  return value;
}

async function resolvePublicLead(pool, leadId, { role = null } = {}) {
  const result = await pool.query(`
    select id, lead_role as role, customer_user_id as "customerUserId",
      public_reference as "publicReference", marketplace_slug as slug, product
    from leads
    where id = $1
      and archived_at is null
      and marketplace_visibility = any($2::text[])
      and marketplace_moderation_status = 'APPROVED'
      and marketplace_status = any($3::text[])
      and (marketplace_expires_at is null or marketplace_expires_at > now())
    limit 1
  `, [leadId, PUBLIC_VISIBILITY, PUBLIC_STATUSES]);
  const lead = result.rows[0] || null;
  if (!lead || (role && lead.role !== role)) return null;
  return lead;
}

export async function createContactRequest(pool, { userId, targetLeadId, message }) {
  const leadId = requireUuid(targetLeadId, 'target lead identifier');
  const cleanMessage = optionalText(message, { label: 'Message', max: 2000 });
  return withTransaction(pool, async client => {
    const target = await resolvePublicLead(client, leadId);
    if (!target) throw requestError('Target listing is not available for contact.', 404);
    if (target.customerUserId === userId) throw requestError('You cannot contact your own listing.');

    const existing = await client.query(`
      select id from fas_contact_requests
      where requester_user_id = $1 and target_lead_id = $2 and status in ('PENDING', 'APPROVED')
      order by created_at desc
      limit 1
    `, [userId, leadId]);
    if (existing.rowCount) throw requestError('A contact request is already open for this listing.', 409);

    const inserted = await client.query(`
      insert into fas_contact_requests (requester_user_id, target_lead_id, target_role, message)
      values ($1,$2,$3,$4)
      returning id, status, consent_status as "consentStatus", created_at as "createdAt"
    `, [userId, leadId, target.role, cleanMessage]);

    return {
      ...inserted.rows[0],
      target: {
        leadId,
        role: target.role,
        reference: target.publicReference,
        slug: target.slug,
        product: target.product
      }
    };
  });
}

export async function createQuote(pool, { userId, requirementLeadId, sellerLeadId, quantity, unit, unitPrice, currency, deliveryTerms, deliveryTime, validUntil, notes }) {
  const requirementId = requireUuid(requirementLeadId, 'requirement lead identifier');
  const linkedSellerLeadId = sellerLeadId ? requireUuid(sellerLeadId, 'seller lead identifier') : null;
  const quoteQuantity = positiveNumber(quantity, { label: 'quantity' });
  const quoteUnit = requiredText(unit, { label: 'unit', max: 40 });
  const quoteUnitPrice = unitPrice === undefined || unitPrice === null || unitPrice === ''
    ? null
    : positiveNumber(unitPrice, { label: 'unit price', max: 1_000_000_000 });
  const quoteCurrency = (currency || 'INR').toUpperCase();
  if (!CURRENCIES.has(quoteCurrency)) throw requestError('Unsupported currency.');
  const cleanDeliveryTerms = optionalText(deliveryTerms, { label: 'Delivery terms', max: 300 });
  const cleanDeliveryTime = optionalText(deliveryTime, { label: 'Delivery time', max: 300 });
  const cleanValidUntil = optionalDate(validUntil, 'valid-until date');
  const cleanNotes = optionalText(notes, { label: 'Notes', max: 2000 });

  return withTransaction(pool, async client => {
    const requirement = await resolvePublicLead(client, requirementId, { role: 'buyer' });
    if (!requirement) throw requestError('Requirement is unavailable for quoting.', 404);
    if (requirement.customerUserId === userId) throw requestError('You cannot quote your own requirement.');

    if (linkedSellerLeadId) {
      const ownedSeller = await client.query(`
        select id from leads
        where id = $1 and customer_user_id = $2 and lead_role = 'seller' and archived_at is null
        limit 1
      `, [linkedSellerLeadId, userId]);
      if (!ownedSeller.rowCount) throw requestError('Seller lead must be an active listing owned by your account.');
    }

    const inserted = await client.query(`
      insert into fas_quotes (
        requirement_lead_id, seller_user_id, seller_lead_id, quantity, unit,
        unit_price, currency, delivery_terms, delivery_time, valid_until, notes
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      returning id, status, quantity, unit, unit_price as "unitPrice", currency,
        valid_until as "validUntil", created_at as "createdAt"
    `, [
      requirementId,
      userId,
      linkedSellerLeadId,
      quoteQuantity,
      quoteUnit,
      quoteUnitPrice,
      quoteCurrency,
      cleanDeliveryTerms,
      cleanDeliveryTime,
      cleanValidUntil,
      cleanNotes
    ]);

    return {
      ...inserted.rows[0],
      requirement: {
        leadId: requirementId,
        reference: requirement.publicReference,
        slug: requirement.slug,
        product: requirement.product
      }
    };
  });
}

export async function saveMarketplaceItem(pool, { userId, leadId }) {
  const targetLeadId = requireUuid(leadId, 'lead identifier');
  return withTransaction(pool, async client => {
    const target = await resolvePublicLead(client, targetLeadId);
    if (!target) throw requestError('Listing is unavailable.', 404);
    if (target.customerUserId === userId) throw requestError('You cannot save your own listing.');

    const inserted = await client.query(`
      insert into fas_saved_items (user_id, lead_id)
      values ($1,$2)
      on conflict (user_id, lead_id) do nothing
      returning lead_id
    `, [userId, targetLeadId]);

    return {
      saved: inserted.rowCount > 0,
      leadId: targetLeadId,
      slug: target.slug,
      reference: target.publicReference
    };
  });
}

export async function removeMarketplaceItem(pool, { userId, leadId }) {
  const targetLeadId = requireUuid(leadId, 'lead identifier');
  const result = await pool.query('delete from fas_saved_items where user_id = $1 and lead_id = $2', [userId, targetLeadId]);
  return { removed: result.rowCount > 0, leadId: targetLeadId };
}

export async function getMarketplaceDashboard(pool, { userId }) {
  const [summary, myListings, savedItems, contactRequests, quotesSent, quotesReceived] = await Promise.all([
    pool.query(`
      select
        count(*)::int as "totalListings",
        count(*) filter (where lead_role = 'buyer')::int as "buyerRequirements",
        count(*) filter (where lead_role = 'seller')::int as "sellerListings",
        count(*) filter (where marketplace_status = 'ACTIVE')::int as "activeListings",
        count(*) filter (where marketplace_status = 'PENDING_REVIEW')::int as "pendingReview"
      from leads
      where customer_user_id = $1 and archived_at is null
    `, [userId]),
    pool.query(`
      select
        id,
        public_reference as reference,
        marketplace_slug as slug,
        lead_role as role,
        category,
        product,
        quantity,
        unit,
        marketplace_status as status,
        marketplace_visibility as visibility,
        marketplace_moderation_status as "moderationStatus",
        coalesce(marketplace_published_at, submitted_at) as "publishedAt"
      from leads
      where customer_user_id = $1 and archived_at is null
      order by submitted_at desc
      limit 20
    `, [userId]),
    pool.query(`
      select
        s.lead_id as "leadId",
        s.created_at as "savedAt",
        l.public_reference as reference,
        l.marketplace_slug as slug,
        l.lead_role as role,
        l.category,
        l.product,
        l.quantity,
        l.unit
      from fas_saved_items s
      join leads l on l.id = s.lead_id
      where s.user_id = $1
      order by s.created_at desc
      limit 20
    `, [userId]),
    pool.query(`
      select
        cr.id,
        cr.status,
        cr.consent_status as "consentStatus",
        cr.created_at as "createdAt",
        cr.responded_at as "respondedAt",
        l.id as "leadId",
        l.public_reference as reference,
        l.marketplace_slug as slug,
        l.product,
        l.lead_role as "targetRole"
      from fas_contact_requests cr
      join leads l on l.id = cr.target_lead_id
      where cr.requester_user_id = $1
      order by cr.created_at desc
      limit 20
    `, [userId]),
    pool.query(`
      select
        q.id,
        q.status,
        q.quantity,
        q.unit,
        q.unit_price as "unitPrice",
        q.currency,
        q.valid_until as "validUntil",
        q.created_at as "createdAt",
        l.id as "requirementLeadId",
        l.public_reference as "requirementReference",
        l.marketplace_slug as "requirementSlug",
        l.product as "requirementProduct"
      from fas_quotes q
      join leads l on l.id = q.requirement_lead_id
      where q.seller_user_id = $1
      order by q.created_at desc
      limit 20
    `, [userId]),
    pool.query(`
      select
        q.id,
        q.status,
        q.quantity,
        q.unit,
        q.unit_price as "unitPrice",
        q.currency,
        q.valid_until as "validUntil",
        q.created_at as "createdAt",
        requirement.id as "requirementLeadId",
        requirement.public_reference as "requirementReference",
        requirement.marketplace_slug as "requirementSlug",
        requirement.product as "requirementProduct",
        seller.public_reference as "sellerReference",
        seller.marketplace_slug as "sellerSlug"
      from fas_quotes q
      join leads requirement on requirement.id = q.requirement_lead_id
      left join leads seller on seller.id = q.seller_lead_id
      where requirement.customer_user_id = $1 and requirement.lead_role = 'buyer'
      order by q.created_at desc
      limit 20
    `, [userId])
  ]);

  return {
    summary: summary.rows[0] || {
      totalListings: 0,
      buyerRequirements: 0,
      sellerListings: 0,
      activeListings: 0,
      pendingReview: 0
    },
    myListings: myListings.rows,
    savedItems: savedItems.rows,
    contactRequests: contactRequests.rows,
    quotesSent: quotesSent.rows,
    quotesReceived: quotesReceived.rows
  };
}
