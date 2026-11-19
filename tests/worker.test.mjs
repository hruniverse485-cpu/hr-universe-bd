import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";

const workerSource = readFileSync(
  new URL("../worker/index.js", import.meta.url),
  "utf8"
);
let worker;
try {
  ({ default: worker } = await import(
    `data:text/javascript;base64,${Buffer.from(workerSource).toString("base64")}`
  ));
} catch (error) {
  console.error("Worker module import failed:", error?.name, error?.message, error?.stack?.split("\n").slice(-5).join("\n"));
  throw error;
}

function request(path, method = "GET", body, headers = {}) {
  return new Request(`https://hr-universe.test${path}`, {
    method,
    headers,
    body
  });
}

test("health endpoint reports unavailable database as 503", async () => {
  const response = await worker.fetch(request("/api/health"), {});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).success, false);
});

test("health endpoint reports a reachable database", async () => {
  const env = {
    DB: {
      prepare(sql) {
        assert.match(sql, /SELECT 1 AS ok/);
        return { first: async () => ({ ok: 1 }) };
      }
    }
  };

  const response = await worker.fetch(request("/api/health"), env);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.database, "connected");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("health endpoint rejects unsupported methods", async () => {
  const response = await worker.fetch(request("/api/health", "POST"), {});
  assert.equal(response.status, 405);
});

test("product endpoint rejects unsupported methods", async () => {
  const response = await worker.fetch(request("/api/products", "POST"), {
    DB: {}
  });
  assert.equal(response.status, 405);
});

test("public category endpoint rejects unsupported methods", async () => {
  const response = await worker.fetch(request("/api/categories?country=BD&currency=BDT", "POST"), { DB: {} });
  assert.equal(response.status, 405);
});

test("public category endpoint requires a valid market", async () => {
  const response = await worker.fetch(request("/api/categories?country=USA&currency=USD"), { DB: {} });
  assert.equal(response.status, 400);
});

test("public category endpoint only returns categories with currently eligible products", async () => {
  let sql = "";
  let values = [];
  const DB = { prepare(query) { sql = query; return { bind(...args) { values = args; return { all: async () => ({ results: [{ id: "cat-1", name: "Home", slug: "home", product_count: 2 }] }) }; } }; } };
  const response = await worker.fetch(request("/api/categories?country=BD&currency=BDT"), { DB, HR_INVENTORY_MAX_AGE_HOURS: "24" });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.count, 1);
  assert.equal(payload.categories[0].slug, "home");
  assert.match(sql, /c\.is_active = 1/);
  assert.match(sql, /p\.status = 'ACTIVE'/);
  assert.match(sql, /pp\.status = 'ACTIVE'/);
  assert.match(sql, /i\.verified_at IS NOT NULL/);
  assert.match(sql, /datetime\(i\.verified_at\) <= CURRENT_TIMESTAMP/);
  assert.deepEqual(values, ["BD", "BDT", "-24 hours"]);
});

test("product endpoint requires a valid country and currency", async () => {
  const response = await worker.fetch(
    request("/api/products?country=USA&currency=USD"),
    { DB: {} }
  );
  assert.equal(response.status, 400);
});

