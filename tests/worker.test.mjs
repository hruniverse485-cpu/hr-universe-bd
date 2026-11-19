import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";

const workerSource = readFileSync(
  new URL("../worker/index.js", import.meta.url),
  "utf8"
);
const { default: worker } = await import(
  `data:text/javascript;base64,${Buffer.from(workerSource).toString("base64")}`
);

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

test("product endpoint requires a valid country and currency", async () => {
  const response = await worker.fetch(
    request("/api/products?country=USA&currency=USD"),
    { DB: {} }
  );
  assert.equal(response.status, 400);
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

test("storefront provides search, saved products, responsive layout and relaxed browsing copy", () => {
  assert.match(storefrontSource, /id="searchInput"/);
  assert.match(storefrontSource, /hu-saved-products/);
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
