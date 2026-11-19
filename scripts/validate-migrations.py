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
        "supplier_variant_offers", "supplier_variant_shipping_quotes", "supplier_offer_audit",
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
        "fulfillment_type", "idempotency_key", "idempotency_request_hash",
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
    # Seed one verified multi-supplier offer and destination quote for schema checks.
    db.execute("INSERT INTO countries (id, country_code, country_name, currency_code, is_active) VALUES ('c-us', 'US', 'United States', 'USD', 1)")
    db.execute("INSERT INTO currencies (code, currency_name, symbol, decimal_places, is_active) VALUES ('USD', 'US Dollar', 'USD', 2, 1)")
    db.execute("INSERT INTO suppliers (id, supplier_name, origin_country_code, status) VALUES ('supplier-a', 'Test supplier', 'US', 'ACTIVE')")
    db.execute("INSERT INTO supplier_product_sources (id, supplier_id, product_id, supplier_product_id, source_currency_code, source_unit_cost_minor, source_status) VALUES ('source-a', 'supplier-a', 'prod', 'external-product-a', 'USD', 1250, 'AVAILABLE')")
    db.execute("INSERT INTO supplier_variant_offers (id, source_id, product_id, variant_id, supplier_variant_id, source_unit_cost_minor, source_currency_code, availability_status, approval_status, quality_score, service_score, packaging_score, delivery_score, packaging_status, supplier_branding_excluded, tracking_available, returns_supported, evidence_reference, verified_at) VALUES ('offer-a', 'source-a', 'prod', 'var', 'external-variant-a', 1250, 'USD', 'AVAILABLE', 'ACTIVE', 90, 85, 95, 80, 'NEUTRAL_CONFIRMED', 1, 1, 1, 'test-evidence', CURRENT_TIMESTAMP)")
    db.execute("INSERT INTO supplier_variant_shipping_quotes (id, offer_id, destination_country_code, shipping_method_code, shipping_cost_minor, currency_code, estimated_min_days, estimated_max_days, availability_status, quoted_at, expires_at) VALUES ('quote-a', 'offer-a', 'US', 'STANDARD', 500, 'USD', 5, 9, 'AVAILABLE', CURRENT_TIMESTAMP, '2099-01-01 00:00:00')")
    eligible = db.execute("SELECT svo.id FROM supplier_variant_offers svo JOIN supplier_product_sources src ON src.id = svo.source_id JOIN suppliers s ON s.id = src.supplier_id JOIN supplier_variant_shipping_quotes q ON q.offer_id = svo.id JOIN countries c ON c.country_code = q.destination_country_code WHERE svo.approval_status = 'ACTIVE' AND svo.availability_status = 'AVAILABLE' AND src.source_status = 'AVAILABLE' AND s.status = 'ACTIVE' AND q.availability_status = 'AVAILABLE' AND q.currency_code = c.currency_code AND svo.packaging_status = 'NEUTRAL_CONFIRMED' AND svo.supplier_branding_excluded = 1 AND q.destination_country_code = 'US'").fetchall()
    if eligible != [('offer-a',)]:
        fail(f"Expected one eligible verified US supplier offer, got {eligible}")
    db.execute("INSERT INTO products (id, category_id, name, slug, status) VALUES ('other-prod', 'cat', 'Other', 'other-product', 'ACTIVE')")
    db.execute("INSERT INTO product_variants (id, product_id, sku, status) VALUES ('other-var', 'other-prod', 'OTHER-1', 'ACTIVE')")
    try:
        db.execute("INSERT INTO supplier_variant_offers (id, source_id, product_id, variant_id, supplier_variant_id, source_unit_cost_minor, source_currency_code) VALUES ('bad-offer', 'source-a', 'prod', 'other-var', 'external-bad', 100, 'USD')")
    except sqlite3.IntegrityError:
        pass
    else:
        fail("Supplier variant offer accepted an HR variant from another product")


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
    legacy_hash = db.execute(
        "SELECT idempotency_request_hash FROM orders WHERE id='order-a'"
    ).fetchone()[0]
    if legacy_hash is not None:
        fail("Legacy orders must retain a NULL request fingerprint after migration 0009")

    fingerprint = "a" * 64
    db.execute(
        "UPDATE orders SET idempotency_key='legacy-test-key', idempotency_request_hash=? WHERE id='order-a'",
        (fingerprint,),
    )
    stored_fingerprint = db.execute(
        "SELECT idempotency_request_hash FROM orders WHERE id='order-a'"
    ).fetchone()[0]
    if stored_fingerprint != fingerprint:
        fail("Order request fingerprint was not persisted")

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
    db.commit()

    insert_order("order-b")
    try:
        db.execute(
            "UPDATE orders SET idempotency_key='legacy-test-key' WHERE id='order-b'"
        )
    except sqlite3.IntegrityError:
        pass
    else:
        fail("Duplicate non-NULL idempotency key was accepted")
    if db.execute(
        "SELECT idempotency_key FROM orders WHERE id='order-b'"
    ).fetchone()[0] is not None:
        fail("Rejected duplicate idempotency key changed the second order")
    db.commit()
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

    audit_columns = {row[1] for row in db.execute("PRAGMA table_info(supplier_offer_audit)")}
    if not {"entity_type", "entity_id", "action", "actor", "before_json", "after_json"} <= audit_columns:
        fail("Supplier offer audit table is missing required fields")

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
