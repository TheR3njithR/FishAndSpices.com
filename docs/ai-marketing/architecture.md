# Architecture

## Repository assessment

The application is Node.js 22, Express 5, ES modules, PostgreSQL through `pg`, static HTML/CSS/JavaScript admin pages, Vitest, and checksum-locked SQL migrations. There is no ORM or frontend framework. Railway runs migrations before the web process and checks `/api/health`. Existing administrator sessions, CSRF protection, role checks, audit records, parameterized SQL, persistent rate limiting, marketplace services, partner attribution, and the central OpenAI client were reused.

## Runtime

```text
Admin workspace -> protected marketing API -> services -> PostgreSQL
                                             -> shared orchestrator
                                             -> controlled tools
                                             -> configured AI provider
Railway worker -> task claim + schedules ----^
```

Agents are database definitions, not applications. Each run records agent and prompt version, task, model, usage, costs, tools, summary, errors, and compact raw response retention. AI receives aggregate marketplace metrics and approved context, not credentials or unnecessary contact data.

The worker claims work with `FOR UPDATE SKIP LOCKED`. Task and schedule keys provide idempotency. Failed tasks use bounded attempts and exponential retry delays. Scheduled times are explicit in `Asia/Kolkata`.

No separate AI database, queue product, event bus, vector database, or agent service was introduced.
