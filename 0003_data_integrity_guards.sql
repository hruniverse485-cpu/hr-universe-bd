-- HR UNIVERSE
-- Migration 0003: Data Integrity Guards
-- Safe migration: adds validation triggers only.
-- Does not delete, recreate, or modify existing records.

-- 1. Countries: is_active must be 0 or 1
CREATE TRIGGER IF NOT EXISTS trg_countries_active_insert
BEFORE INSERT ON countries
WHEN NEW.is_active NOT IN (0, 1)
BEGIN
  SELECT RAISE(ABORT, 'Invalid country active status');
END;

CREATE TRIGGER IF NOT EXISTS trg_countries_active_update
BEFORE UPDATE OF is_active ON countries
WHEN NEW.is_active NOT IN (0, 1)
BEGIN
  SELECT RAISE(ABORT, 'Invalid country active status');
END;

-- 2. Categories: is_active must be 0 or 1
CREATE TRIGGER IF NOT EXISTS trg_categories_active_insert
BEFORE INSERT ON categories
WHEN NEW.is_active NOT IN (0, 1)
BEGIN
  SELECT RAISE(ABORT, 'Invalid category active status');
END;

CREATE TRIGGER IF NOT EXISTS trg_categories_active_update
BEFORE UPDATE OF is_active ON categories
WHEN NEW.is_active NOT IN (0, 1)
BEGIN
  SELECT RAISE(ABORT, 'Invalid category active status');
END;

-- 3. Currencies: is_active must be 0 or 1
CREATE TRIGGER IF NOT EXISTS trg_currencies_active_insert
BEFORE INSERT ON currencies
WHEN NEW.is_active NOT IN (0, 1)
BEGIN
  SELECT RAISE(ABORT, 'Invalid currency active status');
END;

CREATE TRIGGER IF NOT EXISTS trg_currencies_active_update
BEFORE UPDATE OF is_active ON currencies
WHEN NEW.is_active NOT IN (0, 1)
BEGIN
  SELECT RAISE(ABORT, 'Invalid currency active status');
END;

-- 4. Supplier origin country must exist when supplied
CREATE TRIGGER IF NOT EXISTS trg_supplier_country_insert
BEFORE INSERT ON suppliers
WHEN NEW.origin_country_code IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM countries
   WHERE country_code = NEW.origin_country_code
 )
BEGIN
  SELECT RAISE(ABORT, 'Unknown supplier origin country');
END;

CREATE TRIGGER IF NOT EXISTS trg_supplier_country_update
BEFORE UPDATE OF origin_country_code ON suppliers
WHEN NEW.origin_country_code IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM countries
   WHERE country_code = NEW.origin_country_code
 )
BEGIN
  SELECT RAISE(ABORT, 'Unknown supplier origin country');
END;

-- 5. Inventory variant must belong to the same product
CREATE TRIGGER IF NOT EXISTS trg_inventory_variant_insert
BEFORE INSERT ON inventory
WHEN NOT EXISTS (
  SELECT 1 FROM product_variants
  WHERE id = NEW.variant_id
    AND product_id = NEW.product_id
)
BEGIN
  SELECT RAISE(ABORT, 'Inventory product and variant mismatch');
END;

CREATE TRIGGER IF NOT EXISTS trg_inventory_variant_update
BEFORE UPDATE OF product_id, variant_id ON inventory
WHEN NOT EXISTS (
  SELECT 1 FROM product_variants
  WHERE id = NEW.variant_id
    AND product_id = NEW.product_id
)
BEGIN
  SELECT RAISE(ABORT, 'Inventory product and variant mismatch');
END;

-- 6. Product image variant must belong to the same product
CREATE TRIGGER IF NOT EXISTS trg_product_image_variant_insert
BEFORE INSERT ON product_images
WHEN NEW.variant_id IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM product_variants
   WHERE id = NEW.variant_id
     AND product_id = NEW.product_id
 )
BEGIN
  SELECT RAISE(ABORT, 'Product image variant mismatch');
END;

CREATE TRIGGER IF NOT EXISTS trg_product_image_variant_update
BEFORE UPDATE OF product_id, variant_id ON product_images
WHEN NEW.variant_id IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM product_variants
   WHERE id = NEW.variant_id
     AND product_id = NEW.product_id
 )
BEGIN
  SELECT RAISE(ABORT, 'Product image variant mismatch');
END;

-- 7. Supplier product variant must belong to the same product
CREATE TRIGGER IF NOT EXISTS trg_supplier_product_variant_insert
BEFORE INSERT ON supplier_products
WHEN NEW.variant_id IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM product_variants
   WHERE id = NEW.variant_id
     AND product_id = NEW.product_id
 )
BEGIN
  SELECT RAISE(ABORT, 'Supplier product variant mismatch');
END;

CREATE TRIGGER IF NOT EXISTS trg_supplier_product_variant_update
BEFORE UPDATE OF product_id, variant_id ON supplier_products
WHEN NEW.variant_id IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM product_variants
   WHERE id = NEW.variant_id
     AND product_id = NEW.product_id
 )
BEGIN
  SELECT RAISE(ABORT, 'Supplier product variant mismatch');
END;

-- 8. Supplier cost and lead time cannot be negative
CREATE TRIGGER IF NOT EXISTS trg_supplier_cost_insert
BEFORE INSERT ON supplier_products
WHEN (NEW.unit_cost_minor IS NOT NULL AND NEW.unit_cost_minor < 0)
  OR (NEW.lead_time_days IS NOT NULL AND NEW.lead_time_days < 0)
BEGIN
  SELECT RAISE(ABORT, 'Invalid supplier cost or lead time');
END;

CREATE TRIGGER IF NOT EXISTS trg_supplier_cost_update
BEFORE UPDATE OF unit_cost_minor, lead_time_days ON supplier_products
WHEN (NEW.unit_cost_minor IS NOT NULL AND NEW.unit_cost_minor < 0)
  OR (NEW.lead_time_days IS NOT NULL AND NEW.lead_time_days < 0)
BEGIN
  SELECT RAISE(ABORT, 'Invalid supplier cost or lead time');
END;

-- 9. Shipping estimates must be non-negative and logically ordered
CREATE TRIGGER IF NOT EXISTS trg_shipping_rate_days_insert
BEFORE INSERT ON shipping_rates
WHEN (NEW.estimated_min_days IS NOT NULL AND NEW.estimated_min_days < 0)
  OR (NEW.estimated_max_days IS NOT NULL AND NEW.estimated_max_days < 0)
  OR (
    NEW.estimated_min_days IS NOT NULL
    AND NEW.estimated_max_days IS NOT NULL
    AND NEW.estimated_min_days > NEW.estimated_max_days
  )
BEGIN
  SELECT RAISE(ABORT, 'Invalid shipping delivery estimate');
END;

CREATE TRIGGER IF NOT EXISTS trg_shipping_rate_days_update
BEFORE UPDATE OF estimated_min_days, estimated_max_days ON shipping_rates
WHEN (NEW.estimated_min_days IS NOT NULL AND NEW.estimated_min_days < 0)
  OR (NEW.estimated_max_days IS NOT NULL AND NEW.estimated_max_days < 0)
  OR (
    NEW.estimated_min_days IS NOT NULL
    AND NEW.estimated_max_days IS NOT NULL
    AND NEW.estimated_min_days > NEW.estimated_max_days
  )
BEGIN
  SELECT RAISE(ABORT, 'Invalid shipping delivery estimate');
END;
