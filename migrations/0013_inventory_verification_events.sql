-- HR UNIVERSE
-- Migration 0013: owner-entered physical inventory verification history.
-- The inventory.quantity column stores available (unreserved) units. This
-- event table preserves the physical count, active reservations and resulting
-- available count for each verification. No automatic supplier stock sync.

ALTER TABLE inventory ADD COLUMN verification_token TEXT;

CREATE TABLE IF NOT EXISTS inventory_verification_events (
  id TEXT PRIMARY KEY,
  inventory_id TEXT NOT NULL,
  previous_available_quantity INTEGER NOT NULL CHECK (previous_available_quantity >= 0),
  verified_physical_quantity INTEGER NOT NULL CHECK (verified_physical_quantity >= 0),
  reserved_quantity INTEGER NOT NULL CHECK (reserved_quantity >= 0),
  new_available_quantity INTEGER NOT NULL CHECK (new_available_quantity >= 0),
  evidence_reference TEXT NOT NULL,
  notes TEXT,
  verified_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (inventory_id) REFERENCES inventory(id) ON DELETE RESTRICT,
  CHECK (new_available_quantity = verified_physical_quantity - reserved_quantity)
);

CREATE INDEX IF NOT EXISTS idx_inventory_verification_inventory_time
ON inventory_verification_events(inventory_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_verification_evidence
ON inventory_verification_events(inventory_id, evidence_reference);
