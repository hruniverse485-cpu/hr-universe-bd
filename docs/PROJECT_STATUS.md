# HR UNIVERSE — Project Status & Continuation Checkpoint

Last reviewed: 2026-11-19 (COD reconciliation, return inspection and catalog availability safeguards added)  
Repository: `hruniverse485-cpu/hr-universe-bd`  
Active development branch: `feature/global-hybrid-rebuild`  
Stable branch: `main` (do not modify or merge without explicit owner approval)

## Current verified state

- The Feature branch contains a Cloudflare Worker API in `worker/index.js`.
- The Worker exposes `/api/health`, `/api/products`, and Bangladesh-only COD order creation at `/api/orders`.
- Product prices are selected server-side from `product_prices`; client-submitted prices are not used to calculate the order total.
- The current Worker rejects non-BD, non-BDT, and non-COD orders.
- The Worker requires an active Bangladesh country/currency configuration and an active local-warehouse shipping rate before accepting an order.
- The Worker writes the legacy order row and corresponding `order_items` in one D1 batch.
- `public/index.html` has been replaced with an original premium, low-pressure discovery storefront. It fetches products from `/api/products` for BD/BDT, supports search, category navigation, sorting, saved products, product detail modal, responsive layouts, and reduced-motion preferences. It shows no hard-coded sample products and no fake-order fallback. It is currently a browsing/catalog experience; customer checkout is intentionally not exposed in this iteration.
- `/api/products` now excludes products unless they have at least one ACTIVE variant with positive inventory in an ACTIVE warehouse for the requested country and a non-null stock verification timestamp. It reports the maximum available quantity in a single active warehouse (matching the order reservation trigger) and `LOCAL_WAREHOUSE` fulfillment type. Stock older than `HR_INVENTORY_MAX_AGE_HOURS` (1–72 hours; default 72) is excluded from public catalog eligibility. This reduces stale listings but is not a guarantee that physical stock cannot change between checks.
- Migration `0013_inventory_verification_events.sql` adds append-only physical stock verification history. The owner-only `/api/admin/inventory/verification` API and `public/admin-inventory-verification.html` allow a physical count to be recorded; the Worker subtracts active reservations, atomically updates available stock and writes its evidence event. Counts below already-reserved units are rejected. The dashboard token stays in page memory only.
- Migration `0012_bangladesh_cod_reconciliation_returns.sql` adds an owner-only COD evidence ledger and returned-parcel inspection records. The API caps customer collection at the server order total, caps courier settlement and customer refunds at verified customer COD collections, prevents duplicate evidence references, and records new entries pending owner review. Returned inspection quantities are capped atomically; inspection never changes inventory.
- `public/admin-cod-operations.html` provides the owner-only COD ledger and return inspection interface. It keeps the bearer token in page memory only and does not persist it in browser storage.
- `public/HR_UNIVERSE_V2_preview_index.html` is a preview, not a production-ready global storefront. It explicitly labels its catalog as preview-only.
- `worker/schema.sql` contains the legacy `orders` base table. Marketplace tables and columns are added by ordered migrations.
- International payment acceptance, live supplier integrations, production-verified stock data, customer accounts, production-grade role-based admin authentication, actual refund execution, AI shopping, and image search are not implemented as production-ready features. The owner stock-count evidence workflow and COD refund evidence ledger are internal controls only; they do not move money or prove live stock.
- No production deployment or live D1 migration has been verified in this review.

## Owner-approved design and automation requirements (2026-11-18)

- The owner approved the recently presented premium marketplace/catalog visual direction, including editorial lifestyle hero, marketplace homepage, product listing/catalog cards, and responsive mobile shopping experience. Treat these as approved design references; do not ask the owner to choose again. Build an original HR UNIVERSE design, not a direct copy.
- Long-term operating principle: maximize automation while minimizing recurring cost. Prefer free tiers, open-source, and self-hostable components where practical; never assume a free tier is unlimited. Maintain a technology/service register with plan, quotas, actual usage, recurring/usage costs, upgrade triggers, alternatives, renewal dates, and owner approvals.
- Plan a secure voice-control layer for owner operations, with authentication and confirmation for sensitive actions.
- Plan an issue-reporting and resolution workflow: accept owner/customer reports, create auditable tickets, classify severity, collect privacy-safe diagnostics, investigate root causes across frontend/backend/database/integrations, propose or implement authorized fixes, run regression tests, track resolution, and notify the reporter. Never expose secrets or personal data in logs/AI prompts.
- Automatic remediation must be bounded. Payment/refund actions, destructive database changes, permission changes, supplier commitments, and production deployments require owner approval.
- Customer-facing service availability must be distinguished from AI/API usage quotas; no unlimited-free service promise.

## Safety and market activation

- Do not enable international checkout until legal eligibility, payment settlement, fulfillment, shipping/tax, returns, and customer support are verified for that destination.
- Do not populate the public catalog with demo products or unverified prices/stock.
- Never apply migrations to production D1 as part of an unverified code change.
- Preserve existing order records. Test migrations against a disposable database first.
- Keep all implementation work on `feature/global-hybrid-rebuild`. Do not modify `main` or merge branches without owner approval.

## Validation added in this checkpoint

