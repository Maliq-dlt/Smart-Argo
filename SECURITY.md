# Security

Smart Agro is a prototype. It has not had an external security review, and no production deployment of the backend exists.

## Reporting

Report a vulnerability privately through GitHub's **Report a vulnerability** (Security tab) on [Maliq-dlt/Smart-Argo](https://github.com/Maliq-dlt/Smart-Argo/security). Do not open a public issue for it. Include the affected file or endpoint, steps to reproduce, and impact. Expect a first reply within a week.

## What the design relies on

- **Secrets stay on the server.** The browser gets only the API origin and the public anon key. The service-role key, database password, JWT secret, and `AI_API_KEY` must never appear in a `VITE_` variable, the bundle, or logs.
- **Sign-in.** Google sign-in uses Auth's authorization-code flow with PKCE (S256). The verifier stays in the tab's `sessionStorage`, is used once, and the returned code is removed from the address bar. Auth requires passwords of at least 10 characters.
- **Two-step verification.** Once an authenticator (TOTP) factor is verified, every session must reach `aal2` before any account function runs. Redeeming points also needs a code from the last 5 minutes and no 2FA or password change in the last 24 hours. A transfer code needs a sign-in from the last 10 minutes (with 2FA on, one completed with the code) or a fresh authenticator code.
- **Row-level security on every table.** Writes that change ownership, telemetry, curation, energy, or the ledger go through `SECURITY DEFINER` functions that recheck the session, ownership, and locks in one transaction.
- **Device and meter identity** is an Ed25519 key per device. Signatures prove origin, not calibration or physical presence.
- **Activation and transfer codes** are random, short-lived where applicable, attempt-limited, and stored only as SHA-256.
- **QR codes** carry only the public serial. Sealed activation codes never go in a QR, URL, chain, or log.
- **AI** receives only the rule result and recent readings, never owner, unit, device, or account identifiers. The owner's question is passed as quoted data, and model output is checked before it is stored.
- **Record proofs** send only a SHA-256 hash in a zero-value transaction from the user's own wallet. The app never handles a private key. A matching proof shows the file is unchanged, not that its contents are true.

## Known limits

- Local and Docker modes auto-confirm sign-ups and send no email; there is no password-reset flow yet.
- Auth accepts the same TOTP code again within its 30-second window. The 5-minute freshness rule narrows, but does not remove, replay of an observed code.
- Google sign-in is tested against a mocked Google endpoint; each operator must register their own OAuth client.
- Issuer signatures on product manifests are stored but not cryptographically verified; registry status is not proof of physical authenticity.
- Outbox commitments are not yet sent to a chain.
- Development dependencies carry moderate `npm audit` findings in the lint toolchain; runtime dependencies had none at the last check.
