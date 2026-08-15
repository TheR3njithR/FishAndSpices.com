(() => {
  const loginForm = document.querySelector('[data-admin-login]');
  const authPanel = document.querySelector('[data-auth-panel]');
  const dashboard = document.querySelector('[data-dashboard]');
        const authStatus = document.querySelector('[data-auth-status]');
  const identity = document.querySelector('[data-admin-identity]');
  const signOut = document.querySelector('[data-sign-out]');
  const overview = document.querySelector('[data-overview]');
  const workspaceStatus = document.querySelector('[data-workspace-status]');
  const filters = document.querySelector('[data-lead-filters]');
  const rows = document.querySelector('[data-lead-rows]');
  const detail = document.querySelector('[data-lead-detail]');
        let csrfToken = '';
        let activeUser = null;
        let selectedLeadId = '';

        const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
        const formatDate = value => value ? new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(value)) : 'Not recorded';
        const optionList = (options, selected) => options.map(value => `<option${value === selected ? ' selected' : ''}>${escapeHtml(value)}</option>`).join('');

        async function api(path, options = {}) {
          const headers = { accept: 'application/json', ...options.headers };
          if (options.body) headers['content-type'] = 'application/json';
          if (options.method && options.method !== 'GET') headers['x-csrf-token'] = csrfToken;
          const response = await fetch(`/api/v1${path}`, { credentials: 'same-origin', ...options, headers });
          const result = await response.json().catch(() => ({}));
          if (response.status === 401) showSignedOut('Your administrator session has expired. Sign in again.');
          if (!response.ok) throw new Error(result.error || 'The request could not be completed.');
          return result;
        }

        function showSignedOut(message = '') {
          csrfToken = '';
          activeUser = null;
          selectedLeadId = '';
          dashboard.hidden = true;
          signOut.hidden = true;
          authPanel.hidden = false;
          authStatus.textContent = message;
        }

        async function showDashboard(session) {
          csrfToken = session.csrfToken;
          activeUser = session.user;
          authPanel.hidden = true;
          dashboard.hidden = false;
          signOut.hidden = false;
          identity.textContent = `${activeUser.displayName} · ${activeUser.role.replace('_', ' ')}`;
          await Promise.all([loadOverview(), loadLeads()]);
        }

        async function loadOverview() {
          const { overview: counts } = await api('/admin/overview');
          const metrics = [
            ['Intake', 'New buyers', counts.newBuyers], ['Intake', 'New sellers', counts.newSellers],
            ['Verification', 'Pending checks', counts.pendingVerification], ['Follow-up', 'Due', counts.followUpsDue],
            ['Matching', 'Potential matches', counts.potentialMatches], ['Commercial', 'Introductions', counts.introductions]
          ];
          overview.innerHTML = metrics.map(([group, label, value]) => `<article><span>${escapeHtml(group)}</span><strong>${Number(value) || 0}</strong><h2>${escapeHtml(label)}</h2></article>`).join('');
        }

        async function loadLeads() {
          workspaceStatus.textContent = 'Loading leads...';
          const params = new URLSearchParams(new FormData(filters));
          [...params].forEach(([key, value]) => { if (!value) params.delete(key); });
          const { leads } = await api(`/admin/leads?${params}`);
          rows.innerHTML = leads.length ? leads.map(lead => `<tr data-lead-id="${escapeHtml(lead.id)}" tabindex="0"${lead.id === selectedLeadId ? ' class="is-selected"' : ''}><td><strong>${escapeHtml(lead.publicReference)}</strong><br>${escapeHtml(lead.role)}</td><td>${escapeHtml(lead.organisation)}<br><small>${escapeHtml(lead.country)}</small></td><td>${escapeHtml(lead.product)}<br><small>${escapeHtml(lead.quantity)} ${escapeHtml(lead.unit)}</small></td><td><span class="status-pill">${escapeHtml(lead.followUpStatus)}</span><br><small>${escapeHtml(lead.verificationStatus)}</small></td><td>${formatDate(lead.submittedAt)}</td></tr>`).join('') : '<tr><td colspan="5">No leads match these filters.</td></tr>';
          workspaceStatus.textContent = `${leads.length} lead${leads.length === 1 ? '' : 's'} shown.`;
        }

        const detailItem = (label, value) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || 'Not recorded')}</dd></div>`;

        async function loadLead(leadId) {
          selectedLeadId = leadId;
          workspaceStatus.textContent = 'Loading lead details...';
          const record = await api(`/admin/leads/${leadId}`);
          const lead = record.lead;
          rows.querySelectorAll('tr').forEach(row => row.classList.toggle('is-selected', row.dataset.leadId === leadId));
          const verificationFields = ['identity', 'organisationRegistration', 'gst', 'licence', 'certification', 'productEvidence', 'facilityEvidence', 'laboratoryEvidence', 'bankInformation'];
          detail.innerHTML = `
            <div class="lead-detail-head"><p class="eyebrow">${escapeHtml(lead.lead_role)} · ${escapeHtml(lead.category)}</p><h2 id="detail-title">${escapeHtml(lead.public_reference)}</h2><p>${escapeHtml(lead.product)} · ${escapeHtml(lead.quantity)} ${escapeHtml(lead.unit)}</p></div>
            <section class="detail-section"><h3>Contact and company</h3><dl class="detail-grid">${detailItem('Company', lead.organisation.name)}${detailItem('Contact', lead.contact.full_name)}${detailItem('Email', lead.contact.business_email)}${detailItem('Telephone', lead.contact.telephone)}${detailItem('Country', lead.organisation.country)}${detailItem('Destination', lead.destination)}</dl></section>
            <section class="detail-section"><h3>Qualification</h3><form class="admin-action-form" data-status-form><div class="form-row"><div class="field"><label>Verification</label><select name="verificationStatus">${optionList(['Pending','In review','Verified','Rejected'], lead.verification_status)}</select></div><div class="field"><label>Follow-up</label><select name="followUpStatus">${optionList(['New','Contacted','Follow-up due','Closed'], lead.follow_up_status)}</select></div></div><div class="form-row"><div class="field"><label>Match status</label><select name="matchStatus">${optionList(['Not reviewed','Potential match','Introduced','Closed'], lead.match_status)}</select></div><div class="field"><label>Priority</label><select name="priority">${optionList(['Low','Normal','High','Urgent'], lead.priority)}</select></div></div><button class="button button-dark button-small" type="submit">Save qualification</button></form></section>
            <section class="detail-section"><h3>Record interaction</h3><form class="admin-action-form" data-interaction-form><div class="form-row"><div class="field"><label>Method</label><select name="contactMethod"><option>Email</option><option>Telephone</option><option>WhatsApp</option><option>Meeting</option></select></div><div class="field"><label>Direction</label><select name="direction"><option>Outbound</option><option>Inbound</option></select></div></div><div class="field"><label>Summary</label><textarea name="summary" required></textarea></div><div class="field"><label>Next action</label><input name="nextAction"></div><div class="field"><label>Follow-up date</label><input name="followUpDate" type="datetime-local"></div><button class="button button-dark button-small" type="submit">Add interaction</button></form></section>
            <section class="detail-section"><h3>Verification check</h3><form class="admin-action-form" data-verification-form>${verificationFields.map(name => `<div class="field"><label>${escapeHtml(name.replace(/([A-Z])/g, ' $1'))}</label><select name="${name}Status">${optionList(name === 'gst' || ['licence','certification','facilityEvidence','laboratoryEvidence'].includes(name) ? ['Unchecked','Pending','Confirmed','Failed','Not applicable'] : ['Unchecked','Pending','Confirmed','Failed'], 'Unchecked')}</select></div>`).join('')}<div class="field"><label>Overall outcome</label><select name="overallOutcome">${optionList(['Pending','In review','Verified','Rejected'], lead.verification_status)}</select></div><div class="field"><label>Notes</label><textarea name="notes"></textarea></div><button class="button button-dark button-small" type="submit">Record verification</button></form></section>
            ${lead.lead_role === 'buyer' ? '<section class="detail-section"><h3>Match suggestions</h3><button class="button button-light button-small" type="button" data-find-matches>Find compatible sellers</button><div data-match-results></div></section>' : ''}
            <section class="detail-section"><h3>History</h3><p>${record.interactions.length} interaction(s) · ${record.verificationChecks.length} verification check(s) · ${record.matches.length} match record(s)</p></section>
            <section class="detail-section"><button class="button button-light button-small" type="button" data-archive-lead>Archive lead</button></section>`;
          workspaceStatus.textContent = `Opened ${lead.public_reference}.`;
        }

        async function submitForm(form, path, method = 'POST') {
          const body = Object.fromEntries(new FormData(form));
          for (const [key, value] of Object.entries(body)) if (value === '') body[key] = null;
          await api(path, { method, body: JSON.stringify(body) });
        }

        loginForm.addEventListener('submit', async event => {
          event.preventDefault();
          authStatus.textContent = 'Checking credentials...';
          const values = Object.fromEntries(new FormData(loginForm));
          try {
            const session = await api('/auth/login', { method: 'POST', body: JSON.stringify(values) });
            loginForm.reset();
            authStatus.textContent = '';
            await showDashboard(session);
          } catch (error) { authStatus.textContent = error.message; }
        });

        signOut.addEventListener('click', async () => {
          try { await api('/auth/logout', { method: 'POST', body: '{}' }); } catch { /* Local state is still cleared. */ }
          showSignedOut('Signed out securely.');
        });

        filters.addEventListener('submit', event => {
          event.preventDefault();
          loadLeads().catch(error => { workspaceStatus.textContent = error.message; });
        });
        document.querySelector('[data-refresh]').addEventListener('click', () => Promise.all([loadOverview(), loadLeads()]).catch(error => { workspaceStatus.textContent = error.message; }));
        rows.addEventListener('click', event => {
          const row = event.target.closest('[data-lead-id]');
          if (row) loadLead(row.dataset.leadId).catch(error => { workspaceStatus.textContent = error.message; });
        });
        rows.addEventListener('keydown', event => { if (event.key === 'Enter') event.target.closest('[data-lead-id]')?.click(); });

        detail.addEventListener('submit', async event => {
          event.preventDefault();
          const form = event.target;
          try {
            workspaceStatus.textContent = 'Saving...';
            if (form.matches('[data-status-form]')) await submitForm(form, `/admin/leads/${selectedLeadId}`, 'PATCH');
            if (form.matches('[data-interaction-form]')) await submitForm(form, `/admin/leads/${selectedLeadId}/interactions`);
            if (form.matches('[data-verification-form]')) await submitForm(form, `/admin/leads/${selectedLeadId}/verification`);
            await Promise.all([loadOverview(), loadLeads(), loadLead(selectedLeadId)]);
            workspaceStatus.textContent = 'Changes saved.';
          } catch (error) { workspaceStatus.textContent = error.message; }
        });

        detail.addEventListener('click', async event => {
          try {
            if (event.target.matches('[data-archive-lead]')) {
              await api(`/admin/leads/${selectedLeadId}`, { method: 'PATCH', body: JSON.stringify({ archive: true }) });
              selectedLeadId = '';
              detail.innerHTML = '<div class="empty-detail"><h2 id="detail-title">Lead archived</h2><p>Select another queue record to continue.</p></div>';
              await Promise.all([loadOverview(), loadLeads()]);
            }
            if (event.target.matches('[data-find-matches]')) {
              workspaceStatus.textContent = 'Scoring compatible sellers...';
              const { suggestions } = await api(`/admin/leads/${selectedLeadId}/match-suggestions`);
              const root = detail.querySelector('[data-match-results]');
              root.innerHTML = suggestions.length ? suggestions.map(item => `<article class="match-suggestion"><strong>${escapeHtml(item.seller.publicReference)} · ${item.score}/100</strong><p>${escapeHtml(item.conflicts.join(' ') || 'No recorded conflicts.')}</p><button class="button button-dark button-small" type="button" data-propose-match="${escapeHtml(item.seller.id)}" data-score="${item.score}">Propose match</button></article>`).join('') : '<p>No compatible seller records found.</p>';
              workspaceStatus.textContent = `${suggestions.length} compatible seller record(s) scored.`;
            }
            const proposal = event.target.closest('[data-propose-match]');
            if (proposal) {
              const sellerId = proposal.dataset.proposeMatch;
              const { suggestions } = await api(`/admin/leads/${selectedLeadId}/match-suggestions`);
              const suggestion = suggestions.find(item => item.seller.id === sellerId);
              await api('/admin/matches', { method: 'POST', body: JSON.stringify({ buyerLeadId: selectedLeadId, sellerLeadId: sellerId, score: suggestion.score, explanation: { factors: suggestion.factors, conflicts: suggestion.conflicts } }) });
              proposal.disabled = true;
              proposal.textContent = 'Match proposed';
              await Promise.all([loadOverview(), loadLeads()]);
            }
          } catch (error) { workspaceStatus.textContent = error.message; }
        });

        api('/auth/session').then(showDashboard).catch(() => showSignedOut());
})();
