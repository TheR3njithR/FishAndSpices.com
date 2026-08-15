(() => {
  const authPanel = document.querySelector('[data-auth-panel]');
  const challengeForm = document.querySelector('[data-challenge-form]');
  const verifyForm = document.querySelector('[data-verify-form]');
  const authStatus = document.querySelector('[data-auth-status]');
  const dashboard = document.querySelector('[data-dashboard]');
  const dashboardStatus = document.querySelector('[data-dashboard-status]');
  const history = document.querySelector('[data-lead-history]');
  let challengeId = '';
  let csrfToken = '';
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);

  const setStatus = (element, message, error = false) => {
    element.textContent = message;
    element.classList.toggle('is-error', error);
  };

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin',
      ...options,
      headers: { accept: 'application/json', ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) }
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'The request could not be completed.');
    return result;
  }

  function renderLeads(leads) {
    if (!leads.length) {
      history.innerHTML = '<div class="history-empty"><h3>No enquiries found</h3><p>Submit a buying requirement or selling offer, then verify the same contact to see it here.</p></div>';
      return;
    }
    history.innerHTML = leads.map(lead => `<article class="history-item">
      <div><span class="history-label">${escapeHtml(lead.type)}</span><h3>${escapeHtml(lead.product)}</h3><span>${escapeHtml(lead.reference)}</span></div>
      <div><span class="history-label">Quantity</span><span class="history-value">${escapeHtml(lead.quantity)} ${escapeHtml(lead.unit)}</span></div>
      <div><span class="history-label">Current status</span><span class="history-value history-status">${escapeHtml(lead.status)}</span>${lead.requestedNextAction ? `<small>${escapeHtml(lead.requestedNextAction)}</small>` : ''}</div>
    </article>`).join('');
  }

  async function loadDashboard() {
    const session = await api('/api/v1/customer-auth/session');
    csrfToken = session.csrfToken;
    document.querySelector('[data-verification-level]').textContent = `Verification level: ${session.verificationLevel}`;
    const result = await api('/api/v1/me/leads');
    renderLeads(result.leads);
    authPanel.hidden = true;
    dashboard.hidden = false;
  }

  challengeForm.addEventListener('change', () => {
    const input = challengeForm.elements.destination;
    input.value = '';
    input.type = challengeForm.elements.type.value === 'email' ? 'email' : 'tel';
    input.inputMode = challengeForm.elements.type.value === 'email' ? 'email' : 'tel';
  });

  challengeForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!challengeForm.reportValidity()) return;
    setStatus(authStatus, 'Requesting a secure one-time code...');
    try {
      const result = await api('/api/v1/customer-auth/challenges', {
        method: 'POST',
        body: JSON.stringify({ type: challengeForm.elements.type.value, destination: challengeForm.elements.destination.value, purpose: 'sign_in' })
      });
      challengeId = result.challengeId;
      if (!result.deliveryAvailable) {
        setStatus(authStatus, 'Code delivery is not configured yet. Your enquiry remains safe, but passwordless tracking is unavailable until a provider is connected.', true);
        return;
      }
      document.querySelector('[data-masked-destination]').textContent = `Code sent to ${result.maskedDestination}`;
      challengeForm.hidden = true;
      verifyForm.hidden = false;
      verifyForm.elements.code.focus();
      setStatus(authStatus, 'Enter the code before it expires.');
      if (result.testCode) setStatus(authStatus, `Local development code: ${result.testCode}`);
    } catch (error) {
      setStatus(authStatus, error.message, true);
    }
  });

  verifyForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!verifyForm.reportValidity()) return;
    setStatus(authStatus, 'Verifying securely...');
    try {
      const result = await api('/api/v1/customer-auth/verify', {
        method: 'POST', body: JSON.stringify({ challengeId, code: verifyForm.elements.code.value })
      });
      csrfToken = result.csrfToken;
      await loadDashboard();
      setStatus(dashboardStatus, result.claimedRecords ? `${result.claimedRecords} eligible earlier enquiry record(s) linked.` : 'Contact verified.');
    } catch (error) {
      verifyForm.elements.code.select();
      setStatus(authStatus, error.message, true);
    }
  });

  document.querySelector('[data-start-over]').addEventListener('click', () => {
    challengeId = '';
    verifyForm.reset();
    verifyForm.hidden = true;
    challengeForm.hidden = false;
    setStatus(authStatus, '');
    challengeForm.elements.destination.focus();
  });

  document.querySelector('[data-claim-history]').addEventListener('click', async () => {
    try {
      const result = await api('/api/v1/me/claim-history', { method: 'POST', body: '{}', headers: { 'x-csrf-token': csrfToken } });
      setStatus(dashboardStatus, `${result.linkedRecords} eligible record(s) linked. ${result.claimsNeedingReview ? `${result.claimsNeedingReview} sent for administrator review.` : ''}`);
      const leads = await api('/api/v1/me/leads');
      renderLeads(leads.leads);
    } catch (error) {
      setStatus(dashboardStatus, error.message, true);
    }
  });

  document.querySelector('[data-logout]').addEventListener('click', async () => {
    try {
      await api('/api/v1/customer-auth/logout', { method: 'POST', body: '{}', headers: { 'x-csrf-token': csrfToken } });
    } finally {
      csrfToken = '';
      dashboard.hidden = true;
      authPanel.hidden = false;
      challengeForm.hidden = false;
      verifyForm.hidden = true;
      challengeForm.reset();
      setStatus(authStatus, 'Signed out.');
    }
  });

  loadDashboard().catch(() => {
    authPanel.hidden = false;
    dashboard.hidden = true;
  });
})();
