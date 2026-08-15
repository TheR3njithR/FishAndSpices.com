import { LocationValidationError, validateLeadLocation } from '../services/location.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[+\d][\d\s().-]{6,24}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UNITS = new Set(['kg', 'metric tonnes', 'pieces', 'cartons', 'bags', 'litres', 'Other']);
const BOOLEAN_FIELDS = new Set([
  'privacyConsent', 'matchingConsent', 'commercialDeclaration', 'accuracyDeclaration',
  'authorityConfirmation', 'responsibilityDeclaration', 'evidenceAcknowledgement'
]);
const LONG_FIELDS = new Set([
  'additionalNotes', 'quality', 'laboratory', 'licences', 'certifications', 'processing',
  'processingCapability', 'deliveryCapability', 'storage', 'packing', 'microbiology', 'pesticide'
]);

const shared = [
  'fullName', 'companyName', 'businessEmail', 'countryCallingCode', 'phone', 'website', 'country', 'productCategory',
  'quantity', 'unit', 'additionalNotes', 'privacyConsent', 'matchingConsent', 'formStartedAt',
  'turnstileToken', 'submissionId', 'websiteUrl', 'sourceDomain', 'sourcePage', 'referrer',
  'utmSource', 'utmMedium', 'utmCampaign', 'location'
];
const buyer = [
  'jobTitle', 'buyerType', 'city', 'commercialPurpose', 'purchaseFrequency', 'destinationCountry',
  'deliveryLocation', 'requiredDate', 'incoterm', 'sampleRequirement', 'inspectionRequirement',
  'commercialDeclaration', 'packing', 'paymentTerms', 'quality', 'certifications', 'recurringVolume'
];
const seller = [
  'sellerType', 'state', 'district', 'locality', 'registrationStatus', 'registrationNumber', 'gstStatus',
  'licenceStatus', 'exportCapability', 'availabilityDate', 'minimumOrder', 'deliveryCapability',
  'paymentTerms', 'accuracyDeclaration', 'authorityConfirmation', 'responsibilityDeclaration',
  'evidenceAcknowledgement', 'packing', 'storage', 'inspection', 'expectedPrice', 'priceUnit', 'recurringVolume'
];
const fish = [
  'commonProduct', 'scientificName', 'productionPreference', 'productionMethod', 'waterType', 'productForm',
  'cut', 'condition', 'sizeMinimum', 'sizeMaximum', 'sizeUnit', 'sizeRange', 'glazing', 'coldChain',
  'freezing', 'storageTemperature', 'processing', 'processingCapability', 'shelfLife', 'harvestCatch',
  'harvestDate', 'laboratory', 'licences', 'facilityLocation', 'productPhotos', 'facilityPhotos'
];
const spices = [
  'spice', 'variety', 'originPreference', 'sourceLocation', 'supplyType', 'spiceForm', 'grade', 'density',
  'densityUnit', 'moisture', 'size', 'densitySize', 'foreignMatter', 'curcumin', 'volatileOil', 'microbiology',
  'pesticide', 'aflatoxin', 'salmonella', 'steamSterilisation', 'labReport', 'certifications', 'privateLabel',
  'cleaning', 'grading', 'grinding', 'sterilisation', 'packingSize', 'packingMaterial', 'availableDate',
  'harvestDate', 'productPhotos', 'facilityPhotos'
];

const allowed = {
  buyer: { fish: new Set([...shared, ...buyer, ...fish]), spices: new Set([...shared, ...buyer, ...spices]) },
  seller: { fish: new Set([...shared, ...seller, ...fish]), spices: new Set([...shared, ...seller, ...spices]) }
};
const required = {
  buyer: {
    fish: ['fullName', 'destinationCountry', 'deliveryLocation', 'commonProduct', 'quantity', 'unit', 'privacyConsent', 'matchingConsent', 'commercialDeclaration'],
    spices: ['fullName', 'destinationCountry', 'deliveryLocation', 'spice', 'quantity', 'unit', 'privacyConsent', 'matchingConsent', 'commercialDeclaration']
  },
  seller: {
    fish: ['fullName', 'country', 'locality', 'commonProduct', 'quantity', 'unit', 'authorityConfirmation', 'accuracyDeclaration', 'privacyConsent', 'matchingConsent'],
    spices: ['fullName', 'country', 'locality', 'spice', 'quantity', 'unit', 'authorityConfirmation', 'accuracyDeclaration', 'privacyConsent', 'matchingConsent']
  }
};

