# Operations Runbook

## Enable and disable

Set `AI_MARKETING_ENABLED=true` and keep `AI_MARKETING_SIMULATION_MODE=true`. A super administrator can use the prominent workspace switch for an emergency stop. Environment `false` always wins over the database ON setting.

## Normal operations

- Pause/resume: Agents view, then Pause or Resume.
- Manual run: Agents view, Run now. Review tier, simulation state, and maximum cost in the confirmation result.
- Inspect failure: Tasks or Activity view; review error, attempts, model, prompt version, and tools.
- Rerun: use Rerun on a failed task. A new linked task/run is created; original logs are unchanged.
- Approve/reject: Approvals view; select a structured feedback reason and comments.
- Cost review: Costs view; check today, month, projection, agent/model breakdown, and threshold.
- Change budget/model: update Railway environment variables and redeploy to staging first.

## Emergency stop

1. Select `TURN OFF` in the workspace as super administrator.
2. Confirm worker claims stop and dashboards remain available.
3. Inspect Activity, Tasks, Costs, and Health.
4. If required, set `AI_MARKETING_ENABLED=false` in Railway staging and redeploy.
5. Preserve run/task/approval records for investigation.

## Railway

Keep the current web service and predeploy migration. Add one worker service from the same image with start command `npm run start:marketing-worker`. Configure the documented environment variables on web and worker. Deploy staging, run migrations, verify health and the controlled workflow, then consider production promotion. Never add one service per agent.
