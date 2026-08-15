import { Router } from 'express';
import { requireAuthentication, requireCsrf } from '../auth-middleware.js';
import { withTransaction } from '../db.js';
import { writeAudit } from '../services/audit.js';
import { suggestMatches } from '../services/matching.js';
import { createOption, getAdminOptions, MasterDataError, updateOption } from '../services/master-data.js';

const allowedLeadUpdates = {
  verificationStatus: ['Pending', 'In review', 'Verified', 'Rejected'],
  matchStatus: ['Not reviewed', 'Potential match', 'Introduced', 'Closed'],
  followUpStatus: ['New', 'Contacted', 'Follow-up due', 'Closed'],
  priority: ['Low', 'Normal', 'High', 'Urgent']
};
const columnNames = {
  verificationStatus: 'verification_status', matchStatus: 'match_status',
  followUpStatus: 'follow_up_status', priority: 'priority'
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const WRITE_ROLES = ['administrator', 'super_admin'];

const VERIFICATION_BASE = ['Unchecked', 'Pending', 'Confirmed', 'Failed'];
const VERIFICATION_WITH_NA = [...VERIFICATION_BASE, 'Not applicable'];
const verificationFields = {
  identityStatus: VERIFICATION_BASE,
  organisationRegistrationStatus: VERIFICATION_BASE,
  gstStatus: VERIFICATION_WITH_NA,
  licenceStatus: VERIFICATION_WITH_NA,
  certificationStatus: VERIFICATION_WITH_NA,
  productEvidenceStatus: VERIFICATION_BASE,
  facilityEvidenceStatus: VERIFICATION_WITH_NA,
  laboratoryEvidenceStatus: VERIFICATION_WITH_NA,
  bankInformationStatus: VERIFICATION_BASE,
  overallOutcome: ['Pending', 'In review', 'Verified', 'Rejected']
};
const CONTACT_METHODS = ['Email', 'Telephone', 'WhatsApp', 'Video call', 'In person', 'Message', 'Other'];
const MATCH_STATUS = ['Proposed', 'Reviewing', 'Consented', 'Introduced', 'Declined', 'Closed'];

function badRequest(message) {
  const error = new Error(message);
  error.status = 422;
  return error;
}

function requireRole(allowed) {
  return (request, response, next) => allowed.includes(request.adminSession.user.role)
    ? next()
    : response.status(403).json({ success: false, error: 'Insufficient administrator role.' });
}

function requireUuid(value, label = 'identifier') {
  if (!uuid.test(String(value))) {
    const error = new Error(`Invalid ${label}.`);
    error.status = 400;
    throw error;
  }
}

function optionalText(value, limit, label) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw badRequest(`Invalid ${label}.`);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > limit) throw badRequest(`${label} is too long.`);
  return trimmed;
}

function requiredText(value, limit, label) {
  const result = optionalText(value, limit, label);
  if (!result) throw badRequest(`${label} is required.`);
  return result;
}

function optionalDate(value, label) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw badRequest(`Invalid ${label}.`);
  return value;
}

function optionalAmount(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) throw badRequest(`Invalid ${label}.`);
  return numeric;
}

function booleanFlag(value, label) {
  if (typeof value !== 'boolean') throw badRequest(`Invalid ${label}.`);
  return value;
}

function matchExplanation(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const json = JSON.stringify(value);
    if (json.length > 8000) throw badRequest('Explanation is too large.');
    return json;
  }
  return JSON.stringify({ summary: requiredText(value, 4000, 'Explanation') });
}

const matchValidators = {
  status: value => { if (!MATCH_STATUS.includes(value)) throw badRequest('Invalid status.'); return value; },
  buyerConsent: value => booleanFlag(value, 'buyer consent'),
  sellerConsent: value => booleanFlag(value, 'seller consent'),
  introductionDate: value => optionalDate(value, 'introduction date'),
  quotationStatus: value => optionalText(value, 500, 'quotation status'),
  sampleStatus: value => optionalText(value, 500, 'sample status'),
  inspectionStatus: value => optionalText(value, 500, 'inspection status'),
  negotiationStatus: value => optionalText(value, 500, 'negotiation status'),
  transactionStatus: value => optionalText(value, 500, 'transaction status'),
  estimatedValue: value => optionalAmount(value, 'estimated value'),
  platformRevenue: value => optionalAmount(value, 'platform revenue'),
  outcome: value => optionalText(value, 2000, 'outcome')
};

