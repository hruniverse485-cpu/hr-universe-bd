# Bangladesh Partner Network — Schema and Operating Controls

This document accompanies migration 0011. It describes database foundations only; it does not mean courier or supplier accounts have been onboarded.

## Tables added
- `courier_partners`: owner-managed courier directory, onboarding/API/contract state and relationship follow-up.
- `partner_contacts`: contacts for either a courier or supplier, with explicit verification state.
- `courier_service_areas`: district/area service coverage with evidence and verification dates.
- `courier_rate_cards`: zone/weight/service-based BDT fees, COD/return/remote surcharges, ETA and quote validity.
- `partner_interactions`: relationship history, contact drafts/sent records, notes and follow-up dates.
- `supplier_local_profiles`: Bangladesh supplier classification, verification, pickup/direct-ship and packaging capabilities, sample/quality scores.
- `supplier_local_quotes`: product/variant-level price, stock, MOQ, lead time, validity and evidence.
- `partner_ai_recommendations`: explainable AI recommendation queue with human review status.

## Important safeguards
1. New courier partners default to `RESEARCH`; API defaults to `NOT_ASSESSED`; contracts default to `NONE`.
2. Contacts and rate cards default to unverified. A rate must not be used for automatic routing until verified and within its effective period.
3. Service-area rows default inactive. A district is not serviceable merely because a partner name is in the directory.
4. Supplier profiles default unverified and sample status defaults `NOT_REQUESTED`.
5. AI recommendations default to `PENDING_REVIEW`. The schema does not authorize sending messages, booking shipments, buying stock, or accepting a contract.
6. Partner credentials must remain in server-side secret storage; this schema intentionally has no credential-value fields.
7. Polymorphic partner references in contact/interaction tables are validated by application logic because they may refer to either the courier directory or existing supplier directory.
8. Evidence references should point to an owner-approved document/file reference, not contain passwords, tokens or unnecessary customer personal data.

## First onboarding checklist
For each courier:
- Confirm official business identity and official contact channel.
- Request current merchant rate card, service-area list, pickup cutoffs, COD fee, return fee, settlement timing, claims process and API documentation.
- Verify each commercial term against a dated document.
- Add a contact and interaction log; mark contact verified only after independent confirmation.
- Add coverage and rates as unverified first; an owner reviews evidence before activating them.
- Run test shipments before changing onboarding to `ACTIVE`.
- Mark API `CONNECTED` only after authorized credentials, health check, booking, tracking, cancellation/exception and COD reconciliation tests pass.

For each local supplier:
- Verify business identity, address and responsible contact.
- Request SKU/variant stock, BDT price, MOQ, lead time, invoice, sample, defect/return terms and packaging details.
- Physically inspect sample/product before approving quality-sensitive listings.
- Confirm whether direct-to-customer blind shipping is actually supported.
- Verify stock with timestamp and expire old quotes.
- Approve only specific SKUs/variants and routes; do not assume all supplier products are safe to list.

## Automation boundary
The future AI layer may research public information, draft outreach, summarize documents, compare verified rate cards, calculate route options, create follow-up tasks and flag anomalies. Outbound contact, courier booking, purchase orders, deposits, contracts, production deployment and financial commitments remain approval-gated until the owner explicitly configures a safe permission.

## Rollout
Migration 0011 is additive and belongs to `feature/global-hybrid-rebuild`. It has not been applied to production. No partner account has been connected and no partner has been contacted by this migration. Apply only in a controlled development/test database first, add API validation and automated tests, and request explicit approval before production migration/deployment.
