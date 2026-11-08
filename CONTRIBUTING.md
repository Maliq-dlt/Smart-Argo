# Contributing to Smart Agro

Start with the [README](README.md) and protocol document for the area you intend to change. Keep browser simulation, authenticated device evidence, and future integrations distinct.

## Working locally

1. Create a focused branch from `main`.
2. Install Node.js 22.18+, Python 3.10+, and dependencies with `npm ci --cache .cache/npm`.
3. Run `npm run dev` for the simulator. Use `npm run backend:local` for backend integration work or `docker compose up --build -d --wait` for the complete assessment build.
4. Change the smallest relevant surface. Follow existing validation, error handling, accessibility, and naming conventions.

Keep caches, browser evidence, and temporary scripts in `.tmp/` or `.cache/`. Never commit generated credentials, environment files, private device keys, activation codes, database exports, `node_modules`, or `dist`.

## Before opening a pull request

```sh
npm run lint
npm run typecheck
npm test
npm run build
python scripts/reference/simulasi_pot.py --self-test
git diff --check
```

For backend changes, also run `npm run test:backend` against the isolated developer stack. For containers, run a real Compose build and `docker compose --profile tools run --rm verify`. For UI changes, run the relevant browser suite and provide actual desktop/mobile screenshots, including reduced motion when animation changes.

A useful pull request describes the concrete problem, resulting behavior, and commands actually run. State any untested boundary. Keep unrelated formatting and generated evidence out of the diff. Use short descriptive commit titles such as `fix: reject replayed telemetry` or `docs: clarify local assessment setup`.

## Data and protocol changes

Add an ordered SQL migration instead of rewriting an applied migration. Preserve transactions, RLS, replay protection, provenance, and historical profile bindings. A signed packet proves possession of a key; it does not establish measurement accuracy. Test fixtures must be explicitly synthetic.

When changing a decision rule, leave a runnable check for edge cases and preserve Python parity where applicable. Never turn missing/failed readings into successful measurements or label browser-local records as verified device evidence.

## Reporting issues

Include the app route, reproduction steps, expected/actual behavior, operating system/browser, and relevant command output. Remove personal data, tokens, activation codes, and private keys from reports and screenshots. Use private vulnerability reporting if enabled for security issues; otherwise contact the maintainer privately before publishing sensitive details.
