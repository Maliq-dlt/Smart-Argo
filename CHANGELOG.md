# Changelog

Notable changes to Smart Agro. Dates are UTC+7.

## [Unreleased]

### Changed
- Dashboard redesigned around the answer. The stage has a sky that follows the session clock (sun, moon and a chili constellation at night, per theme), the clock sits at its foot labelled "Waktu simulasi", and the pot title is a small label so the engine's advice is the first read, also on a phone. The advice card keeps at most three facts and no longer repeats the stage's numbers.
- Moisture now has a condition band: three zones from the profile's own watering and drained limits, the line broken wherever a reading failed, a 24-hour ribbon, and values readable by pointer, tap or keyboard (←/→, Shift for 6 hours, Home/End, Esc), spoken through a live region. It replaces the lime trend card.
- Three instruments add context instead of repeating readings: growth phase against the 65/90-day journey, 24 hours of soil temperature against the heat limit, and the last three pH readings against the profile's range. Wording follows the product: "Hari ke-N" instead of "HST", "batas siram/panas" instead of "acuan", and the session pill says "Simulasi".
- The rail shows a word under each icon on desktop (the phone dock stays icon-only).
- Pure dashboard logic (zones, sun and moon, phase steps, "ago" labels) lives in `src/lib/dashboardFacts.ts`; `tests/dashboardFacts.test.ts` keeps the sky periods equal to the simulator scene's and the phase steps equal to `phaseAt`.
- Plant catalog (`src/lib/species.ts`) replaces the `onion` flag and the `'cabai' | 'bawang'` literals. One table per curated species holds the scenario it opens, the illustration's growth days, the last day of the journey and the reference phases, so the engine, simulator, session store, dashboard and phase guide no longer keep their own copies. Nothing visible changes (the rendered DOM is identical before and after for both species on every phase boundary), and `cabai`/`bawang` stay the stored ids, so tokens and sessions saved earlier still read back. Anggrek bulan and peoni are catalogued as learning-only species and are not yet selectable. `tests/phases.test.ts` checks the phases against a copy of the old functions.

- The pot stage is redrawn (`src/components/plantScene/`, ported from the Fase 2.0 mock): the pot in section with layered media and roots, the Smart Agro device drawn small and flat like the plants (squircle body, solar panel, skirt, one LED, two short probes), a sky that follows the session clock (sun, moon, stars, one colour matrix for night), and the three readings written beside the part they describe, with no boxes or dots. The plant droops when the media is dry and recovers when it is watered; watering plays a can, a stream and a water front, and the new moisture arrives with the water. One gentle breeze moves the whole plant and the pointer moves nothing. Springs replace CSS keyframes, and reduced motion lands every spring at once and skips the pour. It replaces `PlantIllustration`, `SkyScene`, the lens and the callouts, on the dashboard and in Ruang tanam alike. `tests/plantScene.test.ts` (clock through midnight, palette, springs, bands) and `tests/plant-scene-browser.mjs` (readings in frame at 1440/768/390/320 in both themes, no pointer listeners, night darker than noon, text at 200%, pour and reduced motion) cover it.

