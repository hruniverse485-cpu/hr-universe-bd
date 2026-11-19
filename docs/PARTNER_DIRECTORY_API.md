# Partner Directory API — Owner Operations

All routes below are private owner APIs. Every request requires:

`Authorization: Bearer <HR_ADMIN_API_TOKEN>`

The token must be configured as a server-side Worker secret. Do not put it in storefront code, Git, browser storage, logs, or documents.

## Courier directory

### `GET /api/admin/partners/couriers`
Lists up to 200 courier candidates, ordered with active/onboarding partners first.

### `POST /api/admin/partners/couriers`
Creates a research record. Required JSON fields: `partner_code`, `partner_name`; optional: `website_url`, `internal_notes`.

The server forces `onboarding_status=RESEARCH`, `api_status=NOT_ASSESSED`, all capability flags false, and `contract_status=NONE`. Caller-supplied activation or connection fields are ignored.

## Partner contacts

### `GET /api/admin/partners/contacts?partner_type=COURIER&partner_id=<id>`
Lists contact records. Both filters are optional; `partner_type` must be `COURIER` or `SUPPLIER`.

### `POST /api/admin/partners/contacts`
Required: `partner_type`, `partner_id`, and at least one of `contact_name`, `email`, or `phone`. Optional: `role_title`, `email`, `phone`, `preferred_channel` (`EMAIL`, `PHONE`, `WHATSAPP`, `OTHER`), `notes`.

The API checks that the referenced courier/supplier exists. New contacts are always `UNVERIFIED` and non-primary, regardless of caller-supplied flags. Independently verify identity and contact channel before relying on the details.

## Interaction log and follow-ups

### `GET /api/admin/partners/interactions?partner_type=COURIER&partner_id=<id>&limit=50`
Lists internal interaction history. Limit is capped at 100.

### `POST /api/admin/partners/interactions`
Required: `partner_type`, `partner_id`, `interaction_type`, `summary`. Supported types: `RESEARCH`, `EMAIL`, `PHONE`, `WHATSAPP`, `MEETING`, `QUOTE_RECEIVED`, `CONTRACT`, `SUPPORT_CASE`, `FOLLOW_UP`, `OTHER`. Optional: `subject`, `outcome`, `follow_up_at` (ISO date/datetime), `evidence_reference`.

The API validates the partner exists and stores the entry as `direction=INTERNAL` and `approval_status=INTERNAL_NOTE`. It does not send email, WhatsApp, SMS, or place calls. An interaction type of `EMAIL` is only a record label, not an outbound action.

## Not implemented / not authorized

- Contact verification workflow and outbound messaging.
- Courier rate-card create/verify endpoints and automated courier selection.
- Courier booking, tracking webhooks, cancellation, and COD payout reconciliation.
- Supplier local quote management and supplier API integrations.

Those capabilities require separate implementation, test coverage, verified evidence and, for external actions, explicit owner approval. Migration 0011 remains unapplied to production; no partner is contracted or connected by these endpoints.
