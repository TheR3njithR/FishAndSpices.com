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
  const emailLink = review.querySelector('[data-email]');
  let category = '';
  let generated = false;

  const buyerTypes = ['Importer', 'Exporter seeking supply', 'Distributor', 'Wholesaler', 'Restaurant or hotel', 'Supermarket', 'Food manufacturer', 'Seafood processor', 'Spice processor', 'Private-label company', 'Institutional buyer', 'Trading company', 'Other'];
  const sellerTypes = ['Farmer', 'Fish farmer', 'Fishermen group', 'Aquaculture farm', 'Farmer organisation', 'Aggregator', 'Processor', 'Packer', 'Cold-storage operator', 'Wholesaler', 'Licensed exporter', 'Trading company', 'Other'];
  const yesNo = ['Yes', 'No', 'Not sure'];
  const units = ['kg', 'metric tonnes', 'pieces', 'cartons', 'bags', 'litres', 'Other'];

  const field = (name, label, options = {}) => ({ name, label, type: 'text', ...options });
  const section = (title, description, fields) => ({ title, description, fields });

  const sharedBuyer = [
    section('Buyer and company', 'Tell us who is responsible for this commercial requirement.', [
      field('fullName', 'Full name', { required: true }), field('jobTitle', 'Job title', { required: true }),
      field('companyName', 'Company name', { required: true }), field('buyerType', 'Buyer type', { type: 'select', required: true, options: buyerTypes }),
      field('businessEmail', 'Business email', { type: 'email', required: true }), field('phone', 'WhatsApp or telephone', { type: 'tel', required: true }),
      field('website', 'Company website', { type: 'url', hint: 'Optional' }), field('country', 'Country', { required: true }), field('city', 'City', { required: true })
    ]),
    section('Commercial requirement', 'Define the purchasing context and intended destination.', [
      field('productCategory', 'Product category', { value: () => category === 'fish' ? 'Fish or seafood' : 'Spices', readonly: true, required: true }),
      field('commercialPurpose', 'Commercial purpose', { type: 'select', required: true, options: ['Import and distribution', 'Processing', 'Food service', 'Retail supply', 'Manufacturing', 'Private label', 'Re-export', 'Institutional procurement', 'Other'] }),
      field('purchaseFrequency', 'Purchase frequency', { type: 'select', required: true, options: ['One-time requirement', 'Weekly', 'Monthly', 'Quarterly', 'Seasonal', 'To be confirmed'] }),
      field('destinationCountry', 'Destination country', { required: true }), field('deliveryLocation', 'Delivery city or port', { required: true }),
      field('requiredDate', 'Required date', { type: 'date', required: true }), field('incoterm', 'Preferred Incoterm', { type: 'select', required: true, options: ['EXW', 'FCA', 'FOB', 'CFR', 'CIF', 'DAP', 'DDP', 'Not decided'] }),
      field('sampleRequirement', 'Sample requirement', { type: 'select', required: true, options: yesNo }), field('inspectionRequirement', 'Inspection requirement', { type: 'select', required: true, options: yesNo }),
      field('additionalNotes', 'Additional notes', { type: 'textarea', wide: true })
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
      field('phone', 'WhatsApp or telephone', { type: 'tel', required: true }), field('website', 'Website or social profile', { type: 'url' }),
      field('country', 'Country', { required: true }), field('state', 'State', { required: true }), field('district', 'District', { required: true }), field('locality', 'Locality', { required: true }),
      field('registrationStatus', 'Business-registration status', { type: 'select', required: true, options: ['Registered', 'Not registered', 'Application in progress', 'Not applicable'] }),
      field('licenceStatus', 'Relevant licence status', { type: 'select', required: true, options: ['Current', 'Not held', 'Application in progress', 'Not sure'] }),
      field('gstStatus', 'GST status where applicable', { type: 'select', required: true, options: ['Registered', 'Not registered', 'Not applicable'] }),
      field('exportCapability', 'Export capability', { type: 'select', required: true, options: ['Direct exporter', 'Supply through exporter', 'Domestic supply only', 'To be assessed'] })
    ]),
    section('Commercial availability', 'Provide current, supportable availability rather than an estimate presented as guaranteed stock.', [
      field('productCategory', 'Product category', { value: () => category === 'fish' ? 'Fish or seafood' : 'Spices', readonly: true, required: true }),
      field('availabilityDate', 'Current availability date', { type: 'date', required: true }), field('minimumOrder', 'Minimum order', { required: true }),
      field('deliveryCapability', 'Delivery capability', { type: 'textarea', required: true }), field('paymentTerms', 'Payment-term expectation', { required: true }),
      field('additionalNotes', 'Additional notes', { type: 'textarea', wide: true })
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
    field('commercialDeclaration', 'I confirm this is a genuine commercial enquiry and the information supplied is accurate to the best of my knowledge.', { type: 'checkbox', required: true, wide: true })
  ] : [
    field('accuracyDeclaration', 'I confirm the availability and business information supplied is accurate to the best of my knowledge.', { type: 'checkbox', required: true, wide: true }),
    field('privacyConsent', 'I consent to private review of these details for lead qualification and potential introductions under the Privacy Notice.', { type: 'checkbox', required: true, wide: true })
  ];

  const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
  const sanitize = (value) => String(value ?? '').replace(/[^\P{C}\n\t]/gu, '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 1000);
  const inputId = name => `lead-${name}`;

  function renderField(definition) {
    const required = definition.required ? ' required' : '';
    const requiredMark = definition.required ? ' <span class="required-mark" aria-hidden="true">*</span>' : '';
    const wide = definition.wide ? ' field-wide' : '';
    const hint = definition.hint ? `<span class="field-hint" id="${inputId(definition.name)}-hint">${escapeHtml(definition.hint)}</span>` : '';
    const describedBy = definition.hint ? ` aria-describedby="${inputId(definition.name)}-hint"` : '';
    if (definition.type === 'checkbox') {
      return `<div class="field check-field${wide}"><input id="${inputId(definition.name)}" name="${definition.name}" type="checkbox"${required}><label for="${inputId(definition.name)}">${escapeHtml(definition.label)}${requiredMark}</label></div>`;
    }
    let control;
    if (definition.type === 'select') {
      control = `<select id="${inputId(definition.name)}" name="${definition.name}"${required}${describedBy}><option value="">Select an option</option>${definition.options.map(option => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join('')}</select>`;
    } else if (definition.type === 'textarea') {
      control = `<textarea id="${inputId(definition.name)}" name="${definition.name}"${required}${describedBy}></textarea>`;
    } else {
      const value = definition.value ? ` value="${escapeHtml(definition.value())}"` : '';
      const readonly = definition.readonly ? ' readonly' : '';
      const min = definition.min ? ` min="${definition.min}"` : '';
      const step = definition.step ? ` step="${definition.step}"` : '';
      control = `<input id="${inputId(definition.name)}" name="${definition.name}" type="${definition.type}"${value}${readonly}${required}${min}${step}${describedBy}>`;
    }
    return `<div class="field${wide}"><label for="${inputId(definition.name)}">${escapeHtml(definition.label)}${requiredMark}</label>${control}${hint}</div>`;
  }

  function renderSection(definition) {
    return `<section class="form-section" aria-labelledby="section-${definition.title.replace(/\W+/g, '-').toLowerCase()}"><div class="form-section-head"><h2 id="section-${definition.title.replace(/\W+/g, '-').toLowerCase()}">${escapeHtml(definition.title)}</h2><p>${escapeHtml(definition.description)}</p></div><div class="field-grid">${definition.fields.map(renderField).join('')}</div></section>`;
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
    confirmButton.disabled = false;
    errorsRoot.hidden = true;
    workspace.scrollIntoView({ behavior: 'smooth', block: 'start' });
    fieldsRoot.querySelector('input, select, textarea')?.focus({ preventScroll: true });
    document.querySelector('[data-selection-status]').textContent = `${role === 'buyer' ? 'Buying' : 'Selling'} ${category === 'fish' ? 'fish or seafood' : 'spices'} selected. Relevant fields are now available.`;
  }

  function collectValues() {
    const values = {};
    new FormData(form).forEach((value, key) => { values[key] = sanitize(value); });
    fieldsRoot.querySelectorAll('input[type="checkbox"]').forEach(input => { values[input.name] = input.checked ? 'Confirmed' : 'Not confirmed'; });
    return values;
  }

  function leadReference() {
    const now = new Date();
    const stamp = now.toISOString().replace(/\D/g, '').slice(2, 14);
    const random = crypto.getRandomValues(new Uint32Array(1))[0].toString(36).slice(0, 4).toUpperCase().padStart(4, '0');
    return `FS-${role === 'buyer' ? 'B' : 'S'}-${category === 'fish' ? 'F' : 'S'}-${stamp}-${random}`;
  }

  function allDefinitions() {
    const shared = role === 'buyer' ? sharedBuyer : sharedSeller;
    const specific = role === 'buyer' ? (category === 'fish' ? fishBuyer : spiceBuyer) : (category === 'fish' ? fishSeller : spiceSeller);
    return [...shared.flatMap(item => item.fields), ...specific.fields, ...declarations];
  }

  function showErrors() {
    fieldsRoot.querySelectorAll('.field-error').forEach(error => error.remove());
    fieldsRoot.querySelectorAll('[aria-invalid]').forEach(control => control.removeAttribute('aria-invalid'));
    const invalid = [...form.querySelectorAll(':invalid')];
    if (!invalid.length) {
      errorsRoot.hidden = true;
      return true;
    }
    invalid.forEach(control => {
      control.setAttribute('aria-invalid', 'true');
      const error = document.createElement('span');
      error.className = 'field-error';
      error.textContent = control.validity.valueMissing ? 'This information is required.' : 'Enter a valid value.';
      control.closest('.field').append(error);
    });
    errorsRoot.innerHTML = `<h2>Review the required information</h2><ul>${invalid.map(control => `<li><a href="#${control.id}">${escapeHtml(control.labels?.[0]?.textContent.replace('*', '').trim() || 'Required field')}</a></li>`).join('')}</ul>`;
    errorsRoot.hidden = false;
    errorsRoot.focus();
    return false;
  }

  function buildSummary(values, reference) {
    const params = new URLSearchParams(location.search);
    const metadata = [
      ['Lead reference', reference], ['Lead type', role === 'buyer' ? 'Buyer' : 'Seller'], ['Category', category === 'fish' ? 'Fish or seafood' : 'Spices'],
      ['Product', values.commonProduct || values.spice || 'Not provided'], ['Quantity', values.quantity || 'Not provided'], ['Unit', values.unit || 'Not provided'],
      ['Origin or seller location', role === 'seller' ? [values.locality, values.district, values.state, values.country].filter(Boolean).join(', ') : values.originPreference || 'Not specified'],
      ['Destination', role === 'buyer' ? [values.deliveryLocation, values.destinationCountry].filter(Boolean).join(', ') : values.deliveryCapability || 'To be agreed'],
      ['Submission timestamp', new Date().toISOString()], ['Source domain', config.sourceDomain], ['Source page', location.pathname.split('/').pop() || 'index.html'],
      ['Campaign source', sanitize(params.get('utm_source') || 'Direct')], ['Verification status', 'Pending'], ['Match status', 'Not reviewed'], ['Follow-up status', 'New']
    ];
    const labels = new Map(allDefinitions().map(definition => [definition.name, definition.label]));
    const details = Object.entries(values).filter(([, value]) => value).map(([key, value]) => `${labels.get(key) || key}: ${value}`);
    return ['FISH & SPICES - PROVISIONAL LEAD REVIEW', '', ...metadata.map(([key, value]) => `${key}: ${value}`), '', 'SUBMITTED DETAILS', ...details, '', 'This provisional reference confirms only that a review summary was generated. It is not verification, acceptance, matching or a transaction guarantee.'].join('\n');
  }

  picker.addEventListener('click', event => {
    const button = event.target.closest('button[data-category]');
    if (button) selectCategory(button.dataset.category);
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
    const values = collectValues();
    const reference = leadReference();
    const summary = buildSummary(values, reference);
    summaryOutput.textContent = summary;
    referenceOutput.textContent = reference;
    whatsappLink.href = `https://wa.me/${config.whatsappNumber}?text=${encodeURIComponent(summary)}`;
    emailLink.href = `mailto:${config.businessEmail}?subject=${encodeURIComponent(`${reference} - ${role} ${category} lead`)}&body=${encodeURIComponent(summary)}`;
    review.hidden = false;
    generated = true;
    confirmButton.disabled = true;
    document.querySelectorAll('.progress-bar li').forEach(item => item.classList.add('is-active'));
    review.scrollIntoView({ behavior: 'smooth', block: 'start' });
    review.focus({ preventScroll: true });
  });

  review.querySelector('[data-edit]').addEventListener('click', () => {
    review.hidden = true;
    generated = false;
    confirmButton.disabled = false;
    form.querySelector('input, select, textarea')?.focus();
  });

  const requestedCategory = new URLSearchParams(location.search).get('category');
  if (requestedCategory === 'fish' || requestedCategory === 'spices') selectCategory(requestedCategory);
})();
