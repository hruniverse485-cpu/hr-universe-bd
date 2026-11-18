# HR UNIVERSE supplier directory and migration strategy

Last reviewed: 2026-11-18. This is a research shortlist, not a claim that any supplier has passed a live fulfillment audit.

## Selection policy
Prioritize suppliers that:
- allow registration and product discovery without a paid subscription, joining fee, deposit, or MOQ;
- charge product + shipping only after a customer order, where their payment terms permit;
- provide traceable shipping, destination-specific rates and delivery estimates;
- publish usable catalog/inventory data or provide a documented API/feed;
- have clear returns, damaged/lost parcel and refund processes;
- can serve the USA first, then additional destinations after separate validation.

A free account is not the same as free fulfillment. The customer payment is not guaranteed to settle before a supplier requires payment. HR UNIVERSE must maintain enough cash-flow control to avoid accepting an order it cannot fund.

## Candidate supplier directory

| Candidate | Primary role | Free entry evidence / caveat | Initial status |
|---|---|---|---|
| CJ Dropshipping | General sourcing, broad catalog, cross-border and selected overseas warehouses | Free account/platform entry is commonly offered; product, shipping, optional services and branding are charged. Verify each SKU + destination quote. HR UNIVERSE must use its own new account; do not touch the existing Shopify-linked account managed with Shafiq bhai. | PRIORITY — account pending |
| AliExpress | Broad product sourcing and supplier discovery | Marketplace access is free; each seller has different shipping, quality, dispatch, return and payment terms. No uniform marketplace-wide service guarantee. | CANDIDATE — seller-level vetting |
| DSers | AliExpress product/order workflow connector, not the supplier itself | Basic free tier exists but automation/features are limited; it does not certify AliExpress sellers or product quality. | CANDIDATE — optional adapter |
| Printful | Print-on-demand, branded designs | Free plan, no setup fee/order minimum; product, printing, shipping and applicable tax are charged per order. Not a general catalog replacement. | CANDIDATE — POD category |
| Printify | Print-on-demand supplier network/connector | Free entry tier is available; provider, product, shipping and production quality vary by print provider. Test provider-specific fulfillment. | CANDIDATE — POD category |
| EPROLO | General sourcing and fulfillment | Advertises free platform entry; confirm destination shipping, product cost, optional branding charges and API access before approval. | RESEARCH — not verified |
| Syncee | Supplier marketplace/discovery | Free plan permits browsing, but importing products into a store may require paid plan or DataFeed Manager. Do not treat free browsing as free fulfillment integration. | DISCOVERY ONLY |
| Spocket | US/EU supplier marketplace | Free plan/trial wording exists, but useful importing/automation may require paid plan. Do not commit to subscription. | HOLD — paid-feature gate |


## Long-term supplier partnership and growth support

When contacting prospective suppliers, HR UNIVERSE should communicate its genuine ambition to grow into a substantial, long-term international brand and its preference for building durable supplier relationships rather than one-off transactions. Keep the message professional and honest: this is a growth intention, not a promise of guaranteed order volume, exclusivity, or future spend.

Ask each supplier to specify the practical support available at each stage:

### Support needed at launch (new/small business)
- Low-friction onboarding, free account access where possible, and no unnecessary joining fee, deposit, MOQ, or monthly commitment.
- A responsive contact for product sourcing, quotations, stock checks, order issues, and escalation.
- Competitive product and destination-specific shipping prices, transparent fees, and current delivery estimates.
- Product/variant information, quality evidence, tracking, dispatch updates, and clear cancellation, return, damaged-item, and refund procedures.
- Support for neutral/white-label fulfillment and HR UNIVERSE-branded packaging, including exact setup costs, MOQ, lead time, and sample options.
- Clear payment timing and any limits that affect a small business's cash flow.

