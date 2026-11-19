#!/usr/bin/env python3
"""Validate the legacy base schema plus every ordered marketplace migration.

This is a disposable in-memory database test. It never connects to production D1.
"""
from pathlib import Path
import sqlite3
import sys

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "worker" / "schema.sql"
MIGRATIONS = ROOT / "migrations"

def fail(message: str) -> None:
    print(f"FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)

if not SCHEMA.is_file():
    fail(f"Missing base schema: {SCHEMA}")

migration_files = sorted(MIGRATIONS.glob("*.sql"))
if not migration_files:
    fail("No SQL migrations found")

db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys = ON")
try:
    db.executescript(SCHEMA.read_text(encoding="utf-8"))
    for migration in migration_files:
        print(f"Applying {migration.relative_to(ROOT)}")
        db.executescript(migration.read_text(encoding="utf-8"))

    required_tables = {
        "orders", "countries", "currencies", "categories", "products",
        "product_variants", "product_images", "suppliers", "supplier_products",
        "warehouses", "inventory", "shipping_methods", "shipping_rates",
        "product_prices", "order_items", "supplier_product_sources",
        "supplier_shipping_quotes", "supplier_sync_runs", "inventory_reservations",
    }
    actual_tables = {
        row[0] for row in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )
    }
    missing = sorted(required_tables - actual_tables)
    if missing:
        fail("Missing required tables: " + ", ".join(missing))

    order_columns = {
        row[1] for row in db.execute("PRAGMA table_info(orders)")
    }
    required_order_columns = {
        "country_code", "currency_code", "subtotal_minor",
        "shipping_cost_minor", "tax_minor", "total_minor",
        "fulfillment_type", "idempotency_key",
    }
    missing_columns = sorted(required_order_columns - order_columns)
    if missing_columns:
        fail("Missing order columns: " + ", ".join(missing_columns))

    # Exercise the actual reservation/release triggers on disposable SQLite.
    db.execute("INSERT INTO countries (id, country_code, country_name, currency_code, is_active) VALUES ('c-bd', 'BD', 'Bangladesh', 'BDT', 1)")
    db.execute("INSERT INTO currencies (code, currency_name, symbol, decimal_places, is_active) VALUES ('BDT', 'Taka', '৳', 0, 1)")
    db.execute("INSERT INTO categories (id, name, slug, is_active) VALUES ('cat', 'Test', 'test', 1)")
    db.execute("INSERT INTO products (id, category_id, name, slug, status) VALUES ('prod', 'cat', 'Test product', 'test-product', 'ACTIVE')")
    db.execute("INSERT INTO product_variants (id, product_id, sku, status) VALUES ('var', 'prod', 'TEST-1', 'ACTIVE')")
    db.execute("INSERT INTO warehouses (id, warehouse_name, country_code, status) VALUES ('wh', 'BD Warehouse', 'BD', 'ACTIVE')")
    db.execute("INSERT INTO inventory (id, warehouse_id, product_id, variant_id, quantity, verified_at) VALUES ('inv', 'wh', 'prod', 'var', 5, CURRENT_TIMESTAMP)")

    def insert_order(order_id: str) -> None:
        db.execute(
            """INSERT INTO orders (
                id, product_id, product_name, unit_price, quantity, total,
                payment_method, customer_name, customer_phone, customer_address,
                district, status, created_at
            ) VALUES (?, 'prod', 'Test product', 10, 1, 10, 'COD',
                      'Test Customer', '01000000000', 'Test address',
                      'Dhaka', 'PENDING', CURRENT_TIMESTAMP)""",
            (order_id,),
        )

    insert_order("order-a")
    db.execute(
        """INSERT INTO order_items (
            id, order_id, product_id, variant_id, product_name_snapshot,
            unit_price_minor, currency_code, quantity, line_total_minor,
            fulfillment_type
        ) VALUES ('item-a1', 'order-a', 'prod', 'var', 'Test product',
                  1000, 'BDT', 2, 2000, 'LOCAL_WAREHOUSE')"""
    )
    db.execute(
        """INSERT INTO order_items (
            id, order_id, product_id, variant_id, product_name_snapshot,
            unit_price_minor, currency_code, quantity, line_total_minor,
            fulfillment_type
        ) VALUES ('item-a2', 'order-a', 'prod', 'var', 'Test product',
                  1000, 'BDT', 1, 1000, 'LOCAL_WAREHOUSE')"""
    )
    remaining = db.execute("SELECT quantity FROM inventory WHERE id='inv'").fetchone()[0]
    if remaining != 2:
        fail(f"Reservation trigger expected 2 units remaining, got {remaining}")
    reservation_count = db.execute(
        "SELECT COUNT(*) FROM inventory_reservations WHERE order_id='order-a' AND status='RESERVED'"
    ).fetchone()[0]
    if reservation_count != 2:
        fail(f"Expected two reservation ledger rows, got {reservation_count}")

    insert_order("order-b")
    try:
        with db:
            db.execute(
                """INSERT INTO order_items (
                    id, order_id, product_id, variant_id, product_name_snapshot,
                    unit_price_minor, currency_code, quantity, line_total_minor,
                    fulfillment_type
                ) VALUES ('item-b1', 'order-b', 'prod', 'var', 'Test product',
                          1000, 'BDT', 3, 3000, 'LOCAL_WAREHOUSE')"""
            )
    except sqlite3.IntegrityError:
        pass
    else:
        fail("Insufficient stock did not abort the reservation")
    if db.execute("SELECT quantity FROM inventory WHERE id='inv'").fetchone()[0] != 2:
        fail("Failed reservation changed available inventory")

    db.execute("UPDATE orders SET status='CANCELLED' WHERE id='order-a'")
    restored = db.execute("SELECT quantity FROM inventory WHERE id='inv'").fetchone()[0]
    if restored != 5:
        fail(f"Cancellation should restore 3 units, got inventory={restored}")
    db.execute("UPDATE orders SET status='REJECTED' WHERE id='order-a'")
    if db.execute("SELECT quantity FROM inventory WHERE id='inv'").fetchone()[0] != 5:
        fail("Repeated terminal status change restored inventory twice")
    if db.execute(
        "SELECT COUNT(*) FROM inventory_reservations WHERE order_id='order-a' AND status='RELEASED'"
    ).fetchone()[0] != 2:
        fail("Cancellation did not release all reservation ledger rows")

    violations = db.execute("PRAGMA foreign_key_check").fetchall()
    if violations:
        fail(f"Foreign key violations: {violations[:5]}")

    print(
        f"PASS: base schema + {len(migration_files)} ordered migrations; "
        "required marketplace tables/columns present; foreign keys clean."
    )
except sqlite3.Error as exc:
    fail(f"SQLite migration validation failed: {exc}")
finally:
    db.close()
