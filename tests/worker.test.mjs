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
  const scripts = [...storefrontSource.matchAll(/<script>([\\s\\S]*?)<\\/script>/g)];
  assert.equal(scripts.length, 1);
  assert.doesNotThrow(() => new Script(scripts[0][1]));
});
