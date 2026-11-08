# Signed device telemetry v2

This is the authenticated HTTPS ingestion path. The v1 browser file preview and synthetic simulator remain separate. Locally verified with software Ed25519 keys, PostgreSQL, real Supabase Auth and PostgREST; no physical device or hosted deployment is verified.

## Request

POST `/functions/v1/telemetry-ingest` with `Content-Type: application/json` over HTTPS (loopback HTTP is development-only). A device does not use an owner's access token. Its provisioned `device.public_key` is raw 32-byte Ed25519 standard base64; keep the private key on the device/provisioning system.

The outer object contains `payload` (a JSON **string**) and `signature` (standard base64, 64 bytes). Sign the exact UTF-8 bytes of the string before JSON-encoding the envelope. Do not reformat or normalize the signed string on retry. Maximum payload: 4096 UTF-8 bytes; outer body: 12288 bytes. Browser origins must match `APP_ORIGIN`; CORS does not replace device authentication.

Example payload structure; replace IDs and time with the actual device, owned unit, boot and measurement:

```json
{
  "domain": "smart-agro.telemetry.v2",
  "schema_version": 2,
  "source": "device",
  "device_id": "11111111-1111-4111-8111-111111111111",
  "unit_id": "22222222-2222-4222-8222-222222222222",
  "boot_id": "33333333-3333-4333-8333-333333333333",
  "sequence": 1,
  "measured_at": "2026-11-05T12:00:00.000Z",
  "clock_status": "synced",
  "sensors": {
    "moisture": { "status": "ok", "value": 55 },
    "soil_temperature": { "status": "error", "value": null, "error": "Probe disconnected" },
    "soil_ph": { "status": "not_measured", "value": null }
  }
}
```

IDs are UUIDs. `boot_id` is unique per device reboot; `sequence` is an integer 0–2147483647 increasing **across all units on that device** within that boot. `measured_at` requires ISO 8601 with Z/UTC offset, valid calendar/time and at most millisecond precision. `clock_status` is `synced` or `unsynced`, reported truthfully by the device. Unsynced clocks still need a meaningful timestamp within the accepted window; the server never invents measurement time.

Exactly three sensor keys are required. Status `ok` needs a finite number: moisture 0–100 (capacitive index, not volumetric water), soil temperature −20–60 °C, pH 0–14. `error` and `not_measured` require `value: null`; `error` also requires a nonblank description of 1–240 characters. An OK report does not prove calibration. `drip` and `actuator` are rejected; this endpoint cannot command hardware.

## Storage, order and retries

The endpoint verifies the exact signature and then rechecks the current key, active device/product, same-product unit and active ownership under transaction locks. Private raw payload/signature and its SHA256 digest are stored alongside three sensor rows in one transaction. `received_at` comes from the database clock; `measured_at` remains the device's signed observation time.

An exact same device/boot/sequence/payload retry returns HTTP 200 with `duplicate: true`, `inserted: 0` and the original `packet_id`. A new packet returns `duplicate: false`, `inserted: 3`. Changed signed bytes or target unit with the same identity return 409. Signature/key/revocation checks still apply to duplicates. The server rejects lower/equal new sequences and measurement time reversal within a boot. A new boot allows sequence reset; prior observations remain intact.

New packets may be at most seven days old or five minutes ahead of the database clock. Backlog is retained and labeled stale in the UI; measurements before current ownership are hidden from that owner. At most 120 new packets per device in a rolling minute are accepted. Exact retries do not add to this rate or recheck the original age window. Reconnect firmware should retain and resend the original signed envelope, in increasing order within a boot, until acknowledged. After a 503 retry that envelope because the commit outcome may be uncertain. Invalid/old data should remain diagnosed locally rather than be relabeled as a fresh observation.

| HTTP | Meaning |
| --- | --- |
| 200 | Stored or exact retry acknowledged. |
| 400 / 413 / 415 | Invalid packet/body size/content type. |
| 403 | Invalid signature, unavailable/revoked device/product, wrong unit or origin. |
| 409 | Conflicting sequence or sequence/time reversal. |
| 429 | New-packet rate limit; retry later. |
| 503 | Service/database temporarily unavailable; retry identical envelope. |

## Owner UI and limits

The account panel lists owned units/devices and creates units from real published profile versions (single-pot maximum one unit; garden operational ceiling 32, not a measured hardware capacity). It shows up to 120 latest sensor rows per unit, with NULL/error distinctions, UTC measurement/receipt times, clock status and staleness assessed when loaded. Refresh is manual. It does not claim continuous streaming or device calibration. The history includes all devices on the selected unit.

Authenticated users cannot write telemetry directly or read raw proof packets. Live Auth sessions and active ownership gate reads; measured and received times must both fall in that ownership period. A transfer implementation is outside this phase. The server service key belongs only in function configuration, never frontend `VITE_` settings. Signed telemetry currently creates no AI advice, reward credit, actuator commands or blockchain confirmation.

Verification commands and local setup are in [IMPLEMENTATION_PHASES.md](IMPLEMENTATION_PHASES.md). Synthetic integration/browser fixtures are marked as software tests; the app does not seed or certify agronomic profiles.
