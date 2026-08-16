(() => {
  const page = document.body.dataset.adminPartnerPage;
  const status = document.querySelector('[data-admin-partner-status]');

  let csrfToken = '';

  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  const formatMoney = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value || 0));

  async function session() {
    const response = await fetch('/api/v1/auth/session', { credentials: 'same-origin', headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error('Administrator sign-in required. Open /admin first.');
    const payload = await response.json();
    csrfToken = payload.csrfToken;
    return payload;
  }

  async function api(path, options = {}) {
    const headers = { accept: 'application/json', ...(options.headers || {}) };
    if (options.body) headers['content-type'] = 'application/json';
    if (options.method && options.method !== 'GET') headers['x-csrf-token'] = csrfToken;
    const response = await fetch(`/api/v1/admin/partners${path}`, {
      credentials: 'same-origin',
      ...options,
      headers
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Request failed.');
    return result;
  }

  async function renderPartnersPage() {
    const overviewEl = document.querySelector('[data-admin-overview]');
    const tableEl = document.querySelector('[data-admin-partners-table]');
    const detailEl = document.querySelector('[data-admin-partner-detail]');
    const filters = document.querySelector('[data-admin-partners-filters]');
    if (!overviewEl || !tableEl || !filters || !detailEl) return;

    const overview = await api('/overview');
    overviewEl.innerHTML = `
      <article><span>Total partners</span><strong>${overview.overview.totalPartners}</strong></article>
      <article><span>Active</span><strong>${overview.overview.activePartners}</strong></article>
      <article><span>Registrations</span><strong>${overview.overview.registrations}</strong></article>
      <article><span>Commission cost</span><strong>${formatMoney(overview.overview.commissionCost)}</strong></article>`;

    const loadPartners = async () => {
      status.textContent = 'Loading partners...';
      const params = new URLSearchParams(new FormData(filters));
      [...params.entries()].forEach(([key, value]) => {
        if (!value) params.delete(key);
      });
      const payload = await api(`/?${params.toString()}`);
      tableEl.innerHTML = payload.partners.map(partner => `<tr data-partner-id="${partner.id}">
        <td><strong>${escapeHtml(partner.displayName)}</strong><br><small>${escapeHtml(partner.partnerCode)}</small></td>
        <td>${escapeHtml(partner.partnerType)}</td>
        <td>${escapeHtml(partner.email)}</td>
        <td><span class="partner-pill">${escapeHtml(partner.status)}</span></td>
        <td>${partner.metrics.registrations}</td>
        <td>${formatMoney(partner.metrics.payable)}</td>
      </tr>`).join('') || '<tr><td colspan="6">No partners found.</td></tr>';
      status.textContent = `${payload.total} partner records.`;
    };

    tableEl.addEventListener('click', async event => {
      const row = event.target.closest('[data-partner-id]');
      if (!row) return;
      const detail = await api(`/${row.dataset.partnerId}`);
      detailEl.innerHTML = `
        <h2>${escapeHtml(detail.partner.displayName)}</h2>
        <p>Code: ${escapeHtml(detail.partner.partnerCode)} · ${escapeHtml(detail.partner.partnerType)}</p>
        <p>Email: ${escapeHtml(detail.partner.email)} · Phone: ${escapeHtml(detail.partner.phone)}</p>
        <p>Status: <span class="partner-pill">${escapeHtml(detail.partner.status)}</span></p>
        <p>Pending: ${formatMoney(detail.performance.pending)} · Payable: ${formatMoney(detail.performance.payable)} · Paid: ${formatMoney(detail.performance.paid)}</p>
        <div class="actions">
          <button class="button button-small button-dark" data-set-status="ACTIVE" data-partner-id="${detail.partner.id}">Approve</button>
          <button class="button button-small button-light" data-set-status="SUSPENDED" data-partner-id="${detail.partner.id}">Suspend</button>
          <button class="button button-small button-light" data-regenerate="${detail.partner.id}">Regenerate code</button>
        </div>`;
    });

    detailEl.addEventListener('click', async event => {
      const statusButton = event.target.closest('[data-set-status]');
      if (statusButton) {
        const partnerId = statusButton.dataset.partnerId;
        const nextStatus = statusButton.dataset.setStatus;
        await api(`/${partnerId}`, { method: 'PATCH', body: JSON.stringify({ status: nextStatus }) });
        await loadPartners();
        status.textContent = `Partner status updated to ${nextStatus}.`;
        return;
      }
      const regenerate = event.target.closest('[data-regenerate]');
      if (regenerate) {
        await api(`/${regenerate.dataset.regenerate}/regenerate-code`, { method: 'POST', body: '{}' });
        await loadPartners();
        status.textContent = 'Partner code regenerated.';
      }
    });

    filters.addEventListener('submit', async event => {
      event.preventDefault();
      await loadPartners();
    });

    await loadPartners();
  }

  async function renderSettingsPage() {
    const form = document.querySelector('[data-admin-settings-form]');
    if (!form) return;
    const payload = await api('/settings');
    for (const [key, value] of Object.entries(payload.settings)) {
      const field = form.elements.namedItem(key);
      if (field) field.value = value;
    }

    form.addEventListener('submit', async event => {
      event.preventDefault();
      status.textContent = 'Saving settings...';
      const values = Object.fromEntries(new FormData(form));
      await api('/settings', { method: 'PATCH', body: JSON.stringify(values) });
      status.textContent = 'Partner settings saved.';
    });
  }

  async function renderCommissionPlansPage() {
    const plansRoot = document.querySelector('[data-admin-commission-plans]');
    const form = document.querySelector('[data-admin-create-plan]');
    if (!plansRoot || !form) return;

    const loadPlans = async () => {
      status.textContent = 'Loading commission plans...';
      const plans = await api('/commission-plans');
      plansRoot.innerHTML = plans.plans.map(plan => `<details>
        <summary><strong>${escapeHtml(plan.name)}</strong> · ${escapeHtml(plan.status)} · ${plan.ruleCount} rules</summary>
        <p>${escapeHtml(plan.description || 'No description')}</p>
        <div data-rules-for="${plan.id}">Loading rules...</div>
      </details>`).join('') || '<p>No plans available.</p>';

      for (const container of plansRoot.querySelectorAll('[data-rules-for]')) {
        const planId = container.getAttribute('data-rules-for');
        const rules = await api(`/commission-plans/${planId}/rules`);
        container.innerHTML = `
          <div class="partner-table-wrap">
            <table class="partner-table">
              <thead><tr><th>Event</th><th>Amount</th><th>Status</th><th>Priority</th></tr></thead>
              <tbody>${rules.rules.map(rule => `<tr><td>${escapeHtml(rule.event_type)}</td><td>${formatMoney(rule.amount)}</td><td>${escapeHtml(rule.status)}</td><td>${rule.priority}</td></tr>`).join('') || '<tr><td colspan="4">No rules.</td></tr>'}</tbody>
            </table>
          </div>`;
      }

      status.textContent = `${plans.plans.length} commission plans loaded.`;
    };

    form.addEventListener('submit', async event => {
      event.preventDefault();
      status.textContent = 'Creating commission plan...';
      const values = Object.fromEntries(new FormData(form));
      await api('/commission-plans', { method: 'POST', body: JSON.stringify(values) });
      form.reset();
      await loadPlans();
      status.textContent = 'Commission plan created.';
    });

    await loadPlans();
  }

  (async () => {
    try {
      await session();
      if (page === 'partners') await renderPartnersPage();
      if (page === 'settings') await renderSettingsPage();
      if (page === 'plans') await renderCommissionPlansPage();
    } catch (error) {
      if (status) status.textContent = error.message;
    }
  })();
})();