### Added
- Simulated weather for the pot stage: a "Cuaca simulasi" control (Cerah, Berawan, Mendung, Hujan, Terik) on the dashboard, remembered in this browser (`smart-agro.weather`). Clouds gather and the sky and hills dim, rain falls in streaks, a hot day brightens the sun, warms the sky and shimmers the air, and the breeze strengthens or eases; reduced motion draws the rain still. A line under the stage mentions only rain timing or heat ("Sedang hujan: pertimbangkan menunda siram", "Suhu tinggi: periksa media lebih sering"), says nothing for an indoor pot, quotes only hours that are in the forecast and never an amount. `src/lib/weather.ts` holds the snapshot model, the five simulated skies and a pure Open-Meteo adapter (unknown WMO codes read as cloudy). `supabase/functions/weather-forecast/` is a handler for a real forecast (CORS locked to the app origin, place validated and rounded to about a kilometre, only the place sent to the provider, provider trouble becomes `weather_unavailable`); it is **not deployed**, not in `config.toml`, no deploy script and not in the local gateway. `docs/cuaca.md` records each provider's terms.
- Sign-up asks for a name and a confirmation of the password, then verifies the email with a six-digit code (also reachable by signing in with an unconfirmed email, with a send-again cooldown). The display name is editable in Profil and is not overwritten by the Google name.
- Signing up with an address that already has an account no longer waits for an email that never comes: the card moves to "Masuk" with the address filled in and says why (hosted Auth answers such a sign-up with an empty user; local Auth with an error).
- The sign-in card never jumps: tabs open and close the sign-up fields in place, the card is anchored at its top, a notice opens inside it, a new view rises in while the card eases to its height, and "Coba tanpa akun" and a finished sign-in leave the gate behind the loading screen. Password and confirmation boxes run red until the rule is met and then green (ten small boxes show the ten characters), and "Buat akun" shows that it is working. `tests/gate-motion-browser.mjs` measures it frame by frame.
- Indonesian confirmation and password-reset emails (`supabase/templates/`) and `scripts/apply-auth-email.mjs` to apply them, with the code settings (6 digits, 10 minutes), to hosted Auth with a backup and a restore. Live text on a solid colour: no images, no hidden preview line, and no link in the code email (the strongest Spam signals for a new sender; Gmail also does not load images for messages it files as spam). The code step says to check Spam or Promosi.
- "Siapkan pot" after the first sign-in (Google or email): name the pot, pick Cabai or Bawang merah, say whether a unit is on hand. Saved on the account (Auth user metadata, validated on read) and opens that crop's journey; with a unit it continues to activation. Checked by `tests/pot-setup-browser.mjs` against a mocked Auth.
- Landing numbers and soil scenes animate what the device does (roots drawing in, LED waves, data up the probes, sunlight onto the panel) instead of naming its parts again; parts are labelled only in the product scene.
- Simulator gate (`#masuk`): sign in with Google or email, or continue as a guest whose data stays in the browser. Deep links pass through the gate and continue to the requested page. Without a backend, the gate is skipped.
- Account menu (initials avatar) with Profil & keamanan and Keluar; the pot mascot moved into the pot pill.
- Profile page (`#profil`) with Akun, Keamanan and Produk sections, one at a time.
- Google sign-in through Supabase Auth (authorization code with PKCE S256). It is offered first when Auth enables Google; the email form stays open below it with Masuk and Daftar tabs (no fold since 2026-11-14), and common Auth errors are explained in Indonesian.
- A dedicated sign-in card: the terracotta pot mascot (also the dashboard avatar) beams and reads along the email at the caret, squeezes its eyes shut and peeks now and then for passwords and codes, droops after a failure and sprouts on success. The steps run sign in, register the pot, then 2FA. On narrow cards the mascot sits small above the form.
- Account security: authenticator-app 2FA (TOTP), a 5-minute step-up and a 24-hour hold after security changes before points can be redeemed, and an activity log.
- Transfer confirmation for passwordless (Google) accounts: a fresh authenticator code or a new Google sign-in.
- Hosted backend on Supabase cloud (project `smart-agro`, ap-southeast-1): the same migrations, four edge functions and Auth settings (Google, passwords of 10+ characters, TOTP, email confirmation). `npm run build:cloud` builds against it from `.env.cloud`; that build requires sign-in and offers no guest visit.

- Care journal and sensor history for an owned unit (Ekosistem → Unit & sensor), on the backend contract in `docs/care-history-api.md`: log watering, fertilizing, inspections and notes (a retry reuses its request id, so nothing is saved twice), page back through 31 days, compare the last week with the one before (missing data stays "—"), and download a CSV for up to 31 days. The journal never changes readings, pumps or rewards. Checked by `tests/care-history-browser.mjs` against a mocked backend.
- Landing "Tanya mesinnya" section (replaces the prototype card row): pick chili or shallot, slide the soil moisture, and read the advice, reason and trigger straight from the simulator's rule engine with that crop's profile.

### Changed
- The landing device is one interactive 3D model built in code (Three.js) instead of pre-rendered video and frame sequences. It turns by drag (vertical swipes still scroll), changes state with the story (studio, labelled parts, see-through shell, in the soil, highlighted parts per figure), keeps clear of the nav, and survives viewport resizes and lost WebGL contexts. Reduced motion and browsers without WebGL show rendered posters.
- The growth demo plays a vector Lottie clip recoloured to the Sage palette, and the leaf reveal opens onto a vector garden of a chili and a shallot pot; both stay sharp at any zoom. `public/landing` shrank from 11 MB to about 0.4 MB.
- Email sign-up runs PKCE: the confirmation link signs the visitor in through `?code=` (verifier kept in this browser), and expired links return to the gate with the reason.
- The sign-in card always labels the email section "Masuk atau daftar dengan email" and shows a loading line until Auth reports whether Google is available.
- The ecosystem page no longer starts with the long online account panel. The summary and module tabs come first, and signed-in data sits at the top of the matching tab (telemetry, knowledge, energy and rewards).
- Auth requires passwords of at least 10 characters.
- The local gateway passes Auth redirects through, and allows the preview origin `127.0.0.1:4173`.
- Dashboard first visit (critique 2026-11-14): "Tanam bibit" and the mascot on the start card, care tiles hidden until planting, a calmer trend card in dark mode, the pot pill shows HST or "Belum ditanam" instead of repeating "Perjalanan", "Ruang tanam" is a link, and a disabled play button names why it is disabled.
- Backend error codes (journal, history, AI admission such as `request_pending`) are shown in Indonesian; codes are matched as own keys only.
- The ecosystem and profile pages load on first visit, so the simulator chunk shrank from 625 kB to 430 kB.
- An error without a code no longer signs the visitor out; only `unauthorized`, `invalid_session` or HTTP 401 do.

