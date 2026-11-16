# Security

Smart Agro is a prototype and has not had an external security review. A hosted backend (Supabase) serves the public demo and the live app and holds real sign-ups, so the rules below apply to it.

Last checked against the code: 2026-11-16.

## Reporting

Report a vulnerability privately through GitHub's **Report a vulnerability** (Security tab) on [Maliq-dlt/Smart-Argo](https://github.com/Maliq-dlt/Smart-Argo/security). Do not open a public issue for it. Include the affected file or endpoint, steps to reproduce, and impact. Expect a first reply within a week.

## What the design relies on

- **Secrets stay on the server.** The browser gets only the API origin, the publishable key, and pinned public keys. The service-role key, database password, JWT secret, and `AI_API_KEY` must never appear in a `VITE_` variable, the bundle, or logs.
- **Sign-in.** Google sign-in uses Auth's authorization-code flow with PKCE (S256); the verifier stays in the tab's `sessionStorage`, is used once, and the returned code is removed from the address bar. Passwords must be at least 10 characters.
- **Email sign-up and password reset.** A new address is confirmed with a 6-digit code that expires after 10 minutes; the confirmation link is kept as a fallback and also uses PKCE. A password-reset link returns with a one-time `?code=` that only the browser that asked can exchange, and the app asks for a new password before anything else. Tokens never appear in a URL. An address must be confirmed before sign-in, which also stops pre-registering someone else's address ahead of their Google sign-in.
- **Two-step verification.** Once an authenticator (TOTP) factor is verified, every session must reach `aal2` before any account function runs. Redeeming points also needs a code from the last 5 minutes and no 2FA or password change in the last 24 hours. A transfer code needs a sign-in from the last 10 minutes (with 2FA on, one completed with the code) or a fresh authenticator code, and the same 24-hour pause, so an intruder cannot change the keys and move a pot at once. Operator and curator roles only count in an `aal2` session.
- **Recovery codes** are single-use and stored as hashes; only the service role may consume one. Replaying a used code within its 10-minute window removes only the factors captured at its first use, never a factor added afterwards.
- **Row-level security on every table, checked in CI.** `tests/schema-audit.integration.mjs` fails the build if a table in `public` lacks row-level security, if `anon` holds any table privilege, if `authenticated` can write to a table or read one without a `SELECT` policy, if a view runs with its owner's rights, or if `anon` can run any function of ours other than `product_public_status`. Writes go through `SECURITY DEFINER` functions with a fixed `search_path` that recheck the session, ownership, and locks in one transaction.
- **Pots and gardens** live in closed tables reached only through those functions. Every write carries a request id, so a retried request cannot run twice; the history of plant cycles cannot be edited; one account may open at most 300 plants, 30 per day.
- **Community knowledge** is opt-in per pot. A shared cycle keeps its species, a coarse climate band (never the place), its length, and three rounded numbers (watering interval and moisture band); the owner is kept only to enforce the limits below. Others see only the aggregate per species and band, never an account, pot, or cycle. A band is shown only with at least 5 cycles from at least 3 owners, one owner counts for at most 2 cycles in it, outliers are trimmed, the result is labelled "belum dikurasi", and a curator (in an `aal2` session) can exclude a contribution.
- **Weather** is asked through the `weather-forecast` function, never from the browser, and only for a live session. The place is rounded to about a kilometre before it leaves, no account detail goes with it, and an indoor pot asks nothing.
- **Functions answer only the app's own origins** (`APP_ORIGIN`: the demo and the live app). The site sends a Content-Security-Policy and other headers from `public/_headers`.
- **Device and meter identity** is an Ed25519 key per device. Signatures prove origin, not calibration or physical presence.
- **Product manifests** are signed by the issuer with Ed25519 and checked against pinned public keys twice: by `product-provision` (`ISSUER_PUBLIC_KEYS`) before an operator may register the product, and again in the browser (`VITE_ISSUER_PUBLIC_KEYS`) when anyone looks the serial up. The issuer's private key is kept off the server (`scripts/issuer.mjs`).
- **Activation and transfer codes** are random, short-lived where applicable, attempt-limited, and stored only as SHA-256.
- **QR codes** carry only the public serial. Sealed activation codes never go in a QR, URL, chain, or log.
- **AI** receives only the rule result and recent readings, never owner, unit, device, or account identifiers. The owner's question is passed as quoted data, and model output is checked before it is stored.
- **Record proofs** send only a SHA-256 hash in a zero-value transaction from the user's own wallet. The app never handles a private key. A matching proof shows the file is unchanged, not that its contents are true.

## Known limits

- Local and Docker modes auto-confirm sign-ups and send no email, so the email code, the reset email, and their delivery are only exercised on the hosted project.
- Auth email is sent from a Gmail address until the project has its own domain; messages can land in spam.
- Auth accepts the same TOTP code again within its 30-second window. The 5-minute freshness rule narrows, but does not remove, replay of an observed code.
- Google sign-in is tested in the browser against a mocked Google endpoint. The deploy check confirms that the hosted Auth hands sign-in to `accounts.google.com` with a real client and its own callback; consent and the return trip are checked by hand.
- Registry status is not proof of physical authenticity. There is one issuer key; replacing it means pinning a new key id next to the old one in both places.
- A worker can send outbox commitments to a chain (`scripts/chain-worker.mjs`), but no chain or contract is configured for the hosted project, so none are sent.
- Community trimming tolerates roughly a quarter of bad data. One patient person with several accounts over 30 days could still sway a thin band; the defences are time, the curator, and the label.
- The free Open-Meteo tier is for non-commercial use, and its daily quota is shared by everyone; the function has no per-person limit yet.
- Development dependencies carry 7 moderate `npm audit` findings in the lint toolchain (`minimatch` through `typescript-eslint`); runtime dependencies have none (checked 2026-11-16).
- The app has been tested in Chrome only.
