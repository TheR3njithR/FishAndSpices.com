-- Recover tasks stranded in WAITING by pre-run failures.

update fas_ai_tasks
set status = 'QUEUED',
    scheduled_at = coalesce(scheduled_at, now()),
    error = coalesce(error, jsonb_build_object('code', 'AI_TASK_RECOVERED', 'message', 'Recovered from WAITING during worker resiliency patch'))
where status = 'WAITING' and started_at is null;