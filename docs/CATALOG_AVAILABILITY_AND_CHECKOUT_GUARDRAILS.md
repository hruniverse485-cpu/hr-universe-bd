# HR UNIVERSE — Catalog Availability and Checkout Guardrails

## Current Bangladesh storefront scope

The current public storefront is configured for Bangladesh (BD / BDT) and is currently a browsing/catalog experience; customer-facing checkout is not exposed. The Worker order API supports Bangladesh BDT Cash on Delivery (COD) only. Other country checkouts and global cross-border catalog sales must remain disabled until the required payment, fulfillment, shipping, returns and customer-support configuration is verified.

## Product listing eligibility

`GET /api/products` returns a product only when all of the following are true:

- The product is ACTIVE.
- Its category is active.
- It has an active country-specific price valid at the current time.
- The requested country and currency are active.
- At least one ACTIVE product variant has inventory in an ACTIVE warehouse for the requested country.
- The inventory row has a non-null verification timestamp and a positive remaining quantity.

The response includes the maximum remaining verified quantity in one active warehouse and the current fulfillment type (`LOCAL_WAREHOUSE`). This matches the current order reservation trigger, which allocates each order line to one warehouse; summing stock across warehouses could otherwise overstate fulfillable quantity. This quantity is an operational value, not a customer-facing stock guarantee. The owner-only `/api/admin/inventory/verification` workflow records a physical count and subtracts active order reservations before updating available quantity. Each update is transactionally paired with an append-only evidence event in migration 0013; duplicate evidence for one inventory row is rejected.

## Checkout authority

The storefront must never submit or control the final price. `POST /api/orders` independently validates the country/currency/payment combination, active product and category, price validity, variant ownership, verified warehouse inventory, shipping-rate configuration, and the server-calculated total. Inventory reservation is performed by database triggers in the same D1 batch as the order and order-item writes. An idempotency key is required.

## Verification freshness limitation

Public catalog eligibility uses a configurable freshness limit: `HR_INVENTORY_MAX_AGE_HOURS` accepts 1–720 hours and defaults to 72 hours when unset or invalid. Stock older than this limit is excluded from both the available-quantity calculation and product eligibility. The owner inventory dashboard flags stale rows and displays the active limit. This is a system-level default, not a guarantee that physical stock cannot change between checks.

## Owner catalog management (Feature branch; migration 0014)
- `GET/POST /api/admin/catalog` is owner-token protected. The private `/admin-catalog.html` dashboard manages draft product records, draft variants, and country/currency-specific prices.
- New products and variants are created as `DRAFT`; new prices are created as `PENDING`. Every mutation is paired with a catalog audit record in the same D1 batch. A conditional audit insert makes a stale/no-op update fail rather than recording a false audit event. Categories can also be created inactive and explicitly activated; parent/child activation order is enforced and recursive checks prevent circular category hierarchies.
- Variant status can be changed separately. Price activation checks active category, market and currency, product not archived, variant active when variant-specific, and the validity window.
- Product activation for the current BD/BDT storefront is gated on an active category and market, fresh verified Bangladesh warehouse stock, an active variant, and a valid active BD/BDT price. Public product listing independently repeats its stock/price eligibility checks.
- Product image upload, bulk import, category editing, product-level pause/approval workflow refinements and complete storefront cart/checkout remain separate work. The dashboard is not production-accessible until the Worker is deployed with the owner token and migrations are applied to the intended database.

## Remaining storefront launch work

- Product and variant administration for creating, editing, approving, pausing and archiving catalog items.
- Add optional SKU/warehouse-specific freshness overrides and monitoring for repeated stock mismatches; the current global limit is configurable but not individually tuned.
- Image upload/management and product content quality checks.
- Customer-facing variant selection and an accessible cart/checkout flow that submits variant IDs and idempotency keys.
- Display shipping cost and delivery estimate before order submission, using only configured and verified local rates.
- Customer order confirmation and support workflow.
- Automated tests for catalog eligibility and end-to-end storefront checkout.
- Global cross-border catalog and checkout are a separate later release, gated by payment availability and verified destination-specific supplier offers and shipping quotes.

## Safety rules

- Never publish a product solely because a supplier says it is available.
- Never display unverified or zero-stock products as purchasable.
- Never promise a delivery date or warehouse location without verified operational data.
- Never expose supplier identities, supplier costs, or internal routing in the customer storefront.
- A successful order response is not proof of courier booking, delivery, COD collection or courier settlement.