- `.github/workflows/validate.yml` runs Worker syntax validation, automated Worker API route tests, and the SQLite migration validator on Feature-branch pushes, pull requests, and manual dispatch.
- GitHub Actions run #219 (2026-11-19, commit tested via temporary validation PR against Feature branch `abc38617b45a9da75739c1d29a8e494e628c2ed0`) passed all three validation steps: Worker syntax, Worker API tests, and ordered migration validation. This is code/schema validation only, not production deployment or live integration verification.
- GitHub Actions run #244 (2026-11-19, current Feature branch commit `4efd550eb69feff53bab165a97be2549a51793b3`, validated through a temporary non-merged PR) passed all three validation steps after adding migration 0013, owner inventory verification, verified-stock catalog filtering, and the COD/returns safeguards. This is code/schema validation only, not production deployment or live integration verification.
- GitHub Actions run #263 (2026-11-19, current Feature branch commit `8be6dd903c5690a3ce22aad59d24cc106d4a4a96`, validated through a temporary non-merged PR) passed Worker syntax, all Worker API tests, and ordered SQL migration validation after adding the configurable stock freshness limit and stale inventory dashboard indicators. This is code/schema validation only, not production deployment or live integration verification.
- `tests/worker.test.mjs` adds Node built-in tests for health checks, route/method handling, invalid product-market parameters, malformed/oversized order payloads, database availability, and the unauthenticated order-management boundary.
- `scripts/validate-migrations.py` applies the legacy base schema followed by every ordered SQL migration to an in-memory SQLite database, checks required marketplace tables and order columns, and checks foreign keys. Migrations are one-time ordered schema changes; do not reapply them to an already-migrated database.
- The first GitHub Actions run (run #3, commit `82a060b`) completed successfully: Worker JavaScript syntax check passed, all four SQL migrations applied to a disposable in-memory SQLite database, required marketplace tables/columns were present, and foreign-key checks were clean. This validates syntax and migration compatibility only; it is not an end-to-end or production test.

## Newly added automated test coverage (2026-11-18)

- Added `tests/worker.test.mjs` and wired it into GitHub Actions with `node --test`.
- The tests exercise API boundary behavior with lightweight Worker environment mocks; they do not yet exercise a complete D1-backed order transaction or browser checkout.
- Replaced the hard-coded demo storefront with an API-backed discovery/catalog experience. Added regression tests asserting that the storefront fetches live products, contains no hard-coded demo catalog, never claims a failed request created an order, and includes responsive browsing/search/saved-product behavior.
- The order handler uses migration 0006 database triggers to reserve verified Bangladesh warehouse stock when each `order_items` row is inserted in the same atomic D1 batch as its order. Insufficient stock aborts the batch; cancellation/rejection releases reserved units. Do not enable storefront checkout until the remaining payment, market, and end-to-end prerequisites are met.

## Next implementation sequence

1. Add SKU/warehouse-specific freshness overrides and monitoring for repeated stock mismatches; the current system uses a global 72-hour default (configurable 1–72 hours).
2. Extend backend integration coverage for full COD order creation, pricing, shipping, idempotent retries, and concurrent reservation scenarios.
2. Extend the API-backed premium storefront with real category metadata, verified product imagery/details, and accessibility/browser checks; keep checkout disabled until payment and market prerequisites are met.
3. Implement authentication and role-based authorization before exposing any admin or customer-private endpoints.
4. Implement customer accounts, cart, order history/tracking, and support workflows.
5. Implement supplier/warehouse/shipping integrations with verified stock, delivery estimates, and landed-cost calculation.
6. Implement returns/refunds with owner approvals, supplier recovery tracking, audit records, and cash-flow controls.
7. Implement AI shopping, product image search, sourcing workflows, and the owner command center behind appropriate permissions.
8. Verify payment provider eligibility and settlement for each country; activate one country at a time.
9. Complete security, privacy, performance, backup, recovery, and end-to-end acceptance testing before production launch.

## Owner approvals required

The owner retains control of banking, payment credentials, legal declarations, paid services, production deployment, material supplier commitments, refunds above configured limits, and final merge to `main`.

## Session rule

At every work session, record the current branch/head commit, changed files, test results, unresolved defects, blockers, and the next exact action. Never report a feature as complete without implementation and verification evidence.


## New-product form reset correction (2026-11-20)

- Starting a new product now calls the shared variant and price form reset functions. This clears any previously selected price ID, edit label and cancel state, preventing a later save from accidentally updating an old price record.
- Added a regression assertion for the new-product reset path.
- GitHub Actions run `44601438920` completed successfully on commit `9d54c0017d3b38b9a4904bcccd0b28bcb5c86408`: Worker syntax, all 117 Worker API tests, and ordered SQL migration validation passed.

## Active product editor guard (2026-11-20)

- The owner catalog dashboard now disables product-detail form controls while the selected product is ACTIVE and explains that the product must be paused before editing. Pausing refreshes the editor and makes the fields editable again.
- Added dashboard regression assertions for the active-product lock and owner guidance.
- GitHub Actions run `44601329674` completed successfully on commit `fdbd50ab9affc6a92e07acdd6bfb2c10febe1b1f`: Worker syntax check passed, all 117 Worker API tests passed, and SQL migration validation passed.
- No production deployment, migration application, or paid service activation was performed.

## Catalog eligibility alignment and validation checkpoint (2026-11-20)

- Product activation now requires a currently valid ACTIVE product-level (non-variant-specific) price. This matches the public product and category queries, which currently list only base product prices; a product with only a variant-specific price would otherwise activate but remain absent from the public catalog.
- The owner catalog detail renderer was corrected and the dashboard inline script syntax is now validated by CI.
- Inventory freshness upper-bound guards and the associated regression tests are included in this validated state.
- GitHub Actions run `44601188999` completed successfully on commit `739b3a54daaf7ea571cb2cb91f7a93b71fa6036b`: Worker syntax check passed, all 117 Worker API tests passed, and ordered SQL migration validation passed.
- No migration or production database changes were required. No deployment, paid service, or external action was performed.

## Inventory freshness upper-bound checkpoint (2026-11-20)

- Product activation now rejects future-dated `inventory.verified_at` timestamps as well as timestamps older than the configured freshness window.
- The owner inventory verification dashboard now labels future-dated verification timestamps as stale instead of treating them as fresh.
- Added regression tests for both the product activation SQL guard and the inventory dashboard stale-state query.
- This complements migration 0015 and the public product-listing upper-bound checks; no migration or production data change was needed.
- Changes remain on `feature/global-hybrid-rebuild`. GitHub Actions validation is triggered by pushes to this branch; the latest run has not yet been confirmed. No deployment, paid service, or external action was performed.

## Catalog market-price editing checkpoint (2026-11-20)

- The owner catalog dashboard now supports editing existing PENDING and INACTIVE market-price records without creating duplicate price rows.
- The owner API preserves the existing price ID and approval status, verifies the product/market/variant relationship, rejects edits to ACTIVE prices until they are deactivated, and writes the mutation with an audit event in one D1 batch.
- The dashboard pre-fills the selected price, supports cancel, and keeps the existing activate/deactivate controls. Active prices are not offered for direct editing.
- Added API regression tests for successful audited edits and rejection of active-price edits, plus dashboard source assertions.
- Changes are on `feature/global-hybrid-rebuild`. The automated test suite and GitHub Actions result have not yet been confirmed. No database migration, production resource, deployment, or external service was changed.

## Latest implementation checkpoint (2026-11-18)

- Replaced `public/index.html` on the Feature branch with a responsive premium discovery storefront based on the owner's approved editorial + marketplace direction.
- Storefront now requests the live BD/BDT catalog from `/api/products`; it does not ship demo products or invented prices.
- Added product search, category/discovery navigation, sorting, saved products (browser-local), product detail modal, loading/empty/error states, mobile layout, and reduced-motion support.
- Checkout is intentionally not presented by this storefront yet. The existing backend order handler checks stock but does not reserve it atomically; exposing checkout before resolving this could permit overselling. Payment and destination-market prerequisites also remain unverified.
- Added four storefront regression tests to `tests/worker.test.mjs`, including a JavaScript syntax parse check. GitHub Actions run #18 (commit `8a238860fbe69dcca66c3ae8da0d5e58df98f19b`) completed successfully: all 15 Node tests passed, Worker syntax validation passed, and all ordered SQL migrations validated against disposable SQLite.
- No production deployment, live database migration, payment activation, or changes to `main` were performed.


## Verified CI result for premium storefront milestone

- Workflow run: [#18](https://github.com/hruniverse485-cpu/hr-universe-bd/actions/runs/44274782272)
- Commit: `8a238860fbe69dcca66c3ae8da0d5e58df98f19b`
- Final result: **success**
- Node test suite: **15 passed, 0 failed**
- Worker syntax check: passed
- Base schema + ordered migration validation: passed
- This CI run validates code syntax, mocked API boundaries, storefront static behavior and SQLite migration compatibility. It does not prove live D1 data exists, browser rendering across devices, payment processing, safe concurrent stock reservation, or production deployment.


## CJ supplier integration groundwork (2026-11-18)

- Owner confirmed the existing CJ account is associated with a Shopify connection managed with Shafiq bhai. That account and connection must remain untouched.
- HR UNIVERSE will use a separate CJ account registered with `hruniverse485@gmail.com`; API credentials must be stored as Cloudflare Worker secrets, never in Git, D1, browser code, or chat.
- Added `migrations/0005_supplier_catalog_foundation.sql` for supplier external product mapping, destination-specific shipping quote evidence (including free-shipping flag, currency, delivery window and expiry), and auditable sync runs.
- Added `docs/CJ_DROPSHIPPING_INTEGRATION.md` defining account isolation, secure authentication, product review, destination-specific free-shipping verification, landed-cost checks, and checkout gates.
- Extended the disposable SQLite migration validator to require the three supplier integration tables.
- CJ API credentials/account authorization are not yet available; no CJ API calls, product imports, supplier orders, production D1 migrations, or checkout activation have occurred. Migration 0005 is not applied to production.


## Multi-supplier sourcing and migration route (2026-11-18)

- Added `docs/SUPPLIER_DIRECTORY_AND_MIGRATION.md` with a no-subscription/no-deposit-first supplier shortlist, cost caveats, approval lifecycle, provider-neutral adapter contract, destination-specific vetting and supplier-switch migration procedure.
- Candidates include CJ (priority, separate HR UNIVERSE account pending), AliExpress (seller-by-seller), DSers (connector, not supplier), Printful/Printify (POD only), EPROLO (research), Syncee (free browsing does not necessarily permit importing), and Spocket (paid-feature gate; no subscription approved).
- No supplier is yet marked production-approved. Free entry does not mean free products/shipping; supplier payment may be due before customer funds settle.
- No subscriptions, deposits, sample orders, supplier commitments, production migrations, or changes to the existing Shopify-linked CJ account were made.


## Long-term supplier relationship requirement (2026-11-18)

- Supplier outreach must explain HR UNIVERSE's long-term growth ambition and interest in building a durable partnership as the business scales, without promising guaranteed future volume, exclusivity, or spend.
- Ask what concrete support is available to a new/small business now and what additional support can be earned as real order volume grows: onboarding, sourcing, competitive pricing, payment terms/cash-flow flexibility, tracking, returns, account support, scalable fulfillment, volume pricing, and branded/white-label packaging.
- Record supplier answers and written evidence; do not label future benefits as confirmed until the supplier confirms terms. Preferred-partner status must be earned through measured performance.


## Secure order and inventory reservation milestone (2026-11-19)

- Added ordered migration `0006_atomic_inventory_reservations.sql` with an auditable inventory reservation ledger.
- Database triggers reserve verified, active Bangladesh warehouse stock when `order_items` rows are inserted. The order row and all order items are written through one D1 batch; a failed stock reservation aborts the batch, preventing an order from being partially created.
- Each order line is allocated to one verified active Bangladesh warehouse inventory row. Variant-backed inventory is required because the current base inventory schema requires a non-null variant ID; product-only inventory is not silently treated as available.
- Order cancellation/rejection restores all reserved quantities and marks reservation ledger rows released. Repeated terminal status changes do not release stock twice.
- The order API now requires a stable `Idempotency-Key` header or `idempotency_key` value, returns an existing order for retries, and handles concurrent duplicate-key collisions.
- Stock preflight is informational only; database triggers are authoritative. If stock changes between preflight and commit, the D1 batch fails and the API returns HTTP 409.
- CI run [#39](https://github.com/hruniverse485-cpu/hr-universe-bd/actions/runs/44432206502) succeeded for commit `b0a166393ac387a20313c1f179a2ed5a4730bc8f`: Worker syntax, 17 Node tests, migration application, reservation/depletion, insufficient-stock rollback, cancellation release, and no-double-release checks passed.
- This is code/schema validation on disposable SQLite plus Worker route tests. Migration 0006 has **not** been applied to production D1; no deployment occurred. Storefront checkout remains disabled pending payment/market and end-to-end verification.


## Multi-supplier engine Phase 2 checkpoint (2026-11-19)

- Added migration `0007_verified_supplier_variant_offers.sql`: multiple supplier offers per stable HR product variant; source price/currency; availability and approval lifecycle; quality, service, packaging and delivery scores; tracking/returns; neutral or HR-branded packaging evidence; explicit exclusion of supplier branding; destination-specific shipping quote and expiry; auditable FX conversion evidence.
- Added owner-token-protected read-only Worker endpoint `GET /api/admin/sourcing/compare`. It requires the `HR_ADMIN_API_TOKEN` Worker secret and returns no offers unless supplier, source, offer, quote, verification, currency, FX, quality, and packaging requirements pass. No supplier identity or source cost is exposed through the public catalog API.
- Ranking uses quality 25%, service 15%, packaging 20%, delivery 15%, tracking 5%, returns 5%, and landed-cost competitiveness 15%. It returns a pending-verification state rather than selecting an unverified supplier.
- Added Node route-boundary tests and disposable SQLite validation for supplier variant integrity and destination quote eligibility.
- No supplier account/API credentials, live supplier calls, supplier offers, supplier orders, FX feed, production D1 migration, deployment, or changes to `main` occurred. Existing Shafiq bhai CJ account remains untouched; the separate HR UNIVERSE CJ account is still required before CJ integration.


### Phase 2 CI verification (2026-11-19)

- Successful GitHub Actions run [#55](https://github.com/hruniverse485-cpu/hr-universe-bd/actions/runs/44433249834), commit `7c42b4bf415af3d3178555f2b47e8833810b1107`.
- Worker JavaScript syntax check passed; all 21 Node tests passed; base schema plus all seven ordered migrations passed disposable SQLite validation, including supplier-offer variant integrity and destination quote eligibility.
- Feature branch comparison: 67 commits ahead of `main`, 0 behind at this checkpoint. `main` remains unchanged.
- CI validates code and disposable SQLite behavior only. It does not configure `HR_ADMIN_API_TOKEN`, create supplier records, verify supplier claims, connect CJ, apply migrations to production D1, or deploy the Worker.


## Supplier offer administration foundation (2026-11-19)

- Added migration 0008 with an append-only-style audit record table for owner-managed supplier offer changes (before/after snapshots and action).
- Added owner-token-protected `POST /api/admin/sourcing/offers` operations to create/update non-active supplier variant offers, record destination shipping quotes and FX evidence, record verification scores/packaging evidence, and move offers through controlled review states.
- Offer identity (supplier source, HR product/variant, external supplier variant) cannot be rewritten in place. ACTIVE offers must be paused before editing.
- Promotion to ACTIVE is blocked unless the supplier and source are active/available, stock is available, verification evidence and all four scores exist, packaging is confirmed neutral or HR-branded, supplier branding is excluded, and a current destination-valid shipping quote/FX evidence exists.
- The endpoint requires `HR_ADMIN_API_TOKEN` as a Worker secret. No secret is stored in Git or D1.
- The private browser dashboard is implemented in `public/admin-sourcing.html`, including offer listing/editing, destination quote entry, verification evidence, controlled approval transitions, and audit-history snapshots. The private API currently uses a single owner token; richer role-based access, audit retention policy, supplier integration, and end-to-end operational review remain outstanding. No supplier was activated, no supplier API was called, no production migration/deployment occurred, and `main` remains unchanged.


## Private supplier control center UI (2026-11-19)

- Added `public/admin-sourcing.html`, a responsive owner-only sourcing dashboard served as a static asset. It provides offer listing/selection, offer creation/update, destination shipping quote entry, verification evidence/score entry, approval-state transitions, and per-offer audit history.
- Added authenticated GET listing to `/api/admin/sourcing/offers`; the same `HR_ADMIN_API_TOKEN` is required for both listing and write operations.
- The browser keeps the token only in page memory, clears the password field after connection, does not use localStorage/sessionStorage, and offers explicit disconnect/clear. The page is marked noindex.
- The dashboard does not contact suppliers, place orders, or execute payments. It is not production-accessible until the Worker is deployed with `HR_ADMIN_API_TOKEN` configured and migration 0008 is applied to the target D1 database. No production deployment or migration was performed.
- CI run #74 passed Worker syntax, all 31 Node tests, and ordered migration validation.


- Added authenticated audit-history retrieval scoped to a selected offer; the dashboard displays action, actor, timestamp and entity reference.

- Added a CI syntax check for the dashboard's inline JavaScript so malformed admin-page scripts are caught before merge.


## Supplier audit atomicity and detail checkpoint (2026-11-19)

- Reworked all four supplier-offer mutation paths (offer create/update, shipping quote create/update, verification evidence, and approval-state transition) so the mutation and its audit row execute together in one Cloudflare D1 `batch()`. If either statement fails, the batch is expected to roll back rather than leave an unaudited business change.
- Audit `after_json` is now generated by SQLite `json_object()` from the committed row fields; `before_json` preserves the pre-mutation snapshot. The owner dashboard displays both snapshots using DOM text nodes, not injected HTML.
- Added a regression test for transactional batch use and complete audit snapshots. CI run [#88](https://github.com/hruniverse485-cpu/hr-universe-bd/actions/runs/44530411188) passed: 32 Node tests, Worker syntax, and all eight ordered migrations on disposable SQLite.
- Dashboard update CI run [#89](https://github.com/hruniverse485-cpu/hr-universe-bd/actions/runs/44530420335) also passed: 32 Node tests, Worker syntax, and all eight ordered migrations.
- This validates source syntax, route-boundary tests, and disposable SQLite migration compatibility. It does not yet constitute a live Cloudflare D1 integration/concurrency test. No production migration, deployment, supplier API connection, supplier order, or change to `main` occurred.


## Supplier shipping-quote identity hardening (2026-11-19)

- A focused review found that an existing shipping-quote ID could be submitted with a different offer or destination. The UPSERT did not rewrite those identity columns, but without an explicit guard it could misleadingly accept an update request against the wrong quote record.
- Added a server-side immutable-identity check: an existing quote may only be updated for its original supplier offer and destination country. Reassignment returns HTTP 409 before any mutation or audit batch.
- Added a source-level regression assertion and an API-boundary test with a mocked D1 binding proving that a mismatched offer/destination is rejected and no mutation batch is executed.
- CI run [#93](https://github.com/hruniverse485-cpu/hr-universe-bd/actions/runs/44535402947) completed successfully on commit `46ba9153db9100e6547fb470176efdcc0f16ef70`: Worker syntax passed, all 34 Node tests passed, and all eight ordered migrations passed disposable SQLite validation.
- Scope remains limited to the Feature branch. No production D1 migration, deployment, supplier connection/order, or change to `main` occurred.
- Next: add stronger end-to-end-style mocked D1 tests for supplier offer state transitions and the order creation/idempotency/reservation path; then resolve stale duplicated checkpoint text in this status document.


## Order idempotency request binding (2026-11-19)

- Added additive migration 0009 with `orders.idempotency_request_hash`; existing orders remain intact and keep a NULL fingerprint until a new request is stored.
- New COD order requests receive a SHA-256 fingerprint of canonicalized JSON. Reusing a key with a different fingerprint returns HTTP 409; an identical retry returns only the original order identity/status/timestamp, not internal fingerprint data.
- The unique-key conflict path performs the same fingerprint comparison, covering simultaneous requests that race after the initial lookup.
- Added disposable SQLite checks for migration column presence, legacy NULL compatibility, fingerprint persistence, and unique idempotency-key enforcement. Added Worker tests for mismatched payload rejection, identical retries, canonical JSON key ordering, fingerprint persistence, and concurrent-conflict source guard.
- CI runs #101 and #102 passed on the request-binding implementation and regression tests; run #103 passed after the migration compatibility note update. Run #104 is expected for the latest migration-validator and canonicalization tests; do not treat this checkpoint as fully verified until it completes.
- Current automated Worker suite contains 40 tests. These are mocked Worker/API tests plus disposable SQLite migration/trigger tests; they are not live Cloudflare D1 integration or real concurrent request tests.
- No production D1 migration, deployment, payment activation, supplier order, or change to `main` occurred.


## COD order-path regression coverage (2026-11-19)

- Added mocked-D1 API-path tests that exercise a complete valid Bangladesh COD order request through server-side price lookup, verified-variant/stock checks, shipping lookup, request fingerprint persistence, and one atomic batch containing the order and line item.
- Added a simulated stock-change race: when the atomic batch reports the inventory-reservation trigger error, the API must return HTTP 409 and must not report order success.
- The first test run (#107) correctly exposed an incomplete test double: the mock did not implement D1's unbound `.first()` query form. The mock was corrected; no production Worker change was needed for that failure.
- CI run [#108](https://github.com/hruniverse485-cpu/hr-universe-bd/actions/runs/44538068667) passed Worker syntax, all 42 Node tests, and the complete ordered migration validator including reservation/cancellation triggers and migration 0009 idempotency schema checks.
- These are mocked-D1 request-path tests plus real SQLite migration/trigger tests. They still do not replace live Cloudflare D1 integration, simultaneous network requests, or production load tests.
- No live D1 changes, deployments, payments, supplier orders, or changes to `main`.

## Owner-protected pending-order cancellation (2026-11-19)

- Added `POST /api/admin/orders/cancel`, protected by the existing `HR_ADMIN_API_TOKEN` Worker secret.
- The initial cancellation workflow accepts only an existing `PENDING` order. Confirmed/processing orders are rejected with HTTP 409 so the system does not claim to cancel an order that may already be in fulfilment.
- The status update is conditional (`WHERE id = ? AND status = 'PENDING'`) to prevent a stale admin screen from overwriting a concurrent status change. Repeated cancellation is idempotently reported as already cancelled.
- Migration 0006's database trigger releases the reserved local inventory exactly once when the order transitions to `CANCELLED`; the Worker does not manually add stock and therefore avoids double release.
- Added route tests for missing/incorrect owner authentication, successful pending cancellation, refusal of confirmed orders, and invalid order identifiers.
- GitHub Actions run [#111](https://github.com/hruniverse485-cpu/hr-universe-bd/actions/runs/44546803301) passed: Worker syntax, Node API tests, and all ordered SQL migration validation.
- This is a Feature-branch code/test milestone only. It has not been deployed; no production database was changed. Customer self-service cancellation, confirmed-order exceptions, supplier cancellation, and refund handling remain unimplemented.


## Owner catalog management foundation (2026-11-19)

- Added migration 0014 with an append-only `catalog_admin_audit` table.
- Added owner-token-protected `GET/POST /api/admin/catalog` for catalog listing, draft product creation/editing, draft variant creation/editing, market price creation (PENDING by default), and audited status changes.
- Added private `public/admin-catalog.html` owner workspace with product, variant and price views. Owner token is held in page memory only; no local/session storage is used.
- Product activation is gated by active category and market, fresh verified Bangladesh warehouse inventory, an active variant, and a valid active BD/BDT price. Price activation validates market, category, variant relationship and validity window.
- Product and variant detail edits require pausing an active parent/product. Price rows are created as PENDING and require an explicit review/activation action. Mutations are paired with audit rows in a D1 batch; the audit insert is conditional on the preceding write having changed exactly one row.
- This is Feature-branch code only. Migration 0014 is not applied to production; dashboard is not live. CI validation for the latest catalog changes is pending.
- GitHub Actions run [#284](https://github.com/hruniverse485-cpu/hr-universe-bd/actions/runs/44571261084) passed on temporary non-merged validation PR head `d36ed94591d57080c83ac4d7dc20c5f3d828f7fe`, based on Feature commit `71f4c3257f9309209c00db554723a08ae13cf7e8`: Worker syntax passed, all 108 Node tests passed, and all 14 ordered SQL migrations passed disposable SQLite validation. The first CI attempt exposed three test-harness issues (a broad supplier-source assertion, missing owner header in one test, and a mock not reflecting the committed product); all were corrected and the recheck passed.
- Remaining: extend migration validator with catalog audit integrity/activation SQL checks, add category management and product image handling, improve admin form edit workflow, and integrate catalog with a complete customer storefront/cart/checkout. No deployment or external supplier action occurred.


## Category management and catalog validation checkpoint (2026-11-19)

- Extended migration 0014's catalog audit entity constraint to include `CATEGORY`; validator now exercises an allowed category audit record and rejects an unsupported entity type.
- Added owner-only category creation and activation/deactivation operations to `/api/admin/catalog`, with append-only audit records. New categories start inactive. Parent must be active before a child; active children must be deactivated before their parent; recursive hierarchy checks reject circular parent relationships.
- Added category create/activation controls to `public/admin-catalog.html`; new category is created inactive and can be explicitly activated.
- GitHub Actions run [#293](https://github.com/hruniverse485-cpu/hr-universe-bd/actions/runs/44571740222) passed on temporary non-merged validation PR head `c5cd60184c3be5b0b3c6decbb98db931ab4cf0f4`, based on Feature commit `b9f9123b048324bd85aa8f8047df8c4118be890e`: Worker syntax passed, all 109 Node tests passed, and all 14 ordered SQL migrations passed disposable SQLite validation.
- The temporary validation PR was closed without merging. All implementation changes remain isolated to `feature/global-hybrid-rebuild`; no production database migration or deployment occurred.
- Remaining: category editing/deletion policy, product image upload/management, richer product edit selection, variant-level price/availability UI polish, and complete customer storefront/cart/checkout. Live Cloudflare D1 integration and concurrency tests remain outstanding.


## Atomic inventory freshness enforcement (2026-11-19)

- Added ordered migration `0015_atomic_inventory_freshness_guard.sql`. The database reservation triggers now require Bangladesh warehouse stock to have a verification timestamp within the last 72 hours and not in the future; stale/future stock cannot be reserved by a direct API caller.
- The migration clears existing future-dated verification timestamps because future timestamps are not valid evidence.
- The Worker freshness setting is capped at 72 hours so public listing, product activation, inventory review and the atomic database reservation gate cannot disagree about the maximum permitted age. Owners may choose a stricter (shorter) setting.
- Expanded `scripts/validate-migrations.py` to exercise fresh-stock reservation, stale-stock rejection (73 hours), future-dated rejection, and unchanged inventory after rejected reservations in disposable SQLite.
- GitHub Actions run [#306](https://github.com/hruniverse485-cpu/hr-universe-bd/actions/runs/44575118597) passed on validation PR head `24774a41bc7277cf73ef71ace8b6d1cb993e0493`, based on Feature commit `4240f07a562f540ef764d28317dcecdf042d0ebf`: Worker syntax passed, all 110 Node tests passed, and all 15 ordered migrations passed disposable SQLite validation, including explicit stale (73-hour) and future-dated stock rejection checks. The temporary validation PR was closed unmerged.
- No production D1 migration or deployment was performed. Apply migration 0015 only through an explicitly approved production migration process.


## Live market-aware category discovery (2026-11-19)

- Added public `GET /api/categories?country=BD&currency=BDT`. It returns only active categories that currently contain at least one active product with an active product-level market price, active currency/country, active variant, active Bangladesh warehouse, positive stock and fresh non-future verification evidence.
- Product listing now includes each product's category slug. The storefront removes placeholder category labels and builds its category navigation from the live market-eligible category response; category navigation remains usable when the category request is temporarily unavailable.
- The category endpoint validates the full market-code input rather than truncating overlong values into apparently valid country/currency codes.
- GitHub Actions run [#313](https://github.com/hruniverse485-cpu/hr-universe-bd/actions/runs/44575732518) passed on validation PR head `7c1c01010f6f3a0d76815587dac7c4ce94b5f1af`, based on Feature commit `fff6b6e387c0a43f0661a0b3b0bda8772e21d24f`: Worker syntax, all 113 Node tests, and all 15 ordered migrations passed. The temporary validation PR was closed unmerged.
- No production deployment or D1 migration was performed.


## Public product listing timestamp parity (2026-11-19)

- Hardened both public product-listing inventory subqueries to reject future-dated verification timestamps, matching the category endpoint and the migration 0015 atomic reservation trigger.
- Added a regression assertion requiring both product-listing stock checks to enforce `verified_at <= CURRENT_TIMESTAMP`.
- Corrected the catalog guardrails documentation: the configurable freshness ceiling is 72 hours (not 720), and future-dated evidence is excluded.
- Feature-branch change only; CI validation is pending. No production deployment or database migration was performed.


## Product image pipeline design (2026-11-19)

- Added `docs/PRODUCT_IMAGE_STORAGE_DESIGN.md` after confirming the Worker currently has no R2 binding. The design specifies owner-only uploads, strict file-signature validation, opaque keys, private image delivery, approval gating, atomic audit, and release tests.
- Upload implementation is intentionally blocked until the existing `product_images` schema and a non-production R2 bucket/binding can be verified. No fake binding, production resource, or deployment was created.


## Zero-upfront setup and continuation checkpoint (2026-11-20)

- Reconfirmed the active development branch is `feature/global-hybrid-rebuild`; all work remains isolated from `main` and `backup/pre-global-rebuild`.
- Reconciled the technology/cost register with the current Feature-branch implementation: the storefront is API-backed for BD/BDT discovery, while customer checkout remains intentionally unavailable.
- Recorded the owner's no-deposit/no-upfront-payment rule. No paid plan, supplier deposit, sample purchase, API usage charge, production resource, deployment, or production migration may be initiated without explicit approval.
- The HR UNIVERSE CJ account must be separate and must not affect the existing account associated with Shafiq bhai. CJ authorization and API credentials remain owner-controlled and are not yet configured.
- Product image upload remains blocked on purpose: no R2 binding or bucket has been confirmed. The documented private-storage design remains the implementation specification; do not show fabricated image-upload success or expose unverified external image URLs.
- Updated `docs/TECHNOLOGY_COST_AUTOMATION_REGISTER.md` to remove the stale claim that the current storefront is still a demo/legacy storefront and to document the no-upfront-cost gate.
- This checkpoint is documentation-only. No runtime code, production data, Cloudflare resources, or live supplier accounts were changed. At the time this checkpoint was written, CI was pending; subsequent validation run 44601438920 passed on the then-current code tree.


## Catalog product editing usability fix (2026-11-20)

- Fixed the owner catalog dashboard so selecting an existing product loads its saved ID, name, slug, category, brand and description into the draft product form. Previously the form was reset blank, so the advertised edit workflow could not be completed reliably.
- Added an explicit **New product** action that clears selection and resets dependent variant/price panels while retaining safe BD/BDT defaults.
- Added regression assertions for product-form population, selected-record ID binding, new-product reset affordance, and the existing no-browser-storage credential rule.
- Changes are isolated to `public/admin-catalog.html` and `tests/worker.test.mjs` on `feature/global-hybrid-rebuild`. No database schema, production resource, supplier account, or customer data was changed.
- CI was pending at the time; subsequent validation run 44601438920 passed on the updated catalog dashboard and test tree.


## Catalog variant editing usability fix (2026-11-20)

- Added owner-dashboard editing for non-active product variants through the existing audited save_variant operation.
- Variant edit pre-fills SKU, display name and attributes and preserves the existing variant ID. Cancel resets the form. Active variants must be paused first, and the parent product must be non-active before variant edits.
- Added dashboard-script assertions for variant edit controls, ID preservation and cancel behavior. Feature branch only; no production data, schema, accounts or external services changed.
- CI was pending at the time; subsequent validation run 44601438920 passed on the updated catalog dashboard and test tree.


## Catalog category editing usability fix (2026-11-20)

- Added an Edit action for inactive categories in the owner catalog dashboard. The form pre-fills the saved category ID, name, slug, parent and sort order; saving calls the existing audited `save_category` update path rather than creating a duplicate.
- The current category cannot be selected as its own parent. Active categories remain read-only until deactivated, matching the backend safety rule. Cancel clears edit state.
- Added regression assertions for the edit action, form ID binding, cancel control and audited save operation.
- Changes are limited to `public/admin-catalog.html`, `tests/worker.test.mjs` and this status record on `feature/global-hybrid-rebuild`. No production data, database schema, Cloudflare resource, supplier account or paid service was changed.
- CI and Node test execution have not yet been confirmed for this change.


## Public product image URL privacy guard (2026-11-20)

- Confirmed that the public product listing API previously returned stored `image_url` values directly and the storefront used them as image sources. This could disclose supplier/CDN hostnames or signed URL query strings.
- Added a Worker response guard: only same-origin image paths are returned; external/protocol-relative URLs, unsafe schemes, API paths and malformed values become `null`; same-origin absolute URLs are reduced to path-only values with query strings/fragments removed.
- Added regression coverage for safe and rejected URL classes. Existing schema and records are preserved; this does not create image upload capability.
- Supplier-hosted image files must be migrated into HR UNIVERSE-controlled approved storage before becoming publicly visible. R2 remains unconfigured.
- Feature branch only. CI validation for this checkpoint is pending; no production deployment, production migration, Cloudflare resource, paid service or supplier account was changed.

## COD order preflight freshness parity (2026-11-20)

- Aligned the COD order's friendly inventory preflight query with migration 0015's authoritative atomic reservation rule. The preflight now requires verification within the configured 1–72 hour freshness window and rejects future-dated verification timestamps.
- The default remains 72 hours; a stricter `HR_INVENTORY_MAX_AGE_HOURS` value (for example, 24) is honored consistently before the final D1 reservation trigger.
- Added regression assertions for the default 72-hour query, future-timestamp exclusion, and a stricter configured 24-hour window.
- GitHub Actions run [#44742167042](https://github.com/hruniverse485-cpu/hr-universe-bd/actions/runs/44742167042) passed Worker syntax, all Worker API route tests, and ordered SQL migration validation.
- Feature branch only. No production migration, deployment, customer order, payment, supplier action, paid service, or change to `main` occurred.

## Storefront saved-products resilience (2026-11-20)

- Hardened the customer storefront's saved-products (wishlist) persistence for browsers where local storage is blocked or unavailable: read/write failures no longer break the browsing experience.
- Stored data is accepted only as a bounded array of short string product IDs; oversized lists are capped. After the live catalog loads, saved IDs that no longer exist in the eligible catalog are pruned.
- Added regression assertions for storage guards, input validation, bounded persistence, and stale-ID pruning. Existing live-catalog behavior and the no-checkout/no-order storefront boundary remain unchanged.
- GitHub Actions run [#44743831227](https://github.com/hruniverse485-cpu/hr-universe-bd/actions/runs/44743831227) passed Worker syntax, all Worker API route tests (including storefront source/script checks), and ordered SQL migration validation.
- Feature branch only. No customer orders, payment activation, production deployment, production migration, paid service, supplier action, or change to `main`.


## Product catalog scale target: 1,000+ distinct products (2026-11-20)

- Set the initial HR UNIVERSE catalog target to at least 1,000 distinct product listings, with architecture intended to scale beyond 1,000; 200 is not a business catalog ceiling.
- Clarified that catalog count is not stock quantity: supplier-fulfilled products remain with suppliers and do not require HR UNIVERSE physical inventory. Owned stock is tracked only for products HR UNIVERSE physically holds.
- Separated supplier availability, owned inventory, and customer order quantity; supplier stock must be verified and freshness-aware before it can support an orderable listing.
- Added docs/PRODUCT_CATALOG_SCALE_POLICY.md, including product publication gates, international market/payment eligibility, and bounded pagination requirements.
- Audit clarification: the public product API currently returns at most 50 products per request; this is a response page-size guard, not a 50-product catalog cap. The storefront currently requests up to 50. The 200 maximum found in the Worker applies to an owner-only local supplier directory listing, not the product catalog.
- This is a policy/documentation checkpoint only. Scalable storefront pagination and supplier catalog ingestion remain implementation work. No products were fabricated or published, and no supplier account, payment, production database, deployment, paid service, or main branch was changed.


## Public catalog keyset pagination and storefront load-more (2026-11-21)

- Replaced the public product endpoint's single-page-only retrieval with bounded keyset pagination. Requests remain capped at 50 products; a stable `(created_at DESC, id DESC)` cursor fetches the next page without an unbounded catalog response.
- The endpoint fetches one extra row to determine `has_more`, returns a continuation cursor only when another page exists, validates cursor fields, and omits its internal cursor timestamp from public product records.
- Updated the storefront with a Load more products control that appends pages, retains already loaded products and saved-product state, and handles retry/loading states without creating demo products or orders.
- Added Worker regression coverage for cursor ordering, continuation cursor output, invalid cursor rejection, and storefront pagination wiring. GitHub Actions run #44907094410 passed Worker syntax, all Worker API route tests, and ordered SQL migration validation.
- Feature branch only. No supplier catalog has been imported, no product records were fabricated/published, and no production DB, payment, deployment, paid service, supplier account, or main branch was changed.
