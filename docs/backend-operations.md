# Local database backup and restore

Run from the repository root with the existing local Docker stack running. These commands use native `pg_dump`/`pg_restore` inside `smart-agro-phase1-db-1`; no extra dependency is installed.

```powershell
node scripts/database-backup.mjs backup
node scripts/database-backup.mjs verify .tmp/backups/<archive>.dump
node scripts/database-backup.mjs restore .tmp/backups/<archive>.dump --target restore_drill_20261114
node --experimental-strip-types --test tests/database-backup.test.ts
```

`backup` defaults to the `postgres` database and a unique archive under ignored `.tmp/backups/`. `--container` and `--database` select an explicit local source. Custom archive paths must remain under this repository's `.tmp/backups/`; parent junctions/symlinks escaping the repository are rejected. Archives are streamed as binary bytes, never through PowerShell text conversion. A complete custom-format database archive includes `auth`, `public`, data, schema and object grants. It contains private account data and authentication secrets: restrict access and never commit, publish, or attach it to an issue. POSIX file modes are requested; Windows access follows existing inherited ACLs, which this tool does not change.

The companion `.dump.json` manifest records source database, creation time, byte count and SHA256. Exclusive temporary files and atomic hard links prevent replacing existing archives/manifests. Partial temporary files are removed on failure. The two-file pair is not one filesystem transaction: an interruption between publication steps can leave an archive without a manifest; verification rejects that archive. `verify` checks the manifest, the entire archive hash and PostgreSQL archive readability before restore. SHA256 detects corruption, not a malicious replacement of both files: restore only trusted archives. SQL archives can execute database code.

Restore creates a **new database only** and fails if that name exists. System database names and the manifest source database are rejected. It never drops databases, cleans schemas, or overwrites an existing target. `pg_restore --single-transaction --exit-on-error` rolls back restored objects on failure; a newly created empty target may remain, so retry with a fresh name. Roles must already exist in the destination PostgreSQL cluster; original object ownership and grants are restored. No original database, global role, password, or Windows ACL is changed. Missing owner/grantee roles cause restore to fail rather than silently change access rights.

A useful drill verifies both a successful restore and matching sorted row fingerprints/table counts for `public` and `auth`, then tests application access separately. Keep drill databases until their owner explicitly authorizes removal. Check for corruption and rejected attempts to reuse archive/database names. Successful archive verification alone is not a recovery drill.

This is a local manual backup tool, not an automated retention or disaster-recovery system. It does not back up Docker settings/signing keys, environment files, global role definitions, external object storage, AI providers, email, or blockchain services. Restoring the database alone may not restore working sessions without the original signing/configuration keys. An archive kept on the same laptop does not protect against disk loss. Hosted Supabase backups/PITR, encrypted off-device storage, retention schedules and production recovery credentials must be configured and tested separately; this tool makes no remote changes.

## Backend request logs

Four deployed Edge entrypoints (`product-claim`, `telemetry-ingest`, `energy-ingest`, `unit-explanation`) and the local Node gateway write one JSON `http_request` event per request at their own boundary. Gateway startup uses the distinct `gateway_ready` event. Stdout can be collected by the existing Supabase/container runtime; no new logger dependency or external collector is required.

Request events contain only `timestamp`, `entryPoint`, fixed `operation`, canonical UUID `requestId`, allowlisted `method`, `status`, `durationMs`, `outcome` and `level`. They do not contain paths, queries, RPC names, headers, tokens, bodies, account/device IDs, exception messages or stacks. Status 429 identifies admission/rate-limit rejections; 5xx produces level `error`; other 4xx and aborts produce `warn`. A completed HTTP response can still be an application error: inspect `status`/`level`, not only `outcome`.

The boundary accepts only UUID-shaped `x-request-id` values (normalized lowercase); otherwise it generates a fresh UUID. It returns this header and exposes it to allowed browser origins. Internal Auth and PostgREST calls forward the same diagnostic ID. Caller-supplied IDs may collide intentionally: never use them for authentication, authorization, idempotency, billing or deduplication. AI-provider requests are not instrumented with this ID, and forwarding a header does not guarantee upstream services retain it in their own logs.

Gateway `finish`/`close` listeners emit once; a disconnected response uses `outcome: aborted` and `status: null`. Edge duration measures handler execution until a Response is created, not network delivery or body-stream completion. Its wrapper records an already-aborted request as aborted, but cannot measure disconnects after the Response returns. An unexpected wrapper exception returns a generic 500 without logging the exception; this fallback does not reflect an untrusted CORS origin, so a browser may not be able to read it. Logging sink failures do not alter the business response.

To investigate failures, filter `http_request` by fixed `operation`, HTTP status and `entryPoint`, then match `requestId` across the gateway/function records. Inspect a 429 surge before changing quotas; a 5xx surge warrants checking Auth/PostgREST health and the migration/handler deployment order. Avoid exporting database/account payloads into incident logs. Investigate from bounded metadata first, using restricted database access only when needed.

These are structured access logs, not a durable security audit ledger, tracing service, metrics backend or alert delivery system. At most one event per handled request per boundary is emitted, including health/preflight/static traffic. Configure log retention/access controls in the deployed runtime; stdout is neither encrypted backup nor guaranteed durable storage. Off-host collection, measured latency percentiles/SLOs and symptom-based alerts remain production operations work.

## Continuous checks

The `backend` job in `.github/workflows/checks.yml` starts the isolated local stack, runs the backend integration suite, then creates/verifies a binary archive and restores it into `ci_restore_drill`. This exercises the restore mechanism on each CI run. It does not compare every restored row or prove hosted recovery. The manual 14 November 2026 drill additionally compared all 56 `auth`/`public` table row fingerprints; see the stage-2 audit. CI does not upload archives or logs, because the database may contain authentication data. This workflow must be pushed and executed before reporting a GitHub Actions result.
