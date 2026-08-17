const resultsRoot = document.querySelector('[data-marketplace-results]');
const summaryRoot = document.querySelector('[data-results-summary]');
const detailRoot = document.querySelector('[data-listing-detail]');
const form = document.querySelector('[data-browser-search]');
const roleFilter = document.querySelector('[data-role-filter]');
const categoryFilter = document.querySelector('[data-category-filter]');
const params = new URLSearchParams(window.location.search);
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);

function updateUrl(next = {}) {
  const nextParams = new URLSearchParams(window.location.search);
  Object.entries(next).forEach(([key, value]) => value ? nextParams.set(key, value) : nextParams.delete(key));
  nextParams.delete('listing');
  window.location.assign(`marketplace.html${nextParams.toString() ? `?${nextParams}` : ''}`);
}

function listingLink(listing) { return `marketplace.html?role=${encodeURIComponent(listing.role)}&listing=${encodeURIComponent(listing.slug)}`; }

function renderResults(listings, total) {
  if (!listings.length) { resultsRoot.innerHTML = '<div class="homepage-empty"><strong>No public listings match this search.</strong><p>Try another product or browse all categories.</p><a class="homepage-button homepage-button-secondary" href="marketplace.html">Clear search</a></div>'; return; }
  summaryRoot.textContent = `${total} public ${total === 1 ? 'listing' : 'listings'} found`;
  resultsRoot.innerHTML = listings.map(listing => `<article class="marketplace-result-card"><span class="activity-badge activity-badge-${listing.role === 'buyer' ? 'buyer' : 'seller'}">${listing.role === 'buyer' ? 'Buyer Requirement' : 'Seller Listing'}</span><h2>${escapeHtml(listing.title)}</h2><dl><div><dt>Quantity</dt><dd>${escapeHtml(listing.quantity)} ${escapeHtml(listing.unit)}</dd></div><div><dt>Location</dt><dd>${escapeHtml(listing.location || listing.country || 'Shared on enquiry')}</dd></div></dl><a class="homepage-button homepage-button-secondary" href="${listingLink(listing)}">View Details</a></article>`).join('');
}

function renderDetail(listing) {
  if (!listing) return;
  detailRoot.hidden = false;
  detailRoot.innerHTML = `<a href="marketplace.html" class="marketplace-back">Back to results</a><span class="activity-badge activity-badge-${listing.role === 'buyer' ? 'buyer' : 'seller'}">${listing.role === 'buyer' ? 'Buyer Requirement' : 'Seller Listing'}</span><h2>${escapeHtml(listing.title)}</h2><p>${escapeHtml(listing.product)} | ${escapeHtml(listing.quantity)} ${escapeHtml(listing.unit)} | ${escapeHtml(listing.location || listing.country || 'Location shared on enquiry')}</p><p>This public summary does not include contact details. Sign in to use the platform's protected contact workflow.</p><a class="homepage-button homepage-button-primary" href="account.html">Sign in to continue</a>`;
}

async function load() {
  const requestParams = new URLSearchParams({ pageSize: '24', sort: 'newest' });
  ['q', 'role', 'category'].forEach(key => { if (params.get(key)) requestParams.set(key, params.get(key)); });
  const [categoriesResponse, listingsResponse] = await Promise.all([fetch('/api/v1/categories'), fetch(`/api/v1/marketplace?${requestParams}`)]);
  if (!categoriesResponse.ok || !listingsResponse.ok) throw new Error('Marketplace unavailable');
  const [categoriesData, listingsData] = await Promise.all([categoriesResponse.json(), listingsResponse.json()]);
  categoryFilter.insertAdjacentHTML('beforeend', (categoriesData.categories || []).map(category => `<option value="${escapeHtml(category.slug)}">${escapeHtml(category.name)}</option>`).join(''));
  roleFilter.value = params.get('role') || ''; categoryFilter.value = params.get('category') || ''; form.q.value = params.get('q') || '';
  renderResults(listingsData.listings || [], listingsData.pagination?.total || 0);
  const slug = params.get('listing');
  if (slug && params.get('role')) { const response = await fetch(`/api/v1/${params.get('role') === 'buyer' ? 'buyer-requirements' : 'seller-listings'}/${encodeURIComponent(slug)}`); if (response.ok) renderDetail((await response.json()).listing); }
}

form?.addEventListener('submit', event => { event.preventDefault(); updateUrl({ q: new FormData(form).get('q')?.toString().trim() }); });
roleFilter?.addEventListener('change', () => updateUrl({ role: roleFilter.value }));
categoryFilter?.addEventListener('change', () => updateUrl({ category: categoryFilter.value }));
load().catch(() => { resultsRoot.innerHTML = '<p class="homepage-empty">Marketplace activity is temporarily unavailable. Please try again shortly.</p>'; });