### Support expected as HR UNIVERSE grows
- Better volume-based pricing or tiered discounts when actual order volumes justify them.
- More stable stock allocation, faster processing, expanded destination coverage, and scalable fulfillment capacity.
- Dedicated account management, priority issue resolution, and agreed service-level targets where available.
- Improved custom packaging/branding options, lower packaging unit costs, and coordinated quality control.
- Documented integration/API/feed support and advance notice of material catalog, pricing, shipping, or policy changes.
- A partnership review process to agree realistic milestones based on demonstrated sales and operational performance.

Record each supplier's answers, evidence, conditions, and review date in the supplier profile. Do not assume support exists until confirmed in writing. Compare the support actually offered to new businesses as well as the supplier's ability to scale. Do not promise exclusivity, guaranteed volume, deposits, or long-term commitments without explicit owner approval. A supplier earns preferred-partner status through verified quality, packaging, delivery, communication, fair pricing, and reliable issue resolution over time.

## Source notes
- Printful free plan and pay-on-order cost model: https://help.printful.com/hc/en-us/articles/360014010240-How-much-does-Printful-cost and https://www.printful.com/pricing
- Syncee free browsing vs paid importing: https://help.syncee.com/en/articles/8885830-pricing-and-plans and https://www.syncee.com/pricing/
- Spocket listing: https://apps.shopify.com/spocket
- Candidate discovery background (not a substitute for official terms): https://www.cjdropshipping.com/blogs/supplier-%26-sourcing-guides/Free-Dropshipping-Suppliers

## Supplier approval lifecycle
DISCOVERED -> TERMS_REVIEW -> SAMPLE_OR_ORDER_TEST -> QUALITY_APPROVED -> DESTINATION_APPROVED -> ACTIVE.
Any material failure moves the supplier or SKU to REVIEW / PAUSED. No supplier is automatically trusted based on its brand name or free plan.

For every SKU and destination, record:
- supplier and external product/variant IDs, SKU and product URL;
- source cost, currency, stock evidence and timestamp;
- shipping method, shipping cost, delivery estimate, free-shipping evidence and quote expiry;
- tracking availability, dispatch SLA, cancellation/return/refund terms;
- sample/order test result, packaging, product quality, defect rate and support response;
- payment timing, card/PayPal requirements, cash-flow exposure and any deposit/minimum;
- API/feed terms, rate limits, data rights and credential requirements.

## Provider-neutral integration contract
Keep supplier-specific logic behind adapters. Every adapter should implement the same internal operations:
- authorize / validate credentials;
- discover products and variants;
- fetch product detail and media metadata;
- refresh stock;
- quote shipping for a destination and variant;
- submit fulfillment only after an approved paid order and owner-defined controls;
- fetch tracking and fulfillment status;
- request cancellation/return/refund and record supplier response.

Normalize results into the existing products, product_variants, supplier_products, inventory and product_prices tables, with external identifiers in supplier_product_sources and destination quote evidence in supplier_shipping_quotes. Do not leak supplier identity, supplier URL, source price, or routing into customer-facing API responses.

## Migration and exit route
- Store supplier IDs and external IDs separately from HR UNIVERSE product IDs.
- Preserve immutable source mapping so one HR UNIVERSE product can have multiple supplier offers.
- Keep customer-facing product/variant IDs stable when changing suppliers.
- On migration, pause new orders for affected SKU, verify replacement stock/variant equivalence, compare landed cost and destination ETA, then switch the active source mapping.
- Keep old source mapping and order snapshots for audit/refund/returns; never rewrite historical order items.
- If one supplier is unavailable, mark only the affected offer/destination unavailable; do not silently substitute a different product or price.
- Supplier-specific API clients must be isolated modules. Adding/removing a supplier must not require rewriting catalog, pricing, checkout, or customer order history.

## Launch gates
No supplier is ACTIVE for a destination until at least one test order or sufficiently strong documented verification confirms actual delivery performance, tracking, packaging and support. No checkout for a country until payment settlement, inventory reservation, shipping/tax/returns and customer support are also verified. No paid subscription, sample purchase, deposit, or supplier commitment without owner approval.
