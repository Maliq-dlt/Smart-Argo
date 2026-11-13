# Implementation phases

## Phase 1 — Authenticated product ownership (locally verified)

The online account path is separate from the existing browser-local ecosystem demo.
Implemented source includes Supabase email/password authentication, temporary browser sessions, private ownership reads, session-bound activation challenges, server-side Ed25519 proof verification, and an atomic ownership/outbox transaction. Sign-out targets the current Auth session. Nonce issuance and claim require that session to remain present in Auth.

Verification: `npm test` 54/54; `npm run test:backend` 10/10 (nine integration scenarios plus the parent test); lint, typecheck/build and whitespace checks pass. Fresh application migrations created all 19 domain tables with RLS. The existing Three.js chunk-size warning remains.

Verified on 5 November 2026 against PostgreSQL 17, Supabase Auth v2.197.0 and PostgREST v14.18 in an isolated local Docker stack. The integration test checks RLS, denied privileged access, forged/cross-session proofs, persisted failed attempts, concurrent claims, replay, revoked devices/products/sessions, rate limiting, and rollback if outbox insertion fails. The browser check covers signup, signed claim, page restoration, real refresh, logout/login and 320/390/1440 px without horizontal overflow or JavaScript errors. Keys used to prove the protocol are software-generated test keys; no physical device or remote deployment is verified.

### Run locally

Node >=22.18 and Docker Desktop with Linux containers are required. From `simulasi-web`, use two terminals:

```powershell
npm run backend:local
```

```powershell
npm run dev
```

Open http://127.0.0.1:5173/#ekosistem. The first command starts only PostgreSQL, Auth, PostgREST and a loopback gateway, applies migrations transactionally once, and creates `.env.local` only if that file does not exist. Development passwords/service keys and database files stay inside ignored `.tmp/phase1/`. `.env.local` contains only the public URL and anon key. If an existing `.env.local` is present, use `.tmp/phase1/browser.env` to configure this local instance yourself; the launcher preserves the existing file. Local signup automatically confirms emails; use verified email delivery and confirmation in a hosted environment.

```powershell
npm run test:backend
$env:PLAYWRIGHT_MODULE = 'path/to/an/already-installed/playwright'
node tests/account-browser.mjs
```

The browser check uses existing Playwright and Chrome, without adding a project dependency. Integration tests only target the fixed local test stack. They create isolated test accounts/products, do not clear existing user data, and briefly install a test trigger to verify rollback. Evidence/screenshots are under `.tmp/phase1/browser/`. Ctrl+C stops each Node process; Docker services remain available for restart. To stop these project containers without deleting data:

```powershell
docker compose --env-file .tmp/phase1/compose.env -p smart-agro-phase1 -f supabase/compose.phase1.yml stop
```

### Hosted configuration and boundaries

