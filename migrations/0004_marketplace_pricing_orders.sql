-- HR UNIVERSE
-- Migration 0004: Marketplace pricing and multi-item order foundation
-- Additive migration only:
-- - Preserves the existing orders table and all existing order records.
-- - Does not delete, rename, or recreate existing tables.
-- - Adds country-specific product prices and order line items.
-- IMPORTANT: Apply this migration to D1 only after the Worker API update is prepared.

-- 1. Country-specific customer prices.
CREATE TABLE IF NOT EXISTS product_prices (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  variant_id TEXT,
  country_code TEXT NOT NULL,
  currency_code TEXT NOT NULL,
  price_minor INTEGER NOT NULL CHECK (price_minor > 0),
  compare_at_price_minor INTEGER CHECK (
    compare_at_price_minor IS NULL OR compare_at_price_minor >= price_minor
  ),
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'ACTIVE', 'INACTIVE')),
  valid_from TEXT,
  valid_until TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
  FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE RESTRICT,
  FOREIGN KEY (country_code) REFERENCES countries(country_code) ON DELETE RESTRICT,
  FOREIGN KEY (currency_code) REFERENCES currencies(code) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_product_prices_country_status
ON product_prices(country_code, status);

CREATE INDEX IF NOT EXISTS idx_product_prices_product
ON product_prices(product_id);

CREATE INDEX IF NOT EXISTS idx_product_prices_variant
ON product_prices(variant_id);

-- Ensure an optional variant belongs to the same product.
CREATE TRIGGER IF NOT EXISTS trg_product_prices_variant_insert
BEFORE INSERT ON product_prices
WHEN NEW.variant_id IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM product_variants
   WHERE id = NEW.variant_id AND product_id = NEW.product_id
 )
BEGIN
  SELECT RAISE(ABORT, 'Price variant does not belong to product');
END;

CREATE TRIGGER IF NOT EXISTS trg_product_prices_variant_update
BEFORE UPDATE OF product_id, variant_id ON product_prices
WHEN NEW.variant_id IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM product_variants
   WHERE id = NEW.variant_id AND product_id = NEW.product_id
 )
BEGIN
  SELECT RAISE(ABORT, 'Price variant does not belong to product');
END;

-- 2. Add marketplace checkout metadata to the legacy orders table.
-- Existing legacy columns remain intact for backward compatibility.
ALTER TABLE orders ADD COLUMN country_code TEXT;
ALTER TABLE orders ADD COLUMN currency_code TEXT;
ALTER TABLE orders ADD COLUMN subtotal_minor INTEGER;
ALTER TABLE orders ADD COLUMN shipping_cost_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN tax_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN total_minor INTEGER;
ALTER TABLE orders ADD COLUMN fulfillment_type TEXT;
ALTER TABLE orders ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency_key
ON orders(idempotency_key)
WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_country_created
ON orders(country_code, created_at);

-- 3. Multiple products/variants per order.
CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  variant_id TEXT,
  product_name_snapshot TEXT NOT NULL,
  sku_snapshot TEXT,
  unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor > 0),
  currency_code TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 100),
  line_total_minor INTEGER NOT NULL CHECK (
    line_total_minor = unit_price_minor * quantity
  ),
  fulfillment_type TEXT NOT NULL
    CHECK (fulfillment_type IN ('LOCAL_WAREHOUSE', 'GLOBAL_CROSS_BORDER')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
  FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE RESTRICT,
  FOREIGN KEY (currency_code) REFERENCES currencies(code) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_order_items_order
ON order_items(order_id);

CREATE INDEX IF NOT EXISTS idx_order_items_product
ON order_items(product_id);

CREATE INDEX IF NOT EXISTS idx_order_items_variant
ON order_items(variant_id);
