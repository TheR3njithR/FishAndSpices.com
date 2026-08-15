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
  const masterSets = document.querySelector('[data-master-sets]');
  const masterStatus = document.querySelector('[data-master-status]');
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
          await Promise.all([loadOverview(), loadLeads(), loadMasterData()]);
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

        async function loadMasterData() {
          if (!masterSets) return;
          masterStatus.textContent = 'Loading master data...';
          const { sets } = await api('/admin/options');
          masterSets.innerHTML = sets.map(set => `
            <details class="master-set"><summary>${escapeHtml(set.label)} <small>(${set.options.filter(option => option.isActive).length}/${set.options.length} active)</small></summary>
              <div class="master-table-wrap"><table class="master-table"><thead><tr><th>Label</th><th>Value</th><th>Sort</th><th>Active</th><th></th></tr></thead><tbody>
              ${set.options.map(option => `<tr data-option-id="${escapeHtml(option.id)}">
                <td><input data-field="label" value="${escapeHtml(option.label)}" aria-label="Label"></td>
                <td><code>${escapeHtml(option.value)}</code></td>
                <td><input data-field="sortOrder" type="number" value="${Number(option.sortOrder)}" aria-label="Sort order"></td>
                <td><input data-field="isActive" type="checkbox"${option.isActive ? ' checked' : ''} aria-label="Active"></td>
                <td><button class="button button-small button-dark" type="button" data-save-option>Save</button></td>
              </tr>`).join('')}
              </tbody></table></div>
              <form class="master-add" data-add-option data-set-key="${escapeHtml(set.key)}">
                <input name="value" placeholder="${escapeHtml(set.valueLabel)}" required>
                <input name="label" placeholder="Label" required>
                <input name="sortOrder" type="number" placeholder="Sort" value="0">
                <button class="button button-small button-light" type="submit">Add option</button>
              </form>
            </details>`).join('');
          masterStatus.textContent = `${sets.length} managed lists.`;
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
        });        document.querySelector('[data-refresh]').addEventListener('click', () => Promise.all([loadOverview(), loadLeads()]).catch(error => { workspaceStatus.textContent = error.message; }));
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

        document.querySelector('[data-refresh-master]')?.addEventListener('click', () => loadMasterData().catch(error => { masterStatus.textContent = error.message; }));

        masterSets?.addEventListener('click', async event => {
          const saveButton = event.target.closest('[data-save-option]');
          if (!saveButton) return;
          const row = saveButton.closest('[data-option-id]');
          const body = {
            label: row.querySelector('[data-field="label"]').value,
            sortOrder: Number(row.querySelector('[data-field="sortOrder"]').value),
            isActive: row.querySelector('[data-field="isActive"]').checked
          };
          try {
            masterStatus.textContent = 'Saving option...';
            await api(`/admin/options/${row.dataset.optionId}`, { method: 'PATCH', body: JSON.stringify(body) });
            await loadMasterData();
            masterStatus.textContent = 'Option saved.';
          } catch (error) { masterStatus.textContent = error.message; }
        });

        masterSets?.addEventListener('submit', async event => {
          const form = event.target.closest('[data-add-option]');
          if (!form) return;
          event.preventDefault();
          const values = Object.fromEntries(new FormData(form));
          try {
            masterStatus.textContent = 'Adding option...';
            await api('/admin/options', { method: 'POST', body: JSON.stringify({ setKey: form.dataset.setKey, value: values.value, label: values.label, sortOrder: Number(values.sortOrder) || 0 }) });
            await loadMasterData();
            masterStatus.textContent = 'Option added.';
          } catch (error) { masterStatus.textContent = error.message; }
        });
})();