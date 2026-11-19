-- HR UNIVERSE
-- Migration 0010: Bangladesh COD delivery operations.
-- Additive only. Does not activate a courier integration or change live orders.
-- Courier booking/tracking values are recorded by the owner until a courier API
-- is deliberately selected and credentials are securely configured.

ALTER TABLE orders ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'NOT_DISPATCHED'
  CHECK (delivery_status IN (
    'NOT_DISPATCHED','READY_TO_SHIP','SHIPPED','IN_TRANSIT',
    'OUT_FOR_DELIVERY','DELIVERED','DELIVERY_FAILED','RETURNED'
  ));
ALTER TABLE orders ADD COLUMN courier_name TEXT;
ALTER TABLE orders ADD COLUMN courier_service TEXT;
ALTER TABLE orders ADD COLUMN consignment_id TEXT;
ALTER TABLE orders ADD COLUMN tracking_url TEXT;
ALTER TABLE orders ADD COLUMN cod_amount_minor INTEGER
  CHECK (cod_amount_minor IS NULL OR cod_amount_minor >= 0);
ALTER TABLE orders ADD COLUMN cod_collected_minor INTEGER NOT NULL DEFAULT 0
  CHECK (cod_collected_minor >= 0);
ALTER TABLE orders ADD COLUMN cod_collected_at TEXT;
ALTER TABLE orders ADD COLUMN delivered_at TEXT;
ALTER TABLE orders ADD COLUMN delivery_notes TEXT;
ALTER TABLE orders ADD COLUMN delivery_updated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_delivery_status
ON orders(delivery_status, created_at);

CREATE INDEX IF NOT EXISTS idx_orders_consignment
ON orders(consignment_id)
WHERE consignment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS order_delivery_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'DELIVERY_STATUS_CHANGED','COURIER_ASSIGNED',
    'TRACKING_UPDATED','COD_COLLECTED','DELIVERY_NOTE'
  )),
  previous_value TEXT,
  new_value TEXT,
  note TEXT,
  actor TEXT NOT NULL DEFAULT 'OWNER',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_order_delivery_events_order
ON order_delivery_events(order_id, created_at DESC);
