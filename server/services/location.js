import { timingSafeEqual } from 'node:crypto';
import { getCountries } from 'libphonenumber-js';
import { withTransaction } from '../db.js';

const COUNTRY_CODES = new Set(getCountries());
const LOCATION_TYPES = new Set(['contact', 'farm', 'facility', 'warehouse', 'stock', 'pickup', 'delivery', 'port']);
const TOP_LEVEL_FIELDS = new Set([
  'countryCode', 'countryName', 'region', 'district', 'city', 'postalCode', 'addressLine', 'portName',
  'locationType', 'siteType', 'pickupAvailability', 'notes', 'locationCollectionConsent',
  'preciseLocationConsent', 'consentTextVersion', 'device', 'mapPin'
]);
const COORDINATE_FIELDS = new Set(['latitude', 'longitude', 'accuracyMetres', 'userConfirmed']);

export class LocationValidationError extends Error {
  constructor(message, fields = {}) {
    super(message);
    this.name = 'LocationValidationError';
    this.fields = fields;
  }
}

const cleanText = (value, limit) => {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
};

const strictBoolean = value => value === true;

function validateCoordinates(value, fieldName) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new LocationValidationError('Location coordinates must be an object.', { [fieldName]: 'Review this location.' });
  const unknown = Object.keys(value).filter(key => !COORDINATE_FIELDS.has(key));
  if (unknown.length) throw new LocationValidationError('Unknown location fields are not accepted.', { [fieldName]: `Remove: ${unknown.slice(0, 5).join(', ')}` });
  const latitude = Number(value.latitude);
  const longitude = Number(value.longitude);
  const accuracyMetres = Number(value.accuracyMetres);
  const errors = {};
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) errors[`${fieldName}.latitude`] = 'Latitude must be between -90 and 90.';
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) errors[`${fieldName}.longitude`] = 'Longitude must be between -180 and 180.';
  if (!Number.isFinite(accuracyMetres) || accuracyMetres <= 0) errors[`${fieldName}.accuracyMetres`] = 'Accuracy must be greater than zero.';
  if (!strictBoolean(value.userConfirmed)) errors[`${fieldName}.userConfirmed`] = 'Confirm this location before submitting.';
  if (Object.keys(errors).length) throw new LocationValidationError('Review the submitted location.', errors);
  return { latitude, longitude, accuracyMetres, userConfirmed: true };
}

export function validateLeadLocation(value, role) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new LocationValidationError('Location must be an object.', { location: 'Review this location.' });
  const unknown = Object.keys(value).filter(key => !TOP_LEVEL_FIELDS.has(key));
  if (unknown.length) throw new LocationValidationError('Unknown location fields are not accepted.', { location: `Remove: ${unknown.slice(0, 5).join(', ')}` });

  const countryCode = cleanText(value.countryCode, 2).toUpperCase();
  const locationType = cleanText(value.locationType, 30) || (role === 'buyer' ? 'delivery' : 'stock');
  const errors = {};
  if (countryCode && !COUNTRY_CODES.has(countryCode)) errors['location.countryCode'] = 'Choose a valid two-letter country code.';
  if (!LOCATION_TYPES.has(locationType)) errors['location.locationType'] = 'Choose a supported location type.';
  if (role === 'buyer' && !['delivery', 'port'].includes(locationType)) errors['location.locationType'] = 'Buyer locations must be delivery or port locations.';
  if (role === 'seller' && !['farm', 'facility', 'warehouse', 'stock', 'pickup', 'port'].includes(locationType)) errors['location.locationType'] = 'Choose a seller stock, farm, facility, warehouse, pickup or port location.';

  const device = validateCoordinates(value.device, 'location.device');
  const mapPin = validateCoordinates(value.mapPin, 'location.mapPin');
  const locationCollectionConsent = strictBoolean(value.locationCollectionConsent);
  const preciseLocationConsent = strictBoolean(value.preciseLocationConsent);
  if (!locationCollectionConsent) errors['location.locationCollectionConsent'] = 'Confirm location collection for this enquiry.';
  if ((device || mapPin) && !preciseLocationConsent) errors['location.preciseLocationConsent'] = 'Confirm precise-location collection before submitting coordinates.';
  if (preciseLocationConsent && !locationCollectionConsent) errors['location.locationCollectionConsent'] = 'Location collection consent is required.';
  if (Object.keys(errors).length) throw new LocationValidationError('Review the submitted location.', errors);

  const normalized = {
    countryCode: countryCode || null,
    countryName: cleanText(value.countryName, 100) || null,
    region: cleanText(value.region, 120) || null,
    district: cleanText(value.district, 120) || null,
    city: cleanText(value.city, 120) || null,
    postalCode: cleanText(value.postalCode, 24).toUpperCase() || null,
    addressLine: cleanText(value.addressLine, 300) || null,
    portName: cleanText(value.portName, 160) || null,
    locationType,
    siteType: cleanText(value.siteType, 60) || null,
    pickupAvailability: cleanText(value.pickupAvailability, 60) || null,
    notes: cleanText(value.notes, 1000) || null,
    locationCollectionConsent,
    preciseLocationConsent,
    consentTextVersion: cleanText(value.consentTextVersion, 40) || 'location-v1-2026-08-15',
    device,
    mapPin
  };
  const hasManualLocation = [normalized.countryCode, normalized.countryName, normalized.region, normalized.district,
    normalized.city, normalized.postalCode, normalized.addressLine, normalized.portName].some(Boolean);
  if (!hasManualLocation && !device && !mapPin) throw new LocationValidationError('Enter a location manually or confirm an optional precise location.', { location: 'Enter a manual location.' });
  return normalized;
}

