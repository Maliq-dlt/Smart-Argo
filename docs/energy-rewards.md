# Energy evidence and program rewards

Implemented backend and account UI; verified against the isolated local stack on 6 November 2026. Software test keys and synthetic meter references exercise the protocol. They do not verify a physical meter, calibration, useful load, goods delivery, or production deployment.

## Provisioning and boundaries

An administrator assigns `operator` in `account.access_roles` through trusted server administration. The browser cannot grant itself roles. Operators register a dedicated raw 32-byte Ed25519 meter public key as canonical standard base64, calibration reference, useful-load evidence reference, validity period (at most one year) and rated maximum power. At most one active meter is registered per device. Registration is immutable; replacement requires revocation with a reason. Private meter keys never enter the website or source tree.

An operator attests the calibration and eligible-load references; the software does not independently certify them. A signature proves possession of the registered key and exact packet bytes. It cannot prove the sensor is accurate, a load is useful, solar input is genuine, or gardening happened. Preventing deliberate energy waste and unknown battery charging requires trustworthy meter placement, calibration, load verification and operational review before activating a funded program. Manual care logs and ordinary sensor/simulator packets do not earn spendable points.

There is no default reward ratio, active policy, inventory, or subsidy budget. Server policy is explicit and immutable by version; enabling a policy is an operator action. Daily per-account limits are supported, not a program-wide funded budget or cash value. Deployment and physical/funding approval are separate from local software verification.

## Signed meter protocol

Send `POST /functions/v1/energy-ingest` with JSON `{payload, signature}`. `payload` is the exact UTF-8 JSON text signed by the meter; do not reserialize it after signing. `signature` is a canonical standard-base64 64-byte Ed25519 signature. The request is limited to 12 KiB and the payload to 4 KiB. Account JWTs and client-supplied verification flags cannot authorize this endpoint.

The payload has exactly these fields:

| Field | Contract |
| --- | --- |
| `domain`, `schema_version`, `source` | `smart-agro.energy.v1`, `1`, `meter` |
| `meter_id`, `device_id`, `boot_id` | UUIDs; meter must belong to that active device/product |
| `sequence` | Integer 0 through 2147483647, increasing within a device boot |
| `start_at`, `end_at` | UTC ISO timestamps ending in Z; exactly 15 minutes; start aligned to a UTC quarter-hour |
| `clock_status` | `synced` |
| `solar_start_wh`, `solar_end_wh` | Cumulative solar-harvest Wh, finite 0 through 1 billion; no rollback |
| `load_start_wh`, `load_end_wh` | Cumulative useful-load Wh with the same bounds |
| `battery_soc_pct` | NULL when unmeasured, otherwise finite 0 through 100 |

Use a new `boot_id` when counters restart. Within a boot, time and counters cannot move backward. The server derives deltas; neither Wh eligibility nor points are client assertions. Each delta must fit the registered power ceiling times 0.25 hours. SOC/battery discharge never adds new solar harvest. Canonical nonoverlapping windows are checked across all boots and replacement meters for the same device.

New evidence must be completed, at most seven days old, within the meter validity period, and wholly within the current owner's ownership. Product and device locks serialize competing submissions. At most 120 new windows per device per minute are accepted. The server records receipt time, original signed bytes, SHA256, signature, meter and ownership.

An exact retry of device/boot/sequence returns `duplicate:true` and `credited:0`, meaning **zero additional credit**. It does not call the reward calculator again; inspect account history for the original outcome. Active key/device/product checks still apply to retries. A changed payload for an existing sequence or a different overlapping window fails with 409. Validation errors are 400, unavailable or invalid signatures 403, rate limits 429 and temporary storage failures 503; retry the same signed envelope after a temporary failure.

## Policy, ledger and redemption

`eligible_wh = min(solar_end_wh - solar_start_wh, load_end_wh - load_start_wh)`; points are `floor(eligible_wh / wh_per_point)`, capped by the account's remaining daily points. NUMERIC counter arithmetic prevents floating-point rounding across a point threshold. The cap uses the UTC **credit processing day**, including accepted backlog, rather than the historical observation day. A zero-credit outcome is recorded too: policy disabled, below threshold, or cap reached. Enabling/changing policy later never retroactively credits that same window.

Window insertion, processing outcome, reward event and ledger credit are one PostgreSQL transaction. Failure at any step leaves no partial window or reward. Versioned policy/configuration locks and account locks prevent duplicate credit and concurrent daily-cap overspend. Raw proofs and processing results remain server-only; owners read their own evidence and ledger through live-session RPCs. A new owner never inherits an earlier owner's energy history or points.

Balances are ledger credits/debits, less active reservations. Reserving uses a stable owner-scoped UUID request ID, locks account and catalog stock, and retains the reservation's original point price. Insufficient stock/balance changes neither. Repeating the same request returns the same redemption. Browser transport or refresh failure keeps the request ID for retry while the signed-in panel remains mounted. Reservations do not expire automatically; owners must cancel or operators must record fulfillment. There is no external order/shipping integration.

Cancellation releases reserved stock and points before fulfillment. Operator fulfillment records a reference, decrements stock and writes one debit atomically. Its retry preserves the original reference and cannot debit again. After fulfillment an operator can record a reason and create a full compensating ledger entry linked to the original debit. Compensation never deletes old ledger entries or automatically adds physical stock. This covers recorded redemption disputes; a separate general anomaly/appeal case-management UI is not implemented.

The UI shows current policy, confirmed/reserved/available balances, catalog, owned redemptions and the latest 100 ledger entries/windows. Operators manage policy, catalog, meter registrations, fulfillment references and compensation. Role/session checks are enforced on the server, including revocation before JWT expiry. Local ecosystem demonstrations remain independent and cannot write this ledger. Blockchain commitments and actual transferable tokens are not enabled.

## Run and verification

Start `npm run backend:local` and `npm run dev` as described in [IMPLEMENTATION_PHASES.md](IMPLEMENTATION_PHASES.md). Apply all seven versioned migrations in filename order for a hosted project; deploy the new `energy-ingest` function with server-only `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and exact `APP_ORIGIN`. The browser keeps using only the public URL and anon key. The local Compose/bootstrap configuration remains development-only.

```powershell
npm test
npm run test:backend
npm run lint -- --max-warnings 0
npm run typecheck
npm run build
```

With existing Playwright and Chrome, configure `PLAYWRIGHT_MODULE`, `TEST_URL` and repository-local `TEMP`/`TMP`, then run `node tests/energy-browser.mjs` and `node tests/rewards-browser.mjs`. These create explicitly synthetic local test accounts, policies, catalog entries and meter proofs; they preserve the prior active policy. Run policy-changing integration/browser suites sequentially. Evidence is in `.tmp/phase4/`. They do not exercise physical hardware, subsidized fulfillment or a hosted environment.
