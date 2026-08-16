(() => {
  const workspace = document.querySelector('[data-workspace]');
  const authRequired = document.querySelector('[data-auth-required]');
  const message = document.querySelector('[data-message]');
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
  const date = value => value ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Not scheduled';
  const money = value => `AED ${Number(value || 0).toFixed(2)}`;
  const valueOrGap = value => value === null || value === undefined ? '<span>Instrumentation required</span>' : escapeHtml(value);
  let csrfToken = '';
  let user = null;
  let overviewData = null;
  let contentData = [];

  async function api(path, options = {}) {
    const headers = { accept: 'application/json', ...options.headers };
    if (options.body) headers['content-type'] = 'application/json';
    if (options.method && options.method !== 'GET') headers['x-csrf-token'] = csrfToken;
    const response = await fetch(`/api/v1${path}`, { credentials: 'same-origin', ...options, headers });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'The request could not be completed.');
    return result;
  }

  const metric = (label, value, note = '') => `<article class="metric${value === null || value === undefined ? ' unavailable' : ''}"><small>${escapeHtml(label)}</small><strong>${valueOrGap(value)}</strong>${note ? `<small>${escapeHtml(note)}</small>` : ''}</article>`;

  async function loadOverview() {
    const data = await api('/admin/marketing-ai/overview');
    overviewData = data;
    document.querySelector('[data-system-status]').textContent = data.settings.systemEnabled ? 'ON' : 'OFF';
    const kill = document.querySelector('[data-kill-switch]');
    kill.textContent = data.settings.systemEnabled ? 'TURN OFF' : 'TURN ON';
    kill.classList.toggle('is-on', data.settings.systemEnabled);
    document.querySelector('[data-simulation]').textContent = `Simulation mode: ${data.settings.simulationMode ? 'ON' : 'OFF'}`;
    const percent = Math.min(100, data.costs.percentUsed || 0);
    const report = data.founderBrief;
    document.querySelector('[data-overview]').innerHTML = `
      <div class="overview-band"><section class="ops-panel"><p class="eyebrow">Today</p><h2>Operational pulse</h2>
        <div class="metric-row">${metric('Tasks created', data.operations.tasksCreated)}${metric('Tasks completed', data.operations.tasksCompleted)}${metric('Awaiting approval', data.operations.awaitingApproval)}${metric('Failed', data.operations.tasksFailed)}</div>
        <p class="eyebrow">Business outcomes</p><div class="metric-row">${metric('Seller registrations', data.business.sellerRegistrations)}${metric('Verified sellers', data.business.verifiedSellers)}${metric('Buyer registrations', data.business.buyerRegistrations)}${metric('Verified buyers', data.business.verifiedBuyers)}</div>
        <div class="metric-row">${metric('Website visitors', data.business.websiteVisitors)}${metric('RFQs', data.business.rfqs)}${metric('Matches', data.business.matches)}${metric('GMV pipeline', data.business.gmvPipeline)}</div>
      </section><aside class="brief-panel"><p class="eyebrow">Founder daily brief</p><h2>${report ? 'Latest brief' : 'No brief yet'}</h2>
        ${report ? `<p>${escapeHtml(report.summary)}</p><h3>Recommendation</h3><p>${escapeHtml(report.recommendations?.[0] || 'No recommendation recorded.')}</p>` : '<p>The Analytics Agent has not produced a founder brief yet.</p>'}
        <h3>AI spend</h3><p><strong>${money(data.costs.costThisMonth)}</strong> of ${money(data.costs.budgetMonth)}</p><div class="budget-track ${data.costs.level === 'WARNING' ? 'is-warning' : data.costs.level !== 'NORMAL' ? 'is-critical' : ''}"><span style="width:${percent}%"></span></div><p>${money(data.costs.remainingBudget)} remaining</p>
        <h3>Agents</h3><p>${data.agents.map(agent => `${escapeHtml(agent.name.replace('FishAndSpices ', ''))}: <strong>${escapeHtml(agent.status)}</strong>`).join('<br>')}</p></aside></div>`;
  }

  async function loadAgents() {
    const { agents } = await api('/admin/marketing-ai/agents');
    document.querySelector('[data-agents]').innerHTML = agents.map(agent => `<article class="agent-card"><header><div><p class="eyebrow">${escapeHtml(agent.role.replaceAll('_', ' '))}</p><h3>${escapeHtml(agent.name)}</h3></div><span class="status-label ${agent.status === 'PAUSED' ? 'is-paused' : ''}">${escapeHtml(agent.status)}</span></header><p>${escapeHtml(agent.description)}</p><dl><dt>Model</dt><dd>${escapeHtml(agent.modelTier)} · ${escapeHtml(agent.selectedModel)}</dd><dt>Schedule</dt><dd>${escapeHtml(agent.schedule || 'Task triggered')} · ${escapeHtml(agent.timezone)}</dd><dt>Runs</dt><dd>${agent.dailyRuns} today · ${agent.monthlyRuns} this month</dd><dt>Cost</dt><dd>${money(agent.costToday)} today · ${money(agent.costThisMonth)} this month</dd><dt>Prompt version</dt><dd>${escapeHtml(agent.promptVersion)}</dd></dl><h4>Allowed tools</h4><div class="tool-list">${agent.allowedTools.map(tool => `<span>${escapeHtml(tool)}</span>`).join('')}</div><details><summary>Instructions and blocked tools</summary><p>${escapeHtml(agent.systemInstructions)}</p><p>${agent.deniedTools.map(escapeHtml).join(', ')}</p></details><div class="card-actions"><button class="button button-small button-dark" data-run-agent="${escapeHtml(agent.slug)}">Run now</button><button class="button button-small button-light" data-agent-status="${escapeHtml(agent.id)}" data-next-status="${agent.status === 'PAUSED' ? 'ACTIVE' : 'PAUSED'}">${agent.status === 'PAUSED' ? 'Resume' : 'Pause'}</button></div></article>`).join('');
  }

  async function loadTasks() {
    const status = document.querySelector('[data-task-status]').value;
    const { tasks } = await api(`/admin/marketing-ai/tasks${status ? `?status=${encodeURIComponent(status)}` : ''}`);
    document.querySelector('[data-tasks]').innerHTML = tasks.length ? `<table><thead><tr><th>Task</th><th>Agent</th><th>Status</th><th>Attempts</th><th>Created</th><th></th></tr></thead><tbody>${tasks.map(task => `<tr><td><strong>${escapeHtml(task.title)}</strong><br><small>${escapeHtml(task.description || '')}</small></td><td>${escapeHtml(task.agentName || 'Unassigned')}</td><td><span class="status-label">${escapeHtml(task.status)}</span></td><td>${task.attemptCount}/${task.maxAttempts}</td><td>${date(task.createdAt)}</td><td>${task.status === 'FAILED' ? `<button class="button button-small button-light" data-rerun-task="${escapeHtml(task.id)}">Rerun</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<div class="empty-state">No tasks match this view.</div>';
  }

  async function loadApprovals() {
    const status = document.querySelector('[data-approval-status]').value;
    const { approvals } = await api(`/admin/marketing-ai/approvals${status ? `?status=${encodeURIComponent(status)}` : ''}`);
    document.querySelector('[data-approvals]').innerHTML = approvals.length ? approvals.map(item => `<article class="approval-card"><header><div><p class="eyebrow">${escapeHtml(item.category.replaceAll('_', ' '))}</p><h3>${escapeHtml(item.title)}</h3></div><span class="risk-${escapeHtml(item.riskLevel)}">${escapeHtml(item.riskLevel)} RISK</span></header><p>${escapeHtml(item.summary)}</p><dl><dt>Agent</dt><dd>${escapeHtml(item.agentName || 'System')}</dd><dt>Campaign</dt><dd>${escapeHtml(item.campaignName || 'No campaign')}</dd><dt>Reason</dt><dd>${escapeHtml(item.reason || 'Review required')}</dd><dt>Estimated cost</dt><dd>${money(item.estimatedCostAed)}</dd><dt>Created</dt><dd>${date(item.createdAt)}</dd></dl>${item.preview ? `<details><summary>View generated content and context</summary><pre class="approval-preview">${escapeHtml(JSON.stringify(item.preview, null, 2))}</pre><p><strong>Rationale summary:</strong> ${escapeHtml(item.rationaleSummary || 'Not recorded')}</p></details>` : ''}${['PENDING', 'CHANGES_REQUESTED'].includes(item.status) ? `<div class="feedback-row"><select data-reason><option value="">Feedback reason</option>${['Too generic','Wrong tone','Factually risky','Bad Malayalam','Weak CTA','Duplicate idea','Not useful','Wrong audience','Other'].map(reason => `<option>${reason}</option>`).join('')}</select><input data-comments placeholder="Review comments"></div><div class="card-actions"><button class="button button-small button-dark" data-approval-action="APPROVED" data-id="${item.id}">Approve</button><button class="button button-small button-light" data-approval-action="CHANGES_REQUESTED" data-id="${item.id}">Request changes</button><button class="button button-small button-light" data-approval-action="REJECTED" data-id="${item.id}">Reject</button></div>` : `<p class="status-label">${escapeHtml(item.status)}</p>`}</article>`).join('') : '<div class="empty-state">No approvals match this view.</div>';
  }

  async function loadContent() {
    const status = document.querySelector('[data-content-status]').value;
    const result = await api(`/admin/marketing-ai/content${status ? `?status=${encodeURIComponent(status)}` : ''}`);
    contentData = result.content;
    document.querySelector('[data-content]').innerHTML = contentData.length ? contentData.map(item => `<article class="content-card"><div class="content-meta"><p class="eyebrow">${escapeHtml(item.platform)}</p><h3>${escapeHtml(item.contentType)}</h3><p>${escapeHtml(item.language)}<br>${escapeHtml(item.persona)}<br>${escapeHtml(item.funnelStage)}</p><span class="status-label">${escapeHtml(item.status)}</span></div><div><h3>${escapeHtml(item.headline || item.objective)}</h3><p class="content-body">${escapeHtml(item.caption || item.body || 'No copy recorded.')}</p><p><strong>CTA:</strong> ${escapeHtml(item.cta || 'Not set')}</p><details><summary>Creative brief</summary><p>${escapeHtml(item.creativeBrief || 'No creative brief.')}</p><p>${escapeHtml(item.imagePrompt || '')}</p></details></div></article>`).join('') : '<div class="empty-state">No content yet.</div>';
  }

  function renderCalendar(view = 'week') {
    const root = document.querySelector('[data-calendar]');
    if (!contentData.length) { root.innerHTML = '<div class="empty-state">No scheduled content yet.</div>'; return; }
    if (view === 'drafts') { root.innerHTML = contentData.filter(item => ['IDEA','DRAFT','AI_REVIEW','AWAITING_APPROVAL'].includes(item.status)).map(item => `<article class="calendar-item"><strong>${escapeHtml(item.headline || item.contentType)}</strong><br>${escapeHtml(item.platform)} · ${escapeHtml(item.language)}</article>`).join('') || '<div class="empty-state">No drafts.</div>'; return; }
    const days = view === 'month' ? 30 : 7;
    const start = new Date(); start.setHours(0, 0, 0, 0);
    root.innerHTML = Array.from({ length: days }, (_, index) => {
      const day = new Date(start); day.setDate(day.getDate() + index);
      const key = day.toISOString().slice(0, 10);
      const items = contentData.filter(item => item.scheduledAt?.slice(0, 10) === key);
      return `<section class="calendar-day"><h3>${new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }).format(day)}</h3>${items.map(item => `<div class="calendar-item"><strong>${escapeHtml(item.platform)}</strong><br>${escapeHtml(item.headline || item.contentType)}<br>${escapeHtml(item.status)}</div>`).join('') || '<small>No content</small>'}</section>`;
    }).join('');
  }

  async function loadCampaigns() {
    const { campaigns } = await api('/admin/marketing-ai/campaigns');
    document.querySelector('[data-campaigns]').innerHTML = campaigns.length ? campaigns.map(item => `<article class="record-card"><p class="eyebrow">${escapeHtml(item.status)}</p><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.objective)}</p><p>${escapeHtml(item.persona || 'All personas')} · ${escapeHtml(item.geography || 'All locations')} · ${escapeHtml(item.language || 'All languages')}</p><strong>${money(item.budget)} budget</strong></article>`).join('') : '<div class="empty-state">No campaigns yet.</div>';
  }

  async function loadGoals() {
    const { goals } = await api('/admin/marketing-ai/goals');
    document.querySelector('[data-goals]').innerHTML = goals.length ? goals.map(item => `<article class="record-card"><p class="eyebrow">${escapeHtml(item.status)}</p><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.description || '')}</p><div class="metric-row">${metric('Seller target', item.target_seller_registrations)}${metric('Buyer target', item.target_buyer_registrations)}${metric('RFQ target', item.target_rfqs)}${metric('Match target', item.target_matches)}</div><p>${(item.priority_categories || []).map(escapeHtml).join(' · ')}<br>${(item.priority_locations || []).map(escapeHtml).join(' · ')}</p></article>`).join('') : '<div class="empty-state">No marketing goals yet.</div>';
  }

  async function loadReports() {
    const { reports } = await api('/admin/marketing-ai/reports');
    document.querySelector('[data-reports]').innerHTML = reports.length ? reports.map(item => `<article class="record-card"><p class="eyebrow">${escapeHtml(item.report_type.replaceAll('_', ' '))} · ${escapeHtml(item.period_start)} to ${escapeHtml(item.period_end)}</p><h3>${escapeHtml(item.summary)}</h3><h4>Insights</h4>${(item.insights || []).map(insight => `<p><strong>${escapeHtml(insight.title)}</strong><br>${escapeHtml(insight.summary)}</p>`).join('')}<h4>Recommendations</h4><ul>${(item.recommendations || []).map(value => `<li>${escapeHtml(value)}</li>`).join('')}</ul>${item.instrumentation_gaps?.length ? `<p><strong>Instrumentation required:</strong> ${item.instrumentation_gaps.map(escapeHtml).join(', ')}</p>` : ''}</article>`).join('') : '<div class="empty-state">No analytics report yet. The nightly Analytics Agent will report unavailable metrics as null.</div>';
  }

  async function loadCosts() {
    const data = await api('/admin/marketing-ai/costs');
    document.querySelector('[data-costs]').innerHTML = `<section class="ops-panel"><div class="metric-row">${metric('Today', money(data.status.costToday))}${metric('This month', money(data.status.costThisMonth))}${metric('Monthly limit', money(data.status.budgetMonth))}${metric('Remaining', money(data.status.remainingBudget))}</div><h3>Projected month end</h3><p>${money(data.status.estimatedEndOfMonthSpend)} · <strong>${escapeHtml(data.status.level)}</strong></p><div class="budget-track ${data.status.level === 'WARNING' ? 'is-warning' : data.status.level !== 'NORMAL' ? 'is-critical' : ''}"><span style="width:${Math.min(100, data.status.percentUsed)}%"></span></div><h3>By agent</h3><div class="table-frame"><table><thead><tr><th>Agent</th><th>Month cost</th></tr></thead><tbody>${data.byAgent.map(row => `<tr><td>${escapeHtml(row.name)}</td><td>${money(row.cost)}</td></tr>`).join('')}</tbody></table></div><h3>By model</h3>${data.byModel.length ? data.byModel.map(row => `<p>${escapeHtml(row.provider)} · ${escapeHtml(row.model)}: <strong>${money(row.cost)}</strong> (${row.inputTokens} input / ${row.outputTokens} output tokens)</p>`).join('') : '<p>No AI cost recorded yet.</p>'}</section>`;
  }

  async function loadActivity() {
    const { runs } = await api('/admin/marketing-ai/activity');
    document.querySelector('[data-activity]').innerHTML = runs.length ? `<table><thead><tr><th>Agent / Task</th><th>Status</th><th>Model</th><th>Tokens</th><th>Cost</th><th>Tools</th><th>Summary / Error</th></tr></thead><tbody>${runs.map(run => `<tr><td><strong>${escapeHtml(run.agent)}</strong><br>${escapeHtml(run.task || 'Direct run')}<br><small>${date(run.startedAt)}</small></td><td>${escapeHtml(run.status)}<br><small>${run.durationMs || 0} ms · retry ${run.retryCount}</small></td><td>${escapeHtml(run.model || 'Not selected')}<br><small>Prompt ${escapeHtml(run.promptVersion)}</small></td><td>${run.inputTokens} in<br>${run.outputTokens} out</td><td>${money(run.costAed)}</td><td>${run.toolsUsed.map(escapeHtml).join(', ') || 'None'}</td><td>${escapeHtml(run.executionSummary || run.error?.message || 'No summary')}</td></tr>`).join('')}</tbody></table>` : '<div class="empty-state">No agent runs yet.</div>';
  }

  async function loadSettings() {
    const [settings, health] = await Promise.all([api('/admin/marketing-ai/settings'), api('/admin/marketing-ai/health')]);
    document.querySelector('[data-settings]').innerHTML = `<section class="settings-panel"><div class="health-grid">${Object.entries(health.health).map(([key, value]) => `<div class="health-item"><strong>${escapeHtml(key.replace(/([A-Z])/g, ' $1'))}</strong><br>${escapeHtml(typeof value === 'object' ? JSON.stringify(value) : value)}</div>`).join('')}</div><h3>Effective safety settings</h3><p>AI Marketing: <strong>${settings.effective.systemEnabled ? 'ON' : 'OFF'}</strong><br>Simulation Mode: <strong>${settings.effective.simulationMode ? 'ON' : 'OFF'}</strong><br>External actions: <strong>${settings.effective.externalActionsEnabled ? 'ON' : 'OFF'}</strong><br>Autopublish: <strong>${settings.effective.autopublishEnabled ? 'ON' : 'OFF'}</strong><br>Timezone: <strong>${escapeHtml(settings.effective.timezone)}</strong><br>Monthly budget: <strong>${money(settings.effective.monthlyBudgetAed)}</strong></p><div class="settings-panel danger-zone"><h3>Emergency stop</h3><p>Turning AI Marketing OFF stops scheduled and queued execution while preserving dashboards and history. Only a super administrator can change this control.</p><button class="button button-small button-light" data-settings-stop>${settings.effective.systemEnabled ? 'Turn AI Marketing OFF' : 'Turn AI Marketing ON'}</button></div></section>`;
  }

  const loaders = { overview: loadOverview, agents: loadAgents, tasks: loadTasks, approvals: loadApprovals, content: loadContent, calendar: async () => { if (!contentData.length) await loadContent(); renderCalendar(); }, campaigns: loadCampaigns, goals: loadGoals, analytics: loadReports, costs: loadCosts, activity: loadActivity, settings: loadSettings };

  async function openTab(name) {
    document.querySelectorAll('[data-panel]').forEach(panel => { panel.hidden = panel.dataset.panel !== name; });
    document.querySelectorAll('[data-tab]').forEach(tab => tab.classList.toggle('is-active', tab.dataset.tab === name));
    message.textContent = 'Loading...';
    try { await loaders[name](); message.textContent = ''; } catch (error) { message.textContent = error.message; }
  }

  document.querySelector('[data-tabs]').addEventListener('click', event => { const tab = event.target.closest('[data-tab]'); if (tab) openTab(tab.dataset.tab); });
  document.querySelector('[data-task-status]').addEventListener('change', loadTasks);
  document.querySelector('[data-approval-status]').addEventListener('change', loadApprovals);
  document.querySelector('[data-content-status]').addEventListener('change', loadContent);
  document.querySelectorAll('[data-calendar-view]').forEach(button => button.addEventListener('click', () => { document.querySelectorAll('[data-calendar-view]').forEach(item => item.classList.toggle('is-active', item === button)); renderCalendar(button.dataset.calendarView); }));
  document.querySelectorAll('[data-open-form]').forEach(button => button.addEventListener('click', () => { document.querySelector(`[data-${button.dataset.openForm}-form]`).hidden = false; }));

  document.addEventListener('click', async event => {
    try {
      const run = event.target.closest('[data-run-agent]');
      if (run) { const result = await api(`/admin/marketing-ai/agents/${run.dataset.runAgent}/run`, { method: 'POST', body: '{}' }); message.textContent = `Task queued. ${result.preview.modelTier} tier, Simulation Mode ${result.preview.simulationMode ? 'ON' : 'OFF'}, maximum ${money(result.preview.expectedMaximumCostAed)}.`; await loadAgents(); }
      const status = event.target.closest('[data-agent-status]');
      if (status) { await api(`/admin/marketing-ai/agents/${status.dataset.agentStatus}/status`, { method: 'PATCH', body: JSON.stringify({ status: status.dataset.nextStatus }) }); await loadAgents(); }
      const rerun = event.target.closest('[data-rerun-task]');
      if (rerun) { await api(`/admin/marketing-ai/tasks/${rerun.dataset.rerunTask}/rerun`, { method: 'POST', body: '{}' }); await loadTasks(); }
      const approval = event.target.closest('[data-approval-action]');
      if (approval) { const card = approval.closest('.approval-card'); await api(`/admin/marketing-ai/approvals/${approval.dataset.id}/actions`, { method: 'POST', body: JSON.stringify({ action: approval.dataset.approvalAction, reasonCode: card.querySelector('[data-reason]').value || null, comments: card.querySelector('[data-comments]').value || null }) }); await loadApprovals(); }
      if (event.target.closest('[data-kill-switch]') || event.target.closest('[data-settings-stop]')) { const enabled = overviewData?.settings.systemEnabled ?? true; if (!window.confirm(`${enabled ? 'Turn OFF' : 'Turn ON'} AI Marketing? Historical data will remain available.`)) return; await api('/admin/marketing-ai/settings', { method: 'PATCH', body: JSON.stringify({ system_enabled: !enabled }) }); await loadOverview(); if (!document.querySelector('[data-panel="settings"]').hidden) await loadSettings(); }
    } catch (error) { message.textContent = error.message; }
  });

  document.querySelector('[data-campaign-form]').addEventListener('submit', async event => { event.preventDefault(); try { await api('/admin/marketing-ai/campaigns', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.target))) }); event.target.reset(); event.target.hidden = true; await loadCampaigns(); } catch (error) { message.textContent = error.message; } });
  document.querySelector('[data-goal-form]').addEventListener('submit', async event => { event.preventDefault(); const body = Object.fromEntries(new FormData(event.target)); for (const key of ['targetSellerRegistrations','targetBuyerRegistrations']) body[key] = body[key] ? Number(body[key]) : null; try { await api('/admin/marketing-ai/goals', { method: 'POST', body: JSON.stringify(body) }); event.target.reset(); event.target.hidden = true; await loadGoals(); } catch (error) { message.textContent = error.message; } });
  document.querySelector('[data-sign-out]').addEventListener('click', async () => { try { await api('/auth/logout', { method: 'POST', body: '{}' }); } finally { location.href = '/admin'; } });

  api('/auth/session').then(session => { csrfToken = session.csrfToken; user = session.user; document.querySelector('[data-identity]').textContent = `${user.displayName} · ${user.role.replace('_', ' ')}`; workspace.hidden = false; return loadOverview(); }).catch(() => { workspace.hidden = true; authRequired.hidden = false; });
})();