Apply all versioned migrations in filename order to the intended Supabase project; deploy `supabase/functions/product-claim`, `supabase/functions/telemetry-ingest`, `supabase/functions/unit-explanation`, and `supabase/functions/energy-ingest`. Set `APP_ORIGIN` on the function to the exact website origin. The function uses server-only `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; the frontend uses `VITE_SUPABASE_URL` and the public `VITE_SUPABASE_ANON_KEY`. Never put a service key in a `VITE_` variable. The local bootstrap SQL and Compose are development-only and must not be applied to hosted Supabase. The function deliberately validates the bearer token through Auth, then verifies the server-stored Ed25519 challenge; gateway JWT checking is disabled in `supabase/config.toml` so validation is not tied to a legacy JWT signing scheme.

Product provisioning must place a genuine raw 32-byte Ed25519 public key encoded as standard base64 in `device.public_key`, the SHA256 of a random sealed code in `activation.secret_hash`, and issuer/registry information in `product`. Keep private keys in the device/provisioning environment and sealed codes outside public QR/URLs/logs. The UI accepts a product serial, or reads the `serial` query parameter from a QR URL; camera pairing is not part of this phase. Sign the exact UTF-8 challenge returned by the server and supply the 64-byte signature as standard base64. No device key is generated or held by the browser.

Online claims create pending outbox jobs with an exact, salted private preimage and a public SHA256 commitment. Chain/contract are explicitly unconfigured; no receipt or block is fabricated. The service key and private preimage never reach the browser. Transfers/recovery, password-reset UX/MFA and the other ecosystem modules remain later work; existing local demos do not become live integrations.

## Phase 2 — Authenticated device telemetry (locally verified)

Implemented a separate device-signature endpoint and durable packet/sensor storage. Ed25519 signs the exact UTF-8 payload; the server rechecks the active key/product under transaction locks. One packet writes all three sensor statuses atomically. Device/boot/sequence uniqueness permits exact retry acknowledgements without duplicate measurements; changed payloads, sequence rollback and time reversal fail. New packets accept up to seven days of backlog and five minutes of future clock tolerance, with a 120-packet/minute/device ceiling.

The signed-in account panel can create owned units from published profiles, load stored device history, and distinguish NULL, error and not-measured values. Measured time, server receipt time, device clock status and staleness at load remain visible. Read access requires a live Auth session; a new owner cannot read measurements from before their ownership. Raw packet payloads/signatures remain server-only. The simulator and v1 file preview remain separate.

Verification on 5 November 2026: `npm test` 57/57; `npm run test:backend` 23/23 across phases 1 and 2, including concurrent retries, rate limits, revoked proofs, RLS and injected partial-write rollback. A fresh database using the real local Auth schema applied all three migrations and created 20/20 public domain tables with RLS. `npm run lint` and `npm run build` pass; the existing Three.js chunk-size warning remains. The existing browser check now covers UI unit creation and genuine signed ingestion using explicitly synthetic profiles and software test keys. It checks persisted NULL/error/unsynced/stale/UTC history, refresh/logout/login, server-revoked session cleanup and 320/390/1440 px. No hardware, calibration, hosted deployment, physical control or live agronomic recommendation is verified.

Run commands above also start phase 2. The browser check needs the app running; set `TEST_URL` when using a preview URL rather than the default development URL. Telemetry protocol, limits and firmware responsibilities: [telemetry-v2.md](telemetry-v2.md). The application seeds no agronomic profile; an operator must publish a justified profile before a real owned unit can be created. Test fixtures state synthetic provenance and are not care advice.

## Phase 3 — Evidence-based explanations and profile curation (locally verified)

The authenticated knowledge workspace now supports contributor submissions with affirmative sharing permission, provenance and bounded Profile parameters; author revisions preserve immutable history. Server-managed curator roles can request revision, reject or approve another author's submission. Approval and publication are one transaction under profile/contribution locks; a repeated concurrent approval cannot create a second version. Published parameters, copied provenance, reviews and revision records cannot be rewritten. Published metadata includes scope, sources, evidence level and whether legacy provenance remains unpinned. Owners can explicitly assign a published profile to a unit without changing old measurements or snapshots; validated profiles must target that unit's UUID.

The owner-only explanation endpoint loads actual stored device packets, pins their values/statuses and the exact profile version, and runs the existing deterministic agronomy engine on the server. Missing, stale, unsynced, revoked or future data holds advice. A legacy unpinned profile or calibration for another unit holds advice too. Invalid samples are not replaced by zero or synthetic readings; boot/quality boundaries stop history continuity. Snapshots retain observation/receipt/evaluation times, packet IDs, context hash, rule version and the user's optional context. Questions are private data and cannot override decisions. Ownership-period RLS hides previous owners' snapshots. Snapshot requests are idempotent and rate-limited.

There is no configured generative AI provider. The interface explicitly labels the result `rule_fallback` / explanation from rules; it does not fabricate an AI response. A service failure shows an error and keeps readings accessible without claiming that a new snapshot was saved. The UI displays a historical assessment time rather than implying live monitoring. No recommendation is a hardware command or proof of physical calibration.

Verified on 5 November 2026: `npm test` 59/59; combined backend regression 37/37, followed by the final explanation integration suite 8/8 including a new large-evidence case. Curation integration is 7/7. Lint (zero warnings), typecheck/build and whitespace checks pass; the existing Three.js size warning remains. A fresh database with the real local Auth schema applied all five application migrations, producing 21/21 domain tables with RLS. Chrome checks cover two real Auth users submitting/revising/reviewing/publishing, pinned sources/history after reload, evidence explanations, a deliberately failed browser transport, and session revocation. Both browser scripts passed 320/390/1440 px without horizontal overflow or page errors.

```powershell
npm run test:backend
node --test tests/explanations.integration.mjs
node tests/account-browser.mjs
node tests/knowledge-browser.mjs
```

Use `PLAYWRIGHT_MODULE` as above; set `TEST_URL=http://127.0.0.1:4178/#ekosistem` for the production preview. Keep `TEMP` and `TMP` inside the repository `.tmp` when launching browser checks. Evidence remains in `.tmp/phase1/browser/` and `.tmp/phase3/browser/`. The tests explicitly label synthetic profiles/software keys; approved test fixtures are not agronomic certification. No deployment or physical device was tested. Contracts and operational limits: [profile-curation.md](profile-curation.md).

