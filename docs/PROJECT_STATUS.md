# HR UNIVERSE — Project Status & Continuation Checkpoint

Last reviewed: 2026-11-18 (owner-approved design and automation requirements recorded)  
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
- `public/index.html` remains an older Bangladesh COD demo storefront with four hard-coded sample products. Its product IDs and presentation are not evidence of a populated, order-ready catalog.
- `public/HR_UNIVERSE_V2_preview_index.html` is a preview, not a production-ready global storefront. It explicitly labels its catalog as preview-only.
- `worker/schema.sql` contains the legacy `orders` base table. Marketplace tables and columns are added by ordered migrations.
- International payment acceptance, live supplier integrations, verified warehouse inventory, customer accounts, admin authentication, refunds, AI shopping, and image search are not implemented as production-ready features.
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
- `tests/worker.test.mjs` adds Node built-in tests for health checks, route/method handling, invalid product-market parameters, malformed/oversized order payloads, database availability, and the unauthenticated order-management boundary.
- `scripts/validate-migrations.py` applies the legacy base schema followed by every ordered SQL migration to an in-memory SQLite database, checks required marketplace tables and order columns, and checks foreign keys. Migrations are one-time ordered schema changes; do not reapply them to an already-migrated database.
- The first GitHub Actions run (run #3, commit `82a060b`) completed successfully: Worker JavaScript syntax check passed, all four SQL migrations applied to a disposable in-memory SQLite database, required marketplace tables/columns were present, and foreign-key checks were clean. This validates syntax and migration compatibility only; it is not an end-to-end or production test.

## Newly added automated test coverage (2026-11-18)

- Added `tests/worker.test.mjs` and wired it into GitHub Actions with `node --test`.
- The tests exercise API boundary behavior with lightweight Worker environment mocks; they do not yet exercise a complete D1-backed order transaction or browser checkout.
- The existing storefront still contains hard-coded demo products and a demo-mode fallback message when the API fails. This is a known launch-blocking defect: it must be replaced with API-backed catalog rendering and must never imply that a failed server request created an order.
- The order handler checks stock before creating the order but does not reserve/decrement inventory. Concurrent checkout requests could therefore oversell stock. Do not treat current inventory checking as safe stock reservation until that workflow is implemented and tested.

## Next implementation sequence

1. Run and fix the new CI checks; inspect the exact migration history and D1 deployment configuration.
2. Add backend tests for product listing, country/currency gating, pricing, stock, shipping, COD order creation, duplicate requests, and malformed inputs.
3. Replace the demo storefront with the approved HR UNIVERSE premium marketplace experience while keeping checkout disabled until the market/payment prerequisites are met.
4. Implement authentication and role-based authorization before exposing any admin or customer-private endpoints.
5. Implement customer accounts, cart, order history/tracking, and support workflows.
6. Implement supplier/warehouse/shipping integrations with verified stock, delivery estimates, and landed-cost calculation.
7. Implement returns/refunds with owner approvals, supplier recovery tracking, audit records, and cash-flow controls.
8. Implement AI shopping, product image search, sourcing workflows, and the owner command center behind appropriate permissions.
9. Verify payment provider eligibility and settlement for each country; activate one country at a time.
10. Complete security, privacy, performance, backup, recovery, and end-to-end acceptance testing before production launch.

## Owner approvals required

The owner retains control of banking, payment credentials, legal declarations, paid services, production deployment, material supplier commitments, refunds above configured limits, and final merge to `main`.

## Session rule

At every work session, record the current branch/head commit, changed files, test results, unresolved defects, blockers, and the next exact action. Never report a feature as complete without implementation and verification evidence.