### Added (Miro diagram gap, stages 6–12)
- Suspicious energy claims (at least 90% of the meter limit) are held for review; owners appeal, operators take and decide cases with a reason, and an upheld case credits points once (RW-04).
- Ownership recovery with a statement and evidence references; an operator's approval moves ownership atomically with an outbox proof and a security event for the previous owner (ID-03).
- Units can be renamed, archived and restored; devices are placed on units with history, and ingest rejects packets for another or an archived unit (APP-02).
- "Kondisi unit": latest reading per sensor and alerts for no data, stale data, failed sensors, revoked devices, energy deficit and low battery (APP-03).
- Products are provisioned from a manifest signed by a pinned issuer key (`product-provision` edge function); the public check verifies the Ed25519 signature again in the browser (ID-01, ID-04).
- Password reset (Auth recover with PKCE) and one-time 2FA recovery codes (`mfa-recovery` edge function) (APP-01).
- Chain proof worker (`scripts/chain-worker.mjs`): leased jobs, JSON-RPC send, receipts matched on chain, signer, destination and hash (A08).
- Operator workspace (Profil → Operator): reward cases, ownership recoveries, registry (provision, key rotation, revocation) and chain proofs.
- Paged sensor history for a date range next to the CSV download (APP-06).

### Fixed
- Care journal entries without notes were rejected, and a journal holding one failed to load.
- The energy panel broke on a claim held for review.
- Curators saw profile ids instead of names once there were more than 100 profiles (migration `20261114170000_knowledge_workspace_profiles`).
- Operators and curators without 2FA lost their tools silently; the pages now say 2FA is required.
- A unit created in the telemetry panel did not appear in "Kondisi unit", and renames or archives there did not reach the telemetry list.

### Security
- Ownership transfer offers wait out the same 24-hour hold as redemptions after a password or 2FA change (migration `20261113020000_transfer_security_hold`).
- Content-Security-Policy, Permissions-Policy (camera for this site only) and frame denial in `public/_headers`, checked by `tests/csp-browser.mjs`.

## [1.11.0] - 2026-11-13

### Added
- Record proof (UC-12/13/17): freeze a session as exact JSON bytes, record its SHA-256 through the user's wallet (EIP-6963/1193) as a zero-value self-transfer on Base Sepolia or Sepolia, and verify a record against its separate proof file through the network's public node.
- Product QR: camera and photo scanning with a self-hosted ZXing WebAssembly reader, printable SVG/PNG codes, and a public registry status check (`product_public_status`) before sign-in.
- Ownership transfer (ID-03): re-authenticated owners create a one-time 128-bit code (hash stored, 24 h, five attempts); acceptance ends the old ownership and starts the new one in one transaction with an outbox commitment.
- Optional AI wording for owner explanations through any OpenAI-compatible endpoint (locally 9router with a light Antigravity model). Output is schema-checked and filtered; failures keep the rule text, labelled with the reason.
- Mascot settles against sensor noise: worse conditions show at once, easing needs two agreeing evaluations; a fourth "alert" face.
- `CHANGELOG.md`, `SECURITY.md`.

### Changed
- Dashboard rebuilt: plant stage with root-zone lens, trend, care and session-clock cards, rail navigation, Phosphor icons, General Sans and Fraunces, and a rewritten stylesheet.
- Page changes use a 180 ms cross-fade without movement; the landing hero trail now dissolves into a pixel mosaic of the video.
- Online product forms use the Radix select instead of native `<select>`.
- The explanation snapshot schema accepts `ai_explained` only with a model, prompt version and bounded text.

### Fixed
- A missing field in an AI snapshot could pass the database check as NULL; the check now treats NULL as invalid.
- The segmented control pill drifted when a dialog resized.
- The energy browser test reused a fixed device key and could not run twice on one database.
- The local gateway now serves `.wasm`, `.mp4`, `.avif` and `.md` with their content types.

### Removed
- Lucide icons, Nunito Sans, and the unused `public/plants` images.

## [1.10.0] - 2026-11-12

### Added
- Landing v5: scroll-driven device sequences, root-zone story, watering numbers from the engine, an interactive grow sequence, block transitions, and a loading curtain shared with route changes.

## Earlier

Phases 1–4 of the backend (accounts, signed telemetry, curation and explanations, energy and rewards) and the Docker assessment stack are described in [docs/IMPLEMENTATION_PHASES.md](docs/IMPLEMENTATION_PHASES.md).
