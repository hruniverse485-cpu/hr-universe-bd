# HR UNIVERSE Product Catalog Scale Policy

**Status:** Approved product and architecture requirement  
**Initial catalog target:** At least 1,000 distinct product listings  
**Long-term capacity:** Expand beyond 1,000 without a fixed business-level ceiling

## 1. Catalog count is not inventory quantity

The 1,000 target means 1,000 distinct product listings (unique products), not 1,000 physical units and not 1,000 units of every SKU.

HR UNIVERSE does not need to purchase, warehouse, or physically hold supplier-fulfilled products. Physical inventory is required only for products HR UNIVERSE actually owns or holds.

Track these concepts separately:

- **Catalog product count:** number of distinct product records/listings.
- **Supplier availability:** supplier-reported quantity/status, source, verification time, and confidence; never treat stale or unverified supplier stock as confirmed.
- **Owned inventory:** physically counted stock held by HR UNIVERSE, including reserved and available quantities, with existing verification/freshness controls.
- **Order quantity:** quantity requested by a customer for a specific product/variant; this is not the catalog count.

## 2. Fulfillment models

1. **Supplier-fulfilled / dropship:** supplier keeps the goods and ships directly to the customer where supported. No HR UNIVERSE warehouse stock is required.
2. **On-demand sourcing:** a requested product may be researched and quoted from suppliers before it becomes an orderable listing. Do not promise availability, final price, or delivery until verified.
3. **HR UNIVERSE-owned inventory:** only products physically acquired/held by HR UNIVERSE use owned-inventory records and stock verification.

Customer-facing pages must not reveal supplier identities, supplier costs, private routing, or internal warehouse/provider details.

## 3. Minimum catalog target and quality gates

The initial business catalog target is **at least 1,000 distinct products**. This is a target for a verified and curated catalog, not permission to publish 1,000 unverified listings.

A product may be published/orderable only when all required market-specific checks pass, including:

- supplier/source identity and operational status verified internally;
- product identity, variant, quality evidence, and product compliance reviewed;
- current supplier availability and stock verification freshness established;
- landed cost, selling price, currency, shipping cost, destination coverage, and delivery estimate calculated;
- fulfillment route and returns/support expectations defined;
- market has a working, approved payment method and checkout is explicitly enabled;
- required customer-facing disclosures are accurate.

Products that fail any gate remain private research records or draft listings. Never invent supplier stock, price, shipping, or delivery promises.

## 4. Scale and performance requirements

The data model must support a catalog that grows beyond 1,000 products. Do not hard-code 200 as the business catalog ceiling. Public catalog delivery should use bounded pagination (or an equivalent scalable retrieval strategy), stable ordering, market eligibility filters, and server-side validation. Do not solve catalog growth by forcing every product into one oversized response or by trusting client-supplied prices/availability.

The current public product endpoint is bounded to a maximum of 50 results per request. That is a response/page-size guard, not a 50-product business limit. The storefront currently requests up to 50 products in one request; scalable browsing/pagination is a separate implementation task.

## 5. Payment and launch restrictions

Catalog research and draft listings can cover international markets, but checkout may be enabled only for markets where HR UNIVERSE has a configured and verified payment route and the necessary fulfillment rules. A supplier warehouse in a country does not by itself authorize checkout in that country.

No supplier message, purchase, sample order, deposit, paid service, payment activation, production migration, or deployment is authorized by this policy.

## 6. Acceptance criteria

- The business target is stated as at least 1,000 distinct products.
- No requirement exists to hold 1,000 products or units physically.
- Supplier stock and HR UNIVERSE-owned stock remain separate data concepts.
- Unverified supplier availability cannot be represented as confirmed.
- Catalog retrieval scales through bounded pagination rather than a giant response.
- Market-specific checkout remains disabled until payment and fulfillment eligibility are verified.
