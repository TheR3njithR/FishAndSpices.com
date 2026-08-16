import { agentOutputSchemas } from './schemas.js';
import { assertBudgetAvailable, estimateCostAed, selectModel } from './cost-controls.js';
import { createMarketingProvider } from './provider.js';
import { defaultContextTools, executeMarketingTool } from './tools.js';
import { getAgentBySlug } from './registry.js';

function serviceError(message, status, code) {
  const error = new Error(message); error.status = status; error.code = code; return error;
}

function isoDate(value = new Date()) {
  return value.toISOString().slice(0, 10);
}

function agentFeatureEnabled(config, slug) {
  return {
    'marketing-director': config.aiMarketingDirectorEnabled,
    'content-strategist': config.aiContentStrategistEnabled,
    'social-creative': config.aiSocialAgentEnabled,
    'marketing-analytics': config.aiAnalyticsAgentEnabled
  }[slug] !== false;
}

const AGENT_SLUGS = new Set(['marketing-director', 'content-strategist', 'social-creative', 'marketing-analytics']);
const PRIORITIES = new Set(['LOW', 'NORMAL', 'HIGH', 'URGENT']);
const RISK_LEVELS = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const APPROVAL_CATEGORIES = new Set(['CONTENT_PUBLICATION', 'CAMPAIGN_CREATION', 'STRATEGY_CHANGE', 'HIGH_COST_AI_RUN', 'EXTERNAL_COMMUNICATION']);
const FUNNEL_STAGES = new Set(['AWARENESS', 'EDUCATION', 'TRUST', 'CONSIDERATION', 'CONVERSION', 'RETENTION']);
const REPORT_TYPES = new Set(['DAILY', 'WEEKLY', 'FOUNDER_BRIEF', 'STRATEGY_REVIEW']);

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asText(value, fallback = '') {
  return typeof value === 'string' ? value.trim() || fallback : fallback;
}

function asLooseText(value, fallback = '') {
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized || fallback;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    const normalized = String(value).trim();
    return normalized || fallback;
  }
  if (Array.isArray(value)) {
    const normalized = value
      .map(item => asLooseText(item, ''))
      .filter(Boolean)
      .join(' ')
      .trim();
    return normalized || fallback;
  }
  return fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizePriority(value, fallback = 'NORMAL') {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return PRIORITIES.has(normalized) ? normalized : fallback;
}

function normalizeRiskLevel(value, fallback = 'LOW') {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return RISK_LEVELS.has(normalized) ? normalized : fallback;
}

function normalizeApprovalCategory(value) {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase().replace(/[^A-Z_]/g, '_') : '';
  if (APPROVAL_CATEGORIES.has(normalized)) return normalized;
  if (normalized.includes('CONTENT')) return 'CONTENT_PUBLICATION';
  if (normalized.includes('CAMPAIGN')) return 'CAMPAIGN_CREATION';
  if (normalized.includes('COMM')) return 'EXTERNAL_COMMUNICATION';
  if (normalized.includes('COST')) return 'HIGH_COST_AI_RUN';
  return 'STRATEGY_CHANGE';
}

function normalizeDirectorOutput(output) {
  const source = asObject(output);
  const tasks = asArray(source.tasks).map(task => {
    const item = asObject(task);
    const slug = asText(item.assignedAgentSlug, 'content-strategist').toLowerCase();
    return {
      title: asText(item.title, 'Follow-up marketing task').slice(0, 200),
      description: asText(item.description, '').slice(0, 4000),
      assignedAgentSlug: AGENT_SLUGS.has(slug) ? slug : 'content-strategist',
      priority: normalizePriority(item.priority),
      input: asObject(item.input)
    };
  }).slice(0, 20);

  const insights = asArray(source.insights).map(entry => {
    const item = asObject(entry);
    const evidence = asArray(item.evidence)
      .map(line => asText(line, ''))
      .filter(Boolean)
      .slice(0, 12);
    return {
      title: asText(item.title, 'Marketplace insight').slice(0, 200),
      summary: asText(item.summary, 'Review current signals and validate assumptions.').slice(0, 3000),
      evidence,
      priority: normalizePriority(item.priority)
    };
  }).slice(0, 12);

  const approvalProposals = asArray(source.approvalProposals).map(entry => {
    const item = asObject(entry);
    return {
      category: normalizeApprovalCategory(item.category),
      title: asText(item.title, 'Approval request').slice(0, 200),
      summary: asText(item.summary, 'Review this proposed action before execution.').slice(0, 3000),
      reason: asText(item.reason, '').slice(0, 2000),
      riskLevel: normalizeRiskLevel(item.riskLevel),
      proposedAction: asObject(item.proposedAction)
    };
  }).slice(0, 10);

  const priorities = asArray(source.priorities)
    .map(item => asText(item, ''))
    .filter(Boolean)
    .slice(0, 10);

  return {
    executionSummary: asText(source.executionSummary, 'Drafted a simulation-safe marketplace action plan.').slice(0, 3000),
    priorities,
    insights,
    tasks,
    approvalProposals
  };
}