function safeTokenEqual(actual, expected) {
  const actualBuffer = Buffer.from(String(actual || ''));
  const expectedBuffer = Buffer.from(String(expected || ''));
  return actualBuffer.length > 0 && actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function deriveApproximateLocation(request, config, now = new Date()) {
  if (config.approximateLocationProvider !== 'signed_proxy' || !config.locationProxySecret) return null;
  if (!safeTokenEqual(request.get('x-fas-location-proxy-token'), config.locationProxySecret)) return null;
  const countryCode = cleanText(request.get('x-fas-country-code'), 2).toUpperCase();
  if (!COUNTRY_CODES.has(countryCode)) return null;
  const timeZone = cleanText(request.get('x-fas-time-zone'), 80);
  return {
    countryCode,
    countryName: cleanText(request.get('x-fas-country-name'), 100) || null,
    region: cleanText(request.get('x-fas-region'), 120) || null,
    city: cleanText(request.get('x-fas-city'), 120) || null,
    timeZone: timeZone || null,
    source: 'ip_approximate',
    detectedAt: now
  };
}

export function coarseLocationForAnalytics(location) {
  if (!location) return null;
  return {
    countryCode: location.countryCode || null,
    region: location.region || null,
    city: location.city || null
  };
}

async function insertLocation(client, location) {
  const result = await client.query(`insert into fas_locations (
    location_type, location_source, country_code, country_name, region, district, city, postal_code,
    address_line, port_name, latitude, longitude, accuracy_metres, user_confirmed,
    verification_status, location_purpose, consent_record_id, location_consent_id, detected_at
  ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) returning id`, [
    location.locationType, location.locationSource, location.countryCode, location.countryName,
    location.region, location.district, location.city, location.postalCode, location.addressLine,
    location.portName, location.latitude, location.longitude, location.accuracyMetres,
    location.userConfirmed, location.verificationStatus, location.locationPurpose,
    location.consentRecordId, location.locationConsentId || null, location.detectedAt
  ]);
  return result.rows[0].id;
}

async function linkCommercialLocation(client, { locationId, role, locationType, userId, organisationId, leadId }) {
  const userRelationship = role === 'buyer' ? 'delivery' : ['farm', 'facility', 'warehouse', 'pickup'].includes(locationType) ? locationType : 'saved';
  const organisationRelationship = role === 'buyer' ? (locationType === 'port' ? 'port' : 'delivery') : locationType;
  const leadRelationship = role === 'buyer' ? (locationType === 'port' ? 'port' : 'delivery') : locationType === 'farm' || locationType === 'facility' || locationType === 'warehouse' ? 'stock' : locationType;
  await client.query(`insert into fas_user_locations (user_id, location_id, relationship_type)
    values ($1,$2,$3)`, [userId, locationId, userRelationship]);
  await client.query(`insert into fas_organisation_locations (organisation_id, location_id, relationship_type)
    values ($1,$2,$3)`, [organisationId, locationId, organisationRelationship]);
  await client.query(`insert into fas_lead_locations (lead_id, location_id, relationship_type)
    values ($1,$2,$3)`, [leadId, locationId, leadRelationship]);
  if (role === 'buyer') {
    await client.query(`insert into fas_buyer_requirement_locations (buyer_lead_id, location_id, relationship_type)
      values ($1,$2,$3)`, [leadId, locationId, locationType === 'port' ? 'port' : 'delivery']);
  } else {
    await client.query(`insert into fas_seller_offer_locations (seller_lead_id, location_id, relationship_type)
      values ($1,$2,$3)`, [leadId, locationId, locationType]);
  }
}

export async function storeLeadLocations(client, { location, approximateLocation, role, userId, organisationId, leadId, consentRecordId }) {
  const created = [];
  let claimedLocationId = null;
  let approximateLocationId = null;
  if (location) {
    const manualPresent = [location.countryCode, location.countryName, location.region, location.district,
      location.city, location.postalCode, location.addressLine, location.portName].some(Boolean);
    if (manualPresent) {
      claimedLocationId = await insertLocation(client, {
        ...location, locationSource: 'user_entered', latitude: null, longitude: null, accuracyMetres: null,
        userConfirmed: true, verificationStatus: 'user_confirmed', locationPurpose: role === 'buyer' ? 'commercial delivery planning' : 'commercial stock and pickup planning',
        consentRecordId, detectedAt: null
      });
      await linkCommercialLocation(client, { locationId: claimedLocationId, role, locationType: location.locationType, userId, organisationId, leadId });
      created.push(claimedLocationId);
    }
    for (const [source, coordinates] of [['device_permission', location.device], ['map_pin', location.mapPin]]) {
      if (!coordinates) continue;
      const preciseLocationId = await insertLocation(client, {
        locationType: location.locationType, locationSource: source, countryCode: null, countryName: null,
        region: null, district: null, city: null, postalCode: null, addressLine: null, portName: null,
        ...coordinates, verificationStatus: 'unverified', locationPurpose: role === 'buyer' ? 'user-confirmed delivery area candidate' : 'user-confirmed stock or pickup area candidate',
        consentRecordId, detectedAt: null
      });
      await linkCommercialLocation(client, { locationId: preciseLocationId, role, locationType: location.locationType, userId, organisationId, leadId });
      created.push(preciseLocationId);
    }
  }
  if (approximateLocation) {
    approximateLocationId = await insertLocation(client, {
      locationType: 'visitor_approximate', locationSource: 'ip_approximate', countryCode: approximateLocation.countryCode,
      countryName: approximateLocation.countryName, region: approximateLocation.region, district: null,
      city: approximateLocation.city, postalCode: null, addressLine: null, portName: null,
      latitude: null, longitude: null, accuracyMetres: null, userConfirmed: false,
      verificationStatus: 'unverified', locationPurpose: 'coarse access-region security and analytics',
      consentRecordId: null, detectedAt: approximateLocation.detectedAt
    });
    await client.query(`insert into fas_lead_locations (lead_id, location_id, relationship_type)
      values ($1,$2,'access_approximate')`, [leadId, approximateLocationId]);
    created.push(approximateLocationId);
  }
  if (claimedLocationId && approximateLocationId && location.countryCode && approximateLocation.countryCode !== location.countryCode) {
    await client.query(`insert into fas_location_risk_events (
      customer_user_id, organisation_id, lead_id, claimed_location_id, comparison_location_id,
      signal_type, reason, evidence_source
    ) values ($1,$2,$3,$4,$5,'claimed_country_differs_from_access_country',
      'User-confirmed commercial country differs from coarse access country; manual review only.',
      'user_entered compared with signed-proxy ip_approximate')`, [userId, organisationId, leadId, claimedLocationId, approximateLocationId]);
  }
  return created;
}

const ownerLocation = row => ({
  id: row.id,
  type: row.location_type,
  source: row.location_source,
  countryCode: row.country_code,
  countryName: row.country_name,
  region: row.region,
  district: row.district,
  city: row.city,
  postalCode: row.postal_code,
  addressLine: row.address_line,
  portName: row.port_name,
  latitude: row.latitude === null ? null : Number(row.latitude),
  longitude: row.longitude === null ? null : Number(row.longitude),
  accuracyMetres: row.accuracy_metres === null ? null : Number(row.accuracy_metres),
  userConfirmed: row.user_confirmed,
  verificationStatus: row.verification_status,
  verificationStatement: row.verification_status === 'inspection_verified'
    ? 'Facility location inspected.'
    : row.verification_status === 'documents_reviewed'
      ? 'Address documents reviewed.'
      : row.location_source === 'ip_approximate'
        ? 'Approximate access area only; not a business-location verification.'
        : 'Provided by the user and not independently verified.',
  purpose: row.location_purpose,
  createdAt: row.created_at
});

export async function listCustomerLocations(pool, userId) {
  const result = await pool.query(`select l.* from fas_locations l
    join fas_user_locations ul on ul.location_id = l.id
    where ul.user_id = $1 and ul.active_to is null and l.archived_at is null
    order by l.created_at desc`, [userId]);
  return result.rows.map(ownerLocation);
}

async function customerLocationConsent(client, { userId, location }) {
  const source = location.mapPin ? 'map_pin' : location.device ? 'device_permission' : 'user_entered';
  const consent = await client.query(`insert into fas_location_consents (
    customer_user_id, location_collection_consent, precise_location_consent,
    collection_purpose, location_source, consent_text_version
  ) values ($1,$2,$3,$4,$5,$6) returning id`, [
    userId, location.locationCollectionConsent, location.preciseLocationConsent,
    'Saved commercial location for qualification, pickup or delivery planning', source,
    location.consentTextVersion
  ]);
  return consent.rows[0].id;
}

async function ensureOrganisationMembership(client, userId, organisationId) {
  if (!organisationId) return;
  const membership = await client.query(`select 1 from fas_organisation_members
    where user_id = $1 and organisation_id = $2 and membership_status <> 'revoked'`, [userId, organisationId]);
  if (!membership.rowCount) {
    const error = new Error('Organisation access denied.');
    error.status = 403;
    throw error;
  }
}

async function createCustomerLocationRecord(client, { userId, location, organisationId = null }) {
  await ensureOrganisationMembership(client, userId, organisationId);
  const locationConsentId = await customerLocationConsent(client, { userId, location });
  const coordinates = location.mapPin || location.device;
  const source = location.mapPin ? 'map_pin' : location.device ? 'device_permission' : 'user_entered';
  const locationId = await insertLocation(client, {
    locationType: location.locationType, locationSource: source, countryCode: location.countryCode,
    countryName: location.countryName, region: location.region, district: location.district,
    city: location.city, postalCode: location.postalCode, addressLine: location.addressLine,
    portName: location.portName, latitude: coordinates?.latitude ?? null,
    longitude: coordinates?.longitude ?? null, accuracyMetres: coordinates?.accuracyMetres ?? null,
    userConfirmed: true, verificationStatus: source === 'user_entered' ? 'user_confirmed' : 'unverified',
    locationPurpose: 'Saved commercial location', consentRecordId: null,
    locationConsentId, detectedAt: null
  });
  const relationshipType = ['farm', 'facility', 'warehouse', 'pickup', 'delivery'].includes(location.locationType) ? location.locationType : 'saved';
  await client.query(`insert into fas_user_locations (user_id, location_id, relationship_type)
    values ($1,$2,$3)`, [userId, locationId, relationshipType]);
  if (organisationId) {
    await client.query(`insert into fas_organisation_locations (organisation_id, location_id, relationship_type)
      values ($1,$2,$3)`, [organisationId, locationId, location.locationType === 'delivery' ? 'delivery' : location.locationType]);
  }
  await client.query(`insert into audit_log (action, entity_type, entity_identifier, new_values)
    values ('customer_location_added','location',$1,jsonb_build_object(
      'type',$2::text,'source',$3::text,'country_code',$4::text,'region',$5::text,'city',$6::text
    ))`, [locationId, location.locationType, source, location.countryCode, location.region, location.city]);
  return locationId;
}

export async function createCustomerLocation({ pool, userId, location, organisationId = null }) {
  const locationId = await withTransaction(pool, client => createCustomerLocationRecord(client, { userId, location, organisationId }));
  const result = await pool.query('select * from fas_locations where id = $1', [locationId]);
  return ownerLocation(result.rows[0]);
}

async function ownedLocationForUpdate(client, userId, locationId) {
  const result = await client.query(`select l.* from fas_locations l
    join fas_user_locations ul on ul.location_id = l.id
    where l.id = $1 and ul.user_id = $2 and ul.active_to is null and l.archived_at is null
    for update of l`, [locationId, userId]);
  if (!result.rowCount) {
    const error = new Error('Location not found.');
    error.status = 404;
    throw error;
  }
  return result.rows[0];
}

async function hasImmutableReferences(client, locationId) {
  const result = await client.query(`select exists(
    select 1 from fas_lead_locations where location_id = $1
    union all select 1 from fas_buyer_requirement_locations where location_id = $1
    union all select 1 from fas_seller_offer_locations where location_id = $1
    union all select 1 from fas_business_site_locations where location_id = $1
  ) as retained`, [locationId]);
  return result.rows[0].retained;
}

export async function correctCustomerLocation({ pool, userId, locationId, location, organisationId = null }) {
  return withTransaction(pool, async client => {
    const previous = await ownedLocationForUpdate(client, userId, locationId);
    if (previous.location_source !== 'user_entered') {
      const error = new Error('Only user-entered locations can be corrected. Add a new location instead.');
      error.status = 422;
      throw error;
    }
    const replacementId = await createCustomerLocationRecord(client, { userId, location, organisationId });
    const retained = await hasImmutableReferences(client, locationId);
    if (!retained) {
      await client.query('update fas_locations set archived_at = now() where id = $1', [locationId]);
      await client.query('update fas_user_locations set active_to = now(), is_primary = false where user_id = $1 and location_id = $2', [userId, locationId]);
    }
    await client.query(`insert into audit_log (action, entity_type, entity_identifier, previous_values, new_values)
      values ('customer_location_corrected','location',$1,
        jsonb_build_object('location_id',$1::text,'retained_for_history',$2::boolean),
        jsonb_build_object('replacement_location_id',$3::text))`, [locationId, retained, replacementId]);
    return { replacementId, previousRetained: retained };
  });
}

export async function archiveCustomerLocation({ pool, userId, locationId }) {
  return withTransaction(pool, async client => {
    await ownedLocationForUpdate(client, userId, locationId);
    const retained = await hasImmutableReferences(client, locationId);
    if (retained) {
      await client.query(`insert into fas_location_change_requests (
        customer_user_id, location_id, request_type, reason, status, retention_reason
      ) values ($1,$2,'restricted_retention','Customer requested archive','pending',
        'Location is referenced by lead or site history and cannot be silently erased.')`, [userId, locationId]);
      return { archived: false, retained: true, message: 'Archive requested. This location is retained with restricted access because it is part of operational history.' };
    }
    await client.query('update fas_locations set archived_at = now() where id = $1', [locationId]);
    await client.query('update fas_user_locations set active_to = now(), is_primary = false where user_id = $1 and location_id = $2', [userId, locationId]);
    await client.query(`insert into audit_log (action, entity_type, entity_identifier, new_values)
      values ('customer_location_archived','location',$1,jsonb_build_object('archived',true))`, [locationId]);
    return { archived: true, retained: false };
  });
}

export async function requestLocationChange({ pool, userId, locationId, requestType, reason }) {
  if (!['correction', 'archive', 'deletion'].includes(requestType)) {
    const error = new Error('Unsupported location request.');
    error.status = 422;
    throw error;
  }
  return withTransaction(pool, async client => {
    await ownedLocationForUpdate(client, userId, locationId);
    const result = await client.query(`insert into fas_location_change_requests (
      customer_user_id, location_id, request_type, reason
    ) values ($1,$2,$3,$4) returning id,status,created_at`, [userId, locationId, requestType, cleanText(reason, 1000) || null]);
    return result.rows[0];
  });
}
