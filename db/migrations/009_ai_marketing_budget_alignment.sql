-- Align agent-level budget limits with the configured per-run reserve so
-- manual and scheduled runs are not blocked by configuration mismatch.

update fas_ai_agents
set daily_cost_limit_aed = 25
where daily_cost_limit_aed < 25;

update fas_ai_agents
set monthly_cost_limit_aed = 25
where monthly_cost_limit_aed < 25;