function normalizeFunnelStage(value, fallback = 'EDUCATION') {
  const normalized = asLooseText(value, '').toUpperCase().replace(/[^A-Z_]/g, '_');
  if (FUNNEL_STAGES.has(normalized)) return normalized;
  if (normalized.includes('AWARE')) return 'AWARENESS';
  if (normalized.includes('EDU')) return 'EDUCATION';
  if (normalized.includes('TRUST')) return 'TRUST';
  if (normalized.includes('CONSIDER') || normalized.includes('MOFU')) return 'CONSIDERATION';
  if (normalized.includes('CONVERT') || normalized.includes('PURCHASE') || normalized.includes('BOFU')) return 'CONVERSION';
  if (normalized.includes('RETENT') || normalized.includes('LOYAL')) return 'RETENTION';
  return fallback;
}

function normalizeHashtags(value) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,\n]+/)
      : [];
  return raw
    .map(tag => asLooseText(tag, ''))
    .flatMap(tag => (tag.includes(' ') && tag.startsWith('#') ? tag.split(/\s+/) : [tag]))
    .map(tag => tag.trim())
    .filter(Boolean)
    .slice(0, 30)
    .map(tag => tag.slice(0, 100));
}

function normalizeDateTimeString(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function normalizeTaskProposals(value) {
  return asArray(value).map(task => {
    const item = asObject(task);
    const slug = asText(item.assignedAgentSlug, 'content-strategist').toLowerCase();
    return {
      title: asLooseText(item.title, 'Follow-up marketing task').slice(0, 200),
      description: asLooseText(item.description, '').slice(0, 4000),
      assignedAgentSlug: AGENT_SLUGS.has(slug) ? slug : 'content-strategist',
      priority: normalizePriority(item.priority),
      input: asObject(item.input)
    };
  }).slice(0, 20);
}

function normalizeContentDraft(value) {
  const item = asObject(value);
  return {
    platform: asLooseText(item.platform || item.channel || item.network, 'Instagram').slice(0, 80),
    contentType: asLooseText(item.contentType || item.content_type || item.type || item.format, 'Post').slice(0, 80),
    language: asLooseText(item.language || item.locale, 'English').slice(0, 40),
    originalLanguage: asLooseText(item.originalLanguage || item.original_language, '').slice(0, 40) || null,
    languageVariant: asLooseText(item.languageVariant || item.language_variant, '').slice(0, 80) || null,
    persona: asLooseText(item.persona || item.audience, 'Verified seafood buyers and sellers').slice(0, 100),
    funnelStage: normalizeFunnelStage(item.funnelStage || item.funnel_stage || item.stage),
    objective: asLooseText(item.objective || item.goal, 'Drive qualified marketplace conversations and registrations.').slice(0, 500),
    headline: asLooseText(item.headline, '').slice(0, 300) || null,
    caption: asLooseText(item.caption, '').slice(0, 5000) || null,
    body: asLooseText(item.body || item.copy, '').slice(0, 12000) || null,
    cta: asLooseText(item.cta, '').slice(0, 500) || null,
    hashtags: normalizeHashtags(item.hashtags || item.tags),
    creativeBrief: asLooseText(item.creativeBrief || item.creative_brief || item.brief, '').slice(0, 6000) || null,
    imagePrompt: asLooseText(item.imagePrompt || item.image_prompt, '').slice(0, 6000) || null,
    videoScript: asLooseText(item.videoScript || item.video_script || item.script, '').slice(0, 12000) || null,
    scheduledAt: normalizeDateTimeString(item.scheduledAt || item.scheduled_at || item.publishAt || item.publish_at)
  };
}

function normalizeContentCollection(value) {
  const source = asObject(value);
  const fromLists = asArray(source.content).length
    ? asArray(source.content)
    : asArray(source.drafts).length
      ? asArray(source.drafts)
      : asArray(source.posts).length
        ? asArray(source.posts)
        : asArray(source.items);
  const candidates = fromLists.length
    ? fromLists
    : (source.platform || source.contentType || source.objective || source.caption || source.body)
      ? [source]
      : [];
  const content = candidates.map(normalizeContentDraft).slice(0, 20);
  if (content.length) return content;
  return [normalizeContentDraft({})];
}

function normalizeContentStrategistOutput(output) {
  const source = asObject(output);
  return {
    executionSummary: asLooseText(source.executionSummary || source.summary, 'Prepared simulation-safe content drafts.').slice(0, 3000),
    content: normalizeContentCollection(source),
    tasks: normalizeTaskProposals(source.tasks || source.nextTasks || source.followUpTasks)
  };
}

function normalizeSocialCreativeOutput(output) {
  const source = asObject(output);
  return {
    executionSummary: asLooseText(source.executionSummary || source.summary, 'Prepared social creative draft output.').slice(0, 3000),
    content: normalizeContentCollection(source).slice(0, 12)
  };
}

function normalizeReportType(value) {
  const normalized = asLooseText(value, '').toUpperCase().replace(/[^A-Z_]/g, '_');
  if (REPORT_TYPES.has(normalized)) return normalized;
  if (normalized.includes('WEEK')) return 'WEEKLY';
  if (normalized.includes('FOUNDER')) return 'FOUNDER_BRIEF';
  if (normalized.includes('STRATEGY') || normalized.includes('REVIEW')) return 'STRATEGY_REVIEW';
  return 'DAILY';
}

function normalizeDateString(value, fallback) {
  const parsed = new Date(typeof value === 'string' ? value : fallback);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed.toISOString().slice(0, 10);
}

function normalizeInsights(value, max = 20) {
  return asArray(value).map(entry => {
    const item = asObject(entry);
    const evidence = asArray(item.evidence)
      .map(line => asLooseText(line, ''))
      .filter(Boolean)
      .slice(0, 12)
      .map(line => line.slice(0, 500));
    return {
      title: asLooseText(item.title, 'Marketplace insight').slice(0, 200),
      summary: asLooseText(item.summary, 'Review current marketplace data for trend confirmation.').slice(0, 3000),
      evidence,
      priority: normalizePriority(item.priority)
    };
  }).slice(0, max);
}

function normalizeAnalyticsOutput(output) {
  const source = asObject(output);
  const now = isoDate();
  const metrics = Object.fromEntries(Object.entries(asObject(source.metrics)).map(([key, value]) => {
    const metricKey = asLooseText(key, '').slice(0, 120);
    if (!metricKey) return null;
    const numeric = Number(value);
    return [metricKey, Number.isFinite(numeric) ? numeric : null];
  }).filter(Boolean));
  const recommendations = asArray(source.recommendations)
    .map(item => asLooseText(item, ''))
    .filter(Boolean)
    .slice(0, 20)
    .map(item => item.slice(0, 1000));
  const instrumentationGaps = asArray(source.instrumentationGaps || source.instrumentation_gaps)
    .map(item => asLooseText(item, ''))
    .filter(Boolean)
    .slice(0, 30)
    .map(item => item.slice(0, 500));
  return {
    executionSummary: asLooseText(source.executionSummary || source.summary, 'Generated analytics summary with current instrumentation caveats.').slice(0, 3000),
    reportType: normalizeReportType(source.reportType || source.report_type),
    periodStart: normalizeDateString(source.periodStart || source.period_start, now),
    periodEnd: normalizeDateString(source.periodEnd || source.period_end, now),
    metrics,
    insights: normalizeInsights(source.insights, 20),
    recommendations,
    instrumentationGaps
  };
}

function normalizeAgentOutput(role, output) {
  if (role === 'MARKETING_DIRECTOR') return normalizeDirectorOutput(output);
  if (role === 'CONTENT_STRATEGIST') return normalizeContentStrategistOutput(output);
  if (role === 'SOCIAL_CREATIVE') return normalizeSocialCreativeOutput(output);
  if (role === 'MARKETING_ANALYTICS') return normalizeAnalyticsOutput(output);
  return output;
}

async function runtimeSettings(pool, config) {
  const result = await pool.query(`select setting_key, setting_value from fas_ai_marketing_settings
    where setting_key in ('system_enabled','simulation_mode','external_actions_enabled','autopublish_enabled','brand_memory')`);
  const settings = Object.fromEntries(result.rows.map(row => [row.setting_key, row.setting_value]));
  return {
    enabled: config.aiMarketingEnabled && settings.system_enabled !== false,
    simulationMode: config.aiMarketingSimulationMode || settings.simulation_mode !== false,
    externalActionsEnabled: config.aiExternalActionsEnabled && settings.external_actions_enabled === true,
    autopublishEnabled: config.aiAutopublishEnabled && settings.autopublish_enabled === true,
    brandMemory: settings.brand_memory || {}
  };
}

async function recoverStaleRunningRuns(pool, agent, staleMinutes = 10) {
  const stale = await pool.query(`update fas_ai_agent_runs
    set status = 'FAILED', ended_at = now(),
        duration_ms = coalesce(duration_ms, extract(epoch from (now() - started_at)) * 1000),
        error = coalesce(error, $3)
    where agent_id = $1 and status = 'RUNNING' and started_at < now() - make_interval(mins => $2)
    returning id, task_id as "taskId"`, [agent.id, staleMinutes, { code: 'AI_RUN_TIMEOUT', message: `Run exceeded ${staleMinutes} minute timeout window.` }]);
  for (const row of stale.rows) {
    if (!row.taskId) continue;
    await pool.query(`update fas_ai_tasks
      set status = case when attempt_count < max_attempts then 'QUEUED' else 'FAILED' end,
          error = $2,
          completed_at = case when attempt_count >= max_attempts then now() else completed_at end,
          scheduled_at = case when attempt_count < max_attempts then now() + interval '5 minutes' else scheduled_at end
      where id = $1 and status = 'RUNNING'`, [row.taskId, { code: 'AI_RUN_TIMEOUT', message: `Run exceeded ${staleMinutes} minute timeout window.` }]);
  }
}

async function assertRunLimits(pool, config, agent) {
  const staleMinutes = Math.max(2, Math.ceil(Number(config.aiMarketingProviderTimeoutMs || 60_000) / 60_000) + 1);
  await recoverStaleRunningRuns(pool, agent, staleMinutes);
  const result = await pool.query(`select
      count(*) filter (where created_at >= date_trunc('hour', now()) and status in ('RUNNING','COMPLETED'))::int as "hourlyRuns",
      count(*) filter (where created_at >= date_trunc('day', now()) and status in ('RUNNING','COMPLETED'))::int as "dailyRuns",
      count(*) filter (where status = 'RUNNING')::int as "activeRuns"
    from fas_ai_agent_runs where agent_id = $1`, [agent.id]);
  const usage = result.rows[0];
  if (Number(usage.activeRuns) > 0) throw serviceError(`${agent.name} already has an active run.`, 409, 'AI_CONCURRENT_RUN');
  if (Number(usage.hourlyRuns) >= agent.hourlyRunLimit || Number(usage.dailyRuns) >= agent.dailyRunLimit) {
    throw serviceError(`${agent.name} has reached its configured run limit.`, 429, 'AI_RUN_LIMIT');
  }
}

function expectedRunReservationAed(config, agent) {
  const maxCap = Number(config.aiMarketingMaxRunCostAed || 0);
  const agentCap = Math.min(Number(agent.dailyCostLimitAed || 0), Number(agent.monthlyCostLimitAed || 0));
  const floor = 1;
  const baseline = Math.max(floor, agentCap * 0.1);
  return Math.min(maxCap, baseline);
}

export async function createMarketingTask(pool, input) {
  const agent = input.assignedAgentSlug ? await getAgentBySlug(pool, input.assignedAgentSlug) : null;
  if (input.assignedAgentSlug && !agent) throw serviceError('Assigned agent was not found.', 422, 'AI_AGENT_NOT_FOUND');
  const result = await pool.query(`insert into fas_ai_tasks
      (title, description, created_by, created_by_admin_id, assigned_agent_id, parent_task_id, campaign_id, goal_id, priority, status, scheduled_at, max_attempts, idempotency_key, input)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'QUEUED',$10,$11,$12,$13)
    on conflict (idempotency_key) do update set idempotency_key = excluded.idempotency_key
    returning id, title, status, created_at as "createdAt"`, [
    input.title, input.description || null, input.createdBy, input.createdByAdminId || null, agent?.id || input.assignedAgentId || null,
    input.parentTaskId || null, input.campaignId || null, input.goalId || null, input.priority || 'NORMAL', input.scheduledAt || new Date(),
    input.maxAttempts || 3, input.idempotencyKey || null, input.input || {}
  ]);
  return result.rows[0];
}

async function collectContext({ pool, config, agent, runId, task }) {
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - 8 * 24 * 60 * 60 * 1000);
  const context = {};
  for (const toolName of defaultContextTools(agent)) {
    const args = toolName === 'getMarketplaceMetrics' ? { startDate, endDate } : {};
    context[toolName] = await executeMarketingTool({ pool, config, agent, runId, taskId: task?.id || null, toolName, args });
  }
  return context;
}

