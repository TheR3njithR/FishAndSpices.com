const EXTERNAL_TOOLS = new Set(['publishContent', 'messageUser', 'sendWhatsApp', 'sendEmail', 'spendMoney']);

export async function getMarketplaceMetrics(pool, { startDate, endDate }) {
  const result = await pool.query(`select
      count(*) filter (where l.lead_role = 'seller')::int as "sellerRegistrations",
      count(*) filter (where l.lead_role = 'seller' and l.verification_status = 'Verified')::int as "verifiedSellers",
      count(*) filter (where l.lead_role = 'buyer')::int as "buyerRegistrations",
      count(*) filter (where l.lead_role = 'buyer' and l.verification_status = 'Verified')::int as "verifiedBuyers",
      (select count(*)::int from matches m where m.created_at >= $1 and m.created_at < $2) as "buyerSellerMatches",
      (select count(*)::int from fas_quotes q where q.created_at >= $1 and q.created_at < $2) as "sellerResponses",
      (select count(*)::int from fas_contact_requests c where c.created_at >= $1 and c.created_at < $2) as "buyerResponses"
    from leads l where l.submitted_at >= $1 and l.submitted_at < $2 and l.archived_at is null`, [startDate, endDate]);
  return {
    websiteVisitors: null,
    ...result.rows[0],
    rfqsCreated: null,
    rfqsMatched: null,
    transactions: null,
    estimatedGMVPipeline: null,
    organicTraffic: null,
    directTraffic: null,
    socialTraffic: null,
    referralTraffic: null,
    instrumentationGaps: ['Website traffic events', 'Explicit RFQ lifecycle', 'Transaction and GMV records', 'First-party channel attribution']
  };
}

const toolHandlers = {
  getMarketplaceMetrics: ({ pool }, args) => getMarketplaceMetrics(pool, args),
  getMarketingGoals: async ({ pool }) => (await pool.query(`select id, name, description, start_date as "startDate", end_date as "endDate",
    target_seller_registrations as "targetSellerRegistrations", target_verified_sellers as "targetVerifiedSellers",
    target_buyer_registrations as "targetBuyerRegistrations", target_verified_buyers as "targetVerifiedBuyers",
    target_rfqs as "targetRfqs", target_matches as "targetMatches", target_transactions as "targetTransactions",
    target_gmv as "targetGmv", priority_categories as "priorityCategories", priority_locations as "priorityLocations",
    priority_personas as "priorityPersonas", status from fas_marketing_goals where status = 'ACTIVE' order by start_date desc`)).rows,
  getPreviousMarketingReports: async ({ pool }) => (await pool.query(`select report_type as "reportType", period_start as "periodStart", period_end as "periodEnd", summary, metrics, insights, recommendations, instrumentation_gaps as "instrumentationGaps" from fas_marketing_reports order by period_end desc limit 5`)).rows,
  getContentPerformance: async ({ pool }) => (await pool.query(`select metric_name as "metricName", value, unit, metric_date as "metricDate", instrumentation_status as "instrumentationStatus" from fas_marketing_metrics where metric_level <= 3 order by metric_date desc limit 100`)).rows,
  getCampaignPerformance: async ({ pool }) => (await pool.query(`select c.id, c.name, c.status, c.primary_metric as "primaryMetric", count(mc.id)::int as "contentCount" from fas_marketing_campaigns c left join fas_marketing_content mc on mc.campaign_id = c.id group by c.id order by c.created_at desc limit 30`)).rows,
  getPreviousAgentRuns: async ({ pool }) => (await pool.query(`select r.status, r.execution_summary as "executionSummary", r.created_at as "createdAt", a.slug as agent from fas_ai_agent_runs r join fas_ai_agents a on a.id = r.agent_id order by r.created_at desc limit 20`)).rows
};

export function assertToolAllowed({ agent, toolName, config }) {
  if (!agent.allowedTools.includes(toolName) || agent.deniedTools.includes(toolName)) {
    const error = new Error(`Tool ${toolName} is not permitted for ${agent.name}.`); error.code = 'AI_TOOL_FORBIDDEN'; error.status = 403; throw error;
  }
  if (EXTERNAL_TOOLS.has(toolName) && (config.aiMarketingSimulationMode || !config.aiExternalActionsEnabled)) {
    const error = new Error(`Tool ${toolName} is blocked by Simulation Mode or external-action settings.`); error.code = 'AI_SIMULATION_BLOCKED'; error.status = 409; throw error;
  }
  if (!toolHandlers[toolName]) {
    const error = new Error(`Tool ${toolName} is unavailable.`); error.code = 'AI_TOOL_UNAVAILABLE'; error.status = 422; throw error;
  }
}

export async function executeMarketingTool({ pool, config, agent, runId, taskId, toolName, args }) {
  const started = Date.now();
  try {
    assertToolAllowed({ agent, toolName, config });
    const result = await toolHandlers[toolName]({ pool, config }, args);
    await pool.query(`insert into fas_ai_marketing_tool_calls (agent_run_id, task_id, tool_name, arguments_json, result_summary, status, duration_ms)
      values ($1,$2,$3,$4,$5,'COMPLETED',$6)`, [runId, taskId, toolName, args, { recordCount: Array.isArray(result) ? result.length : undefined }, Date.now() - started]);
    return result;
  } catch (error) {
    await pool.query(`insert into fas_ai_marketing_tool_calls (agent_run_id, task_id, tool_name, arguments_json, status, blocked_reason, duration_ms)
      values ($1,$2,$3,$4,$5,$6,$7)`, [runId, taskId, toolName, args, error.code?.includes('BLOCKED') || error.code?.includes('FORBIDDEN') ? 'BLOCKED' : 'FAILED', error.message, Date.now() - started]);
    throw error;
  }
}

export function defaultContextTools(agent) {
  const order = ['getMarketplaceMetrics', 'getMarketingGoals', 'getCampaignPerformance', 'getContentPerformance', 'getPreviousAgentRuns', 'getPreviousMarketingReports'];
  return order.filter(tool => agent.allowedTools.includes(tool));
}