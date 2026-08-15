import { requestCurrentPosition } from './device-location.js';

(() => {
  const form = document.querySelector('[data-lead-form]');
  if (!form) return;

  const config = window.FS_CONFIG;
  const role = form.dataset.role;
  const picker = document.querySelector('[data-journey-picker]');
  const workspace = document.querySelector('[data-lead-workspace]');
  const fieldsRoot = form.querySelector('[data-fields]');
  const errorsRoot = form.querySelector('[data-errors]');
  const review = document.querySelector('[data-review]');
  const summaryOutput = review.querySelector('[data-summary]');
  const referenceOutput = review.querySelector('[data-reference]');
  const confirmButton = form.querySelector('[data-generate]');
  const whatsappLink = review.querySelector('[data-whatsapp]');
  const submitButton = review.querySelector('[data-submit-lead]');
  const submitStatus = review.querySelector('[data-submit-status]');
  const turnstileRoot = review.querySelector('[data-turnstile]');
  let category = '';
  let generated = false;
  let reviewValues = null;
  let formStartedAt = Date.now();
  let submissionId = crypto.randomUUID();
  let turnstileWidgetId = null;
  let turnstileToken = '';
  let turnstileDevelopmentBypass = false;
  let pendingDeviceLocation = null;
  let locationPermissionDenied = false;
  let approximateLocation = null;

  const buyerTypes = ['Importer', 'Exporter seeking supply', 'Distributor', 'Wholesaler', 'Restaurant or hotel', 'Supermarket', 'Food manufacturer', 'Seafood processor', 'Spice processor', 'Private-label company', 'Institutional buyer', 'Trading company', 'Other'];
  const sellerTypes = ['Farmer', 'Fish farmer', 'Fishermen group', 'Aquaculture farm', 'Farmer organisation', 'Aggregator', 'Processor', 'Packer', 'Cold-storage operator', 'Wholesaler', 'Licensed exporter', 'Trading company', 'Other'];
  const yesNo = ['Yes', 'No', 'Not sure'];
  const units = ['kg', 'metric tonnes', 'pieces', 'cartons', 'bags', 'litres', 'Other'];
  const incoterms = ['EXW', 'FCA', 'FOB', 'CFR', 'CIF', 'DAP', 'DDP', 'Not decided'];
  const callingCodes = ['+91', '+971', '+1', '+44', '+65', '+60', '+966', '+974', '+968', '+973', '+965'];
  const countryCodes = ['IN', 'AE', 'US', 'GB', 'SG', 'MY', 'SA', 'QA', 'OM', 'BH', 'KW', 'LK', 'BD', 'NP', 'MV', 'ID', 'TH', 'VN', 'AU', 'CA', 'DE', 'FR', 'NL', 'IT', 'ES', 'ZA', 'KE', 'TZ'];
  const callingCodeByCountry = { IN: '+91', AE: '+971', US: '+1', GB: '+44', SG: '+65', MY: '+60', SA: '+966', QA: '+974', OM: '+968', BH: '+973', KW: '+965' };
  const locationFormFields = new Set([
    'countryCode', 'destinationCountryCode', 'deliveryState', 'deliveryDistrict', 'deliveryPort',
    'deliveryPostalCode', 'deliveryLocationType', 'deliveryNotes', 'postalCode', 'stockLocation',
    'siteType', 'pickupAvailability', 'locationNotes', 'locationCollectionConsent'
  ]);

  const field = (name, label, options = {}) => ({ name, label, type: 'text', ...options });
  const section = (title, description, fields) => ({ title, description, fields });

  async function loadManagedOptions() {
    try {
      const response = await fetch('/api/v1/options', { headers: { accept: 'application/json' }, cache: 'no-store' });
      if (!response.ok) return;
      const { options } = await response.json();
      const apply = (target, key) => {
        const list = options?.[key];
        if (Array.isArray(list) && list.length) {
          target.length = 0;
          list.forEach(item => target.push(item.value));
        }
      };
      apply(countryCodes, 'countries');
      apply(callingCodes, 'calling_codes');
      apply(buyerTypes, 'buyer_types');
      apply(sellerTypes, 'seller_types');
      apply(incoterms, 'incoterms');
    } catch { /* keep built-in defaults when options are unavailable */ }
  }
  loadManagedOptions();

  const sharedBuyer = [
    section('Buyer and company', 'Tell us who is responsible for this commercial requirement.', [
      field('fullName', 'Full name', { required: true }), field('jobTitle', 'Job title', { required: true }),
      field('companyName', 'Company name', { required: true }), field('buyerType', 'Buyer type', { type: 'select', required: true, options: buyerTypes }),
      field('businessEmail', 'Email', { type: 'email' }), field('countryCallingCode', 'Mobile country code', { type: 'select', options: callingCodes, value: () => '+91' }), field('phone', 'Mobile or WhatsApp number', { type: 'tel' }),
      field('website', 'Company website', { type: 'url', hint: 'Optional' }), field('country', 'Country', { required: true }), field('city', 'City', { required: true })
    ]),
    section('Delivery location', 'Where should the product be delivered? You can enter the location manually.', [
      field('productCategory', 'Product category', { value: () => category === 'fish' ? 'Fish or seafood' : 'Spices', readonly: true, required: true }),
      field('destinationCountryCode', 'Destination country code', { type: 'select', options: countryCodes }),
      field('destinationCountry', 'Destination country', { required: true }), field('deliveryState', 'State or region'),
      field('deliveryDistrict', 'District or county'), field('deliveryLocation', 'Delivery city', { required: true }),
      field('deliveryPort', 'Port name', { hint: 'Optional, when relevant' }), field('deliveryPostalCode', 'Pincode or postal code'),
      field('deliveryLocationType', 'Delivery location type', { type: 'select', options: ['Business premises', 'Warehouse', 'Port', 'Processing facility', 'Other'] }),
      field('deliveryNotes', 'Delivery location notes', { type: 'textarea', wide: true, hint: 'Optional. Do not include information that is not needed for qualification.' }),
      field('requiredDate', 'Required date', { type: 'date', required: true }), field('incoterm', 'Preferred Incoterm', { type: 'select', required: true, options: incoterms }),
      field('sampleRequirement', 'Sample requirement', { type: 'select', required: true, options: yesNo }), field('inspectionRequirement', 'Inspection requirement', { type: 'select', required: true, options: yesNo }),
      field('additionalNotes', 'Short requirement', { type: 'textarea', wide: true })
    ])
  ];

  const fishBuyer = section('Fish or seafood specification', 'Only fish and seafood qualification fields are shown.', [
    field('commonProduct', 'Common product name', { required: true }), field('scientificName', 'Scientific name', { hint: 'Optional, but useful for precise matching' }),
    field('productionPreference', 'Farmed or wild-caught preference', { type: 'select', required: true, options: ['Farmed', 'Wild-caught', 'Either', 'To be confirmed'] }),
    field('waterType', 'Freshwater or marine', { type: 'select', required: true, options: ['Freshwater', 'Marine', 'Brackish water', 'Either'] }),
    field('productForm', 'Product form', { required: true, hint: 'For example: whole, fillet, block or value-added' }),
    field('cut', 'Cut', { type: 'select', required: true, options: ['Whole', 'Gutted', 'Fillet', 'Steak', 'Other cut'] }),
    field('condition', 'Condition', { type: 'select', required: true, options: ['Fresh', 'Chilled', 'Frozen', 'Dried', 'Live', 'Processed'] }),
    field('sizeRange', 'Required size or weight range', { required: true }), field('quantity', 'Required quantity', { type: 'number', required: true, min: '0.01', step: 'any' }),
    field('unit', 'Quantity unit', { type: 'select', required: true, options: units }), field('recurringVolume', 'Weekly or monthly recurring volume'),
    field('glazing', 'Glazing requirement', { hint: 'Where relevant' }), field('coldChain', 'Cold-chain requirement', { required: true }),
    field('packing', 'Packing requirement', { required: true }), field('processing', 'Processing requirement'),
    field('harvestCatch', 'Harvest or catch requirement'), field('quality', 'Quality parameters', { type: 'textarea', wide: true }),
    field('licences', 'Required licences or certifications', { type: 'textarea' }), field('laboratory', 'Laboratory requirements', { type: 'textarea' }),
    field('shelfLife', 'Shelf-life requirement')
  ]);

  const spiceBuyer = section('Spice specification', 'Only spice qualification fields are shown.', [
    field('spice', 'Spice', { required: true }), field('variety', 'Variety'), field('originPreference', 'Origin preference'),
    field('spiceForm', 'Product form', { type: 'select', required: true, options: ['Whole', 'Cracked', 'Ground', 'Dried', 'Fresh', 'Oil', 'Oleoresin', 'Other'] }),
    field('grade', 'Grade', { required: true }), field('density', 'Density requirement', { hint: 'Where applicable' }), field('size', 'Size requirement'),
    field('moisture', 'Moisture limit'), field('foreignMatter', 'Foreign-matter limit'), field('curcumin', 'Curcumin requirement', { hint: 'Where applicable' }),
    field('volatileOil', 'Volatile-oil requirement', { hint: 'Where applicable' }), field('microbiology', 'Microbiological requirements', { type: 'textarea' }),
    field('pesticide', 'Pesticide-residue requirements', { type: 'textarea' }), field('aflatoxin', 'Aflatoxin requirements'),
    field('steamSterilisation', 'Steam-sterilisation requirement', { type: 'select', options: yesNo }),
    field('quantity', 'Required quantity', { type: 'number', required: true, min: '0.01', step: 'any' }), field('unit', 'Quantity unit', { type: 'select', required: true, options: units }),
    field('recurringVolume', 'Recurring volume'), field('packingSize', 'Packing size', { required: true }), field('packingMaterial', 'Packing material'),
    field('privateLabel', 'Private-label requirement', { type: 'select', required: true, options: yesNo }),
    field('certifications', 'Required certifications', { type: 'textarea' }), field('labReport', 'Laboratory-report requirement', { type: 'select', required: true, options: yesNo })
  ]);

  const sharedSeller = [
    section('Seller and organisation', 'Seller submissions remain private and are reviewed before potential matching.', [
      field('fullName', 'Full name', { required: true }), field('companyName', 'Business, farm or organisation name', { required: true }),
      field('sellerType', 'Seller type', { type: 'select', required: true, options: sellerTypes }), field('businessEmail', 'Email', { type: 'email', required: true }),
      field('countryCallingCode', 'Mobile country code', { type: 'select', options: callingCodes, value: () => '+91' }), field('phone', 'Mobile or WhatsApp number', { type: 'tel' }), field('website', 'Website or social profile', { type: 'url' }),
      field('countryCode', 'Country code', { type: 'select', options: countryCodes }),
      field('country', 'Country', { required: true }), field('state', 'State or region'), field('district', 'District'), field('locality', 'City or locality', { required: true }),
      field('postalCode', 'Pincode or postal code'),
      field('registrationStatus', 'Business-registration status', { type: 'select', required: true, options: ['Registered', 'Not registered', 'Application in progress', 'Not applicable'] }),
      field('licenceStatus', 'Relevant licence status', { type: 'select', required: true, options: ['Current', 'Not held', 'Application in progress', 'Not sure'] }),
      field('gstStatus', 'GST status where applicable', { type: 'select', required: true, options: ['Registered', 'Not registered', 'Not applicable'] }),
      field('exportCapability', 'Export capability', { type: 'select', required: true, options: ['Direct exporter', 'Supply through exporter', 'Domestic supply only', 'To be assessed'] })
    ]),
    section('Product location', 'Where is the product currently available? You can enter the location manually.', [
      field('productCategory', 'Product category', { value: () => category === 'fish' ? 'Fish or seafood' : 'Spices', readonly: true, required: true }),
      field('stockLocation', 'Stock location', { hint: 'Village, market, landing centre, warehouse or other useful description' }),
      field('siteType', 'Location type', { type: 'select', options: ['Farm', 'Facility', 'Warehouse', 'Stock point', 'Pickup point', 'Port'] }),
      field('pickupAvailability', 'Pickup availability', { type: 'select', options: ['Available', 'Not available', 'To be discussed'] }),
      field('locationNotes', 'Location notes', { type: 'textarea', wide: true, hint: 'Optional. Your exact location will not be displayed publicly.' }),
      field('availabilityDate', 'Current availability date', { type: 'date', required: true }), field('minimumOrder', 'Minimum order in the selected quantity unit', { type: 'number', required: true, min: '0.01', step: 'any' }),
      field('deliveryCapability', 'Delivery capability', { type: 'textarea', required: true }), field('paymentTerms', 'Payment-term expectation', { required: true }),
      field('additionalNotes', 'Short stock description', { type: 'textarea', wide: true })
    ])
  ];

  const fishSeller = section('Fish or seafood availability', 'Only fish and seafood qualification fields are shown.', [
    field('commonProduct', 'Product or common name', { required: true }), field('scientificName', 'Scientific name', { hint: 'If known' }),
    field('productionMethod', 'Farmed or wild-caught', { type: 'select', required: true, options: ['Farmed', 'Wild-caught', 'Both'] }),
    field('waterType', 'Freshwater or marine', { type: 'select', required: true, options: ['Freshwater', 'Marine', 'Brackish water'] }),
    field('facilityLocation', 'Farm, landing centre or facility location', { required: true, wide: true }),
    field('quantity', 'Current quantity', { type: 'number', required: true, min: '0.01', step: 'any' }), field('recurringVolume', 'Recurring production capacity'),
    field('unit', 'Quantity unit', { type: 'select', required: true, options: units }), field('harvestDate', 'Expected harvest or availability date', { type: 'date', required: true }),
    field('sizeRange', 'Size range', { required: true }), field('productForm', 'Product form', { required: true }), field('processingCapability', 'Processing capability', { type: 'textarea' }),
    field('condition', 'Condition', { type: 'select', required: true, options: ['Fresh', 'Chilled', 'Frozen', 'Dried', 'Live', 'Value-added'] }),
    field('coldChain', 'Ice and cold-chain availability', { type: 'select', required: true, options: yesNo }), field('freezing', 'Freezing capability', { type: 'select', options: yesNo }),
    field('storage', 'Storage capability', { type: 'textarea' }), field('packing', 'Packing capability', { type: 'textarea' }),
    field('licences', 'Relevant fishery or food licences', { type: 'textarea' }), field('laboratory', 'Laboratory or health documentation', { type: 'textarea' }),
    field('inspection', 'Inspection availability', { type: 'select', required: true, options: yesNo }), field('productPhotos', 'Product photographs available', { type: 'select', required: true, options: yesNo }),
    field('facilityPhotos', 'Facility photographs available', { type: 'select', required: true, options: yesNo })
  ]);

  const spiceSeller = section('Spice availability', 'Only spice qualification fields are shown.', [
    field('spice', 'Spice', { required: true }), field('variety', 'Variety'), field('sourceLocation', 'Cultivation or sourcing location', { required: true }),
    field('supplyType', 'Supply type', { type: 'select', required: true, options: ['Farmer-grown', 'Aggregated', 'Processed'] }),
    field('quantity', 'Current quantity', { type: 'number', required: true, min: '0.01', step: 'any' }), field('recurringVolume', 'Recurring production capacity'),
    field('unit', 'Quantity unit', { type: 'select', required: true, options: units }), field('harvestDate', 'Harvest date', { type: 'date' }), field('availableDate', 'Available date', { type: 'date', required: true }),
    field('spiceForm', 'Available form', { type: 'select', required: true, options: ['Whole', 'Dried', 'Cleaned', 'Graded', 'Ground', 'Processed'] }),
    field('grade', 'Grade'), field('moisture', 'Moisture information'), field('densitySize', 'Density or size information'),
    field('cleaning', 'Cleaning capability', { type: 'select', options: yesNo }), field('grading', 'Grading capability', { type: 'select', options: yesNo }),
    field('grinding', 'Grinding capability', { type: 'select', options: yesNo }), field('sterilisation', 'Sterilisation capability', { type: 'select', options: yesNo }),
    field('packing', 'Packing capability', { type: 'textarea' }), field('storage', 'Storage capability', { type: 'textarea' }), field('certifications', 'Certifications', { type: 'textarea' }),
    field('labReport', 'Laboratory report availability', { type: 'select', required: true, options: yesNo }), field('productPhotos', 'Product photographs available', { type: 'select', required: true, options: yesNo }),
    field('facilityPhotos', 'Farm or facility photographs available', { type: 'select', required: true, options: yesNo }), field('inspection', 'Inspection availability', { type: 'select', required: true, options: yesNo })
  ]);

  const declarations = role === 'buyer' ? [
    field('privacyConsent', 'I consent to the use of these details for lead qualification and potential introductions under the Privacy Notice.', { type: 'checkbox', required: true, wide: true }),
    field('matchingConsent', 'I consent to Fish & Spices reviewing this enquiry for potential matches and contacting me about suitable introductions.', { type: 'checkbox', required: true, wide: true }),
    field('commercialDeclaration', 'I confirm this is a genuine commercial enquiry and the information supplied is accurate to the best of my knowledge.', { type: 'checkbox', required: true, wide: true }),
    field('locationCollectionConsent', 'I agree to the location details I enter being used privately for qualification, matching and delivery planning.', { type: 'checkbox', required: true, wide: true })
  ] : [
    field('authorityConfirmation', 'I own or am authorised to offer the stock described in this submission.', { type: 'checkbox', required: true, wide: true }),
    field('accuracyDeclaration', 'I confirm the availability and business information supplied is accurate to the best of my knowledge.', { type: 'checkbox', required: true, wide: true }),
    field('responsibilityDeclaration', 'I understand that applicable food, fishery, business and export requirements remain my responsibility and submission does not guarantee buyer leads.', { type: 'checkbox', required: true, wide: true }),
    field('evidenceAcknowledgement', 'I understand that current product, farm, facility, licence or laboratory evidence may be requested, but sensitive files must not be uploaded in this phase.', { type: 'checkbox', required: true, wide: true }),
    field('privacyConsent', 'I consent to private review of these details for lead qualification and potential introductions under the Privacy Notice.', { type: 'checkbox', required: true, wide: true }),
    field('matchingConsent', 'I consent to Fish & Spices reviewing this offer for potential matches and contacting me about suitable introductions.', { type: 'checkbox', required: true, wide: true }),
    field('locationCollectionConsent', 'I agree to the location details I enter being used privately for qualification, matching, pickup and logistics planning.', { type: 'checkbox', required: true, wide: true })
  ];

  const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
  const sanitize = (value) => String(value ?? '').replace(/[^\P{C}\n\t]/gu, '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 1000);
  const inputId = name => `lead-${name}`;
  const contactFallbackFields = new Set(['businessEmail', 'phone']);
  const contactFallbackHint = 'At least one of Email or Mobile or WhatsApp is required.';

  const minimumFields = new Set([
    'fullName', 'countryCallingCode', 'phone', 'businessEmail', 'companyName', 'countryCode', 'country', 'state', 'district', 'locality', 'postalCode',
    'productCategory', 'destinationCountry', 'deliveryLocation', 'requiredDate', 'availabilityDate',
    'destinationCountryCode', 'deliveryState', 'deliveryDistrict', 'deliveryPort', 'deliveryPostalCode',
    'deliveryLocationType', 'deliveryNotes', 'stockLocation', 'siteType', 'pickupAvailability', 'locationNotes',
    'commonProduct', 'spice', 'quantity', 'unit', 'productForm', 'spiceForm', 'sizeRange', 'grade',
    'additionalNotes', 'privacyConsent', 'matchingConsent', 'commercialDeclaration',
    'authorityConfirmation', 'accuracyDeclaration', 'locationCollectionConsent'
  ]);
  const requiredInitialFields = new Set([
    'fullName', 'country', 'locality', 'productCategory', 'destinationCountry', 'deliveryLocation',
    'commonProduct', 'spice', 'quantity', 'unit', 'additionalNotes', 'privacyConsent',
    'matchingConsent', 'commercialDeclaration', 'authorityConfirmation', 'accuracyDeclaration', 'locationCollectionConsent'
  ]);

  function renderField(definition) {
    if (!minimumFields.has(definition.name)) return '';
    const isRequired = requiredInitialFields.has(definition.name);
    const isContactFallbackRequired = contactFallbackFields.has(definition.name);
    const required = isRequired ? ' required' : '';
    const requiredMark = (isRequired || isContactFallbackRequired) ? ' <span class="required-mark" aria-hidden="true">*</span>' : '';
    const wide = definition.wide ? ' field-wide' : '';
    const hintText = definition.hint || (isContactFallbackRequired ? contactFallbackHint : '');
    const hint = hintText ? `<span class="field-hint" id="${inputId(definition.name)}-hint">${escapeHtml(hintText)}</span>` : '';
    const describedBy = hintText ? ` aria-describedby="${inputId(definition.name)}-hint"` : '';
    if (definition.type === 'checkbox') {
      return `<div class="field check-field${wide}"><input id="${inputId(definition.name)}" name="${definition.name}" type="checkbox"${required}><label for="${inputId(definition.name)}">${escapeHtml(definition.label)}${requiredMark}</label></div>`;
    }
    let control;
    if (definition.type === 'select') {
      const selectedValue = definition.value ? definition.value() : '';
      control = `<select id="${inputId(definition.name)}" name="${definition.name}"${required}${describedBy}><option value="">Select an option</option>${definition.options.map(option => `<option value="${escapeHtml(option)}"${option === selectedValue ? ' selected' : ''}>${escapeHtml(option)}</option>`).join('')}</select>`;
    } else if (definition.type === 'textarea') {
      control = `<textarea id="${inputId(definition.name)}" name="${definition.name}"${required}${describedBy}></textarea>`;
    } else {
      const value = definition.value ? ` value="${escapeHtml(definition.value())}"` : '';
      const readonly = definition.readonly ? ' readonly' : '';
      const min = definition.min ? ` min="${definition.min}"` : '';
      const step = definition.step ? ` step="${definition.step}"` : '';
      const inputmode = definition.type === 'number' ? ' inputmode="decimal"' : definition.type === 'tel' ? ' inputmode="tel"' : '';
      control = `<input id="${inputId(definition.name)}" name="${definition.name}" type="${definition.type}"${value}${readonly}${required}${min}${step}${inputmode}${describedBy}>`;
    }
    return `<div class="field${wide}"><label for="${inputId(definition.name)}">${escapeHtml(definition.label)}${requiredMark}</label>${control}${hint}</div>`;
  }

  function renderSection(definition) {
    const locationControl = ['Delivery location', 'Product location'].includes(definition.title) ? `<div class="device-location-control field-wide" data-device-location-control>
      <div><strong>Use my current location — optional</strong><p>Helps identify the farm, stock, pickup or delivery area. You can enter the location manually.</p></div>
      <button class="button button-secondary" type="button" data-use-device-location>Use my current location</button>
      <p class="device-location-status" data-device-location-status aria-live="polite">Your exact location will not be displayed publicly.</p>
      <label class="device-location-confirm" data-device-location-confirm hidden><input type="checkbox" data-confirm-device-location> Use this captured position for this ${role === 'buyer' ? 'delivery area' : 'product location'} and consent to precise-location collection.</label>
    </div>` : '';
    return `<section class="form-section" aria-labelledby="section-${definition.title.replace(/\W+/g, '-').toLowerCase()}"><div class="form-section-head"><h2 id="section-${definition.title.replace(/\W+/g, '-').toLowerCase()}">${escapeHtml(definition.title)}</h2><p>${escapeHtml(definition.description)}</p></div><div class="field-grid">${definition.fields.map(renderField).join('')}${locationControl}</div></section>`;
  }

  function selectCategory(selectedCategory) {
    category = selectedCategory;
    picker.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.category === category)));
    const sections = role === 'buyer' ? [...sharedBuyer, category === 'fish' ? fishBuyer : spiceBuyer] : [...sharedSeller, category === 'fish' ? fishSeller : spiceSeller];
    sections.push(section('Declarations', 'Both declarations are required before a review summary can be generated.', declarations));
    fieldsRoot.innerHTML = sections.map(renderSection).join('');
    workspace.hidden = false;
    review.hidden = true;
    generated = false;
    reviewValues = null;
    formStartedAt = Date.now();
    submissionId = crypto.randomUUID();
    turnstileToken = '';
    pendingDeviceLocation = null;
    locationPermissionDenied = false;
    confirmButton.disabled = false;
    errorsRoot.hidden = true;
    workspace.scrollIntoView({ behavior: 'smooth', block: 'start' });
    fieldsRoot.querySelector('input, select, textarea')?.focus({ preventScroll: true });
    applyApproximateDefaults();
    document.querySelector('[data-selection-status]').textContent = `${role === 'buyer' ? 'Buying' : 'Selling'} ${category === 'fish' ? 'fish or seafood' : 'spices'} selected. Relevant fields are now available.`;
  }

  function collectValues() {
    const values = {};
    new FormData(form).forEach((value, key) => { values[key] = sanitize(value); });
    fieldsRoot.querySelectorAll('input[type="checkbox"][name]').forEach(input => { values[input.name] = input.checked; });
    return values;
  }

  function buildLocationPayload(values) {
    const countryCode = role === 'buyer' ? values.destinationCountryCode : values.countryCode;
    const siteType = role === 'buyer' ? values.deliveryLocationType : values.siteType;
    const sellerTypeMap = { Farm: 'farm', Facility: 'facility', Warehouse: 'warehouse', 'Stock point': 'stock', 'Pickup point': 'pickup', Port: 'port' };
    const locationType = role === 'buyer' ? (values.deliveryPort ? 'port' : 'delivery') : sellerTypeMap[values.siteType] || 'stock';
    const confirmedDevice = fieldsRoot.querySelector('[data-confirm-device-location]')?.checked && pendingDeviceLocation;
    return {
      countryCode: countryCode || '',
      countryName: role === 'buyer' ? values.destinationCountry : values.country,
      region: role === 'buyer' ? values.deliveryState : values.state,
      district: role === 'buyer' ? values.deliveryDistrict : values.district,
      city: role === 'buyer' ? values.deliveryLocation : values.locality,
      postalCode: role === 'buyer' ? values.deliveryPostalCode : values.postalCode,
      addressLine: role === 'buyer' ? values.deliveryNotes : values.stockLocation,
      portName: role === 'buyer' ? values.deliveryPort : locationType === 'port' ? values.stockLocation : '',
      locationType,
      siteType: siteType || '',
      pickupAvailability: values.pickupAvailability || '',
      notes: role === 'buyer' ? values.deliveryNotes : values.locationNotes,
      locationCollectionConsent: values.locationCollectionConsent === true,
      preciseLocationConsent: Boolean(confirmedDevice),
      consentTextVersion: 'location-v1-2026-08-15',
      ...(confirmedDevice ? { device: { ...pendingDeviceLocation, userConfirmed: true } } : {})
    };
  }

  function applyApproximateDefaults() {
    if (!approximateLocation?.countryCode) return;
    const callingCode = fieldsRoot.querySelector('[name="countryCallingCode"]');
    if (callingCode && callingCodeByCountry[approximateLocation.countryCode]) callingCode.value = callingCodeByCountry[approximateLocation.countryCode];
    if (role !== 'seller') return;
    const countryCode = fieldsRoot.querySelector('[name="countryCode"]');
    const country = fieldsRoot.querySelector('[name="country"]');
    if (countryCode && !countryCode.value && [...countryCode.options].some(option => option.value === approximateLocation.countryCode)) countryCode.value = approximateLocation.countryCode;
    if (country && !country.value && approximateLocation.countryName) country.value = approximateLocation.countryName;
  }

  async function requestDeviceLocation(button) {
    if (locationPermissionDenied || button.disabled) return;
    const status = fieldsRoot.querySelector('[data-device-location-status]');
    const confirmation = fieldsRoot.querySelector('[data-device-location-confirm]');
    button.disabled = true;
    status.textContent = 'Requesting one current position…';
    const result = await requestCurrentPosition();
    if (result.status === 'granted') {
      pendingDeviceLocation = result.location;
      confirmation.hidden = false;
      confirmation.querySelector('input').checked = false;
      status.textContent = `Current position captured with approximately ${Math.round(pendingDeviceLocation.accuracyMetres)} metres accuracy. Confirm it below or continue with manual fields.`;
      return;
    }
    pendingDeviceLocation = null;
    locationPermissionDenied = result.status === 'denied';
    status.textContent = result.status === 'denied'
      ? 'Location permission was declined. You can complete the form manually; we will not ask again on this page.'
      : result.status === 'timeout'
        ? 'Current location timed out. Continue with manual location entry.'
        : 'Current location is unavailable. Continue with manual location entry.';
    if (!locationPermissionDenied && result.status === 'timeout') button.disabled = false;
  }

  function allDefinitions() {
    const shared = role === 'buyer' ? sharedBuyer : sharedSeller;
    const specific = role === 'buyer' ? (category === 'fish' ? fishBuyer : spiceBuyer) : (category === 'fish' ? fishSeller : spiceSeller);
    return [...shared.flatMap(item => item.fields), ...specific.fields, ...declarations];
  }

  function clearFieldErrors() {
    fieldsRoot.querySelectorAll('.field-error').forEach(error => error.remove());
    fieldsRoot.querySelectorAll('[aria-invalid]').forEach(control => control.removeAttribute('aria-invalid'));
    errorsRoot.hidden = true;
    errorsRoot.innerHTML = '';
  }

  function showFieldErrors(fieldErrors, heading = 'Review the required information') {
    clearFieldErrors();
    const labels = new Map(allDefinitions().map(definition => [definition.name, definition.label]));
    const entries = Object.entries(fieldErrors || {}).filter(([, message]) => Boolean(message));
    if (!entries.length) return;

    const listItems = entries.map(([name, message]) => {
      const control = fieldsRoot.querySelector(`[name="${name}"]`);
      const friendlyLabel = control?.labels?.[0]?.textContent.replace('*', '').trim() || labels.get(name) || name;
      if (control) {
        control.setAttribute('aria-invalid', 'true');
        const error = document.createElement('span');
        error.className = 'field-error';
        error.textContent = message;
        control.closest('.field')?.append(error);
      }
      return control?.id
        ? `<li><a href="#${control.id}">${escapeHtml(friendlyLabel)}</a>: ${escapeHtml(message)}</li>`
        : `<li>${escapeHtml(friendlyLabel)}: ${escapeHtml(message)}</li>`;
    });

    errorsRoot.innerHTML = `<h2>${escapeHtml(heading)}</h2><ul>${listItems.join('')}</ul>`;
    errorsRoot.hidden = false;
    errorsRoot.focus();
  }

  function showErrors() {
    clearFieldErrors();
    const phone = fieldsRoot.querySelector('[name="phone"]');
    const email = fieldsRoot.querySelector('[name="businessEmail"]');
    phone?.setCustomValidity('');
    email?.setCustomValidity('');
    if (!phone?.value.trim() && !email?.value.trim()) {
      phone?.setCustomValidity('Enter a mobile number or email address.');
      email?.setCustomValidity('Enter a mobile number or email address.');
    }
    const invalid = [...form.querySelectorAll(':invalid')];
    if (!invalid.length) {
      errorsRoot.hidden = true;
      return true;
    }
    invalid.forEach(control => {
      control.setAttribute('aria-invalid', 'true');
      const error = document.createElement('span');
      error.className = 'field-error';
      error.textContent = control.validationMessage || (control.validity.valueMissing ? 'This information is required.' : 'Enter a valid value.');
      control.closest('.field').append(error);
    });
    errorsRoot.innerHTML = `<h2>Review the required information</h2><ul>${invalid.map(control => `<li><a href="#${control.id}">${escapeHtml(control.labels?.[0]?.textContent.replace('*', '').trim() || 'Required field')}</a>: ${escapeHtml(control.validationMessage || 'Enter a valid value.')}</li>`).join('')}</ul>`;
    errorsRoot.hidden = false;
    errorsRoot.focus();
    return false;
  }

  function buildSummary(values, reference = 'Assigned after secure submission') {
    const params = new URLSearchParams(location.search);
    const metadata = [
      ['Lead reference', reference], ['Lead type', role === 'buyer' ? 'Buyer' : 'Seller'], ['Category', category === 'fish' ? 'Fish or seafood' : 'Spices'],
      ['Product', values.commonProduct || values.spice || 'Not provided'], ['Quantity', values.quantity || 'Not provided'], ['Unit', values.unit || 'Not provided'],
      ['Origin or seller location', role === 'seller' ? [values.locality, values.district, values.state, values.country].filter(Boolean).join(', ') : values.originPreference || 'Not specified'],
      ['Destination', role === 'buyer' ? [values.deliveryLocation, values.destinationCountry].filter(Boolean).join(', ') : values.deliveryCapability || 'To be agreed'],
      ['Source domain', config.sourceDomain], ['Source page', location.pathname.split('/').pop() || 'index.html'],
      ['Campaign source', sanitize(params.get('utm_source') || 'Direct')], ['Verification status', 'Pending'], ['Match status', 'Not reviewed'], ['Follow-up status', 'New']
    ];
    const labels = new Map(allDefinitions().map(definition => [definition.name, definition.label]));
    const details = Object.entries(values).filter(([, value]) => value).map(([key, value]) => `${labels.get(key) || key}: ${value === true ? 'Confirmed' : value}`);
    return ['FISH & SPICES - LEAD REVIEW', '', ...metadata.map(([key, value]) => `${key}: ${value}`), '', 'SUBMITTED DETAILS', ...details, '', 'Submission does not guarantee verification, matching, an introduction or a transaction.'].join('\n');
  }

  async function prepareTurnstile() {
    submitStatus.textContent = 'Loading human verification...';
    try {
      const response = await fetch('/api/v1/public-config', { headers: { accept: 'application/json' } });
      const publicConfig = await response.json();
      turnstileDevelopmentBypass = publicConfig.turnstileDevelopmentBypass === true;
      if (turnstileDevelopmentBypass) {
        turnstileToken = 'development-bypass';
        submitButton.disabled = false;
        submitStatus.textContent = 'Development verification bypass is active.';
        return;
      }
      if (!publicConfig.turnstileSiteKey || !window.turnstile) throw new Error('Turnstile is not configured');
      if (turnstileWidgetId !== null) window.turnstile.remove(turnstileWidgetId);
      turnstileWidgetId = window.turnstile.render(turnstileRoot, {
        sitekey: publicConfig.turnstileSiteKey,
        callback: token => { turnstileToken = token; submitButton.disabled = false; submitStatus.textContent = 'Human verification complete. If Cloudflare shows "Success", verification is working and you can submit securely.'; },
        'expired-callback': () => { turnstileToken = ''; submitButton.disabled = true; submitStatus.textContent = 'Human verification expired. Complete it again.'; },
        'error-callback': () => { turnstileToken = ''; submitButton.disabled = true; submitStatus.textContent = 'Human verification could not load. Please retry.'; }
      });
      submitStatus.textContent = 'Complete Cloudflare human verification to submit.';
    } catch {
      submitStatus.textContent = 'Secure submission is not configured in this environment. Your entered information remains in this page.';
    }
  }

  picker.addEventListener('click', event => {
    const button = event.target.closest('button[data-category]');
    if (button) selectCategory(button.dataset.category);
  });

  fieldsRoot.addEventListener('click', event => {
    const button = event.target.closest('[data-use-device-location]');
    if (button) requestDeviceLocation(button);
  });

  form.addEventListener('input', () => {
    if (generated) {
      generated = false;
      confirmButton.disabled = false;
      review.hidden = true;
      document.querySelectorAll('.progress-bar li').forEach((item, index) => item.classList.toggle('is-active', index < 2));
    }
  });

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!showErrors()) return;
    reviewValues = collectValues();
    summaryOutput.textContent = buildSummary(reviewValues);
    referenceOutput.textContent = 'Not submitted';
    whatsappLink.hidden = true;
    submitButton.hidden = false;
    submitButton.disabled = true;
    submitStatus.textContent = '';
    review.hidden = false;
    generated = true;
    confirmButton.disabled = true;
    document.querySelectorAll('.progress-bar li').forEach(item => item.classList.add('is-active'));
    review.scrollIntoView({ behavior: 'smooth', block: 'start' });
    review.focus({ preventScroll: true });
    prepareTurnstile();
  });

  submitButton.addEventListener('click', async () => {
    if (!reviewValues || !turnstileToken) return;
    submitButton.disabled = true;
    submitStatus.textContent = 'Saving your enquiry securely...';
    const params = new URLSearchParams(location.search);
    const payload = {
      ...Object.fromEntries(Object.entries(reviewValues).filter(([key]) => !locationFormFields.has(key))),
      location: buildLocationPayload(reviewValues), role, category, formStartedAt, submissionId, turnstileToken,
      websiteUrl: form.querySelector('[name="websiteUrl"]')?.value || '',
      sourceDomain: config.sourceDomain, sourcePage: location.pathname, referrer: document.referrer,
      utmSource: params.get('utm_source') || '', utmMedium: params.get('utm_medium') || '', utmCampaign: params.get('utm_campaign') || ''
    };
    try {
      const response = await fetch('/api/v1/leads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      let result = {};
      try {
        result = await response.json();
      } catch {
        result = {};
      }
      if (!response.ok || !result.success) {
        const apiError = new Error(result.error || 'Submission failed.');
        apiError.fields = result.fields || null;
        throw apiError;
      }
      referenceOutput.textContent = result.reference;
      summaryOutput.textContent = buildSummary(reviewValues, result.reference);
      whatsappLink.href = `https://wa.me/${config.whatsappNumber}?text=${encodeURIComponent(`Hello Fish & Spices. I submitted enquiry ${result.reference} and would like to follow up.`)}`;
      whatsappLink.hidden = false;
      review.querySelector('[data-track]')?.removeAttribute('hidden');
      review.querySelector('[data-continue]')?.removeAttribute('hidden');
      submitButton.hidden = true;
      submitStatus.textContent = 'Enquiry saved. No account was created for you to remember. Track it later by verifying your mobile number or email.';
    } catch (error) {
      submitStatus.textContent = error.message || 'Submission failed. Your information remains available for retry.';
      if (error?.fields && typeof error.fields === 'object') {
        review.hidden = true;
        generated = false;
        confirmButton.disabled = false;
        showFieldErrors(error.fields, 'Review and update these fields');
      }
      turnstileToken = '';
      submitButton.disabled = true;
      if (turnstileDevelopmentBypass) {
        turnstileToken = 'development-bypass';
        submitButton.disabled = false;
      } else if (turnstileWidgetId !== null) window.turnstile.reset(turnstileWidgetId);
    }
  });

  review.querySelector('[data-edit]').addEventListener('click', () => {
    review.hidden = true;
    generated = false;
    confirmButton.disabled = false;
    form.querySelector('input, select, textarea')?.focus();
  });

  const requestedCategory = new URLSearchParams(location.search).get('category');
  fetch('/api/v1/public-config', { headers: { accept: 'application/json' } }).then(response => response.json()).then(publicConfig => {
    approximateLocation = publicConfig.approximateLocation || null;
    applyApproximateDefaults();
  }).catch(() => {});
  if (requestedCategory === 'fish' || requestedCategory === 'spices') selectCategory(requestedCategory);
})();
