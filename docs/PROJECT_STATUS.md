# HR UNIVERSE — Project Status & Continuation Checkpoint

Last reviewed: 2026-11-18  
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

## Safety and market activation

- Do not enable international checkout until legal eligibility, payment settlement, fulfillment, shipping/tax, returns, and customer support are verified for that destination.
- Do not populate the public catalog with demo products or unverified prices/stock.
- Never apply migrations to production D1 as part of an unverified code change.
- Preserve existing order records. Test migrations against a disposable database first.
- Keep all implementation work on `feature/global-hybrid-rebuild`. Do not modify `main` or merge branches without owner approval.

## Validation added in this checkpoint

- `.github/workflows/validate.yml` runs Worker syntax validation and the SQLite migration validator on Feature-branch pushes, pull requests, and manual dispatch.
- `scripts/validate-migrations.py` applies the legacy base schema followed by every ordered SQL migration to an in-memory SQLite database, checks required marketplace tables and order columns, checks foreign keys, and verifies repeatability.
- CI results must be checked after GitHub starts the workflow. Adding a workflow is not the same as a passing test.

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
