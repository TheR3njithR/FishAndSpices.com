const DEFAULT_PRICING_AED_PER_MILLION = Object.freeze({
  ECONOMY: { input: 0.75, cachedInput: 0.08, output: 6 },
  STANDARD: { input: 9.2, cachedInput: 0.92, output: 36.7 },
  PREMIUM: { input: 18.4, cachedInput: 1.84, output: 73.4 }
});

export function selectModel(config, agent) {
  if (agent.preferredModel) return agent.preferredModel;
  const models = { ECONOMY: config.aiModelEconomy, STANDARD: config.aiModelStandard, PREMIUM: config.aiModelPremium };
  return models[agent.modelTier] || config.aiModelStandard;
}

export function estimateCostAed({ modelTier, inputTokens = 0, cachedInputTokens = 0, outputTokens = 0 }) {
  const rate = DEFAULT_PRICING_AED_PER_MILLION[modelTier] || DEFAULT_PRICING_AED_PER_MILLION.STANDARD;
  const uncachedInput = Math.max(0, inputTokens - cachedInputTokens);
  return ((uncachedInput * rate.input) + (cachedInputTokens * rate.cachedInput) + (outputTokens * rate.output)) / 1_000_000;
}

export async function getCostStatus(pool, config, now = new Date()) {
  const result = await pool.query(`select
      coalesce(sum(coalesce(actual_cost_aed, estimated_cost_aed, api_cost_aed + tool_cost_aed)) filter (where timestamp >= date_trunc('day', $1::timestamptz)), 0)::float as "costToday",
      coalesce(sum(coalesce(actual_cost_aed, estimated_cost_aed, api_cost_aed + tool_cost_aed)) filter (where timestamp >= date_trunc('month', $1::timestamptz)), 0)::float as "costThisMonth"
    from fas_ai_cost_ledger`, [now]);
  const costToday = Number(result.rows[0]?.costToday || 0);
  const costThisMonth = Number(result.rows[0]?.costThisMonth || 0);
  const budgetMonth = config.aiMonthlyBudgetAed;
  const percentUsed = budgetMonth > 0 ? (costThisMonth / budgetMonth) * 100 : 100;
  const day = now.getUTCDate();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  return {
    costToday,
    costThisMonth,
    budgetToday: budgetMonth / daysInMonth,
    budgetMonth,
    remainingBudget: Math.max(0, budgetMonth - costThisMonth),
    estimatedEndOfMonthSpend: day > 0 ? (costThisMonth / day) * daysInMonth : costThisMonth,
    percentUsed,
    level: percentUsed >= 100 ? 'HARD_STOP' : percentUsed >= config.aiCriticalThresholdPercent ? 'CRITICAL' : percentUsed >= config.aiWarningThresholdPercent ? 'WARNING' : 'NORMAL'
  };
}

export async function assertBudgetAvailable(pool, config, agent, expectedMaximumCostAed = 0) {
  const status = await getCostStatus(pool, config);
  if (status.level === 'HARD_STOP' || status.costThisMonth + expectedMaximumCostAed > status.budgetMonth) {
    const error = new Error('AI spending has reached this month\'s limit. Existing results remain available.');
    error.status = 409;
    error.code = 'AI_MONTHLY_BUDGET_EXCEEDED';
    throw error;
  }
  const agentCost = await pool.query(`select
      coalesce(sum(coalesce(actual_cost_aed, estimated_cost_aed, api_cost_aed + tool_cost_aed)) filter (where timestamp >= date_trunc('day', now())), 0)::float as "today",
      coalesce(sum(coalesce(actual_cost_aed, estimated_cost_aed, api_cost_aed + tool_cost_aed)) filter (where timestamp >= date_trunc('month', now())), 0)::float as "month"
    from fas_ai_cost_ledger where agent_id = $1`, [agent.id]);
  if (Number(agentCost.rows[0]?.today || 0) + expectedMaximumCostAed > agent.dailyCostLimitAed ||
      Number(agentCost.rows[0]?.month || 0) + expectedMaximumCostAed > agent.monthlyCostLimitAed) {
    const error = new Error(`${agent.name} has reached its configured cost limit.`);
    error.status = 409;
    error.code = 'AI_AGENT_BUDGET_EXCEEDED';
    throw error;
  }
  return status;
}
