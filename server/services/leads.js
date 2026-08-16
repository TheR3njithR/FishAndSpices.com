import { withTransaction } from '../db.js';
import { keyedHash, publicLeadReference } from '../security.js';
import { createGuestIdentity } from './identity.js';
import { storeLeadLocations } from './location.js';
import { notifyAdministrator } from './notifications.js';

export class DuplicateSubmissionError extends Error {
  constructor() {
    super('This submission has already been received.');
    this.name = 'DuplicateSubmissionError';
    this.status = 409;
  }
}

const nullable = value => value === '' || value === undefined ? null : value;

export async function createLead({ pool, data, requestIp, config, fetcher, approximateLocation = null }) {
  const reference = publicLeadReference(data.role);
  const submissionKeyHash = keyedHash(data.submissionId, config.sessionSecret);
  const submissionIpHash = keyedHash(requestIp || 'unknown', config.sessionSecret);
  let result;
  try {
    result = await withTransaction(pool, async client => {
      const identity = await createGuestIdentity(client, data);
      const organisation = await client.query(`
        insert into organisations (
          name, organisation_type, registration_status, registration_number, gst_status, website,
          country, state, district, city, export_capability
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id
      `, [
        data.companyName || `${data.fullName} enquiry`, data.buyerType || data.sellerType || 'Not supplied',
        data.registrationStatus || 'Not supplied', nullable(data.registrationNumber), nullable(data.gstStatus), nullable(data.website),
        data.country || data.destinationCountry, nullable(data.state), nullable(data.district), data.city || data.locality || data.deliveryLocation || null, nullable(data.exportCapability)
      ]);
      const organisationId = organisation.rows[0].id;
      await client.query(`insert into fas_organisation_members (
        user_id, organisation_id, role, membership_status, verification_status
      ) values ($1,$2,'submitter','pending','unverified')`, [identity.userId, organisationId]);

      const contact = await client.query(`
        insert into contacts (organisation_id, full_name, job_title, business_email, telephone, whatsapp, country, city)
        values ($1,$2,$3,$4,$5,$6,$7,$8) returning id
      `, [organisationId, data.fullName, nullable(data.jobTitle), nullable(data.businessEmail?.toLowerCase()), nullable(data.phone), nullable(data.phone), data.country || data.destinationCountry, data.city || data.locality || null]);
      const contactId = contact.rows[0].id;
      const product = data.category === 'fish' ? data.commonProduct : data.spice;
      const origin = data.sourceLocation || data.facilityLocation || data.originPreference || data.country;
      const destination = data.role === 'buyer' ? [data.deliveryLocation, data.destinationCountry].filter(Boolean).join(', ') : data.deliveryCapability;
      const sourceDomain = new URL(config.appOrigin).hostname;

      const lead = await client.query(`
        insert into leads (
          organisation_id, contact_id, public_reference, lead_role, category, product, quantity, unit,
          origin, destination, source_domain, source_page, utm_source, utm_medium, utm_campaign,
          submission_key_hash, submission_ip_hash, customer_user_id
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning id
      `, [
        organisationId, contactId, reference, data.role, data.category, product, data.quantity, data.unit,
        nullable(origin), nullable(destination), sourceDomain, nullable(data.sourcePage), nullable(data.utmSource), nullable(data.utmMedium), nullable(data.utmCampaign),
        submissionKeyHash, submissionIpHash, identity.userId
      ]);
      const leadId = lead.rows[0].id;

      if (data.role === 'buyer') {
        await client.query(`
          insert into buyer_requirements (
            lead_id, buyer_type, commercial_purpose, purchase_frequency, required_date, destination,
            delivery_location, incoterm, sample_requirement, inspection_requirement, packing_requirements,
            quality_requirements, certification_requirements, payment_expectations, additional_notes
          ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        `, [
          leadId, nullable(data.buyerType), nullable(data.commercialPurpose), nullable(data.purchaseFrequency), nullable(data.requiredDate),
          data.destinationCountry, data.deliveryLocation, nullable(data.incoterm), nullable(data.sampleRequirement), nullable(data.inspectionRequirement),
          data.packing || [data.packingSize, data.packingMaterial].filter(Boolean).join(' / ') || null,
          nullable(data.quality), nullable(data.certifications), nullable(data.paymentTerms), nullable(data.additionalNotes)
        ]);
      } else {
        await client.query(`
          insert into seller_offers (
            lead_id, seller_type, authority_confirmed, current_quantity, recurring_capacity, availability_date,
            minimum_order, expected_price, price_unit, packing_capability, storage_capability, delivery_capability,
            inspection_availability, export_capability, additional_notes
          ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        `, [
          leadId, nullable(data.sellerType), data.authorityConfirmation, data.quantity, nullable(data.recurringVolume),
          data.availableDate || data.availabilityDate || null, nullable(data.minimumOrder), nullable(data.expectedPrice), nullable(data.priceUnit),
          nullable(data.packing), nullable(data.storage), nullable(data.deliveryCapability), nullable(data.inspection), nullable(data.exportCapability), nullable(data.additionalNotes)
        ]);
      }

      if (data.category === 'fish') {
        await client.query(`
          insert into fish_specifications (
            lead_id, common_name, scientific_name, production_method, water_type, product_form,
            cut_processing_form, condition, size_minimum, size_maximum, size_unit, size_description,
            glazing_requirement, cold_chain_requirement, freezing_capability, storage_requirement,
            shelf_life_requirement, harvest_catch_information, laboratory_requirements, licence_requirements
          ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
        `, [
          leadId, data.commonProduct, nullable(data.scientificName), data.productionMethod || data.productionPreference || null,
          nullable(data.waterType), nullable(data.productForm), nullable(data.cut || data.processingCapability), nullable(data.condition),
          nullable(data.sizeMinimum), nullable(data.sizeMaximum), nullable(data.sizeUnit), nullable(data.sizeRange), nullable(data.glazing),
          nullable(data.coldChain), nullable(data.freezing), nullable(data.storage || data.storageTemperature), nullable(data.shelfLife),
          nullable(data.harvestCatch || data.harvestDate), nullable(data.laboratory), nullable(data.licences)
        ]);
      } else {
        await client.query(`
          insert into spice_specifications (
            lead_id, spice, variety, origin, product_form, grade, density_value, density_unit, moisture,
            size_requirement, foreign_matter, curcumin, volatile_oil, microbiology, pesticide_residues,
            aflatoxin, salmonella, steam_sterilisation, laboratory_report_requirement,
            certification_requirement, private_label_requirement
          ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
        `, [
          leadId, data.spice, nullable(data.variety), data.originPreference || data.sourceLocation || null, nullable(data.spiceForm),
          nullable(data.grade), data.density || data.densitySize || null, nullable(data.densityUnit), nullable(data.moisture), nullable(data.size),
          nullable(data.foreignMatter), nullable(data.curcumin), nullable(data.volatileOil), nullable(data.microbiology), nullable(data.pesticide),
          nullable(data.aflatoxin), nullable(data.salmonella), data.steamSterilisation || data.sterilisation || null,
          nullable(data.labReport), nullable(data.certifications), nullable(data.privateLabel)
        ]);
      }

      const locationSource = data.location?.mapPin ? 'map_pin' : data.location?.device ? 'device_permission' : data.location ? 'user_entered' : null;
      const consent = await client.query(`
        insert into consent_records (
          lead_id, privacy_policy_version, terms_version, commercial_contact_consent, matching_consent, consent_source,
          location_collection_consent, precise_location_consent, location_collection_purpose,
          location_source, location_consent_text_version, location_consent_time
        ) values ($1, '2026-08-15', '2026-08-15', true, $2, 'Website qualification form',
          $3,$4,$5,$6,$7,$8) returning id
      `, [
        leadId, data.matchingConsent, data.location?.locationCollectionConsent || false,
        data.location?.preciseLocationConsent || false,
        data.location ? (data.role === 'buyer' ? 'Delivery qualification and planning' : 'Stock, pickup and facility qualification') : null,
        locationSource, data.location?.consentTextVersion || null, data.location ? new Date() : null
      ]);
      await storeLeadLocations(client, {
        location: data.location, approximateLocation, role: data.role, userId: identity.userId,
        organisationId, leadId, consentRecordId: consent.rows[0].id
      });
      await client.query(`insert into audit_log (action, entity_type, entity_identifier, new_values)
        values ('guest_lead_created', 'lead', $1, jsonb_build_object(
          'role', $2::text, 'category', $3::text, 'identity_association', $4::text
        ))`,
      [reference, data.role, data.category, identity.associatedBy]);
      return { leadId, reference, role: data.role, category: data.category, userId: identity.userId };
    });
  } catch (error) {
    if (error.code === '23505' && String(error.constraint).includes('submission_key')) throw new DuplicateSubmissionError();
    throw error;
  }

  await notifyAdministrator({ pool, ...result, config, fetcher }).catch(error => {
    console.error(JSON.stringify({ level: 'warn', event: 'lead_notification_failed', reference: result.reference, message: error.message }));
  });
  return { reference: result.reference, leadId: result.leadId, userId: result.userId, role: result.role, category: result.category };
}
