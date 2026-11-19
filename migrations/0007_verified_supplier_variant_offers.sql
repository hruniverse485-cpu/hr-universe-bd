-- HR UNIVERSE
-- Migration 0007: verified supplier variant offers and destination landed-cost evidence.
-- Additive only. No supplier credentials, customer data, or live supplier calls.

CREATE TABLE IF NOT EXISTS supplier_variant_offers (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  supplier_variant_id TEXT NOT NULL,
  supplier_sku TEXT,
  source_unit_cost_minor INTEGER NOT NULL CHECK (source_unit_cost_minor >= 0),
  source_currency_code TEXT NOT NULL,
  availability_status TEXT NOT NULL DEFAULT 'UNVERIFIED'
    CHECK (availability_status IN ('UNVERIFIED', 'AVAILABLE', 'UNAVAILABLE')),
  approval_status TEXT NOT NULL DEFAULT 'DISCOVERED'
    CHECK (approval_status IN (
      'DISCOVERED', 'TERMS_REVIEW', 'SAMPLE_REQUIRED',
      'QUALITY_APPROVED', 'DESTINATION_APPROVED', 'ACTIVE',
      'PAUSED', 'REJECTED'
    )),
  quality_score INTEGER CHECK (quality_score BETWEEN 0 AND 100),
  service_score INTEGER CHECK (service_score BETWEEN 0 AND 100),
  packaging_score INTEGER CHECK (packaging_score BETWEEN 0 AND 100),
  delivery_score INTEGER CHECK (delivery_score BETWEEN 0 AND 100),
  packaging_status TEXT NOT NULL DEFAULT 'UNVERIFIED'
    CHECK (packaging_status IN (
      'UNVERIFIED', 'NEUTRAL_CONFIRMED', 'BRANDED_CONFIRMED', 'FAILED'
    )),
  supplier_branding_excluded INTEGER NOT NULL DEFAULT 0
    CHECK (supplier_branding_excluded IN (0, 1)),
  tracking_available INTEGER NOT NULL DEFAULT 0
    CHECK (tracking_available IN (0, 1)),
  returns_supported INTEGER NOT NULL DEFAULT 0
    CHECK (returns_supported IN (0, 1)),
  evidence_reference TEXT,
  verified_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT,
  FOREIGN KEY (source_id) REFERENCES supplier_product_sources(id) ON DELETE RESTRICT,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
  FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE RESTRICT,
  FOREIGN KEY (source_currency_code) REFERENCES currencies(code) ON DELETE RESTRICT,
  UNIQUE (source_id, variant_id, supplier_variant_id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_variant_offer_compare
ON supplier_variant_offers(product_id, variant_id, approval_status, availability_status);

CREATE TRIGGER IF NOT EXISTS trg_supplier_variant_offer_product_insert
BEFORE INSERT ON supplier_variant_offers
WHEN NOT EXISTS (
  SELECT 1 FROM product_variants
  WHERE id = NEW.variant_id AND product_id = NEW.product_id
)
BEGIN
  SELECT RAISE(ABORT, 'Supplier offer HR variant does not belong to product');
END;

CREATE TRIGGER IF NOT EXISTS trg_supplier_variant_offer_product_update
BEFORE UPDATE OF product_id, variant_id ON supplier_variant_offers
WHEN NOT EXISTS (
  SELECT 1 FROM product_variants
  WHERE id = NEW.variant_id AND product_id = NEW.product_id
)
BEGIN
  SELECT RAISE(ABORT, 'Supplier offer HR variant does not belong to product');
END;

CREATE TABLE IF NOT EXISTS supplier_variant_shipping_quotes (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL,
  destination_country_code TEXT NOT NULL,
  shipping_method_code TEXT NOT NULL,
  shipping_cost_minor INTEGER NOT NULL CHECK (shipping_cost_minor >= 0),
  currency_code TEXT NOT NULL,
  estimated_min_days INTEGER CHECK (estimated_min_days IS NULL OR estimated_min_days >= 0),
  estimated_max_days INTEGER CHECK (estimated_max_days IS NULL OR estimated_max_days >= 0),
  availability_status TEXT NOT NULL DEFAULT 'UNVERIFIED'
    CHECK (availability_status IN ('UNVERIFIED', 'AVAILABLE', 'UNAVAILABLE')),
  source_to_destination_fx_numerator INTEGER NOT NULL DEFAULT 1
    CHECK (source_to_destination_fx_numerator > 0),
  source_to_destination_fx_denominator INTEGER NOT NULL DEFAULT 1
    CHECK (source_to_destination_fx_denominator > 0),
  fx_evidence_reference TEXT,
  quoted_at TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (offer_id) REFERENCES supplier_variant_offers(id) ON DELETE CASCADE,
  FOREIGN KEY (destination_country_code) REFERENCES countries(country_code) ON DELETE RESTRICT,
  FOREIGN KEY (currency_code) REFERENCES currencies(code) ON DELETE RESTRICT,
  CHECK (
    estimated_min_days IS NULL OR estimated_max_days IS NULL
    OR estimated_min_days <= estimated_max_days
  )
);

CREATE INDEX IF NOT EXISTS idx_supplier_variant_shipping_compare
ON supplier_variant_shipping_quotes(destination_country_code, offer_id, availability_status, expires_at);
