# HR UNIVERSE — Bangladesh COD Delivery Operations

## Scope
This workflow is for Bangladesh BDT Cash on Delivery orders only. Payment-gateway onboarding and international checkout are deliberately out of scope for this phase.

## Order lifecycle
1. Customer places a Bangladesh COD order.
2. The server calculates product prices and configured local shipping charges; it does not trust totals sent by the browser.
3. Verified Bangladesh warehouse stock is reserved atomically with order creation.
4. Owner/admin confirms the order and prepares the parcel.
5. Courier name/service, consignment ID and tracking URL are recorded.
6. Delivery status is updated as the parcel moves through dispatch, transit and out-for-delivery.
7. On confirmed delivery, COD collection is reconciled against the order's authoritative BDT total.
8. Failed delivery/return is recorded. Stock release/restock must follow an explicit inspected-return workflow; it must not happen merely because a courier status says returned.

## Delivery data
Migration 0010 adds delivery status, courier and consignment fields, COD amount/collection fields, and an append-only delivery event history. Existing order records and core order statuses are preserved.

## Courier integration boundary
The first release is courier-agnostic: an authorized operator can record a shipment and its tracking details from the courier's portal. Do not claim live courier booking, automatic tracking webhooks, pickup requests, or COD remittance reconciliation until a specific courier is selected, its official API is reviewed, credentials are approved, and integration tests pass.

## COD accounting controls
- COD due is based on the server-calculated order total in minor currency units.
- Collection must be reconciled to the exact outstanding amount; never mark an order financially settled based only on a text status.
- Courier COD payout, courier fee, delivery fee and customer refund are separate accounting entries in the eventual ledger.
- Never store courier secrets or merchant credentials in browser code or Git.
- A returned parcel is not automatically saleable stock. Inspect it and record the actual stock movement separately.

## Rollout
Migration 0010 is additive and belongs to the isolated `feature/global-hybrid-rebuild` branch. It is not applied to production. Do not deploy or migrate production without the owner's explicit approval.


## Owner-only manual delivery API (Feature branch)
- `GET /api/admin/orders/delivery` lists at most 100 Bangladesh BDT COD orders. It requires the owner bearer token and excludes orders without explicit BD/BDT classification.
- `PATCH /api/admin/orders/delivery` records courier name/service, consignment ID, HTTPS tracking URL, internal delivery notes and an allowed delivery-status transition.
- Status transitions are constrained: NOT_DISPATCHED → READY_TO_SHIP → SHIPPED → IN_TRANSIT → OUT_FOR_DELIVERY → DELIVERED, with explicit failure/return branches. A courier must be assigned before SHIPPED.
- Each successful change and its `order_delivery_events` audit record are written in one transactional D1 batch. The event insert is conditional on the exact unique update marker, so stale edits cannot create orphan audit events; a batch failure rolls back both changes. Updates use an optimistic status check to reject stale concurrent edits.
- The API initializes COD due from the server-calculated `total_minor` when available. It never changes `cod_collected_minor`, never records a courier payout, and never books a courier or sends customer notifications.
- Only an authorized operator can use the API. The owner token must be supplied at request time and must not be stored in browser local/session storage.
- The endpoint is not a substitute for the pending operator dashboard, real courier integration, verified rate cards, proof-of-delivery checks or COD settlement ledger.

## Current implementation boundary
The manual delivery API is code on `feature/global-hybrid-rebuild` only. Migration 0010 remains unapplied to production, so the endpoint is not production-operational. Courier names, tracking references and status values entered by an operator remain manual records, not independently verified courier events.

## COD financial evidence ledger (Feature branch; migration 0012)
- `GET/POST/PATCH /api/admin/orders/cod-ledger` is owner-token protected and records BDT COD financial events separately: customer COD collected, courier settlement received, courier fee, return fee, customer refund and adjustment entries.
- New entries are forced to `PENDING_REVIEW` and require an evidence reference. A separate owner review can mark an entry `VERIFIED` or `DISPUTED`; review is an internal evidence decision, not a bank confirmation.
- The same evidence reference cannot be reused for the same order and financial event type. Customer-collection and courier-settlement caps are enforced in the database write itself; disputed entries remain included in conservative amount caps, while only verified customer collections support courier settlement records. Customer refunds are also capped by verified COD collections, with prior refund entries counted conservatively. Courier settlement can only be recorded up to the total of VERIFIED customer-collection entries; collection and settlement caps are enforced inside the insert statement to resist concurrent over-recording. Disputed entries do not count toward the cap.
- Customer COD collection cannot be recorded before the order is manually marked `DELIVERED`. Courier settlement remains a separate ledger entry and is never inferred from delivery or collection.
- Ledger entries are append-only in the operator workflow. Corrections should be recorded as separately evidenced adjustment entries; do not edit or delete prior financial history.
- These records do not move funds, update the order's collected amount, mark an order financially settled, or initiate a refund.

## Returned parcel inspection (Feature branch; migration 0012)
- `GET/POST /api/admin/orders/returns` records physical parcel condition and disposition for returned Bangladesh BDT COD orders.
- A damaged, incomplete, wrong or missing parcel cannot be marked as a restock candidate.
- `RESTOCK_CANDIDATE` is only an inspection outcome. No inventory is changed by this endpoint. A separately authorized stock movement and quantity check are required before any item is saleable again.
- Cumulative inspected quantity is enforced inside the insert statement to prevent simultaneous inspection requests from exceeding the order quantity.
- Migration 0012 is additive and is not applied to production.