export function createAdminRouter({ config, pool }) {
  const router = Router();
  router.use(requireAuthentication({ pool, config }));

  router.get('/overview', async (_request, response, next) => {
    try {
      const result = await pool.query(`select
        count(*) filter (where lead_role = 'buyer' and follow_up_status = 'New' and archived_at is null)::int as "newBuyers",
        count(*) filter (where lead_role = 'seller' and follow_up_status = 'New' and archived_at is null)::int as "newSellers",
        count(*) filter (where verification_status in ('Pending','In review') and archived_at is null)::int as "pendingVerification",
        (select count(*)::int from lead_interactions where follow_up_date <= now()) as "followUpsDue",
        count(*) filter (where match_status = 'Potential match' and archived_at is null)::int as "potentialMatches",
        count(*) filter (where match_status = 'Introduced' and archived_at is null)::int as introductions
      from leads`);
      response.json({ success: true, overview: result.rows[0] });
    } catch (error) { next(error); }
  });

  router.get('/location-risk-events', async (request, response, next) => {
    try {
      const status = request.query.status || 'open';
      if (!['open', 'dismissed', 'resolved'].includes(status)) return response.status(422).json({ success: false, error: 'Invalid risk-event status.' });
      const result = await pool.query(`select e.id, e.signal_type as "signalType", e.reason,
          e.evidence_source as "evidenceSource", e.status, e.resolution_notes as "resolutionNotes",
          e.created_at as "createdAt", e.reviewed_at as "reviewedAt", l.public_reference as "leadReference",
          claimed.country_code as "claimedCountryCode", claimed.region as "claimedRegion", claimed.city as "claimedCity",
          comparison.country_code as "comparisonCountryCode", comparison.region as "comparisonRegion", comparison.city as "comparisonCity"
        from fas_location_risk_events e
        left join leads l on l.id = e.lead_id
        left join fas_locations claimed on claimed.id = e.claimed_location_id
        left join fas_locations comparison on comparison.id = e.comparison_location_id
        where e.status = $1 order by e.created_at desc limit 100`, [status]);
      response.json({ success: true, events: result.rows });
    } catch (error) { next(error); }
  });

  router.patch('/location-risk-events/:id', requireRole(WRITE_ROLES), requireCsrf, async (request, response, next) => {
    try {
      requireUuid(request.params.id, 'risk-event identifier');
      if (!['dismissed', 'resolved'].includes(request.body.status) || !String(request.body.notes || '').trim()) {
        return response.status(422).json({ success: false, error: 'A dismissed or resolved status and review notes are required.' });
      }
      const result = await withTransaction(pool, async client => {
        const previous = await client.query('select * from fas_location_risk_events where id = $1 for update', [request.params.id]);
        if (!previous.rowCount) return null;
        const updated = await client.query(`update fas_location_risk_events set
          status = $1, resolution_notes = $2, reviewed_by = $3, reviewed_at = now()
          where id = $4 returning *`, [request.body.status, String(request.body.notes).trim().slice(0, 2000), request.adminSession.user.id, request.params.id]);
        await writeAudit(client, {
          administratorId: request.adminSession.user.id, action: 'location_risk_reviewed',
          entityType: 'location_risk_event', entityIdentifier: request.params.id,
          previousValues: { status: previous.rows[0].status },
          newValues: { status: updated.rows[0].status, resolutionNotes: updated.rows[0].resolution_notes }
        });
        return updated.rows[0];
      });
      if (!result) return response.status(404).json({ success: false, error: 'Risk event not found.' });
      response.json({ success: true, event: { id: result.id, status: result.status, reviewedAt: result.reviewed_at } });
    } catch (error) { next(error); }
  });

  router.get('/leads', async (request, response, next) => {
    try {
      const conditions = ['l.archived_at is null'];
      const values = [];
      const add = (sql, value) => { values.push(value); conditions.push(sql.replace('?', `$${values.length}`)); };
      if (request.query.role) add('l.lead_role = ?', request.query.role);
      if (request.query.category) add('l.category = ?', request.query.category);
      if (request.query.product) add('lower(l.product) like lower(?)', `%${request.query.product}%`);
      if (request.query.country) add('lower(o.country) like lower(?)', `%${request.query.country}%`);
      if (request.query.status) {
        values.push(request.query.status, request.query.status, request.query.status);
        conditions.push(`(l.verification_status = $${values.length - 2} or l.match_status = $${values.length - 1} or l.follow_up_status = $${values.length})`);
      }
      if (request.query.q) {
        const query = `%${request.query.q}%`;
        values.push(query, query, query, query);
        conditions.push(`(l.public_reference ilike $${values.length - 3} or l.product ilike $${values.length - 2} or o.name ilike $${values.length - 1} or c.full_name ilike $${values.length})`);
      }
      const limit = Math.min(Math.max(Number(request.query.limit) || 50, 1), 100);
      values.push(limit);
      const result = await pool.query(`
        select l.id, l.public_reference as "publicReference", l.lead_role as role, l.category, l.product,
          l.quantity, l.unit, l.origin, l.destination, l.verification_status as "verificationStatus",
          l.match_status as "matchStatus", l.follow_up_status as "followUpStatus", l.priority,
          l.submitted_at as "submittedAt", o.name as organisation, o.country, c.full_name as "contactName"
        from leads l join organisations o on o.id = l.organisation_id join contacts c on c.id = l.contact_id
        where ${conditions.join(' and ')} order by l.submitted_at desc limit $${values.length}
      `, values);
      response.json({ success: true, leads: result.rows });
    } catch (error) { next(error); }
  });

  router.get('/leads/:id', async (request, response, next) => {
    try {
      requireUuid(request.params.id, 'lead identifier');
      const lead = await pool.query(`select l.*, row_to_json(o.*) as organisation, row_to_json(c.*) as contact
        from leads l join organisations o on o.id=l.organisation_id join contacts c on c.id=l.contact_id where l.id=$1`, [request.params.id]);
      if (!lead.rowCount) return response.status(404).json({ success: false, error: 'Lead not found.' });
      const [buyer, seller, fish, spice, interactions, verification, consents, matches] = await Promise.all([
        pool.query('select * from buyer_requirements where lead_id=$1', [request.params.id]),
        pool.query('select * from seller_offers where lead_id=$1', [request.params.id]),
        pool.query('select * from fish_specifications where lead_id=$1', [request.params.id]),
        pool.query('select * from spice_specifications where lead_id=$1', [request.params.id]),
        pool.query('select * from lead_interactions where lead_id=$1 order by created_at desc', [request.params.id]),
        pool.query('select * from verification_checks where lead_id=$1 order by checked_at desc', [request.params.id]),
        pool.query('select * from consent_records where lead_id=$1 order by consent_time desc', [request.params.id]),
        pool.query('select * from matches where buyer_lead_id=$1 or seller_lead_id=$1 order by created_at desc', [request.params.id])
      ]);
      response.json({ success: true, lead: lead.rows[0], buyerRequirement: buyer.rows[0] || null, sellerOffer: seller.rows[0] || null, fishSpecification: fish.rows[0] || null, spiceSpecification: spice.rows[0] || null, interactions: interactions.rows, verificationChecks: verification.rows, consents: consents.rows, matches: matches.rows });
    } catch (error) { next(error); }
  });

  router.patch('/leads/:id', requireRole(WRITE_ROLES), requireCsrf, async (request, response, next) => {
    try {
      requireUuid(request.params.id, 'lead identifier');
      const updates = [];
      const values = [];
      for (const [field, options] of Object.entries(allowedLeadUpdates)) {
        if (request.body[field] === undefined) continue;
        if (!options.includes(request.body[field])) return response.status(422).json({ success: false, error: `Invalid ${field}.` });
        values.push(request.body[field]);
        updates.push(`${columnNames[field]}=$${values.length}`);
      }
      if (request.body.assignedAdministrator !== undefined) {
        if (request.body.assignedAdministrator !== null) requireUuid(request.body.assignedAdministrator, 'administrator identifier');
        values.push(request.body.assignedAdministrator);
        updates.push(`assigned_administrator=$${values.length}`);
      }
      if (request.body.archive === true) updates.push('archived_at=now()');
      if (!updates.length) return response.status(422).json({ success: false, error: 'No supported changes provided.' });
      const updated = await withTransaction(pool, async client => {
        const previous = await client.query('select * from leads where id=$1 for update', [request.params.id]);
        if (!previous.rowCount) return null;
        values.push(request.params.id);
        const result = await client.query(`update leads set ${updates.join(', ')} where id=$${values.length} returning *`, values);
        await writeAudit(client, { administratorId: request.adminSession.user.id, action: request.body.archive ? 'lead_archived' : 'lead_updated', entityType: 'lead', entityIdentifier: request.params.id, previousValues: previous.rows[0], newValues: result.rows[0] });
        return result.rows[0];
      });
      if (!updated) return response.status(404).json({ success: false, error: 'Lead not found.' });
      response.json({ success: true, lead: updated });
    } catch (error) { next(error); }
  });

  router.post('/leads/:id/interactions', requireRole(WRITE_ROLES), requireCsrf, async (request, response, next) => {
    try {
      requireUuid(request.params.id, 'lead identifier');
      if (!['Inbound', 'Outbound'].includes(request.body.direction)) throw badRequest('A valid direction is required.');
      if (!CONTACT_METHODS.includes(request.body.contactMethod)) throw badRequest('A valid contact method is required.');
      const summary = requiredText(request.body.summary, 2000, 'Summary');
      const outcome = optionalText(request.body.outcome, 2000, 'Outcome');
      const nextAction = optionalText(request.body.nextAction, 2000, 'Next action');
      const followUpDate = optionalDate(request.body.followUpDate, 'follow-up date');
      const result = await withTransaction(pool, async client => {
        const inserted = await client.query(`insert into lead_interactions (lead_id, contact_method, direction, summary, outcome, next_action, follow_up_date, administrator_id)
          values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`, [request.params.id, request.body.contactMethod, request.body.direction, summary, outcome, nextAction, followUpDate, request.adminSession.user.id]);
        await writeAudit(client, { administratorId: request.adminSession.user.id, action: 'interaction_recorded', entityType: 'lead', entityIdentifier: request.params.id, newValues: inserted.rows[0] });
        return inserted.rows[0];
      });
      response.status(201).json({ success: true, interaction: result });
    } catch (error) { next(error); }
  });

  router.post('/leads/:id/verification', requireRole(WRITE_ROLES), requireCsrf, async (request, response, next) => {
    try {
      requireUuid(request.params.id, 'lead identifier');
      const fields = Object.keys(verificationFields);
      for (const [field, allowed] of Object.entries(verificationFields)) {
        if (!allowed.includes(request.body[field])) throw badRequest(`Invalid ${field}.`);
      }
      const notes = optionalText(request.body.notes, 2000, 'Notes');
      const inserted = await withTransaction(pool, async client => {
        const result = await client.query(`insert into verification_checks (
          lead_id, identity_status, organisation_registration_status, gst_status, licence_status, certification_status,
          product_evidence_status, facility_evidence_status, laboratory_evidence_status, bank_information_status,
          overall_outcome, notes, administrator_id
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`, [request.params.id, ...fields.map(field => request.body[field]), notes, request.adminSession.user.id]);
        await client.query('update leads set verification_status=$1 where id=$2', [request.body.overallOutcome, request.params.id]);
        await writeAudit(client, { administratorId: request.adminSession.user.id, action: 'verification_recorded', entityType: 'lead', entityIdentifier: request.params.id, newValues: result.rows[0] });
        return result.rows[0];
      });
      response.status(201).json({ success: true, verification: inserted });
    } catch (error) { next(error); }
  });

  router.get('/leads/:id/match-suggestions', async (request, response, next) => {
    try { requireUuid(request.params.id, 'lead identifier'); response.json({ success: true, suggestions: await suggestMatches(pool, request.params.id) }); }
    catch (error) { next(error); }
  });

  router.post('/matches', requireRole(WRITE_ROLES), requireCsrf, async (request, response, next) => {
    try {
      requireUuid(request.body.buyerLeadId, 'buyer lead identifier'); requireUuid(request.body.sellerLeadId, 'seller lead identifier');
      const score = Number(request.body.score);
      if (!Number.isFinite(score) || score < 0 || score > 100) throw badRequest('Score must be a number between 0 and 100.');
      const explanationJson = matchExplanation(request.body.explanation);
      const match = await withTransaction(pool, async client => {
        const result = await client.query(`insert into matches (buyer_lead_id, seller_lead_id, match_score, match_explanation, created_by)
          values ($1,$2,$3,$4,$5) returning *`, [request.body.buyerLeadId, request.body.sellerLeadId, score, explanationJson, request.adminSession.user.id]);
        await client.query(`update leads set match_status='Potential match' where id in ($1,$2)`, [request.body.buyerLeadId, request.body.sellerLeadId]);
        await writeAudit(client, { administratorId: request.adminSession.user.id, action: 'match_proposed', entityType: 'match', entityIdentifier: result.rows[0].id, newValues: result.rows[0] });
        return result.rows[0];
      });
      response.status(201).json({ success: true, match });
    } catch (error) { next(error); }
  });

  router.patch('/matches/:id', requireRole(WRITE_ROLES), requireCsrf, async (request, response, next) => {
    try {
      requireUuid(request.params.id, 'match identifier');
      const keys = Object.keys(request.body);
      if (keys.some(key => !matchValidators[key])) throw badRequest('Unsupported match field.');
      if (!keys.length) throw badRequest('No changes provided.');
      const columns = { buyerConsent:'buyer_consent',sellerConsent:'seller_consent',introductionDate:'introduction_date',quotationStatus:'quotation_status',sampleStatus:'sample_status',inspectionStatus:'inspection_status',negotiationStatus:'negotiation_status',transactionStatus:'transaction_status',estimatedValue:'estimated_value',platformRevenue:'platform_revenue' };
      const values=[]; const updates=[];
      for (const key of keys) { values.push(matchValidators[key](request.body[key])); updates.push(`${columns[key] || key}=$${values.length}`); }
      const match = await withTransaction(pool, async client => {
        const previous=await client.query('select * from matches where id=$1 for update',[request.params.id]);
        if(!previous.rowCount)return null; values.push(request.params.id);
        const result=await client.query(`update matches set ${updates.join(',')} where id=$${values.length} returning *`,values);
        await writeAudit(client,{administratorId:request.adminSession.user.id,action:'match_updated',entityType:'match',entityIdentifier:request.params.id,previousValues:previous.rows[0],newValues:result.rows[0]});
        return result.rows[0];
      });
      if(!match)return response.status(404).json({success:false,error:'Match not found.'}); response.json({success:true,match});
    } catch(error){next(error);}
  });

  router.get('/audit', requireAuthentication({ pool, config, roles: ['administrator','super_admin'] }), async (request,response,next)=>{
    try { const result=await pool.query('select * from audit_log order by created_at desc limit $1',[Math.min(Number(request.query.limit)||100,250)]); response.json({success:true,audit:result.rows}); }
    catch(error){next(error);}
  });

  router.get('/options', async (_request, response, next) => {
    try { response.json({ success: true, sets: await getAdminOptions(pool) }); }
    catch (error) { next(error); }
  });

  router.post('/options', requireRole(WRITE_ROLES), requireCsrf, async (request, response, next) => {
    try {
      const option = await createOption(pool, {
        setKey: request.body.setKey, value: request.body.value, label: request.body.label, sortOrder: request.body.sortOrder
      });
      await writeAudit(pool, {
        administratorId: request.adminSession.user.id, action: 'master_option_created',
        entityType: 'master_option', entityIdentifier: option.id, newValues: option
      });
      response.status(201).json({ success: true, option });
    } catch (error) {
      if (error instanceof MasterDataError) return response.status(error.status).json({ success: false, error: error.message });
      next(error);
    }
  });

  router.patch('/options/:id', requireRole(WRITE_ROLES), requireCsrf, async (request, response, next) => {
    try {
      requireUuid(request.params.id, 'option identifier');
      const option = await updateOption(pool, request.params.id, {
        label: request.body.label, sortOrder: request.body.sortOrder, isActive: request.body.isActive
      });
      await writeAudit(pool, {
        administratorId: request.adminSession.user.id, action: 'master_option_updated',
        entityType: 'master_option', entityIdentifier: option.id, newValues: option
      });
      response.json({ success: true, option });
    } catch (error) {
      if (error instanceof MasterDataError) return response.status(error.status).json({ success: false, error: error.message });
      next(error);
    }
  });

  return router;
}
