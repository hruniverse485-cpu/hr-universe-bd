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
