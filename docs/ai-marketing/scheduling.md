# Scheduling

The shared worker runs `npm run start:marketing-worker`. It polls PostgreSQL, queues due schedules, claims one task with row locking, and invokes the common orchestrator. It is suitable for one Railway worker service and does not use browser timers.

Seeded schedules:

- Director daily plan: 07:00 Asia/Kolkata
- Analytics daily report: 23:30 Asia/Kolkata
- Weekly strategy review: Monday 06:30 Asia/Kolkata

Logical keys such as `daily_marketing_plan:2026-08-17` prevent duplicate scheduled work. `next_run_at`, cron expression, enabled state, and timezone are persisted. Run `npm run marketing-worker:once` only for a controlled one-cycle operational check.
