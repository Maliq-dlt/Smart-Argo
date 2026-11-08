# Profile curation and evidence explanations

The online path uses real account sessions and persisted device measurements. The browser-local ecosystem demonstration remains separate.

## Access and workflow

Every new account starts with the server's owner role. Contributor and curator roles must be provisioned by an authorized administrator in the database; the browser cannot promote accounts. The workspace reads those server roles. A reader may inspect published profile sources without owning a product, while private submissions are restricted to their author and curators.

A contributor supplies species/variety, observation scope, measurement/source/license information, evidence references/limitations, the exact Profile JSON, and affirmative permission to share data without personal or secret content. This attestation and curator review do not automatically detect every possible privacy issue. Curators must inspect source content before approval. Text is treated as data, never executable instructions. No personal telemetry is automatically published with a contribution.

A curator may approve, reject or request revision with a reason and evidence level. The author cannot review their own contribution, even if their account has both roles. A requested revision requires the expected current revision number and renewed sharing confirmation. Up to 20 immutable revisions are retained per contribution. New submissions are limited to ten per author per hour. The workspace shows at most 100 authorized profiles/submissions; operational limits can be revisited after measured use.

Approval creates the next profile version atomically. It copies parameters, scope, species, source/license, evidence reference, review reason and revision into immutable published storage. Later changes to source records do not rewrite published evidence. Legacy fixtures without copied provenance are labeled `legacy_unpinned`; their parameters cannot authorize device advice. A profile's evidence label is an assessment within its scope, not a claim of universal field validation.

## Profile parameter contract

The contributor JSON starts blank. Supply observations from your actual calibration and use context; the application does not seed fabricated agronomic values. Exactly these eleven keys are required:

| Field | Contract |
| --- | --- |
| `pot_id` | Calibration target, 1–120 characters. For validated online advice this must equal the target unit's UUID. |
| `crop`, `media`, `phase` | Nonblank context text, each at most 120 characters. |
| `validated`, `ph_validated` | Booleans, asserted and reviewed truthfully. Publication itself does not measure calibration. |
| `needs_water`, `drained` | Each 3–100 observed indices in 0–100; median separation at least ten points. |
| `next_visit_h` | Finite hours, 0.1–24. |
| `hot_c` | Finite threshold, 20–60 °C, justified by the submitted context/evidence. |
| `ph_range` | Two finite increasing bounds within 0–14. |

An unvalidated template can be published and assigned; explanations still hold advice until an appropriate unit-specific calibration is reviewed. Owners explicitly choose the version assigned to a unit. Existing measurements and explanations retain their original data/version references.

## Explanation contract

POST `/functions/v1/unit-explanation` with the owner's bearer session and JSON `{unit_id,device_id,request_id,question}`. IDs are UUIDs; `request_id` is new for a new assessment and reused after uncertain transport failures. `question` is text of at most 500 characters, including an empty string. Extra fields such as client-generated decisions, sensor values, profile parameters or AI results are rejected. Request body limit is 4096 bytes.

The server validates Auth and the live session, loads only that owner's unit/device data, evaluates deterministic rules and saves an immutable snapshot. An exact request-identity retry returns the original historical snapshot with `duplicate: true`; reusing it for a different unit/device/question returns 409. A different owner after transfer receives no prior-owner history. New assessments are limited to 20 per active ownership per minute.

The server considers at most 120 packets in the prior 24 hours for the selected device/unit, restricted by both measured and received times to the current ownership period. Evidence includes sensor values/quality, packet IDs, clock status, profile/version and copied provenance, device/product state and server evaluation time. Raw telemetry signatures are not returned. Stored measurement rows and snapshots cannot be updated/deleted through application roles.

Freshness is checked against the database clock. Future, unsynced, inactive or unavailable readings do not become a healthy state. Moisture/temperature errors hold advice; pH error/not-measured remains NULL and cannot borrow an old pH value. History stops at a boot or invalid-data boundary. Duplicate observation timestamps select the latest received packet deterministically, without averaging fabricated data. The unchanged agronomy engine applies only to valid observed samples and a pinned, unit-specific profile. This phase has no online watering log; it does not invent actions or post-watering responses.

Responses include a snapshot ID, immutable context SHA256, rule version, explanation, deterministic status, evaluation time and `source_mode: rule_fallback`. The hash identifies persisted PostgreSQL JSONB context; it is not a blockchain receipt or independently verified hardware attestation. Published profiles/readings and software tests do not prove a physical probe was calibrated.

No generative model is configured or called. The optional question is stored private context, not an unrestricted chatbot; an instruction inside it cannot override the rules or expose other accounts. Add a model provider only after a server-side contract, bounded context and output validation are specified and tested. Service failures return 503, leave prior readings/history available and create no fabricated successful explanation. Conflicting/revoked context returns 409/401/403 as appropriate.

The browser shows ten latest historical assessments for the selected unit/device, with a manual new-assessment action. Read times and evaluation times stay explicit. No polling, actuator control, reward credit or chain confirmation is implied.

## Verification

See [IMPLEMENTATION_PHASES.md](IMPLEMENTATION_PHASES.md) for commands, local services and dated results. Integration and browser tests use real local Auth, PostgreSQL/PostgREST, signed software-device packets and explicitly synthetic profiles. Physical hardware, hosted deployment and generative AI are outside the verified result.
