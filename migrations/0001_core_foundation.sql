-- HR UNIVERSE
-- Migration 0001: Core marketplace foundation
-- Additive migration. Does NOT modify or delete existing orders.

CREATE TABLE IF NOT EXISTS countries (
    id TEXT PRIMARY KEY,
    country_code TEXT NOT NULL UNIQUE,
    country_name TEXT NOT NULL,
    currency_code TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 0
        CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS currencies (
    code TEXT PRIMARY KEY,
    currency_name TEXT NOT NULL,
    symbol TEXT,
    decimal_places INTEGER NOT NULL DEFAULT 2,
    is_active INTEGER NOT NULL DEFAULT 1
        CHECK (is_active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    image_url TEXT,
    parent_id TEXT,
    is_active INTEGER NOT NULL DEFAULT 0
        CHECK (is_active IN (0, 1)),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_id) REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY,
    supplier_name TEXT NOT NULL,
    origin_country_code TEXT,
    contact_email TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS warehouses (
    id TEXT PRIMARY KEY,
    warehouse_name TEXT NOT NULL,
    country_code TEXT NOT NULL,
    city TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (country_code) REFERENCES countries(country_code)
);

CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    category_id TEXT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    brand TEXT,
    status TEXT NOT NULL DEFAULT 'DRAFT',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT,
    FOREIGN KEY (category_id) REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS product_variants (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    sku TEXT NOT NULL UNIQUE,
    variant_name TEXT,
    attributes_json TEXT,
    status TEXT NOT NULL DEFAULT 'DRAFT',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS product_images (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    variant_id TEXT,
    image_url TEXT NOT NULL,
    alt_text TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (product_id) REFERENCES products(id),
    FOREIGN KEY (variant_id) REFERENCES product_variants(id)
);

CREATE TABLE IF NOT EXISTS supplier_products (
    id TEXT PRIMARY KEY,
    supplier_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    variant_id TEXT,
    supplier_sku TEXT,
    unit_cost_minor INTEGER,
    currency_code TEXT,
    lead_time_days INTEGER,
    status TEXT NOT NULL DEFAULT 'PENDING',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
    FOREIGN KEY (product_id) REFERENCES products(id),
    FOREIGN KEY (variant_id) REFERENCES product_variants(id),
    FOREIGN KEY (currency_code) REFERENCES currencies(code)
);

CREATE TABLE IF NOT EXISTS inventory (
    id TEXT PRIMARY KEY,
    warehouse_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    variant_id TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0
        CHECK (quantity >= 0),
    verified_at TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (warehouse_id, variant_id),
    FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
    FOREIGN KEY (product_id) REFERENCES products(id),
    FOREIGN KEY (variant_id) REFERENCES product_variants(id)
);

CREATE TABLE IF NOT EXISTS shipping_methods (
    id TEXT PRIMARY KEY,
    method_name TEXT NOT NULL,
    fulfillment_type TEXT NOT NULL
        CHECK (fulfillment_type IN ('LOCAL_WAREHOUSE', 'GLOBAL_CROSS_BORDER')),
    status TEXT NOT NULL DEFAULT 'PENDING',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS shipping_rates (
    id TEXT PRIMARY KEY,
    shipping_method_id TEXT NOT NULL,
    country_code TEXT NOT NULL,
    currency_code TEXT NOT NULL,
    base_cost_minor INTEGER NOT NULL
        CHECK (base_cost_minor >= 0),
    estimated_min_days INTEGER,
    estimated_max_days INTEGER,
    status TEXT NOT NULL DEFAULT 'PENDING',
    FOREIGN KEY (shipping_method_id) REFERENCES shipping_methods(id),
    FOREIGN KEY (country_code) REFERENCES countries(country_code),
    FOREIGN KEY (currency_code) REFERENCES currencies(code)
);

CREATE INDEX IF NOT EXISTS idx_products_category
ON products(category_id);

CREATE INDEX IF NOT EXISTS idx_products_status
ON products(status);

CREATE INDEX IF NOT EXISTS idx_variants_product
ON product_variants(product_id);

CREATE INDEX IF NOT EXISTS idx_inventory_warehouse
ON inventory(warehouse_id);

CREATE INDEX IF NOT EXISTS idx_supplier_products_supplier
ON supplier_products(supplier_id);

CREATE INDEX IF NOT EXISTS idx_shipping_rates_country
ON shipping_rates(country_code);
