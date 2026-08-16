(() => {
  const page = document.body.dataset.partnerPage;
  const rootStatus = document.querySelector('[data-partner-status]');

  const formatMoney = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value || 0));
  const formatDate = value => value ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '-';

  async function fetchCustomerSession() {
    const response = await fetch('/api/v1/customer-auth/session', { credentials: 'same-origin', headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error('Sign in required in your account session to view partner pages.');
    return response.json();
  }

  async function api(path) {
    const response = await fetch(`/api/v1/partner${path}`, { credentials: 'same-origin', headers: { accept: 'application/json' } });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Request failed.');
    return result;
  }

  function renderDashboard(payload) {
    const hero = document.querySelector('[data-partner-hero]');
    const summary = document.querySelector('[data-partner-summary]');
    const activity = document.querySelector('[data-partner-activity]');
    if (!hero || !summary || !activity) return;

    hero.innerHTML = `<p class="eyebrow">Partner profile</p><h1>${payload.partner.displayName}</h1><p>Code: ${payload.partner.partnerCode} · Status: ${payload.partner.status} · Type: ${payload.partner.partnerType}</p>`;

    const cards = [
      ['Clicks', payload.performance.clicks],
      ['Registrations', payload.performance.registrations],
      ['Verified users', payload.performance.otpVerified],
      ['Transactions', payload.performance.transactions],
      ['Pending', formatMoney(payload.performance.pending)],
      ['Payable', formatMoney(payload.performance.payable)],
      ['Paid', formatMoney(payload.performance.paid)],
      ['Lifetime', formatMoney(payload.performance.lifetime)]
    ];

    summary.innerHTML = cards.map(([label, value]) => `<article><span>${label}</span><strong>${value}</strong></article>`).join('');

    activity.innerHTML = `
      <div class="partner-table-wrap">
        <table class="partner-table">
          <thead><tr><th>Date</th><th>Activity</th><th>Amount</th><th>Status</th></tr></thead>
          <tbody>
            ${payload.commissions.ledger.map(item => `<tr><td>${formatDate(item.date)}</td><td>${item.activity}</td><td>${formatMoney(item.amount)}</td><td><span class="partner-pill">${item.status}</span></td></tr>`).join('') || '<tr><td colspan="4">No commission activity yet.</td></tr>'}
          </tbody>
        </table>
      </div>`;
  }

  function renderReferrals(payload) {
    const summary = document.querySelector('[data-referral-summary]');
    const table = document.querySelector('[data-referral-table]');
    if (!summary || !table) return;

    summary.innerHTML = `<article><span>Total referrals</span><strong>${payload.total}</strong></article><article><span>Page</span><strong>${payload.page}</strong></article>`;

    table.innerHTML = payload.referrals.map(item => `<tr>
      <td>${item.referredUserId}</td>
      <td>${item.userRole || '-'}</td>
      <td>${formatDate(item.registrationTimestamp)}</td>
      <td>${item.otpVerifiedAt ? 'Yes' : 'No'}</td>
      <td><span class="partner-pill">${item.qualificationStatus}</span></td>
      <td>${[item.city, item.region, item.countryCode].filter(Boolean).join(', ') || '-'}</td>
    </tr>`).join('') || '<tr><td colspan="6">No referrals yet.</td></tr>';
  }

  function renderEarnings(payload) {
    const summary = document.querySelector('[data-earnings-summary]');
    const table = document.querySelector('[data-earnings-table]');
    if (!summary || !table) return;

    summary.innerHTML = `
      <article><span>Pending</span><strong>${formatMoney(payload.summary.pending)}</strong></article>
      <article><span>Approved</span><strong>${formatMoney(payload.summary.approved)}</strong></article>
      <article><span>Payable</span><strong>${formatMoney(payload.summary.payable)}</strong></article>
      <article><span>Paid</span><strong>${formatMoney(payload.summary.paid)}</strong></article>`;

    table.innerHTML = payload.ledger.map(item => `<tr>
      <td>${formatDate(item.date)}</td>
      <td>${item.activity}</td>
      <td>${item.referredUserId || '-'}</td>
      <td>${formatMoney(item.amount)}</td>
      <td><span class="partner-pill">${item.status}</span></td>
    </tr>`).join('') || '<tr><td colspan="5">No earnings events yet.</td></tr>';
  }

  (async () => {
    try {
      await fetchCustomerSession();

      if (page === 'dashboard') {
        const payload = await api('/dashboard');
        renderDashboard(payload);
      }

      if (page === 'referrals') {
        const payload = await api('/referrals?page=1&pageSize=100');
        renderReferrals(payload);
      }

      if (page === 'earnings') {
        const payload = await api('/earnings?page=1&pageSize=100');
        renderEarnings(payload);
      }

      if (rootStatus) rootStatus.textContent = '';
    } catch (error) {
      if (rootStatus) rootStatus.textContent = error.message;
    }
  })();
})();
