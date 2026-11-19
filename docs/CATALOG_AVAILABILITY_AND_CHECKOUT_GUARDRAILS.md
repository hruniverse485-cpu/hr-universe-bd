# HR UNIVERSE — Catalog Availability and Checkout Guardrails

## Current Bangladesh storefront scope

The current public storefront is configured for Bangladesh (BD / BDT). The only implemented customer checkout path is Bangladesh BDT Cash on Delivery (COD). Other country checkouts and global cross-border catalog sales must remain disabled until the required payment, fulfillment, shipping, returns and customer-support configuration is verified.

## Product listing eligibility

`GET /api/products` returns a product only when all of the following are true:

- The product is ACTIVE.
- Its category is active.
- It has an active country-specific price valid at the current time.
- The requested country and currency are active.
- At least one ACTIVE product variant has inventory in an ACTIVE warehouse for the requested country.
- The inventory row has a non-null verification timestamp and a positive remaining quantity.

The response includes the summed remaining verified warehouse quantity and the current fulfillment type (`LOCAL_WAREHOUSE`). This quantity is an operational value, not a customer-facing stock guarantee.

## Checkout authority

The storefront must never submit or control the final price. `POST /api/orders` independently validates the country/currency/payment combination, active product and category, price validity, variant ownership, verified warehouse inventory, shipping-rate configuration, and the server-calculated total. Inventory reservation is performed by database triggers in the same D1 batch as the order and order-item writes. An idempotency key is required.

## Verification freshness limitation

A non-null `inventory.verified_at` proves that a verification record exists; it does not prove that the stock count was rechecked recently. Before public launch, implement a configurable freshness policy (maximum age by warehouse/SKU), a stock-verification workflow, and a clear operator warning for stale counts. Do not interpret the current listing filter as a freshness guarantee.

## Remaining storefront launch work

- Product and variant administration for creating, editing, approving, pausing and archiving catalog items.
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
