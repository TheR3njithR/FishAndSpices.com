import { loadConfig } from './config.js';
import { createDatabase, withTransaction } from './db.js';
import { executeAgent } from './services/marketing-ai/orchestrator.js';

const config = loadConfig();
const pool = createDatabase(config);
const pollMilliseconds = Math.max(5_000, Number(process.env.AI_MARKETING_WORKER_POLL_MS || 30_000));
const oneShot = process.argv.includes('--once');
const staleRunTimeoutMinutes = Math.max(5, Number(process.env.AI_MARKETING_STALE_RUN_TIMEOUT_MINUTES || 15));
let stopping = false;

if (!pool) throw new Error('DATABASE_URL is required for the AI Marketing worker.');

async function systemEnabled() {
  const result = await pool.query(`select setting_value from fas_ai_marketing_settings where setting_key = 'system_enabled'`);
  return config.aiMarketingEnabled && result.rows[0]?.setting_value !== false;
}

async function claimTask() {
  return withTransaction(pool, async client => {
    const result = await client.query(`select t.id, a.slug as "agentSlug"
      from fas_ai_tasks t join fas_ai_agents a on a.id = t.assigned_agent_id
      where t.status = 'QUEUED' and coalesce(t.scheduled_at, now()) <= now() and t.attempt_count < t.max_attempts
        and a.status = 'ACTIVE'
      order by case t.priority when 'URGENT' then 0 when 'HIGH' then 1 when 'NORMAL' then 2 else 3 end, t.created_at
      for update of t skip locked limit 1`);
    if (!result.rowCount) return null;
    await client.query(`update fas_ai_tasks set status = 'WAITING' where id = $1`, [result.rows[0].id]);
    return result.rows[0];
  });
}

async function queueDueSchedules() {
  const queued = await withTransaction(pool, async client => {
    const schedules = await client.query(`select s.id, s.name, s.workflow, s.timezone, a.slug as "agentSlug"
      from fas_marketing_schedules s join fas_ai_agents a on a.id = s.agent_id
      where s.enabled and a.status = 'ACTIVE' and s.next_run_at is not null and s.next_run_at <= now()
      order by s.next_run_at for update of s skip locked`);
    const results = [];
    for (const schedule of schedules.rows) {
      const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: schedule.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      const idempotencyKey = `${schedule.workflow.toLowerCase()}:${dateKey}`;
      const inserted = await client.query(`insert into fas_ai_tasks
          (title, description, created_by, assigned_agent_id, priority, status, scheduled_at, idempotency_key, input)
        select $1,$2,'scheduler',a.id,'HIGH','QUEUED',now(),$3,$4 from fas_ai_agents a where a.slug = $5
        on conflict (idempotency_key) do nothing returning id`, [schedule.name, `Scheduled ${schedule.workflow}`, idempotencyKey, { workflow: schedule.workflow, timezone: schedule.timezone }, schedule.agentSlug]);
      await client.query(`update fas_marketing_schedules set last_idempotency_key = $2,
        next_run_at = case when workflow = 'WEEKLY_STRATEGY_REVIEW' then next_run_at + interval '7 days' else next_run_at + interval '1 day' end
        where id = $1`, [schedule.id, idempotencyKey]);
      if (inserted.rowCount) results.push({ scheduleId: schedule.id, taskId: inserted.rows[0].id, idempotencyKey });
    }
    return results;
  });
  for (const item of queued) console.info(JSON.stringify({ level: 'info', event: 'marketing_ai_schedule_queued', ...item }));
}

async function recoverStaleRuns() {
  const recovered = await withTransaction(pool, async client => {
    const stale = await client.query(`select r.id, r.task_id as "taskId", t.attempt_count as "attemptCount", t.max_attempts as "maxAttempts"
      from fas_ai_agent_runs r
      left join fas_ai_tasks t on t.id = r.task_id
      where r.status = 'RUNNING' and r.started_at < now() - make_interval(mins => $1)
      for update of r skip locked`, [staleRunTimeoutMinutes]);
    if (!stale.rowCount) return [];
    const items = [];
    for (const row of stale.rows) {
      const error = { code: 'AI_RUN_TIMEOUT', message: `Run exceeded ${staleRunTimeoutMinutes} minute timeout window.` };
      await client.query(`update fas_ai_agent_runs
        set status = 'FAILED', ended_at = now(),
            duration_ms = coalesce(duration_ms, extract(epoch from (now() - started_at)) * 1000),
            error = coalesce(error, $2)
        where id = $1 and status = 'RUNNING'`, [row.id, error]);
      if (row.taskId) {
        await client.query(`update fas_ai_tasks
          set status = case when attempt_count < max_attempts then 'QUEUED' else 'FAILED' end,
              error = $2,
              completed_at = case when attempt_count >= max_attempts then now() else completed_at end,
              scheduled_at = case when attempt_count < max_attempts then now() + interval '5 minutes' else scheduled_at end
          where id = $1 and status = 'RUNNING'`, [row.taskId, error]);
      }
      items.push({ runId: row.id, taskId: row.taskId });
    }
    return items;
  });
  for (const item of recovered) {
    console.warn(JSON.stringify({ level: 'warn', event: 'marketing_ai_stale_run_recovered', staleRunTimeoutMinutes, ...item }));
  }
}

async function tick() {
  if (!(await systemEnabled())) return;
  await recoverStaleRuns();
  await queueDueSchedules();
  const task = await claimTask();
  if (!task) return;
  try {
    await executeAgent({ pool, config, agentSlug: task.agentSlug, taskId: task.id, idempotencyKey: `task:${task.id}` });
  } catch (error) {
    // If execution fails before a run is created, the task can still be in WAITING.
    // Requeue with backoff so the worker does not leave it stranded.
    await pool.query(`update fas_ai_tasks
      set status = case when attempt_count < max_attempts then 'QUEUED' else 'FAILED' end,
          error = $2,
          completed_at = case when attempt_count >= max_attempts then now() else completed_at end,
          scheduled_at = case when attempt_count < max_attempts then now() + interval '5 minutes' else scheduled_at end
      where id = $1 and status = 'WAITING'`, [task.id, { code: error.code || 'AI_RUN_FAILED', message: error.message }]);
    console.error(JSON.stringify({ level: 'error', event: 'marketing_ai_worker_task_failed', taskId: task.id, code: error.code, message: error.message }));
  }
}

async function run() {
  console.info(JSON.stringify({ level: 'info', event: 'marketing_ai_worker_started', simulationMode: config.aiMarketingSimulationMode, pollMilliseconds }));
  do {
    try { await tick(); } catch (error) { console.error(JSON.stringify({ level: 'error', event: 'marketing_ai_worker_tick_failed', message: error.message })); }
    if (oneShot || stopping) break;
    await new Promise(resolve => setTimeout(resolve, pollMilliseconds));
  } while (!stopping);
  await pool.end();
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; });
run().catch(error => { console.error(error); process.exitCode = 1; });
