# CJ Dropshipping integration — implementation contract

## Account separation
- HR UNIVERSE will use a separate CJ Dropshipping account registered with `hruniverse485@gmail.com`.
- The existing CJ account and its Shopify connection managed with Shafiq bhai are out of scope. Never disconnect, re-authorize, import from, or change that account.
- Do not ask the owner to share passwords, API keys, access tokens, or recovery codes in chat.

## Authentication and secret handling
- Create/authorize the CJ API application only after the new HR UNIVERSE account is ready.
- Store credentials as Cloudflare Worker secrets (for example, `CJ_API_KEY` and any required client credentials), never in Git, D1, browser JavaScript, logs, or documentation.
- The owner must perform the CJ login/consent step and add secrets in Cloudflare. Code must fail closed when credentials are absent.
- Confirm the current CJ API authentication contract and required scopes from CJ's official developer documentation at implementation time; do not assume endpoint names, token lifetime, pagination, or field names.

## Product discovery and approval pipeline
1. Discover candidate products through the official CJ API.
2. Normalize supplier IDs, product/variant IDs, SKU, name, descriptions, image URLs, source currency/cost, and availability.
3. Keep newly discovered products in an unverified/review state; do not publish automatically.
4. Refresh stock and shipping for each destination country and selected variant.
5. Treat free shipping as a destination + variant + shipping-method quote, not a global product property. A free-shipping flag is valid only when the quote is available, current, and its quoted amount is zero.
6. Calculate landed cost from source cost, destination-specific shipping, currency conversion, duties/tax assumptions where available, and operational buffer. Do not advertise a price until required inputs are verified.
7. Publish only after image/content rights, quality, stock, delivery estimate, margin, destination eligibility, and owner approval are checked.

## Destination and checkout gates
- USA is the first intended market, but a CJ shipping quote alone does not activate checkout.
- Checkout stays disabled until payment acceptance/settlement, fulfillment route, returns, tax/compliance, support, and stock reservation are verified for that country.
- Do not expose supplier identity, source cost, supplier URLs, API details, or warehouse routing to customers.
- Expired or unavailable quotes must make the product unavailable for that destination until refreshed.

## Data foundation
Migration `0005_supplier_catalog_foundation.sql` adds:
- supplier product source mapping (supplier's external product ID and normalized source state);
- destination-specific shipping quote records (method, amount, free-shipping evidence, delivery window, quote/expiry timestamps);
- auditable supplier sync runs and aggregate outcomes.

This migration is additive and was designed for disposable SQLite validation. It has NOT been applied to production D1. Supplier credentials are deliberately not stored in these tables.

## Not yet implemented
- CJ API authentication/client and scheduled sync.
- Product/variant ingestion, image handling, pagination/rate-limit handling.
- Shipping quote refresh and expiry enforcement in the storefront.
- Owner review/approval UI and supplier order placement.
- Live account authorization and end-to-end sandbox verification.
