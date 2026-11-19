# HR UNIVERSE — Bangladesh Courier & Local Sourcing Partner Network

## Purpose
Build a centrally controlled Bangladesh operations network so HR UNIVERSE can source eligible products locally, hand confirmed parcels to the best available delivery partner, monitor delivery/COD, and preserve long-term supplier and courier relationships. This is part of HR UNIVERSE only; it is not related to any other business.

## Operating principles
- Owner-controlled: the owner controls partner approval, commercial terms, credentials, service areas, pricing rules, and activation.
- Multi-partner: never hard-code one courier or supplier as the only route.
- Fast but honest: choose the fastest eligible service only when its current coverage, pickup capacity, price, and ETA are verified.
- No invented integration: a partner is not API-connected until credentials are authorized, a connection test passes, and booking/status tests pass.
- No automatic commercial commitment: AI may research, compare, draft, remind, and recommend. It must not sign agreements, accept rate changes, place supplier purchase orders, pay deposits, or promise exclusivity without owner approval.
- Protect customer data: send only the delivery fields required by the selected courier; never expose supplier costs, sourcing routes, or partner negotiations to customers.
- COD reconciliation: record order COD due, courier-collected amount, courier fees, payout amount, payout date, and variance separately. A delivery status alone is not proof of settlement.
- Returned parcels require physical inspection before restock.

## Courier partner directory — candidates to verify
Initial candidates:
1. Pathao Courier — investigate express/standard delivery, nationwide coverage, COD, fulfillment, API, pickup and return terms.
2. Steadfast Courier — investigate merchant pickup, COD, API, tracking, return workflow and settlement schedule.
3. REDX — investigate merchant onboarding, API/webhooks, parcel booking, coverage, COD, returns and settlement.
4. Paperfly — investigate doorstep delivery, COD, exchange/partial delivery, returns, warehousing and fulfillment.
5. eCourier — investigate merchant/reseller API, COD, service zones, pickup, tracking and settlement.
Additional candidates to keep configurable: Carrybee, Sundarban Courier, SA Paribahan and other vetted regional providers.

These are research candidates, not contracted or connected partners. All rates, service areas, API capabilities, settlement cycles, claims and pickup commitments must be verified directly with each provider and recorded with evidence and a review date.

## Partner relationship management
Each partner profile should include:
- Legal/business name, service type, official website, verified contact person, role, phone, email and preferred contact channel.
- Relationship owner at HR UNIVERSE; onboarding stage; last contact; next follow-up date; meeting notes and communication history.
- Service areas by district/thana/postcode; pickup cutoff; pickup days; service types; parcel size/weight restrictions; prohibited goods.
- Rate card by zone, weight, COD fee, return fee, exchange/partial-delivery fee, remote-area surcharge, insurance/claim rules and effective dates.
- COD settlement frequency, payout method, reconciliation statement format, dispute window and escalation contacts.
- API capability, documentation URL, sandbox availability, webhook support, credential status (never credential values), last successful health check and integration version.
- Contract status, signed document reference, renewal/expiry date, agreed SLA and owner approval record.
- Scorecard: pickup punctuality, first-attempt delivery, on-time delivery, loss/damage, return rate, COD payout delay, support response and complaint resolution.

## Local supplier network
Create a separate supplier directory for Bangladesh manufacturers, wholesalers, distributors, importers and authorized local stockists. Record:
- Verified company identity, trade references, contact person, factory/warehouse location, product categories and serviceable districts.
- SKU/variant, current stock evidence, minimum order, wholesale price, tax/invoice terms, lead time, packaging, quality documents and sample status.
- Product inspection checklist, photo/video evidence, batch/expiry where relevant, warranty/return terms and defect handling.
- Dispatch readiness, pickup address, supplier dispatch cutoff, direct-to-customer capability, neutral/HR UNIVERSE packaging capability and blind-shipping confirmation.
- Price/stock quote validity and last verification timestamp.
- Supplier scorecard: price competitiveness, stock accuracy, quality, dispatch speed, packaging, cancellation/defect rate and response time.