## Phase 4 — Signed energy evidence and transactional rewards (locally verified)

Added dedicated operator-registered Ed25519 meter keys with immutable calibration/useful-load attestation references, validity and rated power. Signed quarter-hour UTC windows derive cumulative-counter deltas on the server. Active product/device/meter, whole-window current ownership, bounded power/time/counter progression and nonoverlap across boots/replacement meters are enforced. Exact replay acknowledges zero additional credit. Original bytes, SHA256, signature, ownership and receipt time are private durable evidence. Signatures verify origin, not physical calibration.

Operators explicitly configure immutable reward policies; there is no active policy or inventory seed. Credit uses NUMERIC min(harvest, useful load), floor conversion and a per-account UTC credit-day cap. Zero-credit outcomes are pinned against retroactive awards. Window/outcome/event/ledger credit commit atomically. Account and stock locks protect reservations, recorded fulfillment, cancellation and full compensating entries. Prices are pinned at reservation; duplicate requests cannot double-debit, and compensation does not restock goods.

The signed-in UI shows owned meter evidence, policy, actual confirmed/reserved/available points, catalog, redemptions and ledger. Server-assigned operators can register/revoke meters, manage policy/catalog, record fulfillment references and compensate points. The browser retains request IDs across failed transport or refresh while mounted. Demo balances cannot enter this ledger. There is no external shipping action, transferable token, general anomaly-case UI or global program budget. Real calibration, useful-load assessment, subsidy/stock decisions and hosted rollout remain operational prerequisites.

Verification on 6 November 2026: `npm test` 63/63; `npm run test:backend` 57/57 across phases 1–4. Lint with zero warnings, typecheck, build, whitespace and a scan for server secrets in production assets passed. The existing Three.js chunk-size warning remains. Actual Chrome checks for account/explanations, knowledge curation, energy meter management and rewards all passed 320/390/1440 px without horizontal overflow or page errors; long catalog buttons wrap within their cards. Reward browser checks deliberately lose a reservation response and a subsequent refresh to verify stable request identity. Integration checks include concurrent initial submissions from two devices for one account, overlap/replay, ownership and key revocation, stock/balance races, compensation once, and injected ledger failures rolling back all energy/reward writes. A fresh database with real local Auth schema applied all seven migrations: 25/25 domain tables with RLS. Tests use software keys and explicit synthetic references, not field evidence. Protocol and operational limits: [energy-rewards.md](energy-rewards.md).

```powershell
node tests/energy-browser.mjs
node tests/rewards-browser.mjs
```

Use the same existing Playwright/Chrome and repository-local temporary environment as phase 3. Run policy-changing checks sequentially; test fixtures restore the previous active policy. Reports and screenshots: `.tmp/phase4/`. Local app preview: http://127.0.0.1:4178/#ekosistem when `npm run preview -- --port 4178` is running.

## Phase 5 — External commitments

Configure an actual contract and worker only when the preceding durable events are trustworthy. Verify transaction receipts and byte-level artifact hashes; retain pending/failed state on timeouts. Do not describe a locally generated hash or simulated block as a confirmed blockchain transaction.

### User-signed record proofs (implemented 13 November 2026)

