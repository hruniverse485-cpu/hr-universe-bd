-- HR UNIVERSE
-- Migration 0012: Bangladesh COD financial reconciliation and returned-parcel inspection.
-- Additive only. This records owner-entered evidence; it does not move money,
-- settle an order, restock inventory, or claim an independently verified event.

CREATE TABLE IF NOT EXISTS cod_reconciliation_entries (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN (
    'CUSTOMER_COD_COLLECTED',
    'COURIER_SETTLEMENT_RECEIVED',
    'COURIER_FEE',
    'RETURN_FEE',
    'CUSTOMER_REFUND',
    'ADJUSTMENT_IN',
    'ADJUSTMENT_OUT'
  )),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency_code TEXT NOT NULL DEFAULT 'BDT' CHECK (currency_code = 'BDT'),
  status TEXT NOT NULL DEFAULT 'PENDING_REVIEW'
    CHECK (status IN ('PENDING_REVIEW','VERIFIED','DISPUTED')),
  source_reference TEXT,
  evidence_reference TEXT NOT NULL,
  notes TEXT,
  occurred_at TEXT NOT NULL,
  recorded_by TEXT NOT NULL DEFAULT 'OWNER',
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT,
  CHECK (
    (status = 'PENDING_REVIEW' AND reviewed_at IS NULL AND reviewed_by IS NULL)
    OR
    (status IN ('VERIFIED','DISPUTED') AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_cod_ledger_order_time
ON cod_reconciliation_entries(order_id, occurred_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cod_ledger_status_time
ON cod_reconciliation_entries(status, occurred_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cod_ledger_source_reference
ON cod_reconciliation_entries(order_id, entry_type, source_reference)
WHERE source_reference IS NOT NULL AND length(trim(source_reference)) > 0;

CREATE TABLE IF NOT EXISTS order_return_inspections (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  parcel_condition TEXT NOT NULL CHECK (parcel_condition IN (
    'SEALED_INTACT','OPENED_INTACT','DAMAGED','INCOMPLETE','WRONG_ITEM','MISSING'
  )),
  disposition TEXT NOT NULL CHECK (disposition IN (
    'QUARANTINE','RESTOCK_CANDIDATE','RETURN_TO_SUPPLIER','DISPOSE','INVESTIGATE'
  )),
  inspected_quantity INTEGER NOT NULL CHECK (inspected_quantity BETWEEN 1 AND 10000),
  notes TEXT NOT NULL,
  evidence_reference TEXT,
  inspected_by TEXT NOT NULL DEFAULT 'OWNER',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_return_inspections_order
ON order_return_inspections(order_id, created_at DESC);

-- Deliberately no trigger that restocks inventory. A RESTOCK_CANDIDATE is only
-- an inspection outcome; a separately authorized stock movement is required.
