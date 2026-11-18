# HR UNIVERSE — Technology, Cost & Automation Register

Last reviewed: 2026-11-18
Repository: `hruniverse485-cpu/hr-universe-bd`
Branch: `feature/global-hybrid-rebuild`

## Operating policy

1. Minimize recurring cost; prefer free tiers, open-source, and self-hosting where practical.
2. Never describe a free tier as unlimited. Record quota type, reset period, overage behavior, and upgrade trigger.
3. Separate always-on website infrastructure from usage-metered AI, messaging, payment, and supplier services.
4. Keep provider integrations behind replaceable adapters so a provider can be changed without rebuilding the marketplace.
5. No paid subscription, production deployment, live payment activation, destructive migration, refund execution, or material supplier commitment without owner approval.
6. Do not put API keys, customer secrets, or sensitive personal data in browser code, public logs, or unredacted AI prompts.

## Approved product direction

The owner approved the premium marketplace/catalog references shown in the conversation:
- Original editorial lifestyle campaign hero.
- Marketplace homepage with category navigation, promotional campaign areas, service/trust strip, and product discovery sections.
- Image-led product catalog/listing cards and filters.
- Responsive mobile shopping experience.
These are design references, not permission to copy another brand's exact site or assets.

## Planned service architecture

| Layer | Preferred approach | Cost/limit control |
|---|---|---|
| Storefront | Static, responsive frontend served through edge/CDN | Cache assets; avoid unnecessary server calls |
| Backend/API | Existing Cloudflare Worker foundation | Monitor request and CPU quotas; graceful rate-limit handling |
| Database | Existing Cloudflare D1 foundation | Index queries, paginate, monitor reads/writes/storage, scheduled backups/export |
| Media | Evaluate Cloudflare R2 or equivalent | Image resizing/compression, deduplication, lifecycle policies |
| Source control/CI | Existing GitHub repository and Actions | Keep CI focused; monitor included Actions minutes for private/public repo plan |
| AI | Provider adapter, disabled until budget and credentials approved | Route only tasks needing AI; cache answers; use rules/templates for FAQs |
| Voice | Browser speech capabilities where supported; fallback text controls | Feature detection, permission checks, no paid speech API by default |
| Email/SMS | Provider adapter | Email first; SMS only where operationally necessary and budgeted |
| Payments | Country-specific eligible provider adapter | Activate only after legal/KYC/settlement verification |
| Supplier/3PL | Per-supplier adapter | Verify API terms, stock freshness, fees, delivery and returns before activation |

Provider quotas and prices change. Before enabling any provider, record its current official pricing/limits and the exact account plan; do not hard-code assumed quotas in application logic.

## Customer support and issue resolution

Required workflow:
1. Customer or owner submits a report by form, comment, or authenticated voice command.
2. Create a ticket with category, severity, timestamp, affected page/order reference, consented contact method, and status.
3. Capture privacy-safe diagnostics (request ID, sanitized error code, app version, route, timestamp); exclude passwords, payment credentials, API keys, and unnecessary personal data.
4. Correlate ticket with available frontend, Worker, database, and integration logs.
5. AI may summarize evidence and suggest likely root cause; deterministic checks and human review remain available.
6. A code fix is made on the feature branch, with regression tests and review.
7. Deploy only after required owner approval; verify the fix and notify the reporter.
8. Maintain immutable/auditable status and action history, including unresolved/needs-owner/needs-provider states.

Automation must not autonomously issue refunds, change payment details, delete production data, alter permissions, or deploy risky changes.

## Voice-control safety

- Voice is an input method, not an authentication factor.
- Require an authenticated owner session and explicit confirmation for sensitive actions.
- Read back the intended action before execution.
- Provide a visible text alternative and a way to cancel.
- Keep an audit event for each accepted command.

## Cost register fields

For every provider/service record:
- Service and purpose
- Account owner and recovery method (never store passwords in this document)
- Plan and billing status
- Free quota and reset period
- Usage and overage behavior
- Recurring and variable price
- Security/privacy/data-retention terms
- Alternative provider or self-hosted option
- Upgrade trigger and owner approval date
- Last verified date and official pricing/limits URL

## Current verified implementation status

- Existing Worker, D1 schema/migrations, GitHub Actions validation, and 11 lightweight Worker API boundary tests are present on the feature branch.
- Current backend order path is Bangladesh/BDT/COD only.
- The current storefront is still a demo/legacy storefront; catalog is not yet fully API-backed.
- Admin authentication, customer accounts, international payment, supplier/warehouse integrations, complete refund automation, AI, voice control, and automated issue remediation are not production-ready.
- No production deployment or live D1 migration has been verified.

## Next build sequence

1. Strengthen Worker correctness/security and add D1-backed order, pricing, shipping, stock-reservation, and idempotency tests.
2. Implement the approved responsive marketplace using API-backed catalog data; remove demo fallback behavior.
3. Implement authenticated owner/admin controls and customer account workflows.
4. Build ticketing/feedback plus privacy-safe diagnostics and auditable issue lifecycle.
5. Add monitoring, backups, quota/cost register and alerting.
6. Add provider adapters for payments, suppliers, shipping, email, and AI only after eligibility/cost review.
7. Add bounded AI remediation and voice control with owner confirmation.
8. Complete browser end-to-end, security, privacy, performance, backup/restore, and launch acceptance tests.

## Branch and approval rules

All development stays on `feature/global-hybrid-rebuild`. Keep `main` unchanged until the owner explicitly approves merge. Never claim a feature is complete without implementation and verification evidence.
