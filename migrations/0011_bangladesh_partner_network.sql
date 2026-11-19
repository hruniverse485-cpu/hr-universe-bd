-- HR UNIVERSE
-- Migration 0011: Bangladesh courier and local supplier partner network.
-- Additive foundation only. No partner is activated or API-connected by this migration.
-- Existing supplier, order, inventory and delivery records are preserved.

CREATE TABLE IF NOT EXISTS courier_partners (
  id TEXT PRIMARY KEY,
  partner_code TEXT NOT NULL UNIQUE,
  partner_name TEXT NOT NULL,
  website_url TEXT,
  onboarding_status TEXT NOT NULL DEFAULT 'RESEARCH'
    CHECK (onboarding_status IN ('RESEARCH','CONTACT_READY','CONTACTED','NEGOTIATING','ONBOARDING','TESTING','ACTIVE','PAUSED','REJECTED')),
  api_status TEXT NOT NULL DEFAULT 'NOT_ASSESSED'
    CHECK (api_status IN ('NOT_ASSESSED','NOT_AVAILABLE','DOCUMENTATION_REVIEW','CREDENTIALS_PENDING','SANDBOX_TESTING','CONNECTED','DEGRADED','DISABLED')),
  cod_supported INTEGER NOT NULL DEFAULT 0 CHECK (cod_supported IN (0,1)),
  pickup_supported INTEGER NOT NULL DEFAULT 0 CHECK (pickup_supported IN (0,1)),
  tracking_supported INTEGER NOT NULL DEFAULT 0 CHECK (tracking_supported IN (0,1)),
  webhook_supported INTEGER NOT NULL DEFAULT 0 CHECK (webhook_supported IN (0,1)),
  fulfillment_supported INTEGER NOT NULL DEFAULT 0 CHECK (fulfillment_supported IN (0,1)),
  relationship_owner TEXT,
  last_contacted_at TEXT,
  next_follow_up_at TEXT,
  contract_status TEXT NOT NULL DEFAULT 'NONE'
    CHECK (contract_status IN ('NONE','DRAFT','UNDER_REVIEW','SIGNED','EXPIRED','TERMINATED')),
  contract_expires_at TEXT,
  internal_notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_courier_partners_status
ON courier_partners(onboarding_status, api_status);

CREATE TABLE IF NOT EXISTS partner_contacts (
  id TEXT PRIMARY KEY,
  partner_type TEXT NOT NULL CHECK (partner_type IN ('COURIER','SUPPLIER')),
  partner_id TEXT NOT NULL,
  contact_name TEXT,
  role_title TEXT,
  email TEXT,
  phone TEXT,
  preferred_channel TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
  verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED'
    CHECK (verification_status IN ('UNVERIFIED','PENDING','VERIFIED','REJECTED')),
  verified_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_partner_contacts_lookup
ON partner_contacts(partner_type, partner_id, is_primary);

CREATE TABLE IF NOT EXISTS courier_service_areas (
  id TEXT PRIMARY KEY,
  courier_id TEXT NOT NULL,
  country_code TEXT NOT NULL DEFAULT 'BD',
  district TEXT NOT NULL,
  area_name TEXT,
  postcode TEXT,
  service_type TEXT NOT NULL DEFAULT 'STANDARD'
    CHECK (service_type IN ('STANDARD','EXPRESS','SAME_DAY','PICKUP_ONLY','RETURN_ONLY')),
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0,1)),
  evidence_reference TEXT,
  verified_at TEXT,
  valid_until TEXT,
  FOREIGN KEY (courier_id) REFERENCES courier_partners(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_courier_service_area
ON courier_service_areas(courier_id, district, active);

CREATE TABLE IF NOT EXISTS courier_rate_cards (
  id TEXT PRIMARY KEY,
  courier_id TEXT NOT NULL,
  rate_name TEXT NOT NULL,
  origin_zone TEXT,
  destination_district TEXT,
  destination_area TEXT,
  service_type TEXT NOT NULL DEFAULT 'STANDARD',
  weight_from_grams INTEGER NOT NULL DEFAULT 0 CHECK (weight_from_grams >= 0),
  weight_to_grams INTEGER CHECK (weight_to_grams IS NULL OR weight_to_grams >= weight_from_grams),
  base_fee_minor INTEGER NOT NULL CHECK (base_fee_minor >= 0),
  cod_fee_minor INTEGER NOT NULL DEFAULT 0 CHECK (cod_fee_minor >= 0),
  return_fee_minor INTEGER NOT NULL DEFAULT 0 CHECK (return_fee_minor >= 0),
  remote_area_fee_minor INTEGER NOT NULL DEFAULT 0 CHECK (remote_area_fee_minor >= 0),
  currency_code TEXT NOT NULL DEFAULT 'BDT',
  estimated_min_days INTEGER,
  estimated_max_days INTEGER,
  pickup_cutoff_local TEXT,
  effective_from TEXT,
  effective_until TEXT,
  verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED'
    CHECK (verification_status IN ('UNVERIFIED','PENDING_REVIEW','VERIFIED','REJECTED','EXPIRED')),
  evidence_reference TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (courier_id) REFERENCES courier_partners(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_courier_rates_lookup
ON courier_rate_cards(courier_id, destination_district, verification_status, effective_until);

CREATE TABLE IF NOT EXISTS partner_interactions (
  id TEXT PRIMARY KEY,
  partner_type TEXT NOT NULL CHECK (partner_type IN ('COURIER','SUPPLIER')),
  partner_id TEXT NOT NULL,
  interaction_type TEXT NOT NULL
    CHECK (interaction_type IN ('RESEARCH','EMAIL','PHONE','WHATSAPP','MEETING','QUOTE_RECEIVED','CONTRACT','SUPPORT_CASE','FOLLOW_UP','OTHER')),
  direction TEXT NOT NULL DEFAULT 'INTERNAL'
    CHECK (direction IN ('INBOUND','OUTBOUND','INTERNAL')),
  subject TEXT,
  summary TEXT NOT NULL,
  outcome TEXT,
  follow_up_at TEXT,
  approval_status TEXT NOT NULL DEFAULT 'INTERNAL_NOTE'
    CHECK (approval_status IN ('INTERNAL_NOTE','DRAFT_ONLY','APPROVED_TO_SEND','SENT','CANCELLED')),
  evidence_reference TEXT,
  created_by TEXT NOT NULL DEFAULT 'OWNER',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_partner_interactions_followup
ON partner_interactions(follow_up_at, approval_status);

CREATE INDEX IF NOT EXISTS idx_partner_interactions_partner
ON partner_interactions(partner_type, partner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS supplier_local_profiles (
  supplier_id TEXT PRIMARY KEY,
  business_type TEXT NOT NULL DEFAULT 'OTHER'
    CHECK (business_type IN ('MANUFACTURER','WHOLESALER','DISTRIBUTOR','IMPORTER','AUTHORIZED_RESELLER','OTHER')),
  verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED'
    CHECK (verification_status IN ('UNVERIFIED','PENDING','VERIFIED','REJECTED','SUSPENDED')),
  district TEXT,
  area_name TEXT,
  pickup_address TEXT,
  direct_to_customer INTEGER NOT NULL DEFAULT 0 CHECK (direct_to_customer IN (0,1)),
  blind_shipping_supported INTEGER NOT NULL DEFAULT 0 CHECK (blind_shipping_supported IN (0,1)),
  branded_packaging_supported INTEGER NOT NULL DEFAULT 0 CHECK (branded_packaging_supported IN (0,1)),
  sample_status TEXT NOT NULL DEFAULT 'NOT_REQUESTED'
    CHECK (sample_status IN ('NOT_REQUESTED','REQUESTED','RECEIVED','PASSED','FAILED')),
  quality_score REAL,
  dispatch_score REAL,
  response_score REAL,
  last_stock_verified_at TEXT,
  verification_evidence TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS supplier_local_quotes (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  variant_id TEXT,
  supplier_sku TEXT,
  unit_cost_minor INTEGER NOT NULL CHECK (unit_cost_minor >= 0),
  currency_code TEXT NOT NULL DEFAULT 'BDT',
  available_quantity INTEGER,
  minimum_order_quantity INTEGER NOT NULL DEFAULT 1 CHECK (minimum_order_quantity >= 1),
  lead_time_hours INTEGER,
  quote_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (quote_status IN ('PENDING','VERIFIED','REJECTED','EXPIRED')),
  stock_verified_at TEXT,
  valid_until TEXT,
  evidence_reference TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
  FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE RESTRICT,
  FOREIGN KEY (currency_code) REFERENCES currencies(code) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_supplier_local_quotes_product
ON supplier_local_quotes(product_id, variant_id, quote_status, valid_until);

CREATE TABLE IF NOT EXISTS partner_ai_recommendations (
  id TEXT PRIMARY KEY,
  recommendation_type TEXT NOT NULL
    CHECK (recommendation_type IN ('COURIER_SELECTION','SUPPLIER_SELECTION','FOLLOW_UP','SLA_ALERT','COD_VARIANCE','OTHER')),
  order_id TEXT,
  partner_type TEXT CHECK (partner_type IN ('COURIER','SUPPLIER')),
  partner_id TEXT,
  recommendation_json TEXT NOT NULL,
  confidence_score REAL,
  evidence_summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING_REVIEW'
    CHECK (status IN ('PENDING_REVIEW','APPROVED','REJECTED','EXPIRED','EXECUTED')),
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_partner_ai_recommendations_queue
ON partner_ai_recommendations(status, created_at);
