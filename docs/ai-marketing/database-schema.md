# Database Schema

Migration `008_ai_marketing_os_phase1.sql` is additive and uses the existing `fas_` namespace.

Core tables:

- `fas_ai_marketing_settings`: founder-controlled runtime settings and brand memory
- `fas_ai_agents`: registry and versioned instructions
- `fas_ai_tasks`, `fas_ai_agent_runs`, `fas_ai_marketing_tool_calls`: work and execution history
- `fas_ai_cost_ledger`: usage and cost by agent/run/task/campaign/workflow/model/time
- `fas_approval_requests`, `fas_approval_actions`: decision queue and immutable feedback history
- `fas_marketing_goals`, `fas_marketing_campaigns`: configurable business direction
- `fas_marketing_content`, `fas_marketing_content_versions`: drafts, translations, variants, calendar status
- `fas_marketing_metrics`, `fas_marketing_reports`: evidence and instrumentation gaps
- `fas_marketing_schedules`: configurable timezone-aware schedules

Indexes cover queue status/time, agent, task, campaign, approval status, content calendar, cost periods, and report periods. Successful run idempotency and task idempotency prevent duplicate workflow results. No existing business table is deleted or reset.