The simulator's **Berkas → Bukti blockchain** freezes the active session as exact UTF-8 JSON, hashes it with SHA-256, and asks the user's own browser wallet (EIP-6963/1193) for one zero-value transaction to their own address on Base Sepolia (84532) or Sepolia (11155111). The data is `0x53414731` ("SAG1") followed by the hash. Chain ID, transaction, block and status go into a separate `.bukti.json`. Verification recomputes the file hash and checks chain ID, sender, recipient, zero value, data and a successful receipt through the network's public JSON-RPC node; pending, failed, missing and mismatched states never show as verified. Server outbox commitments for claims and transfers remain unsent: no contract or worker is configured.

Verified in Chrome against an injected test wallet and an intercepted RPC that share one in-memory chain (`tests/chain-proof-browser.mjs`): add and switch network, record, proof download, verify, one-byte tampering, wallet refusal, and no wallet, at 1440/390/1024 px. No live testnet transaction was sent.

## Product completion — 13 November 2026

- **ID-01:** `product_public_status(serial)` is callable without an account and returns registry status, variant and whether the product is claimed, never the owner. The account panel shows it after typing or scanning a QR (camera or photo; ZXing WASM bundled). Registry status is not proof of physical authenticity; issuer signatures are stored but not cryptographically verified.
- **ID-03:** `create_transfer_offer` requires a session created within ten minutes (the UI asks for the password again) and returns a one-time 128-bit code, stored as SHA-256, valid 24 hours and five wrong attempts. `accept_transfer` ends the old ownership and starts the new one in one transaction with an `ownership_transfer` outbox commitment; retries are idempotent and concurrent recipients yield one owner.
- **UC-11:** the explanation handler optionally calls an OpenAI-compatible chat endpoint (`AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`; locally 9router with `ag/gemini-3.8-flash-low`). The prompt carries the rule result and recent readings only, never owner, unit, device or account identifiers. Replies must be JSON within length bounds, without dose amounts, links or markup. Accepted text is stored as `ai_explained` with model and prompt version; failures, refusals and rejected text are stored as `rule_fallback` with that status. The database enforces the same rule.

Verification on 13 November 2026: `npm test` 83/83; `npm run test:backend` 67/67 (adds `ai-explanation.integration.mjs` against a local OpenAI-compatible stub and `transfer.integration.mjs`); lint, typecheck and build pass. Chrome checks pass for account (including public status and a transfer code), knowledge, energy, rewards, QR (photo, fake camera, refused camera), record proof, simulator UI, dashboard, route transitions and landing. A call through a real 9router key was not run in this verification.

## Local assessment containers — 8 November 2026

The root `compose.yaml` now runs the compiled web app, shared Node API gateway, PostgreSQL 17, Supabase Auth and PostgREST. It is separate from the `smart-agro-phase1` developer stack. Start with `docker compose up --build -d --wait` and open http://127.0.0.1:8088. The initial setup generates local secrets in a named configuration volume; a second named volume stores PostgreSQL data. Migrations run transactionally once. No host Node/Python installation or manually copied environment file is needed for this route.

`docker compose --profile tools run --rm verify` checks actual readiness, compiled assets, public runtime configuration, path traversal rejection, real signup/login, account idempotency, denied anonymous reads and session revocation. It removes only its own synthetic test user. A real Chrome signup followed by a full Compose stop/start also verified persisted accounts, unchanged signing keys, session restoration, and password login after restart. This is local assessment mode: signup auto-confirms and sends no email.

Current local verification: 63/63 unit tests, including 110-case Python parity; 57/57 backend integration tests against the developer stack; lint, typecheck, production build, Python self-test and whitespace checks passed. Chrome checks cover six landing viewport/motion combinations, ten dashboard viewport/theme combinations, simulator interaction/accessibility, and route transitions (cold load, cancellation, Back, failed chunk, native/fallback and reduced motion). Evidence is stored in ignored `.tmp/` directories.

Dependency audit after compatible patch updates: zero findings in runtime npm dependencies; seven moderate findings remain in the TypeScript ESLint/minimatch development-tool chain. No forced downgrade or major tooling migration was applied. Frontend build dependencies are absent from the final runtime image. This npm audit is not a complete vulnerability scan of the container OS images.

The GitHub Actions workflow runs application checks and a real Compose smoke test on pushes to main and pull requests. Consult the repository Actions tab for the latest remote run; local verification does not imply a successful CI run. Earlier phase verification counts and Three.js warnings above are historical snapshots; the inactive flower landing, its assets and Three.js dependency have been retired.
