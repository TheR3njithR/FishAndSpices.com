import { Router } from 'express';
import { requireAuthentication, requireCsrf } from '../auth-middleware.js';
import { withTransaction } from '../db.js';
import { writeAudit } from '../services/audit.js';
import { consumeRateLimit } from '../services/rate-limit.js';
import { getCostStatus, selectModel } from '../services/marketing-ai/cost-controls.js';
import { createMarketingTask } from '../services/marketing-ai/orchestrator.js';
import { getAgentBySlug, listAgents, updateAgentStatus } from '../services/marketing-ai/registry.js';

const MANAGE_ROLES = ['administrator', 'super_admin'];
const EMERGENCY_ROLES = ['super_admin'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const approvalActions = new Set(['APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'CANCELLED']);
const feedbackReasons = new Set(['Too generic', 'Wrong tone', 'Factually risky', 'Bad Malayalam', 'Weak CTA', 'Duplicate idea', 'Not useful', 'Wrong audience', 'Other']);

function requireRole(roles) {
  return (request, response, next) => roles.includes(request.adminSession.user.role)
    ? next()
    : response.status(403).json({ success: false, error: 'Insufficient administrator role.' });
}

function requireUuid(value, label = 'identifier') {
  if (!uuid.test(String(value))) { const error = new Error(`Invalid ${label}.`); error.status = 400; throw error; }
}

function text(value, limit, label, required = false) {
  if (value === undefined || value === null || value === '') {
    if (required) { const error = new Error(`${label} is required.`); error.status = 422; throw error; }
    return null;
  }
  if (typeof value !== 'string' || value.trim().length > limit) { const error = new Error(`Invalid ${label}.`); error.status = 422; throw error; }
  return value.trim();
}

function boolSetting(row, fallback) {
  return row === undefined ? fallback : row === true;
}

async function getSettings(pool, config) {
  const result = await pool.query('select setting_key as key, setting_value as value, updated_at as "updatedAt" from fas_ai_marketing_settings order by setting_key');
  const stored = Object.fromEntries(result.rows.map(row => [row.key, row.value]));
  return {
    effective: {
      systemEnabled: config.aiMarketingEnabled && boolSetting(stored.system_enabled, true),
      simulationMode: config.aiMarketingSimulationMode || boolSetting(stored.simulation_mode, true),
      externalActionsEnabled: config.aiExternalActionsEnabled && boolSetting(stored.external_actions_enabled, false),
      autopublishEnabled: config.aiAutopublishEnabled && boolSetting(stored.autopublish_enabled, false),
      monthlyBudgetAed: config.aiMonthlyBudgetAed,
      timezone: config.marketingTimezone
    },
    stored
  };
}

export function createMarketingAiAdminRouter({ config, pool }) {
  const router = Router();
  router.use(requireAuthentication({ pool, config }));

  router.get('/overview', async (_request, response, next) => {
    try {
      const [settings, costs, agents, operations, business, brief] = await Promise.all([
        getSettings(pool, config),
        getCostStatus(pool, config),
        listAgents(pool),
        pool.query(`select
          count(*) filter (where created_at >= date_trunc('day', now()))::int as "tasksCreated",
          count(*) filter (where status = 'COMPLETED' and completed_at >= date_trunc('day', now()))::int as "tasksCompleted",
          count(*) filter (where status = 'FAILED' and updated_at >= date_trunc('day', now()))::int as "tasksFailed",
          (select count(*)::int from fas_approval_requests where status = 'PENDING') as "awaitingApproval"
          from fas_ai_tasks`),
        pool.query(`select
          count(*) filter (where lead_role = 'seller' and submitted_at >= date_trunc('day', now()))::int as "sellerRegistrations",
          count(*) filter (where lead_role = 'seller' and verification_status = 'Verified' and submitted_at >= date_trunc('day', now()))::int as "verifiedSellers",
          count(*) filter (where lead_role = 'buyer' and submitted_at >= date_trunc('day', now()))::int as "buyerRegistrations",
          count(*) filter (where lead_role = 'buyer' and verification_status = 'Verified' and submitted_at >= date_trunc('day', now()))::int as "verifiedBuyers",
          (select count(*)::int from matches where created_at >= date_trunc('day', now())) as matches
          from leads where archived_at is null`),
        pool.query(`select id, summary, metrics, insights, recommendations, instrumentation_gaps as "instrumentationGaps", created_at as "createdAt"
          from fas_marketing_reports where report_type = 'FOUNDER_BRIEF' order by period_end desc limit 1`)
      ]);
      response.json({ success: true, settings: settings.effective, costs, agents, operations: operations.rows[0], business: {
        websiteVisitors: null, ...business.rows[0], rfqs: null, transactions: null, gmvPipeline: null
      }, founderBrief: brief.rows[0] || null });
    } catch (error) { next(error); }
  });

  router.get('/agents', async (_request, response, next) => {
    try {
      const agents = await listAgents(pool);
      const stats = await pool.query(`select agent_id as "agentId",
        count(*) filter (where created_at >= date_trunc('day', now()))::int as "dailyRuns",
        count(*) filter (where created_at >= date_trunc('month', now()))::int as "monthlyRuns",
        coalesce(sum(cost_aed) filter (where created_at >= date_trunc('day', now())),0)::float as "costToday",
        coalesce(sum(cost_aed) filter (where created_at >= date_trunc('month', now())),0)::float as "costThisMonth"
        from fas_ai_agent_runs group by agent_id`);
      const byAgent = new Map(stats.rows.map(row => [row.agentId, row]));
      response.json({ success: true, agents: agents.map(agent => ({ ...agent, ...(byAgent.get(agent.id) || { dailyRuns: 0, monthlyRuns: 0, costToday: 0, costThisMonth: 0 }), selectedModel: selectModel(config, agent) })) });
    } catch (error) { next(error); }
  });

  router.patch('/agents/:id/status', requireRole(MANAGE_ROLES), requireCsrf, async (request, response, next) => {
    try {
      requireUuid(request.params.id, 'agent identifier');
      const agent = await updateAgentStatus(pool, request.params.id, request.body.status);
      if (!agent) return response.status(404).json({ success: false, error: 'Agent not found.' });
      await writeAudit(pool, { administratorId: request.adminSession.user.id, action: 'marketing_ai_agent_status_changed', entityType: 'ai_agent', entityIdentifier: agent.id, newValues: { status: agent.status } });
      response.json({ success: true, agent });
    } catch (error) { next(error); }
  });

  router.post('/agents/:slug/run', requireRole(MANAGE_ROLES), requireCsrf, async (request, response, next) => {
    try {
      const rate = await consumeRateLimit(pool, 'marketing_ai_manual_run', request.adminSession.user.id, config);
      if (!rate.allowed) return response.status(429).set('Retry-After', String(rate.retryAfterSeconds)).json({ success: false, error: 'Please wait before requesting another AI run.' });
      const agent = await getAgentBySlug(pool, request.params.slug);
      if (!agent) return response.status(404).json({ success: false, error: 'Agent not found.' });
      const settings = await getSettings(pool, config);
      const task = await createMarketingTask(pool, {
        title: text(request.body.title, 200, 'title') || `Manual run: ${agent.name}`,
        description: text(request.body.description, 2000, 'description') || 'Requested from the administrator workspace.',
        createdBy: 'administrator', createdByAdminId: request.adminSession.user.id, assignedAgentId: agent.id,
        priority: 'HIGH', input: request.body.input && typeof request.body.input === 'object' ? request.body.input : {},
        idempotencyKey: `manual:${request.adminSession.user.id}:${agent.slug}:${new Date().toISOString().slice(0, 16)}`
      });
      response.status(202).json({ success: true, task, preview: { modelTier: agent.modelTier, selectedModel: selectModel(config, agent), simulationMode: settings.effective.simulationMode, expectedMaximumCostAed: config.aiMarketingMaxRunCostAed } });
    } catch (error) { next(error); }
  });

  router.get('/tasks', async (request, response, next) => {
    try {
      const values = [];
      const conditions = [];
      if (request.query.status) { values.push(request.query.status); conditions.push(`t.status = $${values.length}`); }
      if (request.query.agent) { values.push(request.query.agent); conditions.push(`a.slug = $${values.length}`); }
      const where = conditions.length ? `where ${conditions.join(' and ')}` : '';
      const result = await pool.query(`select t.id, t.title, t.description, t.created_by as "createdBy", t.priority, t.status,
        t.scheduled_at as "scheduledAt", t.started_at as "startedAt", t.completed_at as "completedAt", t.attempt_count as "attemptCount",
        t.max_attempts as "maxAttempts", t.input, t.output, t.error, t.created_at as "createdAt", a.slug as "agentSlug", a.name as "agentName"
        from fas_ai_tasks t left join fas_ai_agents a on a.id = t.assigned_agent_id ${where} order by t.created_at desc limit 200`, values);
      response.json({ success: true, tasks: result.rows });
    } catch (error) { next(error); }
  });

  router.post('/tasks/:id/rerun', requireRole(MANAGE_ROLES), requireCsrf, async (request, response, next) => {
    try {
      requireUuid(request.params.id, 'task identifier');
      const original = await pool.query(`select t.*, a.slug as agent_slug from fas_ai_tasks t left join fas_ai_agents a on a.id = t.assigned_agent_id where t.id = $1`, [request.params.id]);
      if (!original.rowCount || original.rows[0].status !== 'FAILED') return response.status(409).json({ success: false, error: 'Only failed tasks can be rerun.' });
      const row = original.rows[0];
      const task = await createMarketingTask(pool, { title: `Rerun: ${row.title}`, description: row.description, createdBy: 'administrator-rerun', createdByAdminId: request.adminSession.user.id, assignedAgentSlug: row.agent_slug, parentTaskId: row.id, campaignId: row.campaign_id, goalId: row.goal_id, priority: row.priority, input: row.input, idempotencyKey: `rerun:${row.id}:${Date.now()}` });
      response.status(202).json({ success: true, task });
    } catch (error) { next(error); }
  });

  router.get('/approvals', async (request, response, next) => {
    try {
      const status = request.query.status || null;
      const result = await pool.query(`select ar.id, ar.category, ar.status, ar.title, ar.summary, ar.reason,
        ar.rationale_summary as "rationaleSummary", ar.proposed_action as "proposedAction", ar.preview,
        ar.estimated_impact as "estimatedImpact", ar.estimated_cost_aed as "estimatedCostAed", ar.risk_level as "riskLevel",
        ar.created_at as "createdAt", ar.expires_at as "expiresAt", a.name as "agentName", c.name as "campaignName"
        from fas_approval_requests ar left join fas_ai_agents a on a.id = ar.agent_id left join fas_marketing_campaigns c on c.id = ar.campaign_id
        where ($1::text is null or ar.status = $1) order by case when ar.status = 'PENDING' then 0 else 1 end, ar.created_at desc limit 200`, [status]);
      response.json({ success: true, approvals: result.rows });
    } catch (error) { next(error); }
  });

  router.post('/approvals/:id/actions', requireRole(MANAGE_ROLES), requireCsrf, async (request, response, next) => {
    try {
      requireUuid(request.params.id, 'approval identifier');
      if (!approvalActions.has(request.body.action)) return response.status(422).json({ success: false, error: 'Invalid approval action.' });
      const reasonCode = text(request.body.reasonCode, 100, 'reason code');
      if (reasonCode && !feedbackReasons.has(reasonCode)) return response.status(422).json({ success: false, error: 'Invalid feedback reason.' });
      const rate = await consumeRateLimit(pool, 'marketing_ai_approval_action', request.adminSession.user.id, config);
      if (!rate.allowed) return response.status(429).json({ success: false, error: 'Please wait before taking another approval action.' });
      const result = await withTransaction(pool, async client => {
        const current = await client.query('select * from fas_approval_requests where id = $1 for update', [request.params.id]);
        if (!current.rowCount) return null;
        if (current.rows[0].status !== 'PENDING' && current.rows[0].status !== 'CHANGES_REQUESTED') throw Object.assign(new Error('This approval is no longer actionable.'), { status: 409 });
        const newStatus = request.body.action;
        await client.query('update fas_approval_requests set status = $1 where id = $2', [newStatus, request.params.id]);
        await client.query(`insert into fas_approval_actions (approval_id, action, administrator_id, reason_code, comments, previous_status, new_status)
          values ($1,$2,$3,$4,$5,$6,$7)`, [request.params.id, request.body.action, request.adminSession.user.id, reasonCode,
          text(request.body.comments, 2000, 'comments'), current.rows[0].status, newStatus]);
        const contentId = current.rows[0].proposed_action?.contentId;
        if (contentId && uuid.test(contentId)) {
          const contentStatus = newStatus === 'APPROVED' ? 'APPROVED' : newStatus === 'REJECTED' ? 'REJECTED' : newStatus === 'CHANGES_REQUESTED' ? 'DRAFT' : null;
          if (contentStatus) await client.query('update fas_marketing_content set status = $1 where id = $2', [contentStatus, contentId]);
        }
        await writeAudit(client, { administratorId: request.adminSession.user.id, action: 'marketing_ai_approval_action', entityType: 'approval_request', entityIdentifier: request.params.id, previousValues: { status: current.rows[0].status }, newValues: { status: newStatus, reasonCode } });
        return { id: request.params.id, status: newStatus };
      });
      if (!result) return response.status(404).json({ success: false, error: 'Approval not found.' });
      response.json({ success: true, approval: result, externalActionExecuted: false });
    } catch (error) { next(error); }
  });

  router.get('/content', async (request, response, next) => {
    try {
      const result = await pool.query(`select mc.id, mc.platform, mc.content_type as "contentType", mc.language, mc.persona,
        mc.funnel_stage as "funnelStage", mc.objective, mc.headline, mc.caption, mc.body, mc.cta, mc.hashtags,
        mc.creative_brief as "creativeBrief", mc.image_prompt as "imagePrompt", mc.video_script as "videoScript", mc.status,
        mc.scheduled_at as "scheduledAt", mc.created_at as "createdAt", c.name as "campaignName", a.name as "agentName"
        from fas_marketing_content mc left join fas_marketing_campaigns c on c.id = mc.campaign_id left join fas_ai_agents a on a.id = mc.created_by_agent_id
        where ($1::text is null or mc.status = $1) and ($2::text is null or mc.platform = $2) and ($3::text is null or mc.language = $3)
        order by coalesce(mc.scheduled_at, mc.created_at) desc limit 300`, [request.query.status || null, request.query.platform || null, request.query.language || null]);
      response.json({ success: true, content: result.rows });
    } catch (error) { next(error); }
  });

  router.get('/goals', async (_request, response, next) => {
    try { response.json({ success: true, goals: (await pool.query('select * from fas_marketing_goals order by created_at desc')).rows }); } catch (error) { next(error); }
  });

  router.post('/goals', requireRole(MANAGE_ROLES), requireCsrf, async (request, response, next) => {
    try {
      const result = await pool.query(`insert into fas_marketing_goals
        (name, description, start_date, end_date, target_seller_registrations, target_verified_sellers, target_buyer_registrations,
         target_verified_buyers, target_rfqs, target_matches, target_transactions, target_gmv, priority_categories, priority_locations,
         priority_personas, status, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning *`, [
        text(request.body.name, 200, 'name', true), text(request.body.description, 2000, 'description'), request.body.startDate,
        request.body.endDate || null, request.body.targetSellerRegistrations || null, request.body.targetVerifiedSellers || null,
        request.body.targetBuyerRegistrations || null, request.body.targetVerifiedBuyers || null, request.body.targetRfqs || null,
        request.body.targetMatches || null, request.body.targetTransactions || null, request.body.targetGmv || null,
        request.body.priorityCategories || [], request.body.priorityLocations || [], request.body.priorityPersonas || [],
        request.body.status || 'DRAFT', request.adminSession.user.id]);
      response.status(201).json({ success: true, goal: result.rows[0] });
    } catch (error) { next(error); }
  });

  router.get('/campaigns', async (_request, response, next) => {
    try { response.json({ success: true, campaigns: (await pool.query('select * from fas_marketing_campaigns order by created_at desc')).rows }); } catch (error) { next(error); }
  });

  router.post('/campaigns', requireRole(MANAGE_ROLES), requireCsrf, async (request, response, next) => {
    try {
      const name = text(request.body.name, 200, 'name', true);
      const slug = text(request.body.slug, 120, 'slug', true);
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return response.status(422).json({ success: false, error: 'Campaign slug must use lowercase words and hyphens.' });
      const result = await pool.query(`insert into fas_marketing_campaigns
        (name, slug, description, objective, persona, geography, language, start_date, end_date, status, primary_metric, secondary_metrics, created_by, budget, metadata)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning *`, [name, slug,
        text(request.body.description, 2000, 'description'), text(request.body.objective, 1000, 'objective', true),
        text(request.body.persona, 100, 'persona'), text(request.body.geography, 100, 'geography'), text(request.body.language, 40, 'language'),
        request.body.startDate || null, request.body.endDate || null, request.body.status || 'DRAFT', text(request.body.primaryMetric, 100, 'primary metric'),
        request.body.secondaryMetrics || [], request.adminSession.user.id, Number(request.body.budget || 0), request.body.metadata || {}]);
      response.status(201).json({ success: true, campaign: result.rows[0] });
    } catch (error) { next(error); }
  });

  router.get('/reports', async (_request, response, next) => {
    try { response.json({ success: true, reports: (await pool.query(`select r.*, a.name as agent_name from fas_marketing_reports r left join fas_ai_agents a on a.id = r.agent_id order by period_end desc limit 100`)).rows }); } catch (error) { next(error); }
  });

  router.get('/costs', async (_request, response, next) => {
    try {
      const [status, byAgent, byModel, daily] = await Promise.all([
        getCostStatus(pool, config),
        pool.query(`select a.name, coalesce(sum(coalesce(l.actual_cost_aed,l.estimated_cost_aed,l.api_cost_aed+l.tool_cost_aed)),0)::float as cost from fas_ai_agents a left join fas_ai_cost_ledger l on l.agent_id=a.id and l.timestamp >= date_trunc('month',now()) group by a.id order by cost desc`),
        pool.query(`select provider, model, coalesce(sum(coalesce(actual_cost_aed,estimated_cost_aed,api_cost_aed+tool_cost_aed)),0)::float as cost, sum(input_tokens)::int as "inputTokens", sum(output_tokens)::int as "outputTokens" from fas_ai_cost_ledger where timestamp >= date_trunc('month',now()) group by provider,model order by cost desc`),
        pool.query(`select date(timestamp) as date, sum(coalesce(actual_cost_aed,estimated_cost_aed,api_cost_aed+tool_cost_aed))::float as cost from fas_ai_cost_ledger where timestamp >= date_trunc('month',now()) group by date(timestamp) order by date`)
      ]);
      response.json({ success: true, status, byAgent: byAgent.rows, byModel: byModel.rows, daily: daily.rows });
    } catch (error) { next(error); }
  });

  router.get('/activity', async (_request, response, next) => {
    try {
      const runs = await pool.query(`select r.id, a.name as agent, t.title as task, r.started_at as "startedAt", r.ended_at as "endedAt",
        r.duration_ms as "durationMs", r.status, r.model, r.input_tokens as "inputTokens", r.output_tokens as "outputTokens",
        r.cost_aed as "costAed", r.execution_summary as "executionSummary", r.error, r.retry_count as "retryCount", r.agent_prompt_version as "promptVersion",
        coalesce(array_agg(distinct tc.tool_name) filter (where tc.tool_name is not null), '{}') as "toolsUsed"
        from fas_ai_agent_runs r join fas_ai_agents a on a.id=r.agent_id left join fas_ai_tasks t on t.id=r.task_id
        left join fas_ai_marketing_tool_calls tc on tc.agent_run_id=r.id group by r.id,a.name,t.title order by r.created_at desc limit 200`);
      response.json({ success: true, runs: runs.rows });
    } catch (error) { next(error); }
  });

  router.get('/settings', async (_request, response, next) => {
    try { response.json({ success: true, ...(await getSettings(pool, config)) }); } catch (error) { next(error); }
  });

  router.patch('/settings', requireRole(EMERGENCY_ROLES), requireCsrf, async (request, response, next) => {
    try {
      const supported = new Set(['system_enabled', 'simulation_mode']);
      const entries = Object.entries(request.body || {});
      if (!entries.length || entries.some(([key, value]) => !supported.has(key) || typeof value !== 'boolean')) return response.status(422).json({ success: false, error: 'Only boolean system and simulation controls may be changed here.' });
      await withTransaction(pool, async client => {
        for (const [key, value] of entries) await client.query(`insert into fas_ai_marketing_settings (setting_key,setting_value,updated_by) values ($1,$2,$3)
          on conflict (setting_key) do update set setting_value=excluded.setting_value,updated_by=excluded.updated_by`, [key, value, request.adminSession.user.id]);
        await writeAudit(client, { administratorId: request.adminSession.user.id, action: keyAction(entries), entityType: 'ai_marketing_settings', entityIdentifier: 'global', newValues: Object.fromEntries(entries) });
      });
      response.json({ success: true, ...(await getSettings(pool, config)) });
    } catch (error) { next(error); }
  });

  router.get('/health', async (_request, response, next) => {
    try {
      const [queued, failed, schedules] = await Promise.all([
        pool.query(`select count(*)::int as count from fas_ai_tasks where status = 'QUEUED'`),
        pool.query(`select count(*)::int as count from fas_ai_agent_runs where status = 'FAILED' and created_at >= now() - interval '24 hours'`),
        pool.query(`select count(*) filter (where enabled)::int as enabled, max(last_run_at) as "lastRunAt" from fas_marketing_schedules`)
      ]);
      response.json({ success: true, health: { database: 'available', provider: config.openaiApiKey ? 'configured' : 'not_configured', scheduler: schedules.rows[0], queue: { queued: queued.rows[0].count }, agentWorker: { recentFailures: failed.rows[0].count }, costService: 'available' } });
    } catch (error) { next(error); }
  });

  return router;
}

function keyAction(entries) {
  return entries.some(([key, value]) => key === 'system_enabled' && value === false) ? 'marketing_ai_emergency_stop' : 'marketing_ai_settings_changed';
}