test("Product catalog only lists products with verified active warehouse stock", async () => {
  let sql = "";
  let values = [];
  const DB = {
    prepare(query) {
      sql = query;
      return { bind(...args) { values = args; return { all: async () => ({ results: [] }) }; } };
    }
  };
  const response = await worker.fetch(request("/api/products?country=BD&currency=BDT"), { DB });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.success, true);
  assert.equal(payload.inventory_max_age_hours, 72);
  assert.ok(sql.includes("i.verified_at IS NOT NULL"));
  assert.equal(sql.split("datetime(i.verified_at) >= datetime('now', ?)").length - 1, 2);
  assert.equal(sql.split("datetime(i.verified_at) <= CURRENT_TIMESTAMP").length - 1, 2);
  assert.ok(sql.includes("i.quantity > 0"));
  assert.ok(sql.includes("w.status = 'ACTIVE'"));
  assert.ok(sql.includes("available_quantity"));
  assert.ok(sql.includes("MAX(i.quantity)"));
  assert.deepEqual(values, ["-72 hours", "BD", "BDT", "-72 hours", "", "", "", 24]);
});
test("Product catalog honors a configured inventory freshness limit", async () => {
  let values = [];
  const DB = { prepare() { return { bind(...args) { values = args; return { all: async () => ({ results: [] }) }; } }; } };
  const response = await worker.fetch(request("/api/products?country=BD&currency=BDT"), {
    DB, HR_INVENTORY_MAX_AGE_HOURS: "24"
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.inventory_max_age_hours, 24);
  assert.equal(values.filter(value => value === "-24 hours").length, 2);
});

test("Inventory freshness configuration cannot exceed the atomic 72-hour reservation ceiling", async () => {
  let values = [];
  const DB = { prepare() { return { bind(...args) { values = args; return { all: async () => ({ results: [] }) }; } }; } };
  const response = await worker.fetch(request("/api/products?country=BD&currency=BDT"), {
    DB, HR_INVENTORY_MAX_AGE_HOURS: "120"
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.inventory_max_age_hours, 72);
  assert.equal(values.filter(value => value === "-72 hours").length, 2);
});

test("Owner inventory list returns stale flags using the configured freshness limit", async () => {
  let sql = "";
  let values = [];
  const DB = { prepare(query) { sql = query; return { bind(...args) { values = args; return { all: async () => ({ results: [] }) }; } }; } };
  const response = await worker.fetch(request("/api/admin/inventory/verification", "GET", undefined, { authorization: "Bearer owner-secret" }), {
    DB, HR_ADMIN_API_TOKEN: "owner-secret", HR_INVENTORY_MAX_AGE_HOURS: "48"
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.inventory_max_age_hours, 48);
  assert.ok(sql.includes("AS is_stale"));
  assert.deepEqual(values, ["-48 hours"]);
});
test("order endpoint rejects malformed JSON without creating an order", async () => {
  const response = await worker.fetch(
    request("/api/orders", "POST", "{not-json}", {
      "content-type": "application/json"
    }),
    { DB: {} }
  );

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Invalid JSON/);
});

test("order endpoint rejects oversized request bodies", async () => {
  const response = await worker.fetch(
    request("/api/orders", "POST", "x".repeat(20001)),
    { DB: {} }
  );
  assert.equal(response.status, 413);
});

test("order endpoint rejects non-object JSON payloads", async () => {
  const response = await worker.fetch(
    request("/api/orders", "POST", "[]"),
    { DB: {} }
  );
  assert.equal(response.status, 400);
});

test("order endpoint requires the database binding", async () => {
  const response = await worker.fetch(
    request("/api/orders", "POST", "{}"),
    {}
  );
  assert.equal(response.status, 503);
});

test("unknown API routes return JSON 404", async () => {
  const response = await worker.fetch(request("/api/not-real"), {});
  assert.equal(response.status, 404);
  assert.equal((await response.json()).success, false);
});

test("order management is not exposed without admin authentication", async () => {
  const response = await worker.fetch(request("/api/orders"), { DB: {} });
  assert.equal(response.status, 403);
});

test("owner cancellation endpoint rejects missing owner credentials before database access", async () => {
  const response = await worker.fetch(
    request("/api/admin/orders/cancel", "POST", JSON.stringify({ order_id: "order-1" })),
    { DB: { prepare() { throw new Error("Database must not be queried"); } }, HR_ADMIN_API_TOKEN: "owner-secret" }
  );
  assert.equal(response.status, 401);
});

test("owner cancellation endpoint cancels only pending orders with a conditional update", async () => {
  const statements = [];
  const DB = {
    prepare(sql) {
      statements.push(sql);
      return {
        bind(...values) {
          return {
            first: async () => ({ id: values[0], status: "PENDING" }),
            run: async () => ({ meta: { changes: 1 } })
          };
        }
      };
    }
  };
  const response = await worker.fetch(
    request("/api/admin/orders/cancel", "POST", JSON.stringify({ order_id: "order-1" }), {
      authorization: "Bearer owner-secret", "content-type": "application/json"
    }),
    { DB, HR_ADMIN_API_TOKEN: "owner-secret" }
  );
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.order.status, "CANCELLED");
  assert.equal(payload.inventory_release, "DATABASE_TRIGGER");
  assert.match(statements[1], /WHERE id = \? AND status = 'PENDING'/);
});

test("owner cancellation endpoint refuses confirmed orders without changing status", async () => {
  let updateAttempted = false;
  const DB = {
    prepare(sql) {
      return {
        bind() {
          return {
            first: async () => ({ id: "order-2", status: "CONFIRMED" }),
            run: async () => { updateAttempted = true; return { meta: { changes: 1 } }; }
          };
        }
      };
    }
  };
  const response = await worker.fetch(
    request("/api/admin/orders/cancel", "POST", JSON.stringify({ order_id: "order-2" }), {
      authorization: "Bearer owner-secret", "content-type": "application/json"
    }),
    { DB, HR_ADMIN_API_TOKEN: "owner-secret" }
  );
  assert.equal(response.status, 409);
  assert.equal(updateAttempted, false);
});

test("owner cancellation endpoint validates the order identifier", async () => {
  const response = await worker.fetch(
    request("/api/admin/orders/cancel", "POST", JSON.stringify({}), {
      authorization: "Bearer owner-secret"
    }),
    { DB: {}, HR_ADMIN_API_TOKEN: "owner-secret" }
  );
  assert.equal(response.status, 400);
});

const storefrontSource = readFileSync(
  new URL("../public/index.html", import.meta.url),
  "utf8"
);

test("storefront loads products from the live API instead of hard-coded demo products", () => {
  assert.match(storefrontSource, /fetch\('\/api\/products\?/);
  assert.doesNotMatch(storefrontSource, /const products\s*=\s*\[\s*\{/);
  assert.match(storefrontSource, /No sample or unverified products are shown/);
});

test("storefront never claims a failed request created a demo order", () => {
  assert.doesNotMatch(storefrontSource, /Demo mode:/i);
  assert.doesNotMatch(storefrontSource, /submitOrder\s*\(/);
  assert.doesNotMatch(storefrontSource, /fetch\('\/api\/orders/);
});

test("storefront provides search, saved products, live category discovery, responsive layout and relaxed browsing copy", () => {
  assert.match(storefrontSource, /id="searchInput"/);
  assert.match(storefrontSource, /hu-saved-products/);
  assert.match(storefrontSource, /api\/categories\?/);
  assert.match(storefrontSource, /id="dynamicCategoryNav"/);
  assert.match(storefrontSource, /category_slug/);
  assert.match(storefrontSource, /@media\(max-width:600px\)/);
  assert.match(storefrontSource, /No rush/);
  assert.match(storefrontSource, /prefers-reduced-motion/);
});

test("storefront JavaScript parses without syntax errors", () => {
  const start = storefrontSource.indexOf("<script>");
  const end = storefrontSource.indexOf("</script>", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const script = storefrontSource.slice(start + 8, end);
  assert.doesNotThrow(() => new Script(script));
});


test("order endpoint rejects missing idempotency key before database work", async () => {
  const response = await worker.fetch(
    request("/api/orders", "POST", JSON.stringify({
      country_code: "BD",
      currency_code: "BDT",
      payment_method: "COD"
    })),
    { DB: {} }
  );
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Idempotency-Key/);
});

test("Worker delegates authoritative stock reservation to database triggers", () => {
  assert.match(workerSource, /authoritative atomic/);
  assert.match(workerSource, /reservation inside the same D1 batch/);
  assert.match(workerSource, /A valid Idempotency-Key header/);
});


test("supplier comparison endpoint is owner-token protected and unavailable without a configured secret", async () => {
  const response = await worker.fetch(
    request("/api/admin/sourcing/compare?product_id=p&variant_id=v&destination=US"),
    { DB: {}, HR_ADMIN_API_TOKEN: "" }
  );
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /not configured/i);
});

test("supplier comparison endpoint rejects invalid owner credentials before database access", async () => {
  const response = await worker.fetch(
    request("/api/admin/sourcing/compare?product_id=p&variant_id=v&destination=US", "GET", undefined, {
      authorization: "Bearer wrong-token"
    }),
    {
      DB: { prepare() { throw new Error("Database must not be queried"); } },
      HR_ADMIN_API_TOKEN: "correct-owner-token"
    }
  );
  assert.equal(response.status, 401);
});

test("supplier comparison endpoint validates identifiers after owner authentication", async () => {
  const response = await worker.fetch(
    request("/api/admin/sourcing/compare?destination=USA", "GET", undefined, {
      authorization: "Bearer correct-owner-token"
    }),
    {
      DB: {},
      HR_ADMIN_API_TOKEN: "correct-owner-token"
    }
  );
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /product_id, variant_id/i);
});

test("supplier comparison is isolated behind an authenticated admin route and requires verified branded-neutral offers", () => {
  assert.match(workerSource, /\/api\/admin\/sourcing\/compare/);
  assert.match(workerSource, /Authorization/);
  assert.match(workerSource, /PENDING_VERIFICATION/);
  assert.match(workerSource, /supplier_branding_excluded = 1/);
  assert.match(workerSource, /quality_score/);
  assert.match(workerSource, /landed_cost_minor/);
});


test("supplier offer management requires configured owner token", async () => {
  const response = await worker.fetch(request("/api/admin/sourcing/offers", "POST", "{}", {
    "content-type": "application/json"
  }), { DB: {}, HR_ADMIN_API_TOKEN: "" });
  assert.equal(response.status, 503);
});

test("supplier offer management rejects unauthorized requests before database access", async () => {
  const response = await worker.fetch(request("/api/admin/sourcing/offers", "POST", "{}", {
    authorization: "Bearer wrong"
  }), {
    DB: { prepare() { throw new Error("Database must not be queried"); } },
    HR_ADMIN_API_TOKEN: "owner-secret"
  });
  assert.equal(response.status, 401);
});

test("supplier offer management rejects unsupported methods after authentication", async () => {
  const response = await worker.fetch(request("/api/admin/sourcing/offers", "PATCH", undefined, {
    authorization: "Bearer owner-secret"
  }), { DB: {}, HR_ADMIN_API_TOKEN: "owner-secret" });
  assert.equal(response.status, 405);
});

test("supplier offer management validates operation before database access", async () => {
  const response = await worker.fetch(request("/api/admin/sourcing/offers", "POST", JSON.stringify({
    operation: "unknown"
  }), {
    authorization: "Bearer owner-secret",
    "content-type": "application/json"
  }), {
    DB: {},
    HR_ADMIN_API_TOKEN: "owner-secret"
  });
  assert.equal(response.status, 400);
});

test("supplier offer management enforces approval evidence gates and immutable identity", () => {
  assert.match(workerSource, /Offer identity is immutable/);
  assert.match(workerSource, /Pause an ACTIVE offer before editing it/);
  assert.match(workerSource, /confirmed supplier-branding-free packaging/);
  assert.match(workerSource, /supplier_offer_audit/);
  assert.match(workerSource, /\/api\/admin\/sourcing\/offers/);
});


test("supplier offer admin exposes quote and verification evidence operations", () => {
  assert.match(workerSource, /data\.operation === "save_quote"/);
  assert.match(workerSource, /data\.operation === "verify_offer"/);
  assert.match(workerSource, /Cross-currency quotes require FX evidence/);
  assert.match(workerSource, /Four 0–100 scores/);
});


test("supplier offer listing requires owner token and returns records", async () => {
  const response = await worker.fetch(request("/api/admin/sourcing/offers?limit=10", "GET", undefined, {
    authorization: "Bearer owner-secret"
  }), {
    HR_ADMIN_API_TOKEN: "owner-secret",
    DB: { prepare(sql) {
      assert.match(sql, /FROM supplier_variant_offers/);
      return { bind(limit) { assert.equal(limit, 10); return { all: async () => ({ results: [{ id: "offer-1" }] }) }; } };
    } }
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.offers[0].id, "offer-1");
});

test("private supplier dashboard does not persist owner token", () => {
  const page = readFileSync(new URL("../public/admin-sourcing.html", import.meta.url), "utf8");
  assert.match(page, /autocomplete="off"/);
  assert.match(page, /ownerToken=""/);
  assert.doesNotMatch(page, /localStorage|sessionStorage/);
  assert.match(page, /\/api\/admin\/sourcing\/offers/);
});


test("supplier offer audit listing is owner-authenticated and scoped by entity", async () => {
  const response = await worker.fetch(request("/api/admin/sourcing/offers?view=audit&entity_id=offer-1", "GET", undefined, {
    authorization: "Bearer owner-secret"
  }), {
    HR_ADMIN_API_TOKEN: "owner-secret",
    DB: { prepare(sql) {
      assert.match(sql, /FROM supplier_offer_audit WHERE entity_id = \?/);
      return { bind(id, limit) { assert.equal(id, "offer-1"); assert.equal(limit, 50); return { all: async () => ({ results: [{ action: "OFFER_CREATED" }] }) }; } };
    } }
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.audit[0].action, "OFFER_CREATED");
});


test("private supplier dashboard inline JavaScript has valid syntax", () => {
  const page = readFileSync(new URL("../public/admin-sourcing.html", import.meta.url), "utf8");
  const scriptStart = page.indexOf("<script>");
  const scriptEnd = page.indexOf("</script>", scriptStart);
  assert.ok(scriptStart >= 0 && scriptEnd > scriptStart, "dashboard must contain inline script");
  assert.doesNotThrow(() => new Script(page.slice(scriptStart + 8, scriptEnd)));
});


test("supplier offer mutations commit together with complete before/after audit snapshots", () => {
  assert.match(workerSource, /const commitAudited = async/);
  assert.match(workerSource, /env\.DB\.batch\(\[mutation, auditStatement\]\)/);
  assert.match(workerSource, /json_object\(/);
  assert.doesNotMatch(workerSource, /await audit\(/);
  for (const operation of ["OFFER_CREATED","QUOTE_CREATED","OFFER_VERIFIED","STATUS_"]) {
    assert.ok(workerSource.includes(operation), "missing audited operation " + operation);
  }
});


test("supplier shipping quote identity cannot be reassigned across offers or destinations", () => {
  assert.match(workerSource, /Shipping quote identity is immutable/);
  assert.match(workerSource, /before\.offer_id !== offerId/);
  assert.match(workerSource, /before\.destination_country_code !== destination/);
});


test("supplier quote update rejects reassignment before mutation or audit batch", async () => {
  let batchCalled = false;
  const db = {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            first: async () => {
              if (sql.includes("FROM supplier_variant_offers o JOIN countries")) {
                assert.deepEqual(values, ["US", "offer-current"]);
                return { id: "offer-current", source_currency_code: "EUR", destination_currency: "USD" };
              }
              if (sql.includes("FROM supplier_variant_shipping_quotes WHERE id")) {
                return { id: "quote-existing", offer_id: "another-offer", destination_country_code: "CA" };
              }
              throw new Error("Unexpected database query: " + sql);
            }
          };
        }
      };
    },
    async batch() { batchCalled = true; throw new Error("Mutation must not run"); }
  };
  const payload = {
    operation: "save_quote",
    id: "quote-existing",
    offer_id: "offer-current",
    destination_country_code: "US",
    shipping_method_code: "STANDARD",
    shipping_cost_minor: 500,
    currency_code: "USD",
    fx_numerator: 2,
    fx_denominator: 1,
    fx_evidence_reference: "fx-evidence-2026-11-19",
    quoted_at: "2026-11-19T12:00:00Z",
    estimated_min_days: 5,
    estimated_max_days: 9
  };
  const response = await worker.fetch(
    request("/api/admin/sourcing/offers", "POST", JSON.stringify(payload), {
      authorization: "Bearer owner-secret",
      "content-type": "application/json"
    }),
    { DB: db, HR_ADMIN_API_TOKEN: "owner-secret" }
  );
  const result = await response.json();
  assert.equal(response.status, 409);
  assert.match(result.error, /identity is immutable/i);
  assert.equal(batchCalled, false);
});


test("supplier FX conversion uses exact integer arithmetic for large minor-unit values", () => {
  assert.match(workerSource, /function convertMinorByRatio/);
  assert.match(workerSource, /BigInt\(minor\) \* BigInt\(numerator\)/);
  assert.match(workerSource, /const rounded = \(product \+ divisor \/ 2n\) \/ divisor/);
  assert.match(workerSource, /convertMinorByRatio\(/);
  assert.doesNotMatch(workerSource, /Math\.round\(\s*Number\(row\.source_unit_cost_minor\)/);
});


test("order idempotency rejects reuse of a key with a different request fingerprint", async () => {
  const db = {
    prepare(sql) {
      assert.match(sql, /idempotency_request_hash/);
      return {
        bind(key) {
          assert.equal(key, "order-key-123");
          return {
            first: async () => ({
              id: "existing-order",
              status: "PENDING",
              created_at: "2026-11-19T00:00:00.000Z",
              idempotency_request_hash: "0".repeat(64)
            })
          };
        }
      };
    }
  };
  const response = await worker.fetch(
    request("/api/orders", "POST", JSON.stringify({ customer_name: "Different customer" }), {
      "content-type": "application/json",
      "Idempotency-Key": "order-key-123"
    }),
    { DB: db }
  );
  const payload = await response.json();
  assert.equal(response.status, 409);
  assert.match(payload.error, /different order request/i);
});

test("order idempotency returns the original order for an identical request fingerprint", async () => {
  const { createHash } = await import("node:crypto");
  const body = { customer_name: "Same customer" };
  const canonical = JSON.stringify({ customer_name: "Same customer" });
  const fingerprint = createHash("sha256").update(canonical).digest("hex");
  const db = {
    prepare(sql) {
      assert.match(sql, /idempotency_request_hash/);
      return {
        bind() {
          return {
            first: async () => ({
              id: "existing-order",
              status: "PENDING",
              created_at: "2026-11-19T00:00:00.000Z",
              idempotency_request_hash: fingerprint
            })
          };
        }
      };
    }
  };
  const response = await worker.fetch(
    request("/api/orders", "POST", JSON.stringify(body), {
      "content-type": "application/json",
      "Idempotency-Key": "order-key-123"
    }),
    { DB: db }
  );
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.duplicate, true);
  assert.equal(payload.order.id, "existing-order");
  assert.equal("idempotency_request_hash" in payload.order, false);
});

test("order request fingerprint is stored with newly created orders", () => {
  assert.match(workerSource, /async function orderRequestFingerprint/);
  assert.match(workerSource, /idempotency_request_hash/);
  assert.match(workerSource, /idempotency_request_hash,?\s*$/m);
  assert.match(workerSource, /requestFingerprint/);
  assert.match(workerSource, /This Idempotency-Key was already used for a different order request/);
});


test("concurrent idempotency-key conflicts also compare the original request fingerprint", () => {
  const conflictStart = workerSource.indexOf('if (databaseMessage');
  const conflictEnd = workerSource.indexOf('throw error;', conflictStart);
  assert.ok(conflictStart >= 0 && conflictEnd > conflictStart);
  const conflictHandler = workerSource.slice(conflictStart, conflictEnd);
  assert.match(conflictHandler, /idempotency_request_hash/);
  assert.match(conflictHandler, /constantTimeEqual\(existing\.idempotency_request_hash, requestFingerprint\)/);
  assert.match(conflictHandler, /different order request/);
});


test("order fingerprint canonicalization ignores JSON object key order", async () => {
  const { createHash } = await import("node:crypto");
  const canonical = JSON.stringify({ customer_name: "Same", customer_phone: "0100" });
  const fingerprint = createHash("sha256").update(canonical).digest("hex");
  const db = {
    prepare(sql) {
      assert.match(sql, /idempotency_request_hash/);
      return {
        bind() {
          return {
            first: async () => ({
              id: "existing-order",
              status: "PENDING",
              created_at: "2026-11-19T00:00:00.000Z",
              idempotency_request_hash: fingerprint
            })
          };
        }
      };
    }
  };
  const response = await worker.fetch(
    request("/api/orders", "POST", JSON.stringify({
      customer_phone: "0100",
      customer_name: "Same"
    }), {
      "content-type": "application/json",
      "Idempotency-Key": "order-key-123"
    }),
    { DB: db }
  );
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.duplicate, true);
});


function createOrderDbMock(batchError = null) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const resolve = async (values = []) => {
        calls.push({ type: "first", sql, values });
        if (sql.includes("FROM orders") && sql.includes("idempotency_key")) return null;
        if (sql.includes("FROM countries")) return { country_code: "BD" };
        if (sql.includes("FROM currencies")) return { code: "BDT", decimal_places: 0 };
        if (sql.includes("FROM product_variants")) return { id: "variant-1" };
        if (sql.includes("FROM products p")) {
          return {
            id: "product-1",
            name: "Verified product",
            price_minor: 1500,
            currency_code: "BDT",
            priced_variant_id: "variant-1",
            sku: "SKU-1"
          };
        }
        if (sql.includes("FROM inventory i")) return { id: "inventory-1" };
        if (sql.includes("FROM shipping_rates sr")) return { base_cost_minor: 100 };
        throw new Error("Unexpected first() query: " + sql);
      };
      return {
        first: () => resolve(),
        bind(...values) {
          return { first: () => resolve(values) };
        }
      };
    },
    async batch(statements) {
      calls.push({ type: "batch", count: statements.length });
      if (batchError) throw new Error(batchError);
      return statements.map(() => ({ success: true }));
    }
  };
}

const validOrderPayload = {
  customer_name: "Test Buyer",
  customer_phone: "01700000000",
  customer_address: "Test Road, Dhaka",
  district: "Dhaka",
  country_code: "BD",
  currency_code: "BDT",
  payment_method: "COD",
  items: [{ product_id: "product-1", variant_id: "variant-1", quantity: 2 }]
};

test("COD order creation prices from database and batches order with reserved-stock line item", async () => {
  const DB = createOrderDbMock();
  const response = await worker.fetch(
    request("/api/orders", "POST", JSON.stringify(validOrderPayload), {
      "content-type": "application/json",
      "Idempotency-Key": "full-order-key-01"
    }),
    { DB }
  );
  const payload = await response.json();
  assert.equal(response.status, 201);
  assert.equal(payload.success, true);
  assert.equal(payload.order.subtotal_minor, 3000);
  assert.equal(payload.order.shipping_cost_minor, 100);
  assert.equal(payload.order.total_minor, 3100);
  assert.equal(DB.calls.filter(call => call.type === "batch").length, 1);
  assert.equal(DB.calls.find(call => call.type === "batch").count, 2);
});

test("COD order creation maps an atomic stock race to conflict without reporting success", async () => {
  const DB = createOrderDbMock("Insufficient verified stock for atomic reservation");
  const response = await worker.fetch(
    request("/api/orders", "POST", JSON.stringify(validOrderPayload), {
      "content-type": "application/json",
      "Idempotency-Key": "full-order-key-02"
    }),
    { DB }
  );
  const payload = await response.json();
  assert.equal(response.status, 409);
  assert.equal(payload.success, false);
  assert.match(payload.error, /stock changed while placing/i);
  assert.equal(DB.calls.filter(call => call.type === "batch").length, 1);
});


test("courier partner directory requires configured owner authentication", async () => {
  const response = await worker.fetch(
    request("/api/admin/partners/couriers"),
    { DB: {}, HR_ADMIN_API_TOKEN: "owner-secret" }
  );
  assert.equal(response.status, 401);
});

test("courier partner directory does not query database for an invalid owner token", async () => {
  const response = await worker.fetch(
    request("/api/admin/partners/couriers"),
    { DB: { prepare() { throw new Error("Database must not be queried"); } }, HR_ADMIN_API_TOKEN: "owner-secret" }
  );
  assert.equal(response.status, 401);
});

test("courier partner directory lists partner records for the owner", async () => {
  const DB = {
    prepare(sql) {
      assert.match(sql, /FROM courier_partners/);
      return { all: async () => ({ results: [{ partner_code: "PATHAO", onboarding_status: "RESEARCH" }] }) };
    }
  };
  const response = await worker.fetch(
    request("/api/admin/partners/couriers", "GET", undefined, { authorization: "Bearer owner-secret" }),
    { DB, HR_ADMIN_API_TOKEN: "owner-secret" }
  );
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.partners[0].partner_code, "PATHAO");
});

test("courier partner creation starts unverified and cannot self-activate or connect an API", async () => {
  let statement = "";
  let values = [];
  const DB = {
    prepare(sql) {
      statement = sql;
      return { bind(...args) { values = args; return { run: async () => ({ success: true }) }; } };
    }
  };
  const response = await worker.fetch(
    request("/api/admin/partners/couriers", "POST", JSON.stringify({
      partner_code: "PATHAO",
      partner_name: "Pathao Courier",
      website_url: "https://pathao.com",
      onboarding_status: "ACTIVE",
      api_status: "CONNECTED",
      cod_supported: true
    }), { authorization: "Bearer owner-secret", "content-type": "application/json" }),
    { DB, HR_ADMIN_API_TOKEN: "owner-secret" }
  );
  const payload = await response.json();
  assert.equal(response.status, 201);
  assert.equal(payload.partner.onboarding_status, "RESEARCH");
  assert.equal(payload.partner.api_status, "NOT_ASSESSED");
  assert.match(statement, /'RESEARCH', 'NOT_ASSESSED'/);
  assert.equal(values[1], "PATHAO");
});

test("courier partner creation validates code and HTTPS website URL", async () => {
  const response = await worker.fetch(
    request("/api/admin/partners/couriers", "POST", JSON.stringify({
      partner_code: "bad code",
      partner_name: "Courier",
      website_url: "http://example.com"
    }), { authorization: "Bearer owner-secret", "content-type": "application/json" }),
    { DB: {}, HR_ADMIN_API_TOKEN: "owner-secret" }
  );
  assert.equal(response.status, 400);
});

test("courier partner directory rejects unsupported methods", async () => {
  const response = await worker.fetch(
    request("/api/admin/partners/couriers", "DELETE", undefined, { authorization: "Bearer owner-secret" }),
    { DB: {}, HR_ADMIN_API_TOKEN: "owner-secret" }
  );
  assert.equal(response.status, 405);
});

test("partner network migration keeps courier partners in research until verified", () => {
  const migration = readFileSync(
    new URL("../migrations/0011_bangladesh_partner_network.sql", import.meta.url),
    "utf8"
  );
  assert.match(migration, /onboarding_status TEXT NOT NULL DEFAULT 'RESEARCH'/);
  assert.match(migration, /api_status TEXT NOT NULL DEFAULT 'NOT_ASSESSED'/);
  assert.match(migration, /verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED'/);
  assert.match(migration, /partner_ai_recommendations/);
});


test("partner interaction log rejects unauthorized requests before database access", async () => {
  const response = await worker.fetch(request("/api/admin/partners/interactions"), {
    DB: { prepare() { throw new Error("Database must not be queried"); } },
    HR_ADMIN_API_TOKEN: "owner-secret"
  });
  assert.equal(response.status, 401);
});

test("partner interaction log saves internal notes only and never sends messages", async () => {
  const calls = [];
  const DB = {
    prepare(sql) {
      calls.push({ sql, values: [] });
      return {
        bind(...values) {
          calls[calls.length - 1].values = values;
          return {
            first: async () => ({ id: "courier-1" }),
            run: async () => ({ success: true })
          };
        }
      };
    }
  };
  const response = await worker.fetch(
    request("/api/admin/partners/interactions", "POST", JSON.stringify({
      partner_type: "COURIER",
      partner_id: "courier-1",
      interaction_type: "EMAIL",
      summary: "Prepare an outreach draft for owner review.",
      follow_up_at: "2026-12-01"
    }), { authorization: "Bearer owner-secret", "content-type": "application/json" }),
    { DB, HR_ADMIN_API_TOKEN: "owner-secret" }
  );
  const payload = await response.json();
  assert.equal(response.status, 201);
  assert.equal(payload.interaction.direction, "INTERNAL");
  assert.equal(payload.interaction.approval_status, "INTERNAL_NOTE");
  assert.match(payload.message, /No message was sent/);
  assert.match(calls[1].sql, /'INTERNAL'.*'INTERNAL_NOTE'/s);
  assert.doesNotMatch(calls[1].sql, /APPROVED_TO_SEND|SENT/);
});

test("partner interaction log validates partner identity and follow-up date", async () => {
  const DB = {
    prepare() {
      return { bind() { return { first: async () => null }; } };
    }
  };
  const response = await worker.fetch(
    request("/api/admin/partners/interactions", "POST", JSON.stringify({
      partner_type: "COURIER",
      partner_id: "missing",
      interaction_type: "FOLLOW_UP",
      summary: "Call after reviewing rates.",
      follow_up_at: "next week"
    }), { authorization: "Bearer owner-secret", "content-type": "application/json" }),
    { DB, HR_ADMIN_API_TOKEN: "owner-secret" }
  );
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /ISO date/);
});

test("partner interaction log rejects unsupported methods", async () => {
  const response = await worker.fetch(
    request("/api/admin/partners/interactions", "DELETE", undefined, { authorization: "Bearer owner-secret" }),
    { DB: {}, HR_ADMIN_API_TOKEN: "owner-secret" }
  );
  assert.equal(response.status, 405);
});


test("partner contacts require owner authentication", async () => {
  const response = await worker.fetch(request("/api/admin/partners/contacts"), {
    DB: { prepare() { throw new Error("Database must not be queried"); } },
    HR_ADMIN_API_TOKEN: "owner-secret"
  });
  assert.equal(response.status, 401);
});

test("partner contact creation forces unverified and non-primary defaults", async () => {
  const calls = [];
  const DB = {
    prepare(sql) {
      calls.push({ sql, values: [] });
      return { bind(...values) {
        calls[calls.length - 1].values = values;
        return { first: async () => ({ id: "supplier-1" }), run: async () => ({ success: true }), all: async () => ({ results: [] }) };
      }};
    }
  };
  const response = await worker.fetch(
    request("/api/admin/partners/contacts", "POST", JSON.stringify({
      partner_type: "SUPPLIER", partner_id: "supplier-1",
      contact_name: "Sales Desk", email: "sales@example.com",
      verification_status: "VERIFIED", is_primary: true
    }), { authorization: "Bearer owner-secret", "content-type": "application/json" }),
    { DB, HR_ADMIN_API_TOKEN: "owner-secret" }
  );
  const payload = await response.json();
  assert.equal(response.status, 201);
  assert.equal(payload.contact.verification_status, "UNVERIFIED");
  assert.equal(payload.contact.is_primary, false);
  assert.match(calls[1].sql, /0, 'UNVERIFIED'/);
});

test("partner contact creation rejects malformed email and unsupported channel", async () => {
  const response = await worker.fetch(
    request("/api/admin/partners/contacts", "POST", JSON.stringify({
      partner_type: "COURIER", partner_id: "courier-1",
      email: "not-an-email", preferred_channel: "SMS"
    }), { authorization: "Bearer owner-secret", "content-type": "application/json" }),
    { DB: {}, HR_ADMIN_API_TOKEN: "owner-secret" }
  );
  assert.equal(response.status, 400);
});

test("partner contact directory rejects unsupported methods", async () => {
  const response = await worker.fetch(
    request("/api/admin/partners/contacts", "DELETE", undefined, { authorization: "Bearer owner-secret" }),
    { DB: {}, HR_ADMIN_API_TOKEN: "owner-secret" }
  );
  assert.equal(response.status, 405);
});


test("local supplier directory requires owner authentication", async () => {
  const response = await worker.fetch(request("/api/admin/partners/suppliers"), {
    DB: { prepare() { throw new Error("Database must not be queried"); } },
    HR_ADMIN_API_TOKEN: "owner-secret"
  });
  assert.equal(response.status, 401);
});

test("local supplier directory returns supplier records and rejects writes", async () => {
  let sql = "";
  const DB = { prepare(value) { sql = value; return { bind() { return { all: async () => ({ results: [{ id: "s-1", supplier_name: "Local Supplier", verification_status: "UNVERIFIED" }] }) }; } }; } };
  const response = await worker.fetch(
    request("/api/admin/partners/suppliers?q=local", "GET", undefined, { authorization: "Bearer owner-secret" }),
    { DB, HR_ADMIN_API_TOKEN: "owner-secret" }
  );
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.suppliers[0].id, "s-1");
  assert.ok(sql.includes("LEFT JOIN supplier_local_profiles"));
  const denied = await worker.fetch(
    request("/api/admin/partners/suppliers", "POST", "{}", { authorization: "Bearer owner-secret" }),
    { DB: {}, HR_ADMIN_API_TOKEN: "owner-secret" }
  );
  assert.equal(denied.status, 405);
});


test("partner operations dashboard inline JavaScript parses", () => {
  const html = readFileSync(new URL("../public/admin-partners.html", import.meta.url), "utf8");
  const scriptStart = html.indexOf("<script>");
  const scriptEnd = html.indexOf("</script>", scriptStart);
  assert.notEqual(scriptStart, -1);
  assert.notEqual(scriptEnd, -1);
  assert.doesNotThrow(() => new Script(html.slice(scriptStart + 8, scriptEnd)));
  assert.match(html, /OWNER ACCESS ONLY/);
  assert.match(html, /No email, WhatsApp, SMS or call is sent/);
});


test("courier service areas require owner authentication", async () => {
  const response = await worker.fetch(request("/api/admin/partners/service-areas"), {
    DB: { prepare() { throw new Error("Database must not be queried"); } },
    HR_ADMIN_API_TOKEN: "owner-secret"
  });
  assert.equal(response.status, 401);
});

test("courier service area creation forces inactive and unverified state", async () => {
  const calls = [];
  const DB = { prepare(sql) { calls.push({ sql, values: [] }); return { bind(...values) {
    calls[calls.length - 1].values = values;
    return { first: async () => ({ id: "courier-1" }), run: async () => ({ success: true }) };
  } }; } };
  const response = await worker.fetch(
    request("/api/admin/partners/service-areas", "POST", JSON.stringify({
      courier_id: "courier-1", district: "Dhaka", area_name: "Dhanmondi",
      active: true, verified_at: "2026-11-19T00:00:00Z"
    }), { authorization: "Bearer owner-secret", "content-type": "application/json" }),
    { DB, HR_ADMIN_API_TOKEN: "owner-secret" }
  );
  const payload = await response.json();
  assert.equal(response.status, 201);
  assert.equal(payload.service_area.active, false);
  assert.equal(payload.service_area.verified_at, null);
  assert.match(calls[1].sql, /VALUES \(\?, \?, \?, \?, \?, \?, \?, 0, \?, NULL, \?\)/);
});

test("courier service areas reject invalid service type and unsupported methods", async () => {
  const DB = { prepare() { return { bind() { return { first: async () => ({ id: "courier-1" }) }; } }; } };
  const response = await worker.fetch(
    request("/api/admin/partners/service-areas", "POST", JSON.stringify({
      courier_id: "courier-1", district: "Dhaka", service_type: "MAGIC"
    }), { authorization: "Bearer owner-secret", "content-type": "application/json" }),
    { DB, HR_ADMIN_API_TOKEN: "owner-secret" }
  );
  assert.equal(response.status, 400);
  const denied = await worker.fetch(request("/api/admin/partners/service-areas", "DELETE", undefined, {
    authorization: "Bearer owner-secret"
  }), { DB: {}, HR_ADMIN_API_TOKEN: "owner-secret" });
  assert.equal(denied.status, 405);
});

test("local supplier profile update is owner-only and forces unverified state", async () => {
  const response = await worker.fetch(request("/api/admin/partners/supplier-profiles", "PUT", JSON.stringify({
    supplier_id: "s-1", verification_status: "VERIFIED", district: "Dhaka"
  }), { authorization: "Bearer owner-secret", "content-type": "application/json" }), {
    DB: { prepare(sql) { return { bind() { return { first: async () => ({ id: "s-1" }), run: async () => ({ success: true }) }; } }; } },
    HR_ADMIN_API_TOKEN: "owner-secret"
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.supplier_profile.verification_status, "UNVERIFIED");
  assert.equal(payload.supplier_profile.last_stock_verified_at, null);
});

test("local supplier profile rejects invalid scores and unauthorized access", async () => {
  const denied = await worker.fetch(request("/api/admin/partners/supplier-profiles", "PUT", "{}", { authorization: "Bearer wrong" }), {
    DB: {}, HR_ADMIN_API_TOKEN: "owner-secret"
  });
  assert.equal(denied.status, 401);
  const invalid = await worker.fetch(request("/api/admin/partners/supplier-profiles", "PUT", JSON.stringify({
    supplier_id: "s-1", quality_score: 101
  }), { authorization: "Bearer owner-secret", "content-type": "application/json" }), {
    DB: {}, HR_ADMIN_API_TOKEN: "owner-secret"
  });
  assert.equal(invalid.status, 400);
});

test("local supplier quote is saved pending and stock unverified", async () => {
  const calls = [];
  const DB = { prepare(sql) { calls.push(sql); return { bind() { return {
    first: async () => ({ id: "found" }), run: async () => ({ success: true })
  }; } }; } };
  const response = await worker.fetch(request("/api/admin/partners/supplier-quotes", "POST", JSON.stringify({
    supplier_id: "s-1", product_id: "p-1", unit_cost_minor: 500,
    available_quantity: 12, minimum_order_quantity: 2, currency_code: "BDT",
    quote_status: "VERIFIED", stock_verified_at: "2026-11-19"
  }), { authorization: "Bearer owner-secret", "content-type": "application/json" }), {
    DB, HR_ADMIN_API_TOKEN: "owner-secret"
  });
  const payload = await response.json();
  assert.equal(response.status, 201);
  assert.equal(payload.quote.quote_status, "PENDING");
  assert.equal(payload.quote.stock_verified_at, null);
  assert.match(calls[calls.length - 1], /'PENDING', NULL/);
});

test("courier rate cards require owner authentication", async () => {
  const response = await worker.fetch(request("/api/admin/partners/courier-rates"), {
    DB: { prepare() { throw new Error("Database must not be queried"); } },
    HR_ADMIN_API_TOKEN: "owner-secret"
  });
  assert.equal(response.status, 401);
});

test("courier rate card creation forces unverified status", async () => {
  const calls = [];
  const DB = { prepare(sql) { calls.push({ sql, values: [] }); return { bind(...values) { calls[calls.length - 1].values = values; return { first: async () => ({ id: "courier-1", code: "BDT" }), run: async () => ({ success: true }), all: async () => ({ results: [] }) }; } }; } };
  const response = await worker.fetch(
    request("/api/admin/partners/courier-rates", "POST", JSON.stringify({
      courier_id: "courier-1", rate_name: "Dhaka standard",
      destination_district: "Dhaka", base_fee_minor: 700,
      cod_fee_minor: 10, return_fee_minor: 500, currency_code: "BDT",
      verification_status: "VERIFIED"
    }), { authorization: "Bearer owner-secret", "content-type": "application/json" }),
    { DB, HR_ADMIN_API_TOKEN: "owner-secret" }
  );
  const payload = await response.json();
  assert.equal(response.status, 201);
  assert.equal(payload.rate_card.verification_status, "UNVERIFIED");
  assert.match(calls[2].sql, /'UNVERIFIED'/);
});

test("courier rate cards reject invalid fees and unsupported methods", async () => {
  const DB = { prepare() { return { bind() { return { first: async () => ({ id: "courier-1" }) }; } }; } };
  const response = await worker.fetch(
    request("/api/admin/partners/courier-rates", "POST", JSON.stringify({
      courier_id: "courier-1", rate_name: "Invalid", base_fee_minor: -1
    }), { authorization: "Bearer owner-secret", "content-type": "application/json" }),
    { DB, HR_ADMIN_API_TOKEN: "owner-secret" }
  );
  assert.equal(response.status, 400);
});


test("partner operations dashboard exposes service-area and supplier profile/quote controls", () => {
  const page = readFileSync(new URL("../public/admin-partners.html", import.meta.url), "utf8");
  for (const id of ["areaForm","profileForm","quoteForm","loadAreas","loadQuotes"]) assert.match(page, new RegExp('id="' + id + '"'));
  for (const route of ["/api/admin/partners/service-areas","/api/admin/partners/supplier-profiles","/api/admin/partners/supplier-quotes"]) assert.ok(page.includes(route));
  const start = page.indexOf("<script>");
  const end = page.indexOf("</script>", start);
  assert.ok(start >= 0 && end > start);
  assert.doesNotThrow(() => new Script(page.slice(start + 8, end)));
});


test("partner recommendations require owner authentication and remain pending", async () => {
  const denied = await worker.fetch(request("/api/admin/partners/recommendations", "GET"), {
    DB: { prepare() { throw new Error("Database must not be queried"); } }, HR_ADMIN_API_TOKEN: "owner-secret"
  });
  assert.equal(denied.status, 401);
  let insertSql = "";
  const DB = { prepare(sql) { insertSql = sql; return { bind(...values) { return { run: async () => ({ success: true }) }; } }; } };
  const response = await worker.fetch(request("/api/admin/partners/recommendations", "POST", JSON.stringify({
    recommendation_type: "COURIER_SELECTION", recommendation_json: { courier: "candidate-1" },
    confidence_score: 0.7, evidence_summary: "Illustrative evidence only", status: "APPROVED"
  }), { authorization: "Bearer owner-secret", "content-type": "application/json" }), { DB, HR_ADMIN_API_TOKEN: "owner-secret" });
  const payload = await response.json();
  assert.equal(response.status, 201);
  assert.equal(payload.recommendation.status, "PENDING_REVIEW");
  assert.match(insertSql, /'PENDING_REVIEW'/);
});

test("partner recommendation review only records approval and never executes operations", async () => {
  let sql = "";
  const DB = { prepare(statement) { sql = statement; return { bind() { return { run: async () => ({ meta: { changes: 1 } }) }; } }; } };
  const response = await worker.fetch(request("/api/admin/partners/recommendations", "PATCH", JSON.stringify({
    id: "rec-1", status: "APPROVED"
  }), { authorization: "Bearer owner-secret", "content-type": "application/json" }), {
    DB, HR_ADMIN_API_TOKEN: "owner-secret", HR_ADMIN_OWNER_LABEL: "OWNER"
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.match(sql, /WHERE id = \? AND status = 'PENDING_REVIEW'/);
  assert.match(payload.message, /does not execute/i);
});


test("Bangladesh COD delivery queue is owner-only and reads only BD BDT COD orders", async () => {
  const denied = await worker.fetch(request("/api/admin/orders/delivery"), {
    DB: { prepare() { throw new Error("Database must not be queried"); } },
    HR_ADMIN_API_TOKEN: "owner-secret"
  });
  assert.equal(denied.status, 401);
  let sql = "";
  const DB = { prepare(statement) { sql = statement; return { all: async () => ({ results: [{ id: "order-bd" }] }) }; } };
  const response = await worker.fetch(request("/api/admin/orders/delivery"), {
    DB, HR_ADMIN_API_TOKEN: "owner-secret",
    // The route requires the bearer token even for read-only order data.
  });
  assert.equal(response.status, 401);
  const authorized = await worker.fetch(request("/api/admin/orders/delivery", "GET", undefined, {
    authorization: "Bearer owner-secret"
  }), { DB, HR_ADMIN_API_TOKEN: "owner-secret" });
  assert.equal(authorized.status, 200);
  assert.match(sql, /country_code = 'BD'.*currency_code = 'BDT'.*payment_method = 'COD'/s);
});

test("Bangladesh COD delivery update atomically records its audit event", async () => {
  const statements = [];
  const before = {
    id: "order-bd", status: "PENDING", country_code: "BD", currency_code: "BDT",
    payment_method: "COD", total_minor: 25000, delivery_status: "NOT_DISPATCHED",
    courier_name: null, courier_service: null, consignment_id: null,
    tracking_url: null, delivery_notes: null
  };
  const DB = {
    prepare(sql) {
      return {
        bind(...values) {
          statements.push({ sql, values });
          return { first: async () => before };
        }
      };
    },
    async batch(batchStatements) {
      assert.equal(batchStatements.length, 2);
      return [{ meta: { changes: 1 } }, { meta: { changes: 1 } }];
    }
  };
  const response = await worker.fetch(request("/api/admin/orders/delivery", "PATCH", JSON.stringify({
    order_id: "order-bd", delivery_status: "READY_TO_SHIP",
    courier_name: "Manual Test Courier", delivery_notes: "Parcel packed"
  }), { authorization: "Bearer owner-secret", "content-type": "application/json" }), {
    DB, HR_ADMIN_API_TOKEN: "owner-secret", HR_ADMIN_OWNER_LABEL: "OWNER"
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.delivery_status, "READY_TO_SHIP");
  assert.equal(payload.cod_collected_minor_changed, false);
  assert.match(payload.message, /not performed by this manual record/i);
  assert.match(statements[1].sql, /UPDATE orders SET/);
  assert.match(statements[2].sql, /INSERT INTO order_delivery_events[\s\S]*WHERE EXISTS/);
  assert.match(statements[2].sql, /delivery_updated_at = \?/);
  assert.equal(statements[2].values[1], "order-bd");
});

test("Bangladesh COD delivery does not create an audit event after a stale conditional update", async () => {
  const before = {
    id: "order-bd", status: "PENDING", country_code: "BD", currency_code: "BDT",
    payment_method: "COD", total_minor: 1000, delivery_status: "NOT_DISPATCHED"
  };
  let batchLength = 0;
  const DB = {
    prepare(sql) {
      return { bind() { return { first: async () => before }; } };
    },
    async batch(statements) {
      batchLength = statements.length;
      return [{ meta: { changes: 0 } }, { meta: { changes: 0 } }];
    }
  };
  const response = await worker.fetch(request("/api/admin/orders/delivery", "PATCH", JSON.stringify({
    order_id: "order-bd", delivery_status: "READY_TO_SHIP"
  }), { authorization: "Bearer owner-secret", "content-type": "application/json" }), {
    DB, HR_ADMIN_API_TOKEN: "owner-secret"
  });
  assert.equal(response.status, 409);
  assert.equal(batchLength, 2);
});

test("Bangladesh COD delivery sets delivered_at only on confirmed DELIVERED transition", async () => {
  const before = {
    id: "order-bd", status: "PENDING", country_code: "BD", currency_code: "BDT",
    payment_method: "COD", total_minor: 25000, delivery_status: "OUT_FOR_DELIVERY"
  };
  let updateSql = "";
  const DB = {
    prepare(sql) {
      return { bind() { if (sql.startsWith("UPDATE orders")) updateSql = sql; return { first: async () => before }; } };
    },
    async batch() { return [{ meta: { changes: 1 } }, { meta: { changes: 1 } }]; }
  };
  const response = await worker.fetch(request("/api/admin/orders/delivery", "PATCH", JSON.stringify({
    order_id: "order-bd", delivery_status: "DELIVERED"
  }), { authorization: "Bearer owner-secret", "content-type": "application/json" }), {
    DB, HR_ADMIN_API_TOKEN: "owner-secret"
  });
  assert.equal(response.status, 200);
  assert.match(updateSql, /delivered_at = CURRENT_TIMESTAMP/);
  assert.ok(updateSql.includes("cod_amount_minor = COALESCE(cod_amount_minor, ?)"));
});

test("Bangladesh COD delivery reports audit failure when the D1 batch fails", async () => {
  const before = {
    id: "order-bd", status: "PENDING", country_code: "BD", currency_code: "BDT",
    payment_method: "COD", total_minor: 1000, delivery_status: "NOT_DISPATCHED"
  };
  const DB = {
    prepare() { return { bind() { return { first: async () => before }; } }; },
    async batch() { throw new Error("Simulated transactional batch failure"); }
  };
  const response = await worker.fetch(request("/api/admin/orders/delivery", "PATCH", JSON.stringify({
    order_id: "order-bd", delivery_status: "READY_TO_SHIP"
  }), { authorization: "Bearer owner-secret", "content-type": "application/json" }), {
    DB, HR_ADMIN_API_TOKEN: "owner-secret"
  });
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /Unable to update delivery record/);
});

test("Bangladesh COD delivery rejects invalid transitions and non-HTTPS tracking URLs", async () => {
  const before = {
    id: "order-bd", status: "PENDING", country_code: "BD", currency_code: "BDT",
    payment_method: "COD", total_minor: 1000, delivery_status: "NOT_DISPATCHED"
  };
  const DB = { prepare() { return { bind() { return { first: async () => before }; } }; } };
  const invalidTransition = await worker.fetch(request("/api/admin/orders/delivery", "PATCH", JSON.stringify({
    order_id: "order-bd", delivery_status: "DELIVERED"
  }), { authorization: "Bearer owner-secret", "content-type": "application/json" }), {
    DB, HR_ADMIN_API_TOKEN: "owner-secret"
  });
  assert.equal(invalidTransition.status, 409);
  const invalidUrl = await worker.fetch(request("/api/admin/orders/delivery", "PATCH", JSON.stringify({
    order_id: "order-bd", tracking_url: "http://courier.example/track/1"
  }), { authorization: "Bearer owner-secret", "content-type": "application/json" }), {
    DB, HR_ADMIN_API_TOKEN: "owner-secret"
  });
  assert.equal(invalidUrl.status, 400);
});

test("Bangladesh COD delivery API rejects unsupported methods", async () => {
  const response = await worker.fetch(request("/api/admin/orders/delivery", "DELETE", undefined, {
    authorization: "Bearer owner-secret"
  }), { DB: {}, HR_ADMIN_API_TOKEN: "owner-secret" });
  assert.equal(response.status, 405);
});


test("Bangladesh delivery dashboard JavaScript parses and does not persist owner tokens", () => {
  const html = readFileSync(new URL("../public/admin-delivery.html", import.meta.url), "utf8");
  const start = html.indexOf("<script>");
  const end = html.indexOf("</script>", start);
  assert.ok(start >= 0 && end > start);
  assert.doesNotThrow(() => new Script(html.slice(start + 8, end)));
  assert.match(html, /OWNER OPERATIONS/);
  assert.match(html, /noindex,nofollow/);
  assert.doesNotMatch(html, /localStorage|sessionStorage/);
  assert.match(html, /does not book a courier/);
});


test("Catalog administration requires owner authentication before database access", async () => {
  let touched=false;
  const response=await worker.fetch(request("/api/admin/catalog"),{
    DB:{prepare(){touched=true;throw new Error("must not query DB");}},
    HR_ADMIN_API_TOKEN:"owner-secret"
  });
  assert.equal(response.status,401);
  assert.equal(touched,false);
});

test("Catalog administration lists owner products only after authentication", async () => {
  let sql="",values=[];
  const DB={prepare(query){sql=query;return{bind(...args){values=args;return{all:async()=>({results:[{id:"p1",status:"DRAFT"}]})};}};}};
  const response=await worker.fetch(request("/api/admin/catalog?view=products","GET",undefined,{authorization:"Bearer owner-secret"}),{DB,HR_ADMIN_API_TOKEN:"owner-secret"});
  const payload=await response.json();
  assert.equal(response.status,200);
  assert.equal(payload.products[0].id,"p1");
  assert.match(sql,/FROM products p LEFT JOIN categories/);
  assert.deepEqual(values,[50]);
});

test("Catalog product creation stores a DRAFT and audits it atomically", async () => {
  const calls=[];
  let mutationCommitted=false;
  const DB={
    prepare(sql){return{bind(...values){return{
      first:async()=>sql.includes("SELECT id FROM categories")?{id:"cat"}:sql.includes("SELECT * FROM products")?(mutationCommitted?{id:"p-new",status:"DRAFT"}:null):null,
      sql,values
    };}};},
    batch:async statements=>{calls.push(statements);mutationCommitted=true;return[{meta:{changes:1}},{meta:{changes:1}}];}
  };
  const response=await worker.fetch(request("/api/admin/catalog","POST",JSON.stringify({
    operation:"save_product",name:"Cotton Shirt",slug:"cotton-shirt",category_id:"cat",description:"Soft cotton"
  }),{authorization:"Bearer owner-secret","content-type":"application/json"}),{DB,HR_ADMIN_API_TOKEN:"owner-secret"});
  const payload=await response.json();
  assert.equal(response.status,201);
  assert.equal(payload.product.status,"DRAFT");
  assert.equal(calls.length,1);
  assert.equal(calls[0].length,2);
  assert.match(calls[0][0].sql,/INSERT INTO products/);
  assert.match(calls[0][1].sql,/INSERT INTO catalog_admin_audit/);
});

test("Catalog rejects invalid price and never activates it during creation", async () => {
  const response=await worker.fetch(request("/api/admin/catalog","POST",JSON.stringify({
    operation:"save_price",product_id:"p1",country_code:"BD",currency_code:"BDT",price_minor:-1
  }),{authorization:"Bearer owner-secret","content-type":"application/json"}),{
    DB:{prepare(){throw new Error("invalid input must be rejected before DB");}},
    HR_ADMIN_API_TOKEN:"owner-secret"
  });
  assert.equal(response.status,400);
});

test("Catalog category hierarchy rejects circular parent assignment", async () => {
  let batchCalled=false;
  const DB={prepare(sql){return{bind(...values){return{first:async()=>{
    if(sql.includes("SELECT id FROM categories WHERE id=?"))return{id:values[0]};
    if(sql.includes("SELECT * FROM categories WHERE id=?"))return{id:"cat-a",is_active:0,parent_id:null};
    if(sql.includes("WITH RECURSIVE descendants"))return{cycle:1};
    return null;
  }};}};},batch:async()=>{batchCalled=true;return[];}};
  const response=await worker.fetch(request("/api/admin/catalog","POST",JSON.stringify({
    operation:"save_category",id:"cat-a",name:"Category A",slug:"category-a",parent_id:"cat-b",sort_order:0
  }),{authorization:"Bearer owner-secret","content-type":"application/json"}),{DB,HR_ADMIN_API_TOKEN:"owner-secret"});
  assert.equal(response.status,409);
  assert.match((await response.json()).error,/hierarchy cycle/);
  assert.equal(batchCalled,false);
});

test("Catalog product activation is blocked without verified market stock and active price", async () => {
  const calls=[];
  const DB={prepare(sql){return{bind(...values){calls.push({sql,values});return{first:async()=>sql.includes("SELECT * FROM products")?{id:"p1",status:"DRAFT",category_id:"cat"}:null};}};}};
  const response=await worker.fetch(request("/api/admin/catalog","POST",JSON.stringify({
    operation:"set_product_status",id:"p1",status:"ACTIVE",country_code:"BD",currency_code:"BDT"
  }),{authorization:"Bearer owner-secret","content-type":"application/json"}),{DB,HR_ADMIN_API_TOKEN:"owner-secret"});
  assert.equal(response.status,409);
  assert.match((await response.json()).error,/fresh verified warehouse stock/);
  assert.equal(calls.some(x=>x.sql.includes("UPDATE products SET status")),false);
});

test("Catalog dashboard script is valid and does not persist owner credentials", () => {
  const html=readFileSync(new URL("../public/admin-catalog.html",import.meta.url),"utf8");
  const start=html.indexOf("<script>"),end=html.indexOf("</script>",start);
  assert.ok(start>=0&&end>start);
  assert.doesNotThrow(()=>new Script(html.slice(start+8,end)));
  assert.match(html,/noindex,nofollow/);
  assert.doesNotMatch(html,/localStorage|sessionStorage/);
  assert.match(html,/PENDING/);
  assert.match(html,/Activate selected/);
  assert.match(html,/id="newProduct"/);
  assert.match(html,/function fillProductForm\(p\)/);
  assert.match(html,/f\.elements\.id\.value=p\?\.id/);
  assert.match(html,/fillProductForm\(products\.find\(p=>p\.id===selected\)\)/);
  assert.match(html,/New draft product form ready/);
  assert.match(html,/function fillVariantForm\(v\)/);
  assert.match(html,/data-variant-edit=/);
  assert.match(html,/id:d\.id\|\|undefined/);
  assert.match(html,/cancelVariantEdit/);
});

test("Inventory verification requires owner authentication", async () => {
  let touched = false;
  const response = await worker.fetch(request("/api/admin/inventory/verification"), {
    DB: { prepare() { touched = true; throw new Error("Database must not be queried"); } },
    HR_ADMIN_API_TOKEN: "owner-secret"
  });
  assert.equal(response.status, 401);
  assert.equal(touched, false);
});

test("Inventory verification converts physical count to available stock after reservations", async () => {
  let batchStatements = [];
  const DB = {
    prepare(sql) {
      return { bind(...values) { return {
        first: async () => ({ id: "inventory-1", quantity: 4, verified_at: "2026-11-18T10:00:00.000Z", country_code: "BD", reserved_quantity: 3 }),
        sql, values
      }; } };
    },
    batch: async statements => { batchStatements = statements; return [{ meta: { changes: 1 } }, { meta: { changes: 1 } }]; }
  };
  const response = await worker.fetch(request("/api/admin/inventory/verification", "POST", JSON.stringify({
    inventory_id: "inventory-1", physical_quantity: 10, evidence_reference: "count-sheet-2026-11-19"
  }), { authorization: "Bearer owner-secret", "content-type": "application/json" }), {
    DB, HR_ADMIN_API_TOKEN: "owner-secret", HR_ADMIN_OWNER_LABEL: "OWNER"
  });
  const payload = await response.json();
  assert.equal(response.status, 201);
  assert.equal(payload.verification.reserved_quantity, 3);
  assert.equal(payload.verification.available_quantity, 7);
  assert.equal(batchStatements.length, 2);
  assert.ok(batchStatements[0].sql.includes("UPDATE inventory"));
  assert.ok(batchStatements[1].sql.includes("INSERT INTO inventory_verification_events"));
  assert.ok(batchStatements[1].sql.includes("verification_token = ?"));
});

test("Inventory verification cannot reduce physical stock below active reservations", async () => {
  let batchCalled = false;
  const DB = {
    prepare(sql) { return { bind() { return { first: async () => ({
      id: "inventory-1", quantity: 4, verified_at: null, country_code: "BD", reserved_quantity: 5
    }) }; } }; },
    batch: async () => { batchCalled = true; return []; }
  };
  const response = await worker.fetch(request("/api/admin/inventory/verification", "POST", JSON.stringify({
    inventory_id: "inventory-1", physical_quantity: 3, evidence_reference: "count-sheet-2"
  }), { authorization: "Bearer owner-secret", "content-type": "application/json" }), {
    DB, HR_ADMIN_API_TOKEN: "owner-secret"
  });
  assert.equal(response.status, 409);
  assert.equal(batchCalled, false);
});

test("Inventory verification dashboard parses and does not persist owner token", () => {
  const html = readFileSync(new URL("../public/admin-inventory-verification.html", import.meta.url), "utf8");
  const start = html.indexOf("<script>");
  const end = html.indexOf("</script>", start);
  assert.ok(start >= 0 && end > start);
  assert.doesNotThrow(() => new Script(html.slice(start + 8, end)));
  assert.match(html, /noindex,nofollow/);
  assert.doesNotMatch(html, /localStorage|sessionStorage/);
  assert.match(html, /reserved_quantity/);
  assert.match(html, /row\.is_stale/);
});
test("Bangladesh COD ledger is owner-only and records financial evidence pending review", async () => {
  const calls = [];
  const order = { id: "order-bd", country_code: "BD", currency_code: "BDT", payment_method: "COD", delivery_status: "DELIVERED", total_minor: 25000 };
  const DB = {
    prepare(sql) {
      return {
        bind(...values) {
          calls.push({ sql, values });
          return {
            first: async () => sql.includes("SUM(amount_minor)") ? { amount: 0 } : order,
            run: async () => ({ meta: { changes: 1 } }),
            all: async () => ({ results: [] })
          };
        }
      };
    }
  };
  const denied = await worker.fetch(request("/api/admin/orders/cod-ledger", "GET"), { DB, HR_ADMIN_API_TOKEN: "owner-secret" });
  assert.equal(denied.status, 401);
  const response = await worker.fetch(request("/api/admin/orders/cod-ledger", "POST", JSON.stringify({
    order_id: "order-bd", entry_type: "CUSTOMER_COD_COLLECTED",
    amount_minor: 25000, evidence_reference: "courier receipt #123"
  }), { authorization: "Bearer owner-secret", "content-type": "application/json" }), {
    DB, HR_ADMIN_API_TOKEN: "owner-secret", HR_ADMIN_OWNER_LABEL: "OWNER"
  });
  const payload = await response.json();
  assert.equal(response.status, 201);
  assert.equal(payload.entry.status, "PENDING_REVIEW");
  assert.equal(payload.entry.amount_minor, 25000);
  assert.match(calls[1].sql, /INSERT INTO cod_reconciliation_entries/);
  assert.match(calls[1].sql, /'PENDING_REVIEW'/);
});

test("COD ledger rejects unsupported methods before parsing a request body", async () => {
  let databaseTouched = false;
  const DB = { prepare() { databaseTouched = true; throw new Error("Database should not be queried"); } };
  const response = await worker.fetch(request("/api/admin/orders/cod-ledger", "DELETE", undefined, { authorization: "Bearer owner-secret" }), {
    DB, HR_ADMIN_API_TOKEN: "owner-secret"
  });
  assert.equal(response.status, 405);
  assert.equal(databaseTouched, false);
});

test("COD collection ledger cannot be recorded before delivery", async () => {
  const DB = {
    prepare() {
      return { bind() { return { first: async () => ({ id: "order-bd", country_code: "BD", currency_code: "BDT", payment_method: "COD", delivery_status: "OUT_FOR_DELIVERY" }) }; } };
    }
  };
  const response = await worker.fetch(request("/api/admin/orders/cod-ledger", "POST", JSON.stringify({
    order_id: "order-bd", entry_type: "CUSTOMER_COD_COLLECTED",
    amount_minor: 1000, evidence_reference: "receipt"
  }), { authorization: "Bearer owner-secret", "content-type": "application/json" }), {
    DB, HR_ADMIN_API_TOKEN: "owner-secret"
  });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /only after delivery/i);
});

test("Returned parcel inspection is evidence-only and never changes inventory", async () => {
  const calls = [];
  const DB = {
    prepare(sql) {
      return {
        bind(...values) {
          calls.push({ sql, values });
          return {
            first: async () => sql.includes("SUM(inspected_quantity)")
              ? { quantity: 0 }
              : { id: "order-return", country_code: "BD", currency_code: "BDT", payment_method: "COD", delivery_status: "RETURNED", ordered_quantity: 1 },
            run: async () => ({ meta: { changes: 1 } })
          };
        }
      };
    }
  };
  const response = await worker.fetch(request("/api/admin/orders/returns", "POST", JSON.stringify({
    order_id: "order-return", parcel_condition: "SEALED_INTACT",
    disposition: "RESTOCK_CANDIDATE", inspected_quantity: 1,
    notes: "Seal and product visually inspected", evidence_reference: "photo-set-1"
  }), { authorization: "Bearer owner-secret", "content-type": "application/json" }), {
    DB, HR_ADMIN_API_TOKEN: "owner-secret"
  });
  const payload = await response.json();
  assert.equal(response.status, 201);
  assert.equal(payload.inspection.inventory_changed, false);
  assert.match(calls[1].sql, /INSERT INTO order_return_inspections/);
  assert.equal(calls.some((call) => /UPDATE inventory|INSERT INTO inventory/.test(call.sql)), false);
});

test("Return inspection quantity cap is enforced atomically by the insert", async () => {
  let insertSql = "";
  const DB = {
    prepare(sql) {
      return { bind() {
        if (sql.includes("SELECT o.id")) return { first: async () => ({
          id: "order-return", country_code: "BD", currency_code: "BDT",
          payment_method: "COD", delivery_status: "RETURNED", ordered_quantity: 1
        }) };
        insertSql = sql;
        return { run: async () => ({ meta: { changes: 0 } }) };
      } };
    }
  };
  const response = await worker.fetch(request("/api/admin/orders/returns", "POST", JSON.stringify({
    order_id: "order-return", parcel_condition: "SEALED_INTACT",
    disposition: "RESTOCK_CANDIDATE", inspected_quantity: 1, notes: "Second inspection"
  }), { authorization: "Bearer owner-secret", "content-type": "application/json" }), {
    DB, HR_ADMIN_API_TOKEN: "owner-secret"
  });
  assert.equal(response.status, 409);
  assert.match(insertSql, /SUM\(inspected_quantity\)/);
  assert.match(insertSql, /SUM\(oi\.quantity\)/);
});
test("Damaged returned parcels cannot be marked as restock candidates", async () => {
  const DB = {
    prepare() {
      return { bind() { return { first: async () => ({ id: "order-return", country_code: "BD", currency_code: "BDT", payment_method: "COD", delivery_status: "RETURNED", ordered_quantity: 1 }) }; } };
    }
  };
  const response = await worker.fetch(request("/api/admin/orders/returns", "POST", JSON.stringify({
    order_id: "order-return", parcel_condition: "DAMAGED",
    disposition: "RESTOCK_CANDIDATE", inspected_quantity: 1, notes: "Damaged box"
  }), { authorization: "Bearer owner-secret", "content-type": "application/json" }), {
    DB, HR_ADMIN_API_TOKEN: "owner-secret"
  });
  assert.equal(response.status, 409);
});


test("COD ledger review records a human verification state", async () => {
  let updateSql = "";
  const DB = {
    prepare(sql) {
      return { bind() { updateSql = sql; return { run: async () => ({ meta: { changes: 1 } }) }; } };
    }
  };
  const response = await worker.fetch(request("/api/admin/orders/cod-ledger", "PATCH", JSON.stringify({
    entry_id: "entry-1", status: "VERIFIED", review_note: "Matched courier statement"
  }), { authorization: "Bearer owner-secret", "content-type": "application/json" }), {
    DB, HR_ADMIN_API_TOKEN: "owner-secret", HR_ADMIN_OWNER_LABEL: "OWNER"
  });
  assert.equal(response.status, 200);
  assert.match(updateSql, /status = 'PENDING_REVIEW'/);
  assert.match(updateSql, /reviewed_at = CURRENT_TIMESTAMP/);
  assert.match(updateSql, /o.country_code = 'BD'/);
});

test("Courier settlement cannot exceed recorded customer COD collection", async () => {
  let insertSql = "";
  const DB = {
    prepare(sql) {
      return { bind() { insertSql = sql; return {
        first: async () => ({ id: "order-bd", country_code: "BD", currency_code: "BDT", payment_method: "COD", delivery_status: "DELIVERED", total_minor: 1000 }),
        run: async () => ({ meta: { changes: 0 } })
      }; } };
    }
  };
  const response = await worker.fetch(request("/api/admin/orders/cod-ledger", "POST", JSON.stringify({
    order_id: "order-bd", entry_type: "COURIER_SETTLEMENT_RECEIVED",
    amount_minor: 200, evidence_reference: "bank statement"
  }), { authorization: "Bearer owner-secret", "content-type": "application/json" }), {
    DB, HR_ADMIN_API_TOKEN: "owner-secret"
  });
  assert.equal(response.status, 409);
  assert.match(insertSql, /SUM\(amount_minor\)/);
  assert.match(insertSql, /entry_type = 'COURIER_SETTLEMENT_RECEIVED'/);
  assert.doesNotMatch(insertSql, /status <> 'DISPUTED'/);
  assert.match((await response.json()).error, /cannot exceed recorded customer COD collection/i);
});

test("Customer refund cannot exceed verified COD collection", async () => {
  let insertSql = "";
  const DB = {
    prepare(sql) {
      return { bind() {
        if (sql.includes("SELECT id, country_code")) return { first: async () => ({
          id: "order-bd", country_code: "BD", currency_code: "BDT",
          payment_method: "COD", delivery_status: "DELIVERED", total_minor: 1000
        }) };
        insertSql = sql;
        return { run: async () => ({ meta: { changes: 0 } }) };
      } };
    }
  };
  const response = await worker.fetch(request("/api/admin/orders/cod-ledger", "POST", JSON.stringify({
    order_id: "order-bd", entry_type: "CUSTOMER_REFUND",
    amount_minor: 200, evidence_reference: "refund receipt"
  }), { authorization: "Bearer owner-secret", "content-type": "application/json" }), {
    DB, HR_ADMIN_API_TOKEN: "owner-secret"
  });
  assert.equal(response.status, 409);
  assert.ok(insertSql.includes("entry_type = 'CUSTOMER_REFUND'"));
  assert.ok(insertSql.includes("status = 'VERIFIED'"));
  assert.match((await response.json()).error, /refunds cannot exceed verified/i);
});
test("Customer COD collection cannot exceed order total", async () => {
  let insertSql = "";
  const DB = {
    prepare(sql) {
      return { bind() { insertSql = sql; return {
        first: async () => ({ id: "order-bd", country_code: "BD", currency_code: "BDT", payment_method: "COD", delivery_status: "DELIVERED", total_minor: 1000 }),
        run: async () => ({ meta: { changes: 0 } })
      }; } };
    }
  };
  const response = await worker.fetch(request("/api/admin/orders/cod-ledger", "POST", JSON.stringify({
    order_id: "order-bd", entry_type: "CUSTOMER_COD_COLLECTED",
    amount_minor: 200, evidence_reference: "courier receipt"
  }), { authorization: "Bearer owner-secret", "content-type": "application/json" }), {
    DB, HR_ADMIN_API_TOKEN: "owner-secret"
  });
  assert.equal(response.status, 409);
  assert.match(insertSql, /total_minor >= \?/);
  assert.match(insertSql, /entry_type = 'CUSTOMER_COD_COLLECTED'/);
  assert.doesNotMatch(insertSql, /status <> 'DISPUTED'/);
});

test("COD operations dashboard parses and keeps owner token out of browser storage", () => {
  const html = readFileSync(new URL("../public/admin-cod-operations.html", import.meta.url), "utf8");
  const start = html.indexOf("<script>");
  const end = html.indexOf("</script>", start);
  assert.ok(start >= 0 && end > start);
  assert.doesNotThrow(() => new Script(html.slice(start + 8, end)));
  assert.match(html, /noindex,nofollow/);
  assert.doesNotMatch(html, /localStorage|sessionStorage/);
  assert.match(html, /PENDING REVIEW/);
  assert.match(html, /inventory was not changed/i);
});
