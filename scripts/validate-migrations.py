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
        "product_prices", "order_items",
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
