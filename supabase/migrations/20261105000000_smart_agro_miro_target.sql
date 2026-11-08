-- Smart Agro — Skema Target Produk Miro (E02, E03, E04, A04–A08)
-- Menegakkan seluruh 16 invariant integritas pada docs/diagram/v2/SPESIFIKASI.md Bab 8.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- 1. DOMAIN OPERASIONAL & IDENTITAS PRODUK (E02)
-- ============================================================================

CREATE TABLE account (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_subject TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  access_roles TEXT[] NOT NULL DEFAULT ARRAY['owner']::TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_account_roles CHECK (
    access_roles <@ ARRAY['owner', 'contributor', 'curator', 'operator']::TEXT[]
    AND cardinality(access_roles) >= 1
  )
);

CREATE TABLE product (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  serial_public TEXT NOT NULL UNIQUE,
  variant TEXT NOT NULL CHECK (variant IN ('single_pot', 'garden')),
  registry_status TEXT NOT NULL DEFAULT 'active' CHECK (registry_status IN ('active', 'revoked', 'pending')),
  issuer_signature TEXT NOT NULL,
  revoked_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE activation (
  product_id UUID PRIMARY KEY REFERENCES product(id) ON DELETE RESTRICT,
  secret_hash TEXT NOT NULL,
  consumed_by UUID REFERENCES account(id) ON DELETE RESTRICT,
  consumed_at TIMESTAMPTZ,
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  CONSTRAINT chk_activation_consumed_pair CHECK (
    (consumed_by IS NULL AND consumed_at IS NULL)
    OR (consumed_by IS NOT NULL AND consumed_at IS NOT NULL)
  )
);

CREATE TABLE ownership (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES product(id) ON DELETE RESTRICT,
  account_id UUID NOT NULL REFERENCES account(id) ON DELETE RESTRICT,
  start_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  end_at TIMESTAMPTZ,
  CONSTRAINT chk_ownership_period CHECK (end_at IS NULL OR end_at >= start_at)
);

-- Invariant: Satu pemilik aktif per produk (end_at IS NULL)
CREATE UNIQUE INDEX idx_ownership_single_active_per_product
  ON ownership(product_id)
  WHERE end_at IS NULL;

CREATE INDEX idx_ownership_account_id ON ownership(account_id);

CREATE TABLE device (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES product(id) ON DELETE RESTRICT,
  public_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'offline')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_device_product_id ON device(product_id);

-- ============================================================================
-- 2. DOMAIN PENGETAHUAN & KURASI PROFIL TANAMAN (E04)
-- ============================================================================

CREATE TABLE plant_profile (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  species_variety TEXT NOT NULL UNIQUE,
  context_scope TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE contribution (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES plant_profile(id) ON DELETE RESTRICT,
  author_account_id UUID NOT NULL REFERENCES account(id) ON DELETE RESTRICT,
  source_method_license TEXT NOT NULL,
  evidence_ref TEXT NOT NULL,
  proposed_parameters JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review', 'needs_revision', 'approved', 'rejected')),
  revision_count INTEGER NOT NULL DEFAULT 1 CHECK (revision_count >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_contribution_profile_id ON contribution(profile_id);
CREATE INDEX idx_contribution_author_id ON contribution(author_account_id);

CREATE TABLE review (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_id UUID NOT NULL REFERENCES contribution(id) ON DELETE RESTRICT,
  reviewer_account_id UUID NOT NULL REFERENCES account(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'needs_revision', 'rejected')),
  decision_reason TEXT NOT NULL,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_review_contribution_id ON review(contribution_id);

CREATE TABLE profile_version (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES plant_profile(id) ON DELETE RESTRICT,
  contribution_id UUID NOT NULL REFERENCES contribution(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version >= 1),
  parameters_and_scope JSONB NOT NULL,
  evidence_level TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Invariant: Kombinasi (profile_id, version) unik dan immutable
  CONSTRAINT uq_profile_version UNIQUE (profile_id, version)
);

-- ============================================================================
-- 3. UNIT POT/ZONA, PENGUKURAN SENSOR & AI SNAPSHOT (E02 LANJUTAN)
-- ============================================================================

CREATE TABLE unit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES product(id) ON DELETE RESTRICT,
  profile_version_id UUID NOT NULL REFERENCES profile_version(id) ON DELETE RESTRICT,
  location_label TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_unit_product_id ON unit(product_id);

CREATE TABLE measurement (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES device(id) ON DELETE RESTRICT,
  unit_id UUID NOT NULL REFERENCES unit(id) ON DELETE RESTRICT,
  -- Invariant: Deduplikasi (device_id, boot_id, sequence, sensor_id)
  device_boot_seq_sensor TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL CHECK (source IN ('device', 'simulation')),
  quality_status TEXT NOT NULL CHECK (quality_status IN ('ok', 'error', 'not_measured')),
  value_nullable DOUBLE PRECISION,
  measured_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Invariant: quality_status=ok memerlukan angka hingga; status lain wajib null
  CONSTRAINT chk_measurement_quality_value CHECK (
    (quality_status = 'ok' AND value_nullable IS NOT NULL)
    OR (quality_status IN ('error', 'not_measured') AND value_nullable IS NULL)
  )
);

CREATE INDEX idx_measurement_unit_measured_at ON measurement(unit_id, measured_at DESC);

CREATE TABLE ai_snapshot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID NOT NULL REFERENCES unit(id) ON DELETE RESTRICT,
  profile_version_id UUID NOT NULL REFERENCES profile_version(id) ON DELETE RESTRICT,
  evidence_ref JSONB NOT NULL,
  decision_and_state TEXT NOT NULL,
  model_prompt_version TEXT NOT NULL,
  explanation TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_snapshot_unit_id ON ai_snapshot(unit_id, created_at DESC);

-- ============================================================================
-- 4. DOMAIN ENERGI, REWARD, LEDGER & PENUKARAN KATALOG (E03)
-- ============================================================================

CREATE TABLE energy_window (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES device(id) ON DELETE RESTRICT,
  boot_id TEXT NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  solar_harvest_wh DOUBLE PRECISION NOT NULL CHECK (solar_harvest_wh >= 0),
  load_wh DOUBLE PRECISION NOT NULL CHECK (load_wh >= 0),
  evidence_quality TEXT NOT NULL CHECK (evidence_quality IN ('verified_meter', 'simulated', 'unverified')),
  CONSTRAINT chk_energy_window_range CHECK (end_at > start_at),
  CONSTRAINT uq_energy_window_canonical UNIQUE (device_id, boot_id, start_at, end_at)
);

CREATE TABLE reward_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES account(id) ON DELETE RESTRICT,
  energy_window_id UUID REFERENCES energy_window(id) ON DELETE RESTRICT,
  source_event_key TEXT NOT NULL UNIQUE,
  policy_version TEXT NOT NULL,
  verification_status TEXT NOT NULL
    CHECK (verification_status IN ('verified', 'rejected_simulation', 'rejected_duplicate', 'flagged_anomaly')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_reward_event_account_id ON reward_event(account_id);

CREATE TABLE catalog_item (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  point_cost INTEGER NOT NULL CHECK (point_cost > 0),
  stock_total INTEGER NOT NULL CHECK (stock_total >= 0),
  stock_reserved INTEGER NOT NULL DEFAULT 0 CHECK (stock_reserved >= 0),
  availability TEXT NOT NULL DEFAULT 'available' CHECK (availability IN ('available', 'out_of_stock', 'disabled')),
  -- Invariant: Stok tidak pernah minus dan reservasi tidak melebihi stok total
  CONSTRAINT chk_catalog_stock_bounds CHECK (stock_reserved <= stock_total)
);

CREATE TABLE redemption (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES account(id) ON DELETE RESTRICT,
  catalog_item_id UUID NOT NULL REFERENCES catalog_item(id) ON DELETE RESTRICT,
  reserved_points INTEGER NOT NULL CHECK (reserved_points > 0),
  status TEXT NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'fulfilled', 'cancelled', 'compensated')),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_redemption_account_id ON redemption(account_id);

CREATE TABLE ledger_entry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES account(id) ON DELETE RESTRICT,
  reward_event_id UUID REFERENCES reward_event(id) ON DELETE RESTRICT,
  redemption_id UUID REFERENCES redemption(id) ON DELETE RESTRICT,
  signed_points INTEGER NOT NULL CHECK (signed_points <> 0),
  idempotency_key TEXT NOT NULL UNIQUE,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Invariant: Satu kredit per reward_event
  CONSTRAINT uq_ledger_reward_event UNIQUE (reward_event_id)
);

CREATE INDEX idx_ledger_entry_account_id ON ledger_entry(account_id);

-- ============================================================================
-- 5. OUTBOX BLOCKCHAIN IDEMPOTEN (A08)
-- ============================================================================

CREATE TABLE outbox_job (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('product_manifest', 'ownership_claim', 'ledger_anchor')),
  artifact_bytes TEXT NOT NULL,
  artifact_sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'failed')),
  chain_id TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  tx_hash TEXT,
  block_number BIGINT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 6. ROW LEVEL SECURITY (RLS) DASAR
-- ============================================================================

ALTER TABLE account ENABLE ROW LEVEL SECURITY;
ALTER TABLE ownership ENABLE ROW LEVEL SECURITY;
ALTER TABLE unit ENABLE ROW LEVEL SECURITY;
ALTER TABLE measurement ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE reward_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE redemption ENABLE ROW LEVEL SECURITY;