async function persistTasks(pool, output, run, task) {
  for (const proposal of output.tasks || []) {
    await createMarketingTask(pool, {
      ...proposal,
      createdBy: `agent:${run.agentSlug}`,
      parentTaskId: task?.id || null,
      campaignId: task?.campaignId || null,
      goalId: task?.goalId || null,
      idempotencyKey: `${run.id}:${proposal.assignedAgentSlug}:${proposal.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80)}`
    });
  }
}

async function persistContent(pool, output, run, task) {
  for (const draft of output.content || []) {
    const inserted = await pool.query(`insert into fas_marketing_content
        (campaign_id, created_by_agent_id, task_id, platform, content_type, language, original_language, language_variant,
         translation_review_status, persona, funnel_stage, objective, headline, caption, body, cta, hashtags, creative_brief,
         image_prompt, video_script, status, scheduled_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'AWAITING_APPROVAL',$21)
      returning id`, [task?.campaignId || null, run.agentId, task?.id || null, draft.platform, draft.contentType, draft.language,
      draft.originalLanguage, draft.languageVariant, draft.originalLanguage ? 'PENDING' : null, draft.persona, draft.funnelStage,
      draft.objective, draft.headline, draft.caption, draft.body, draft.cta, draft.hashtags, draft.creativeBrief, draft.imagePrompt,
      draft.videoScript, draft.scheduledAt]);
    const contentId = inserted.rows[0].id;
    await pool.query(`insert into fas_marketing_content_versions (content_id, version_number, content_snapshot, change_summary, created_by_agent_id)
      values ($1,1,$2,'Initial AI-generated draft',$3)`, [contentId, draft, run.agentId]);
    await pool.query(`insert into fas_approval_requests
        (category, title, summary, agent_id, agent_run_id, task_id, campaign_id, reason, rationale_summary, proposed_action, preview, estimated_cost_aed, risk_level)
      values ('CONTENT_PUBLICATION',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,'LOW')`, [
      `Review ${draft.platform} ${draft.contentType}`, draft.objective, run.agentId, run.id, task?.id || null, task?.campaignId || null,
      'Human review is mandatory before any publication.', output.executionSummary, { action: 'REVIEW_CONTENT', contentId }, draft
    ]);
  }
}