export class LeadValidationError extends Error {
  constructor(message, fields = {}) {
    super(message);
    this.name = 'LeadValidationError';
    this.status = 422;
    this.fields = fields;
  }
}

function text(value, limit = 300) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function bool(value) {
  return value === true || value === 'true' || value === 'Confirmed' || value === 'on';
}

export function validateLead(input, now = Date.now()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new LeadValidationError('The request body must be a JSON object.');
  const role = text(input.role, 10).toLowerCase();
  const category = text(input.category, 10).toLowerCase();
  if (!allowed[role]?.[category]) throw new LeadValidationError('Invalid buyer/seller or fish/spice category.', { role: 'Choose a valid journey and category.' });

  const permitted = allowed[role][category];
  const unknown = Object.keys(input).filter(key => !permitted.has(key) && !['role', 'category'].includes(key));
  if (unknown.length) throw new LeadValidationError('Unknown fields are not accepted.', { request: `Remove: ${unknown.slice(0, 5).join(', ')}` });

  if (text(input.websiteUrl, 500)) throw new LeadValidationError('Automated submission rejected.');
  const startedAt = Number(input.formStartedAt);
  if (!Number.isFinite(startedAt) || startedAt > now || now - startedAt < 3000) throw new LeadValidationError('The form was submitted too quickly. Please review and retry.');
  if (now - startedAt > 24 * 60 * 60 * 1000) throw new LeadValidationError('This form session expired. Reload the page and retry.');
  if (!UUID_V4.test(text(input.submissionId, 40))) throw new LeadValidationError('Invalid submission session. Reload the page and retry.');

  const data = { role, category };
  for (const key of permitted) {
    if (key === 'location') continue;
    data[key] = BOOLEAN_FIELDS.has(key) ? bool(input[key]) : text(input[key], LONG_FIELDS.has(key) ? 2000 : 300);
  }
  try {
    data.location = validateLeadLocation(input.location, role);
  } catch (error) {
    if (error instanceof LocationValidationError) throw new LeadValidationError(error.message, error.fields);
    throw error;
  }
  const errors = {};
  for (const key of required[role][category]) {
    if (BOOLEAN_FIELDS.has(key) ? data[key] !== true : !data[key]) errors[key] = 'This field is required.';
  }
  if (!data.businessEmail && !data.phone) {
    errors.phone = 'Enter a mobile number or email address.';
    errors.businessEmail = 'Enter a mobile number or email address.';
  }
  if (data.phone && data.countryCallingCode && !data.phone.startsWith('+')) data.phone = `${data.countryCallingCode}${data.phone.replace(/^0+/, '')}`;
  if (data.businessEmail && !EMAIL.test(data.businessEmail)) errors.businessEmail = 'Enter a valid business email.';
  if (data.phone && !PHONE.test(data.phone)) errors.phone = 'Enter a valid telephone or WhatsApp number.';
  if (data.unit && !UNITS.has(data.unit)) errors.unit = 'Choose a supported quantity unit.';
  for (const key of ['requiredDate', 'availabilityDate', 'availableDate', 'harvestDate']) {
    if (data[key] && (!DATE.test(data[key]) || Number.isNaN(Date.parse(`${data[key]}T00:00:00Z`)))) errors[key] = 'Enter a valid date.';
  }
  for (const key of ['quantity', 'minimumOrder', 'expectedPrice', 'sizeMinimum', 'sizeMaximum']) {
    if (!data[key]) continue;
    const numeric = Number(data[key]);
    if (!Number.isFinite(numeric) || numeric <= 0) errors[key] = 'Enter a number greater than zero.';
    else data[key] = numeric;
  }
  if (data.sizeMinimum && data.sizeMaximum && data.sizeMaximum < data.sizeMinimum) errors.sizeMaximum = 'Maximum size must be at least the minimum size.';
  if (Object.keys(errors).length) throw new LeadValidationError('Review the submitted information.', errors);

  const turnstileToken = data.turnstileToken;
  delete data.formStartedAt;
  delete data.websiteUrl;
  delete data.turnstileToken;
  return { data, turnstileToken };
}
