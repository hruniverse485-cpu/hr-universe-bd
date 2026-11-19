-- HR UNIVERSE
-- Migration 0014: owner-managed catalog audit history.
-- Additive only. Audit rows are append-only in the Worker workflow.

CREATE TABLE IF NOT EXISTS catalog_admin_audit (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('CATEGORY','PRODUCT','VARIANT','PRICE')),
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_catalog_admin_audit_entity
ON catalog_admin_audit(entity_type, entity_id, created_at DESC);
