-- HR UNIVERSE
-- Migration 0015: enforce stock-verification freshness at the database boundary.
-- Public catalog filtering alone is insufficient: a caller could submit an
-- order directly, bypassing the storefront. Keep the reservation trigger as
-- the final authority and require verification within the last 72 hours.
--
-- Future-dated verification timestamps are not valid evidence. Clear existing
-- future timestamps so they cannot make stock appear freshly verified.

UPDATE inventory
SET verified_at = NULL
WHERE verified_at IS NOT NULL
  AND datetime(verified_at) > CURRENT_TIMESTAMP;

DROP TRIGGER IF EXISTS trg_order_item_reserve_stock;
DROP TRIGGER IF EXISTS trg_order_item_reserve_stock_after;

CREATE TRIGGER trg_order_item_reserve_stock
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
     AND datetime(i.verified_at) >= datetime('now', '-72 hours')
     AND datetime(i.verified_at) <= CURRENT_TIMESTAMP
     AND i.quantity >= NEW.quantity
 )
BEGIN
  SELECT RAISE(ABORT, 'Insufficient verified stock for atomic reservation (fresh verification required)');
END;

CREATE TRIGGER trg_order_item_reserve_stock_after
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
    AND datetime(i.verified_at) >= datetime('now', '-72 hours')
    AND datetime(i.verified_at) <= CURRENT_TIMESTAMP
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
