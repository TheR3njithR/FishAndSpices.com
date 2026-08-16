function mapAgent(row) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    role: row.role,
    status: row.status,
    systemInstructions: row.systemInstructions,
    promptVersion: row.promptVersion,
    modelTier: row.modelTier,
    preferredModel: row.preferredModel,
    fallbackModel: row.fallbackModel,
    simulationAllowed: row.simulationAllowed,
    autoExecutionAllowed: row.autoExecutionAllowed,
    dailyRunLimit: Number(row.dailyRunLimit),
    hourlyRunLimit: Number(row.hourlyRunLimit),
    dailyCostLimitAed: Number(row.dailyCostLimitAed),
    monthlyCostLimitAed: Number(row.monthlyCostLimitAed),
    requiresApprovalByDefault: row.requiresApprovalByDefault,
    allowedTools: row.allowedTools || [],
    deniedTools: row.deniedTools || [],
    schedule: row.schedule,
    timezone: row.timezone,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

const selection = `select id, slug, name, description, role, status,
  system_instructions as "systemInstructions", prompt_version as "promptVersion",
  model_tier as "modelTier", preferred_model as "preferredModel", fallback_model as "fallbackModel",
  simulation_allowed as "simulationAllowed", auto_execution_allowed as "autoExecutionAllowed",
  daily_run_limit as "dailyRunLimit", hourly_run_limit as "hourlyRunLimit",
  daily_cost_limit_aed as "dailyCostLimitAed", monthly_cost_limit_aed as "monthlyCostLimitAed",
  requires_approval_by_default as "requiresApprovalByDefault", allowed_tools as "allowedTools",
  denied_tools as "deniedTools", schedule, timezone, created_at as "createdAt", updated_at as "updatedAt"
  from fas_ai_agents`;

export async function listAgents(pool) {
  const result = await pool.query(`${selection} order by name`);
  return result.rows.map(mapAgent);
}

export async function getAgentBySlug(pool, slug) {
  const result = await pool.query(`${selection} where slug = $1`, [slug]);
  return result.rowCount ? mapAgent(result.rows[0]) : null;
}

export async function updateAgentStatus(pool, id, status) {
  if (!['ACTIVE', 'PAUSED', 'DISABLED', 'ERROR', 'MAINTENANCE'].includes(status)) {
    const error = new Error('Invalid agent status.'); error.status = 422; throw error;
  }
  const result = await pool.query('update fas_ai_agents set status = $1 where id = $2 returning id, slug, name, status', [status, id]);
  return result.rows[0] || null;
}
