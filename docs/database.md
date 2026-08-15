# Database operations

Railway PostgreSQL is private infrastructure. The application uses `DATABASE_URL`; migrations prefer `DATABASE_UNPOOLED_URL` when available.

## Migrations

```powershell
npm run migrate
```

The runner takes a PostgreSQL advisory lock, creates `schema_migrations`, verifies SHA-256 checksums for previously applied files, and applies each new `db/migrations/*.sql` file in its own transaction. Never edit an applied migration. Add a new numbered migration instead.

Railway runs the same command as a predeploy step. A failed migration prevents the new application deployment from starting.

## Administrator bootstrap

No administrator is seeded. Set `ADMIN_BOOTSTRAP_EMAIL`, `ADMIN_BOOTSTRAP_PASSWORD`, `ADMIN_BOOTSTRAP_NAME` and optionally `ADMIN_BOOTSTRAP_ROLE`, then run `npm run bootstrap-admin`. Existing accounts are not changed unless `ADMIN_BOOTSTRAP_ROTATE=true` is explicitly set.

Unset bootstrap password variables after use. Do not store them in Git or long-lived Railway variables.

## Backups and restore

Enable Railway volume backups for PostgreSQL and verify their schedule in the Railway dashboard. Before a high-risk migration, create an additional provider backup or `pg_dump` from an authorized environment. Test restoration into an isolated staging database at least quarterly; a backup is not verified until a restore and row-count/integrity check succeeds.

Do not expose the PostgreSQL service publicly for routine administration. Use Railway's private network or an approved temporary access workflow, then remove temporary access.