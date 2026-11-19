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
- Each successful change creates an `order_delivery_events` audit record. Updates use an optimistic status check to reject stale concurrent edits.
- The API initializes COD due from the server-calculated `total_minor` when available. It never changes `cod_collected_minor`, never records a courier payout, and never books a courier or sends customer notifications.
- Only an authorized operator can use the API. The owner token must be supplied at request time and must not be stored in browser local/session storage.
- The endpoint is not a substitute for the pending operator dashboard, real courier integration, verified rate cards, proof-of-delivery checks or COD settlement ledger.

## Current implementation boundary
The manual delivery API is code on `feature/global-hybrid-rebuild` only. Migration 0010 remains unapplied to production, so the endpoint is not production-operational. Courier names, tracking references and status values entered by an operator remain manual records, not independently verified courier events.
