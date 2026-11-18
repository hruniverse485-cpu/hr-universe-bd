-- HR UNIVERSE
-- Migration 0005: supplier catalog and destination-specific shipping evidence
-- Additive only. No supplier credentials are stored in D1.

CREATE TABLE IF NOT EXISTS supplier_product_sources (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  supplier_product_id TEXT NOT NULL,
  supplier_product_url TEXT,
  source_currency_code TEXT,
  source_unit_cost_minor INTEGER CHECK (
    source_unit_cost_minor IS NULL OR source_unit_cost_minor >= 0
  ),
  source_status TEXT NOT NULL DEFAULT 'UNVERIFIED'
    CHECK (source_status IN ('UNVERIFIED', 'AVAILABLE', 'UNAVAILABLE', 'REVIEW')),
  last_synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT,
  UNIQUE (supplier_id, supplier_product_id),
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
  FOREIGN KEY (source_currency_code) REFERENCES currencies(code) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_supplier_source_product
ON supplier_product_sources(product_id, source_status);

CREATE TABLE IF NOT EXISTS supplier_shipping_quotes (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  destination_country_code TEXT NOT NULL,
  shipping_method_code TEXT NOT NULL,
  shipping_cost_minor INTEGER NOT NULL CHECK (shipping_cost_minor >= 0),
  currency_code TEXT NOT NULL,
  estimated_min_days INTEGER CHECK (
    estimated_min_days IS NULL OR estimated_min_days >= 0
  ),
  estimated_max_days INTEGER CHECK (
    estimated_max_days IS NULL OR estimated_max_days >= 0
  ),
  is_free_shipping INTEGER NOT NULL DEFAULT 0
    CHECK (is_free_shipping IN (0, 1)),
  availability_status TEXT NOT NULL DEFAULT 'UNVERIFIED'
    CHECK (availability_status IN ('UNVERIFIED', 'AVAILABLE', 'UNAVAILABLE')),
  quoted_at TEXT NOT NULL,
  expires_at TEXT,
  FOREIGN KEY (source_id) REFERENCES supplier_product_sources(id) ON DELETE CASCADE,
  FOREIGN KEY (destination_country_code) REFERENCES countries(country_code) ON DELETE RESTRICT,
  FOREIGN KEY (currency_code) REFERENCES currencies(code) ON DELETE RESTRICT,
  CHECK (
    estimated_min_days IS NULL OR estimated_max_days IS NULL
    OR estimated_min_days <= estimated_max_days
  ),
  CHECK (is_free_shipping = 0 OR shipping_cost_minor = 0)
);

CREATE INDEX IF NOT EXISTS idx_supplier_shipping_destination
ON supplier_shipping_quotes(destination_country_code, availability_status, expires_at);

CREATE TABLE IF NOT EXISTS supplier_sync_runs (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL,
  sync_type TEXT NOT NULL
    CHECK (sync_type IN ('PRODUCT_DISCOVERY', 'PRODUCT_REFRESH', 'SHIPPING_REFRESH', 'INVENTORY_REFRESH')),
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED')),
  items_seen INTEGER NOT NULL DEFAULT 0 CHECK (items_seen >= 0),
  items_imported INTEGER NOT NULL DEFAULT 0 CHECK (items_imported >= 0),
  items_rejected INTEGER NOT NULL DEFAULT 0 CHECK (items_rejected >= 0),
  safe_error_code TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_supplier_sync_runs_recent
ON supplier_sync_runs(supplier_id, started_at DESC);