async function persistApprovals(pool, output, run, task) {
  for (const proposal of output.approvalProposals || []) {
    await pool.query(`insert into fas_approval_requests
        (category, title, summary, agent_id, agent_run_id, task_id, campaign_id, reason, rationale_summary, proposed_action, risk_level)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [proposal.category, proposal.title, proposal.summary,
      run.agentId, run.id, task?.id || null, task?.campaignId || null, proposal.reason, output.executionSummary,
      proposal.proposedAction, proposal.riskLevel]);
  }
}

async function persistReport(pool, output, run) {
  if (!output.reportType) return;
  await pool.query(`insert into fas_marketing_reports
      (report_type, period_start, period_end, agent_id, agent_run_id, summary, metrics, insights, recommendations, instrumentation_gaps)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    on conflict (report_type, period_start, period_end) do nothing`, [output.reportType, output.periodStart, output.periodEnd,
    run.agentId, run.id, output.executionSummary, output.metrics, output.insights, output.recommendations, output.instrumentationGaps]);
}

async function failRun(pool, runId, taskId, error) {
  const payload = { code: error.code || 'AI_RUN_FAILED', message: error.message };
  await pool.query(`update fas_ai_agent_runs set status = 'FAILED', ended_at = now(), duration_ms = extract(epoch from (now() - started_at)) * 1000, error = $2 where id = $1`, [runId, payload]);
  if (taskId) await pool.query(`update fas_ai_tasks set status = case when attempt_count < max_attempts then 'QUEUED' else 'FAILED' end,
    error = $2, completed_at = case when attempt_count >= max_attempts then now() else null end,
    scheduled_at = case when attempt_count < max_attempts then now() + make_interval(secs => least(3600, power(2, attempt_count)::int * 60)) else scheduled_at end where id = $1`, [taskId, payload]);
}

export async function executeAgent({ pool, config, agentSlug, taskId = null, idempotencyKey = null, requestId = null, provider = null, replayOfRunId = null }) {
  const settings = await runtimeSettings(pool, config);
  if (!settings.enabled) throw serviceError('AI Marketing is OFF. Historical data remains available.', 409, 'AI_MARKETING_DISABLED');
  const agent = await getAgentBySlug(pool, agentSlug);
  if (!agent) throw serviceError('AI agent was not found.', 404, 'AI_AGENT_NOT_FOUND');
  if (!agentFeatureEnabled(config, agent.slug)) throw serviceError(`${agent.name} is disabled by configuration.`, 409, 'AI_AGENT_FEATURE_DISABLED');
  if (agent.status !== 'ACTIVE') throw serviceError(`${agent.name} is ${agent.status.toLowerCase()}.`, 409, 'AI_AGENT_INACTIVE');
  if (settings.simulationMode && !agent.simulationAllowed) throw serviceError(`${agent.name} cannot run in Simulation Mode.`, 409, 'AI_SIMULATION_NOT_ALLOWED');
  if (idempotencyKey) {
    const previous = await pool.query(`select id, status from fas_ai_agent_runs where idempotency_key = $1 and status = 'COMPLETED'`, [idempotencyKey]);
    if (previous.rowCount) return { duplicate: true, runId: previous.rows[0].id, status: previous.rows[0].status };
  }
  await assertRunLimits(pool, config, agent);
  await assertBudgetAvailable(pool, config, agent, expectedRunReservationAed(config, agent));
  const taskResult = taskId ? await pool.query(`select id, campaign_id as "campaignId", goal_id as "goalId", input, attempt_count as "attemptCount", max_attempts as "maxAttempts" from fas_ai_tasks where id = $1`, [taskId]) : null;
  const task = taskResult?.rows[0] || null;
  const model = selectModel(config, agent);
  const runResult = await pool.query(`insert into fas_ai_agent_runs
      (agent_id, task_id, replay_of_run_id, status, provider, model, model_tier, agent_prompt_version, simulation_mode, idempotency_key, started_at, request_id, raw_response_expires_at)
    values ($1,$2,$3,'RUNNING',$4,$5,$6,$7,$8,$9,now(),$10,now() + make_interval(days => $11)) returning id`, [
    agent.id, taskId, replayOfRunId, provider?.name || config.aiProvider, model, agent.modelTier, agent.promptVersion,
    settings.simulationMode, idempotencyKey, requestId, config.aiRawPayloadRetentionDays
  ]);
  const run = { id: runResult.rows[0].id, agentId: agent.id, agentSlug: agent.slug };
  if (taskId) await pool.query(`update fas_ai_tasks set status = 'RUNNING', started_at = coalesce(started_at, now()), attempt_count = attempt_count + 1 where id = $1`, [taskId]);
  try {
    const controlledContext = await collectContext({ pool, config, agent, runId: run.id, task });
    const generationProvider = createMarketingProvider(config, provider);
    const schema = agentOutputSchemas[agent.role];
    if (!schema) throw serviceError(`No output schema is registered for ${agent.role}.`, 500, 'AI_SCHEMA_MISSING');
    const generationContext = {
      simulationMode: settings.simulationMode,
      externalActionsEnabled: settings.externalActionsEnabled,
      autopublishEnabled: settings.autopublishEnabled,
      brandMemory: settings.brandMemory,
      task: task ? { id: task.id, input: task.input } : null,
      CONTROLLED_DATA: controlledContext,
      UNTRUSTED_DATA: []
    };
    const maxSchemaAttempts = 3;
    let schemaAttemptsUsed = 0;
    let validationHints = null;
    let generated = null;
    let parsed = null;
    const usageTotals = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
    let actualCost = null;
    for (let attempt = 1; attempt <= maxSchemaAttempts; attempt += 1) {
      schemaAttemptsUsed = attempt;
      try {
        generated = await generationProvider.generateStructured({
          model,
          systemInstructions: agent.systemInstructions,
          schemaName: agent.role,
          context: generationContext,
          validationHints
        });
      } catch (error) {
        const malformed = error?.code === 'AI_PROVIDER_MALFORMED_OUTPUT' ||
          /malformed structured output/i.test(String(error?.message || ''));
        if (malformed && attempt < maxSchemaAttempts) {
          validationHints = [{
            path: '(root)',
            message: 'Return one valid JSON object with only schema fields. Do not include markdown fences or extra prose.'
          }];
          continue;
        }
        throw error;
      }
      usageTotals.inputTokens += Number(generated.usage?.inputTokens || 0);
      usageTotals.cachedInputTokens += Number(generated.usage?.cachedInputTokens || 0);
      usageTotals.outputTokens += Number(generated.usage?.outputTokens || 0);
      if (generated.actualCostAed !== null && generated.actualCostAed !== undefined) {
        actualCost = (actualCost || 0) + Number(generated.actualCostAed || 0);
      }
      const normalizedOutput = normalizeAgentOutput(agent.role, generated.output);
      parsed = schema.safeParse(normalizedOutput);
      if (parsed.success) break;
      if (attempt < maxSchemaAttempts) {
        validationHints = parsed.error.issues.slice(0, 8).map(issue => ({
          path: issue.path.length ? issue.path.join('.') : '(root)',
          message: issue.message
        }));
      }
    }
    if (!parsed?.success) throw serviceError('AI output did not match the required schema.', 502, 'AI_OUTPUT_INVALID');
    const output = parsed.data;
    const usage = usageTotals;
    const estimatedCost = estimateCostAed({ modelTier: agent.modelTier, ...usage });
    await persistTasks(pool, output, run, task);
    await persistContent(pool, output, run, task);
    await persistApprovals(pool, output, run, task);
    await persistReport(pool, output, run);
    await pool.query(`update fas_ai_agent_runs set status = 'COMPLETED', ended_at = now(),
      duration_ms = extract(epoch from (now() - started_at)) * 1000, input_tokens = $2, cached_input_tokens = $3,
      output_tokens = $4, cost_aed = $5, execution_summary = $6, structured_output = $7, raw_response = $8 where id = $1`, [
      run.id, usage.inputTokens, usage.cachedInputTokens, usage.outputTokens, actualCost ?? estimatedCost,
      output.executionSummary, output, generated.rawResponse
    ]);
    await pool.query(`insert into fas_ai_cost_ledger
        (agent_id, agent_run_id, task_id, campaign_id, workflow, provider, model, input_tokens, cached_input_tokens,
         output_tokens, api_cost_aed, estimated_cost_aed, actual_cost_aed, metadata)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [agent.id, run.id, taskId, task?.campaignId || null,
      agent.role, generationProvider.name, model, usage.inputTokens, usage.cachedInputTokens, usage.outputTokens,
      actualCost ?? estimatedCost, estimatedCost, actualCost, { promptVersion: agent.promptVersion, schemaAttempts: schemaAttemptsUsed }]);
    if (taskId) await pool.query(`update fas_ai_tasks set status = 'COMPLETED', completed_at = now(), output = $2, error = null where id = $1`, [taskId, output]);
    console.info(JSON.stringify({ level: 'info', event: 'marketing_ai_run_completed', agentId: agent.id, agentRunId: run.id, taskId, requestId, costAed: actualCost ?? estimatedCost }));
    return { runId: run.id, status: 'COMPLETED', output, costAed: actualCost ?? estimatedCost, simulationMode: settings.simulationMode };
  } catch (error) {
    await failRun(pool, run.id, taskId, error);
    console.error(JSON.stringify({ level: 'error', event: 'marketing_ai_run_failed', agentId: agent.id, agentRunId: run.id, taskId, requestId, code: error.code, message: error.message }));
    throw error;
  }
}

export async function runScheduledWorkflow({ pool, config, schedule, provider = null }) {
  const date = isoDate();
  return executeAgent({
    pool,
    config,
    agentSlug: schedule.agentSlug,
    idempotencyKey: `${schedule.workflow.toLowerCase()}:${date}`,
    provider
  });
}