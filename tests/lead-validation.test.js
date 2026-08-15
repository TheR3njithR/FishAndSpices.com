import { describe, expect, it } from 'vitest';
import { LeadValidationError, validateLead } from '../server/validation/lead.js';

const now = Date.parse('2026-08-15T12:00:00Z');
const shared = {
  fullName: 'Commercial Contact', companyName: 'Example Foods', businessEmail: 'buyer@example.com', phone: '+91 90000 00000',
  country: 'India', quantity: '25', unit: 'metric tonnes', privacyConsent: true, matchingConsent: true,
  formStartedAt: now - 10_000, submissionId: 'dc87103a-bf77-4c01-a44e-dba6ca606e11', turnstileToken: 'test-token', websiteUrl: ''
};
const buyer = {
  ...shared, role: 'buyer', jobTitle: 'Procurement Manager', buyerType: 'Importer', city: 'Kochi', commercialPurpose: 'Distribution',
  purchaseFrequency: 'Monthly', destinationCountry: 'India', deliveryLocation: 'Kochi', requiredDate: '2026-09-15', incoterm: 'CIF',
  sampleRequirement: 'Yes', inspectionRequirement: 'Yes', commercialDeclaration: true
};
const seller = {
  ...shared, role: 'seller', sellerType: 'Farmer', state: 'Kerala', district: 'Ernakulam', locality: 'Kochi',
  registrationStatus: 'Registered', gstStatus: 'Registered', licenceStatus: 'Current', exportCapability: 'Supply through exporter',
  availabilityDate: '2026-09-01', minimumOrder: '5', deliveryCapability: 'Cold-chain delivery', paymentTerms: 'Against documents',
  authorityConfirmation: true, accuracyDeclaration: true, responsibilityDeclaration: true, evidenceAcknowledgement: true
};
const fishBuyer = {
  ...buyer, category: 'fish', commonProduct: 'Shrimp', productionPreference: 'Farmed', waterType: 'Marine', productForm: 'Frozen',
  cut: 'Whole', condition: 'Frozen', sizeRange: '20-30 pieces/kg', coldChain: 'Required', packing: '10 kg cartons'
};
const spiceBuyer = { ...buyer, category: 'spices', spice: 'Turmeric', spiceForm: 'Dried', grade: 'Export grade', packingSize: '25 kg', privateLabel: 'No', labReport: 'Yes' };
const fishSeller = {
  ...seller, category: 'fish', commonProduct: 'Pearl spot', productionMethod: 'Farmed', waterType: 'Freshwater', facilityLocation: 'Kochi',
  harvestDate: '2026-09-01', sizeRange: '300-500 g', productForm: 'Whole', condition: 'Fresh', coldChain: 'Yes', inspection: 'Yes', productPhotos: 'Yes', facilityPhotos: 'Yes'
};
const spiceSeller = {
  ...seller, category: 'spices', spice: 'Black pepper', sourceLocation: 'Idukki', supplyType: 'Farmer-grown', availableDate: '2026-09-01',
  spiceForm: 'Whole', labReport: 'Yes', productPhotos: 'Yes', facilityPhotos: 'Yes', inspection: 'Yes'
};

const valid = payload => validateLead(payload, now).data;
const invalid = payload => expect(() => valid(payload)).toThrow(LeadValidationError);

describe('Railway lead validation', () => {
  it.each([
    ['buyer fish', fishBuyer, 'fish'], ['buyer spices', spiceBuyer, 'spices'],
    ['seller fish', fishSeller, 'fish'], ['seller spices', spiceSeller, 'spices']
  ])('accepts %s', (_label, payload, category) => expect(valid(payload)).toMatchObject({ role: payload.role, category, quantity: 25 }));
  it('rejects invalid email', () => invalid({ ...fishBuyer, businessEmail: 'invalid' }));
  it('rejects invalid telephone', () => invalid({ ...fishBuyer, phone: '12' }));
  it('rejects zero or negative quantity', () => invalid({ ...fishBuyer, quantity: 0 }));
  it('rejects invalid category', () => invalid({ ...fishBuyer, category: 'meat' }));
  it('rejects missing consent', () => invalid({ ...fishBuyer, matchingConsent: false }));
  it('rejects honeypot content', () => invalid({ ...fishBuyer, websiteUrl: 'spam' }));
  it('rejects fast submissions', () => invalid({ ...fishBuyer, formStartedAt: now - 100 }));
  it('rejects fish fields in a spice payload', () => invalid({ ...spiceBuyer, commonProduct: 'Shrimp' }));
  it('rejects unsupported quantity units', () => invalid({ ...fishBuyer, unit: 'containers' }));

  it('accepts a manual commercial location without precise coordinates', () => {
    const location = {
      countryCode: 'IN', countryName: 'India', region: 'Kerala', district: 'Ernakulam', city: 'Kochi',
      postalCode: ' 682001 ', locationType: 'delivery', locationCollectionConsent: true,
      preciseLocationConsent: false, consentTextVersion: 'location-v1-2026-08-15'
    };
    expect(valid({ ...fishBuyer, location }).location).toMatchObject({ postalCode: '682001', device: null, mapPin: null });
  });

  it.each([
    ['latitude', { latitude: 91, longitude: 76, accuracyMetres: 10, userConfirmed: true }],
    ['longitude', { latitude: 10, longitude: -181, accuracyMetres: 10, userConfirmed: true }],
    ['accuracy', { latitude: 10, longitude: 76, accuracyMetres: 0, userConfirmed: true }],
    ['confirmation', { latitude: 10, longitude: 76, accuracyMetres: 10, userConfirmed: false }]
  ])('rejects invalid device %s', (_label, device) => invalid({ ...fishBuyer, location: {
    countryCode: 'IN', locationType: 'delivery', locationCollectionConsent: true,
    preciseLocationConsent: true, device
  } }));

  it('rejects unknown location and coordinate fields', () => {
    invalid({ ...fishBuyer, location: { countryCode: 'IN', locationType: 'delivery', locationCollectionConsent: true, browserCountry: 'IN' } });
    invalid({ ...fishBuyer, location: {
      countryCode: 'IN', locationType: 'delivery', locationCollectionConsent: true, preciseLocationConsent: true,
      device: { latitude: 10, longitude: 76, accuracyMetres: 10, userConfirmed: true, altitude: 3 }
    } });
  });

  it('requires explicit precise-location consent and keeps map pins unverified input', () => {
    const mapPin = { latitude: 10, longitude: 76, accuracyMetres: 25, userConfirmed: true };
    invalid({ ...fishBuyer, location: { countryCode: 'IN', locationType: 'delivery', locationCollectionConsent: true, preciseLocationConsent: false, mapPin } });
    expect(valid({ ...fishBuyer, location: {
      countryCode: 'IN', locationType: 'delivery', locationCollectionConsent: true, preciseLocationConsent: true, mapPin
    } }).location.mapPin).toEqual(mapPin);
  });
});

export { fishBuyer, spiceBuyer, fishSeller, spiceSeller };
