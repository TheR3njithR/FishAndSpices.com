const categoryGrid = document.querySelector('[data-category-grid]');
const activityGrid = document.querySelector('[data-marketplace-activity]');
const searchForm = document.querySelector('[data-marketplace-search]');

const categoryDescriptions = {
  fish: 'Fresh, chilled and dry fish',
  seafood: 'Fresh, chilled and dry fish',
  spices: 'Whole and ground spices',
  'farm-produce': 'Fruits, vegetables and more',
  bulk: 'For bulk and export buyers'
};

const imageForCategory = (slug, index) => {
  if (/fish|seafood/i.test(slug)) return 'assets/images/fish-sorting.jpg';
  return index % 2 ? 'assets/images/commercial-spices.jpg' : 'assets/images/spice-sorting.jpg';
};

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);

function relativeTime(value) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'Recently added';
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function listingUrl(listing) {
  return `marketplace.html?role=${encodeURIComponent(listing.role)}&listing=${encodeURIComponent(listing.slug)}`;
}

function renderCategories(categories) {
  if (!categoryGrid) return;
  if (!categories.length) {
    categoryGrid.innerHTML = '<p class="homepage-empty">Marketplace categories will appear here when they are available.</p>';
    return;
  }
  categoryGrid.innerHTML = categories.slice(0, 5).map((category, index) => `
    <a class="homepage-category-card" href="marketplace.html?category=${encodeURIComponent(category.slug)}" data-home-event="category_clicked" data-category="${escapeHtml(category.slug)}">
      <img src="${imageForCategory(category.slug, index)}" alt="" loading="lazy">
      <span class="homepage-category-number">0${index + 1}</span>
      <strong>${escapeHtml(category.name)}</strong>
      <small>${escapeHtml(categoryDescriptions[category.slug] || `${category.productCount || 0} products to explore`)}</small>
    </a>`).join('');
}

function renderActivity(listings) {
  if (!activityGrid) return;
  if (!listings.length) {
    activityGrid.innerHTML = '<div class="homepage-empty"><strong>No public marketplace activity yet.</strong><p>Browse categories or post a requirement to begin.</p><a class="homepage-button homepage-button-primary" href="buy.html">Post Requirement</a></div>';
    return;
  }
  activityGrid.innerHTML = listings.slice(0, 4).map(listing => {
    const isBuyer = listing.role === 'buyer';
    const heading = isBuyer ? 'Looking to buy' : 'Available now';
    const location = listing.location || listing.country || 'Location shared on enquiry';
    return `<article class="marketplace-activity-card">
      <div class="activity-card-top"><span class="activity-badge activity-badge-${isBuyer ? 'buyer' : 'seller'}">${isBuyer ? 'Buyer Requirement' : 'Seller Listing'}</span><time datetime="${escapeHtml(listing.publishedAt)}">${relativeTime(listing.publishedAt)}</time></div>
      <p>${heading}</p><h3>${escapeHtml(listing.title)}</h3>
      <span class="activity-location">${escapeHtml(location)}</span>
      <a href="${listingUrl(listing)}" data-home-event="${isBuyer ? 'requirement_viewed' : 'listing_viewed'}">View Details</a>
    </article>`;
  }).join('');
}

async function loadHomepageData() {
  const [categoriesResponse, marketplaceResponse] = await Promise.all([
    fetch('/api/v1/categories', { headers: { accept: 'application/json' } }),
    fetch('/api/v1/marketplace?pageSize=4&sort=newest', { headers: { accept: 'application/json' } })
  ]);
  if (!categoriesResponse.ok || !marketplaceResponse.ok) throw new Error('Marketplace data is unavailable.');
  const [categoriesData, marketplaceData] = await Promise.all([categoriesResponse.json(), marketplaceResponse.json()]);
  renderCategories(categoriesData.categories || []);
  renderActivity(marketplaceData.listings || []);
}

searchForm?.addEventListener('submit', event => {
  event.preventDefault();
  const query = new FormData(searchForm).get('q')?.toString().trim();
  window.location.assign(query ? `marketplace.html?q=${encodeURIComponent(query)}` : 'marketplace.html');
});

document.addEventListener('click', event => {
  const target = event.target.closest('[data-home-event]');
  if (!target) return;
  document.dispatchEvent(new CustomEvent('fishandspices:marketplace-action', {
    detail: { action: target.dataset.homeEvent, category: target.dataset.category || null }
  }));
});

loadHomepageData().catch(() => {
  if (categoryGrid) categoryGrid.innerHTML = '<p class="homepage-empty">Categories are temporarily unavailable. Please try again shortly.</p>';
  if (activityGrid) activityGrid.innerHTML = '<p class="homepage-empty">Marketplace activity is temporarily unavailable. Please try again shortly.</p>';
});