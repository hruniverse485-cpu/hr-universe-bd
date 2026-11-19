-- HR UNIVERSE
-- Migration 0006: Atomic local inventory reservation for COD orders.
-- Reservation triggers run in the same D1 batch as order creation. A failed
-- reservation aborts the batch, rolling back the order and all order items.
-- Each line is allocated to one verified Bangladesh warehouse inventory row.

CREATE TABLE IF NOT EXISTS inventory_reservations (
  order_item_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  inventory_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  status TEXT NOT NULL DEFAULT 'RESERVED'
    CHECK (status IN ('RESERVED', 'RELEASED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  released_at TEXT,
  FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE RESTRICT,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT,
  FOREIGN KEY (inventory_id) REFERENCES inventory(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_inventory_reservations_order
ON inventory_reservations(order_id, status);

CREATE TRIGGER IF NOT EXISTS trg_order_item_reserve_stock
BEFORE INSERT ON order_items
WHEN NEW.fulfillment_type = 'LOCAL_WAREHOUSE'
 AND NOT EXISTS (
   SELECT 1
   FROM inventory i
   JOIN warehouses w ON w.id = i.warehouse_id
   WHERE i.product_id = NEW.product_id
     AND i.variant_id = NEW.variant_id
     AND w.country_code = 'BD'
     AND w.status = 'ACTIVE'
     AND i.verified_at IS NOT NULL
     AND i.quantity >= NEW.quantity
 )
BEGIN
  SELECT RAISE(ABORT, 'Insufficient verified stock for atomic reservation');
END;

CREATE TRIGGER IF NOT EXISTS trg_order_item_reserve_stock_after
AFTER INSERT ON order_items
WHEN NEW.fulfillment_type = 'LOCAL_WAREHOUSE'
BEGIN
  INSERT INTO inventory_reservations (
    order_item_id, order_id, inventory_id, quantity, status
  )
  SELECT
    NEW.id, NEW.order_id, i.id, NEW.quantity, 'RESERVED'
  FROM inventory i
  JOIN warehouses w ON w.id = i.warehouse_id
  WHERE i.product_id = NEW.product_id
    AND i.variant_id = NEW.variant_id
    AND w.country_code = 'BD'
    AND w.status = 'ACTIVE'
    AND i.verified_at IS NOT NULL
    AND i.quantity >= NEW.quantity
  ORDER BY i.id
  LIMIT 1;

  UPDATE inventory
  SET quantity = quantity - NEW.quantity,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = (
    SELECT inventory_id
    FROM inventory_reservations
    WHERE order_item_id = NEW.id
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_order_cancel_release_stock
AFTER UPDATE OF status ON orders
WHEN OLD.status NOT IN ('CANCELLED', 'REJECTED')
 AND NEW.status IN ('CANCELLED', 'REJECTED')
BEGIN
  UPDATE inventory
  SET quantity = quantity + (
    SELECT r.quantity
    FROM inventory_reservations r
    WHERE r.inventory_id = inventory.id
      AND r.order_id = NEW.id
      AND r.status = 'RESERVED'
  ),
  updated_at = CURRENT_TIMESTAMP
  WHERE id IN (
    SELECT inventory_id
    FROM inventory_reservations
    WHERE order_id = NEW.id AND status = 'RESERVED'
  );

  UPDATE inventory_reservations
  SET status = 'RELEASED',
      released_at = CURRENT_TIMESTAMP
  WHERE order_id = NEW.id AND status = 'RESERVED';
END;
