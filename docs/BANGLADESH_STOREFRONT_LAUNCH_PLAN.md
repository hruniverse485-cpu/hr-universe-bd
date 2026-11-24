# HR UNIVERSE Bangladesh storefront — launch plan

Status: Feature-branch implementation; not deployed.

## Purpose
Provide a Bangladesh-only storefront while the international/USA-first marketplace continues to be prepared separately. The Bangladesh storefront is available at `/bd/` after deployment and is restricted to BD/BDT.

## Customer experience
- Bengali-first, mobile-responsive interface with English brand identity.
- Live catalog only: active BD/BDT prices, active categories/products/variants, and fresh verified Bangladesh local-warehouse inventory.
- Search and category filters use the public API; product catalog uses bounded keyset pagination.
- Shopping bag stores product ID, variant ID and quantity only. It does not store customer information, prices, supplier identity or stock assertions.
- Before checkout, the UI fetches the configured Bangladesh local-warehouse shipping base rate and displays item subtotal, shipping and estimated total.
- COD checkout sends only item IDs/quantities and customer details. Worker recalculates prices, verifies market eligibility and fresh stock, uses the configured shipping rate, and atomically reserves inventory.
- An idempotency key is sent to avoid duplicate order creation on retries.
- Customer-facing status is explicitly Pending; HR UNIVERSE must confirm delivery coverage before confirming the order.

## Important boundaries
- The current shipping schema provides a country-level base rate, not district-specific courier pricing. The quote endpoint clearly discloses this. The owner must verify delivery coverage manually before confirming an order.
- This storefront supports only local warehouse fulfillment. It does not expose supplier-direct COD, on-demand sourcing checkout, cross-border fulfillment or any international payment method.
- The page shows no sample/demo products. If no eligible BD/BDT catalog records exist, it shows an empty state instead of fabricated listings.
- Customer support contacts, terms, privacy notice, return/refund policy and delivery service coverage must be owner-verified before public launch.
- The existing Worker order API returns Pending orders and reserves verified local stock; owner order review and delivery operations remain manual.
- No courier is booked and no tracking number is generated automatically.

## Pre-launch checklist
1. Activate only genuinely sellable BD/BDT categories, products, variants and prices.
2. Verify physical stock and timestamps within the configured freshness limit.
3. Configure one approved active local-warehouse shipping method and BDT rate.
4. Confirm district/service coverage with a real courier partner; update the shipping model before promising district-specific fees or delivery times.
5. Publish verified support contact, privacy, terms, delivery, cancellation and returns/refund policies.
6. Test order placement in a non-production environment, including duplicate submission, stale stock, invalid market and missing shipping rate.
7. Owner reviews the order dashboard and confirms fulfillment capacity.
8. Obtain explicit approval before production D1 migrations or deployment.

## International track
The international storefront, market activation, supplier integrations, payment acceptance, cross-border shipping, tax/customs and country-specific compliance remain independent release gates. This Bangladesh page does not activate any other country.
