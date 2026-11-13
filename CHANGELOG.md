# Changelog

Notable changes to Smart Agro. Dates are UTC+7.

## [Unreleased]

### Added
- Simulator gate (`#masuk`): sign in with Google or email, or continue as a guest whose data stays in the browser. Deep links pass through the gate and continue to the requested page. Without a backend, the gate is skipped.
- Account menu (initials avatar) with Profil & keamanan and Keluar; the pot mascot moved into the pot pill.
- Profile page (`#profil`) with Akun, Keamanan and Produk sections, one at a time.
- Google sign-in through Supabase Auth (authorization code with PKCE S256). It is offered first when Auth enables Google; email and password stay available in a folded section.
- A dedicated sign-in card: the pot mascot follows the email being typed, covers its eyes for passwords and codes, droops after a failure and sprouts on success. The steps run sign in, register the pot, then 2FA. On narrow cards the mascot sits small above the form.
- Account security: authenticator-app 2FA (TOTP), a 5-minute step-up and a 24-hour hold after security changes before points can be redeemed, and an activity log.
- Transfer confirmation for passwordless (Google) accounts: a fresh authenticator code or a new Google sign-in.
- Hosted backend on Supabase cloud (project `smart-agro`, ap-southeast-1): the same migrations, four edge functions and Auth settings (Google, passwords of 10+ characters, TOTP, email confirmation). `npm run build:cloud` builds against it from `.env.cloud`; that build requires sign-in and offers no guest visit.

### Changed
- Email sign-up runs PKCE: the confirmation link signs the visitor in through `?code=` (verifier kept in this browser), and expired links return to the gate with the reason.
- The sign-in card always labels the email section "Masuk atau daftar dengan email" and shows a loading line until Auth reports whether Google is available.
- The ecosystem page no longer starts with the long online account panel. The summary and module tabs come first, and signed-in data sits at the top of the matching tab (telemetry, knowledge, energy and rewards).
- Auth requires passwords of at least 10 characters.
- The local gateway passes Auth redirects through, and allows the preview origin `127.0.0.1:4173`.

### Security
- Ownership transfer offers wait out the same 24-hour hold as redemptions after a password or 2FA change (migration `20261113020000_transfer_security_hold`).

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