## Order-to-delivery automation
1. Receive a confirmed Bangladesh COD order and validate customer phone/address, SKU, variant and quantity.
2. Check owner-approved local supplier/warehouse inventory and reserve stock safely.
3. If HR UNIVERSE stock is available, prepare it for dispatch. If supplier-direct fulfillment is approved, request supplier stock confirmation and dispatch readiness first.
4. Generate eligible courier options from destination, parcel dimensions/weight, current rate cards, pickup cutoff, service type, COD support, delivery ETA, return terms and partner health.
5. Rank eligible options using transparent configurable weights: verified ETA/reliability, total delivery cost, COD/return cost, route coverage, pickup availability and recent scorecard. Never rank using stale/unverified rates as if current.
6. AI explains the recommendation and highlights missing data. Owner-approved rules may auto-select a courier only within configured limits; otherwise ask an operator.
7. Book through the official API only after a successful integration test and authorized merchant credentials. Until then, create a manual booking task and record the consignment/tracking details entered by an operator.
8. Store courier response, booking reference, label reference, tracking URL, status events and timestamps. Use idempotency keys to prevent duplicate bookings.
9. Send customer delivery updates without revealing internal supplier or sourcing information.
10. Reconcile delivered COD against order amount and courier statement. Flag shortages, excess collection, missing payout and overdue settlement.
11. On failed/returned shipment, open an exception case. Inspect returned goods and explicitly record any restock, damage, refund or supplier claim.

## AI Command Center capabilities
- Search and shortlist verified local suppliers and courier partners.
- Draft tailored partnership emails/messages, meeting agendas, rate-card requests, onboarding checklists and negotiation comparisons.
- Maintain follow-up reminders and relationship history.
- Extract structured fields from uploaded rate cards, contracts and supplier quotations; require human verification for extracted commercial terms.
- Compare courier options per order and explain the selected option.
- Detect delayed pickups, stalled parcels, failed attempts, customer address issues, COD variances and overdue payouts.
- Draft customer messages and partner escalation messages for owner/operator review.
- Produce daily operations summaries and partner scorecards.
- Never send external messages, change contracts/rates, place purchase orders, book paid services, or make financial commitments without explicit owner-configured permission and approval.

## Admin dashboard sections
1. Partner Directory
2. Courier Connections & API Health
3. Supplier Directory & Product Offers
4. Rate Cards & Service Areas
5. Orders Awaiting Sourcing
6. Orders Awaiting Pickup
7. Live Delivery Board
8. Failed Delivery & Returns
9. COD Collections & Payout Reconciliation
10. Partner Messages & Follow-up Calendar
11. SLA Scorecards & Reports
12. AI Recommendations & Approval Queue
13. Audit Log & Access Controls

## Integration and security requirements
- Keep each courier integration behind a provider adapter so one provider outage does not stop other providers.
- Store credentials only in encrypted server-side secrets; never in browser JavaScript, database plaintext, Git, logs or AI prompts.
- Use least-privilege owner/admin roles and log every sensitive change.
- Verify webhook signatures where supported; deduplicate events and tolerate out-of-order status events.
- Use timeouts, retries with backoff, rate limits, circuit breakers and a manual fallback.
- Do not send an order to multiple couriers unless the first booking is confirmed cancelled or an operator explicitly approves a replacement.
- Separate supplier purchase-order state from courier shipment state.
- Keep customer-facing ETA as an estimate with a last-updated timestamp; never guarantee delivery unless a contracted SLA genuinely supports it.

## Delivery phases
### Phase 1 — foundation
Partner directory, relationship notes, manual rate cards, supplier directory, owner approval queue, manual courier assignment, delivery event history and COD reconciliation controls.

### Phase 2 — first live courier integrations
After owner selects providers and supplies authorized credentials: integrate and test one courier at a time (recommended evaluation order: Pathao, Steadfast, REDX), including sandbox/health checks where available, booking, label/reference, tracking, cancellation, returns and COD statement reconciliation.

### Phase 3 — supplier-direct fulfillment
Onboard vetted local suppliers, verify stock/dispatch promises, test sample orders, confirm neutral/HR UNIVERSE packaging, and enable supplier-direct dispatch only for approved SKUs and routes.

### Phase 4 — AI-assisted routing
Enable partner recommendations, SLA anomaly detection, proactive follow-ups and rule-based auto-selection only after sufficient real delivery data exists. Keep high-risk decisions and commercial commitments behind owner approval.

## Rollout boundary
This specification does not connect any courier account, send a supplier message, sign an agreement, place an order, charge money, apply a production database migration, or deploy production. Those actions require separate authorization and verified integration readiness.
