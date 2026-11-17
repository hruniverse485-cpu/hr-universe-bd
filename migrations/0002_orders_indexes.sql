-- HR UNIVERSE
-- Migration 0002: Orders Indexes
-- Safe: creates indexes only; does not modify or delete order data.

CREATE INDEX IF NOT EXISTS idx_orders_created_at
ON orders(created_at);

CREATE INDEX IF NOT EXISTS idx_orders_status
ON orders(status);
