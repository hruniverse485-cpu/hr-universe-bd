# HR UNIVERSE Automation Pilot Mode — Runbook

## Purpose

Pilot Mode is a controlled owner-operated trial of the Bangladesh courier and local supplier operating system. It is not a public launch, live courier integration, unattended purchasing system, or authorization to contact partners.

## Current implementation

- Private owner-only Partner Operations page: `/admin-partners.html`.
- Courier research candidate directory.
- Read-only view of existing supplier records and local supplier verification profile fields.
- Partner contact records, defaulting to `UNVERIFIED` and non-primary.
- Internal interaction and follow-up log. Records are internal notes; no outbound communication occurs.
- Courier rate-card register. Newly entered rates are forced to `UNVERIFIED`.
- Existing supplier sourcing offer control page remains separate at `/admin-sourcing.html`.
- Worker API authentication uses the server-side `HR_ADMIN_API_TOKEN` secret.

## Pilot safety rules

1. Never place the owner token in storefront JavaScript, browser storage, Git, issue comments, screenshots, logs or AI prompts.
2. Do not mark a courier, supplier contact, rate, service area, API or contract as verified unless evidence has been independently checked.
3. Unverified courier rates must never be used for automated selection or customer delivery promises.
4. Do not send email, WhatsApp, SMS, make calls, sign agreements, create courier bookings, place supplier orders or pay money from this pilot.
5. Do not expose supplier identity, contact details, procurement costs, courier routes or partner notes to customers.
6. COD collected by a courier and courier settlement paid to HR UNIVERSE are separate events. Delivery status alone is not proof of payout.
7. Returned goods require physical inspection before inventory restock.
8. Any production migration, live deployment, customer checkout/payment activation, external integration credentials, spending or commercial commitment requires explicit owner approval.

## Owner workflow during the pilot

1. Review candidate courier and supplier records.
2. Add official partner website and internal research notes.
3. Verify contact identity and channel outside the system; until a verification feature exists, keep records unverified.
4. Record received quotes and attach evidence references (official rate sheet, dated email, signed document or test shipment record).
5. Enter courier rate cards with service area, weight band, COD fee, return fee, remote-area fee and validity dates.
6. Keep all entered rate cards unverified until a dedicated evidence-review and verification control is implemented.
7. Record test shipment results, delivery time, pickup performance, COD remittance and return handling as internal notes.
8. Use the follow-up date log to plan the next owner action.

## Pilot readiness gates still outstanding

- Dedicated review/verification API and UI for partner contacts, service areas and courier rate cards.
- Supplier local profile create/update and local quote capture APIs/UI.
- Courier service-area capture and verification.
- Rate-card validity/evidence checks and courier comparison engine.
- Delivery assignment, tracking-event and exception workflows.
- COD collection versus payout reconciliation and return inspection workflow.
- Admin dashboard integration/navigation and operational role/access review.
- Production D1 backup, migration dry run, rollback plan and explicit owner authorization.
- Live courier API credentials, sandbox access and test booking/tracking/cancel/webhook/COD tests, only after a courier is selected and authorized.

## How to access the private dashboard

After the approved Worker deployment and migration are completed, open `/admin-partners.html` on the HR UNIVERSE domain. The page is noindex and its APIs require the owner token. Do not attempt to use it against production until the owner explicitly approves deployment and migration.

## Current deployment state

This runbook and related code are on `feature/global-hybrid-rebuild`. Migration `0011_bangladesh_partner_network.sql` has not been applied to production. The dashboard and APIs are not confirmed live. No courier or supplier is contracted or API-connected by this work.
