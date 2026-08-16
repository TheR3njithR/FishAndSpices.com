-- Keep director run throughput aligned with manual/scheduled validation flow.

update fas_ai_agents
set hourly_run_limit = greatest(hourly_run_limit, 6),
    daily_run_limit = greatest(daily_run_limit, 12)
where slug = 'marketing-director';