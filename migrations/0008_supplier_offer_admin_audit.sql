-- HR UNIVERSE migration 0008: owner-managed supplier offer audit trail.
CREATE TABLE IF NOT EXISTS supplier_offer_audit (
 id TEXT PRIMARY KEY,
 entity_type TEXT NOT NULL CHECK (entity_type IN ('OFFER','SHIPPING_QUOTE')),
 entity_id TEXT NOT NULL,
 action TEXT NOT NULL,
 actor TEXT NOT NULL,
 before_json TEXT,
 after_json TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_supplier_offer_audit_entity ON supplier_offer_audit(entity_type,entity_id,created_at DESC);
