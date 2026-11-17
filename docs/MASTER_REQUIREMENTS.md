HR UNIVERSE

MASTER REQUIREMENTS & BUSINESS OPERATING SYSTEM

Document Version: 1.0
Project: HR UNIVERSE International E-commerce Marketplace
Repository: hruniverse485-cpu/hr-universe-bd
Development Branch: feature/global-hybrid-rebuild
Document Status: Master Requirements — Initial Baseline

---

1. PROJECT VISION

HR UNIVERSE will be a premium, international, AI-powered e-commerce marketplace operated from Bangladesh.

The platform must combine:

- International online shopping.
- Multi-country product sourcing.
- Multiple suppliers and fulfillment partners.
- Local warehouse and cross-border fulfillment.
- AI-powered customer shopping assistance.
- AI sourcing and supplier research.
- Automated business operations.
- Central AI Command Center.
- Owner-controlled financial operations.
- Secure and scalable technical infrastructure.

The platform must be designed for long-term international expansion, not limited to Bangladesh.

Core principle: One connected business operating system, with separate permissions for customers, AI systems, administrators, and the owner.

2. CORE DESIGN REQUIREMENTS

- Premium, clean, professional international marketplace design.
- Mobile-first, responsive and fast.
- Hybrid shopping experience combining advanced marketplace functionality with a premium brand identity.
- Public header should show HR UNIVERSE without unnecessary promotional banners.
- Optional subtle tagline: "Discover More. Shop Better."
- Do not display Bangladesh-launch messaging.
- Use real product and category images, not emoji placeholders.
- Keep customer-facing experience simple and trustworthy.
- Hide internal supplier identities, sourcing costs, warehouse routing and internal operational details except where legal disclosure is required.

3. CUSTOMER STOREFRONT

Required features:

- Homepage and product discovery.
- Product categories and subcategories.
- Advanced search, filters and sorting.
- Product images and galleries.
- Product descriptions and specifications.
- Product variants.
- Verified stock and availability.
- Customer reviews and ratings.
- Wishlist.
- Shopping cart.
- Secure checkout.
- Customer accounts.
- Order history.
- Order tracking.
- Coupons and promotions.
- Returns and refund request workflow.
- Customer support.
- Product request system.
- Mobile-friendly navigation.

Product information and prices must come from trusted backend records, not unverified browser input.

4. AI SHOPPING ASSISTANT

Build a complete customer-facing AI Shopping Experience, not merely a basic chatbot.

4.1 Natural-language conversation

- Customers can describe what they need in ordinary language.
- AI understands intended use, preferences, budget and requirements.
- AI asks relevant clarification questions.
- Customers can ask product-related questions.
- Customers can refine their searches conversationally.

4.2 Voice shopping

- Voice input for product discovery and questions.
- Text input must remain available.
- Support available languages where technically and commercially feasible.
- Provide accessible controls and clear permission handling.

4.3 Product discovery

- Search the live product database.
- Recommend relevant products.
- Display product images, prices, specifications and product links.
- Check destination-specific availability.
- Show verified delivery estimates and shipping costs.
- Recommend alternatives when appropriate.
- Never invent products, specifications, stock or delivery promises.

4.4 Product comparison

- Compare price, specifications, features and suitability.
- Explain differences in understandable language.
- Use only verified product information.
- Identify missing or unverified specifications.

4.5 Image-based search

- Allow customers to upload a product image.
- Find visually similar or matching catalog products where technically feasible.
- Clearly distinguish exact matches from similar products.
- Respect image privacy and retention policies.

4.6 Product requests

- If a requested product is unavailable, offer a product sourcing request.
- Create a unique request ID.
- Record the customer's requirements and destination.
- Send the request to the AI Sourcing Workflow.
- Provide status updates with customer consent.
- Offer alternatives when sourcing is not feasible.

4.7 Shopping conversion

- Allow customers to open product details.
- Add selected products to cart.
- Continue to checkout.
- Preserve relevant conversation context where appropriate and with privacy safeguards.

Customer conversations must remain private and separated from other customers' records.

5. AI SOURCING TEAM

The AI Sourcing Team must be integrated with the complete HR UNIVERSE operating system.

It must work with:

- Customer AI Shopping Assistant.
- Product database.
- Supplier database.
- Market research.
- Warehouse and fulfillment.
- Shipping and logistics.
- Cost and margin calculation.
- Compliance research.
- Owner AI Command Center.

5.1 Sourcing workflow

When a product is missing from the catalog:

1. Understand the customer's product requirements.
2. Search internal catalog and approved external sources.
3. Identify possible suppliers and origin countries.
4. Compare available suppliers.
5. Check product specifications and quality evidence.
6. Check minimum order quantity and unit cost.
7. Check shipping options and delivery lead time.
8. Evaluate destination-country import requirements.
9. Estimate duties, taxes and other landed costs.
10. Compare local warehouse and direct cross-border fulfillment.
11. Calculate potential selling price and profit margin.
12. Evaluate supplier reliability and operational risk.
13. Prepare a sourcing recommendation.
14. Escalate material decisions for owner approval.
15. Update the customer with verified information.

5.2 Supplier research

Maintain supplier records containing, where available:

- Supplier identity and contact information.
- Country and location.
- Product categories.
- Product specifications.
- Quoted prices and currency.
- MOQ.
- Shipping terms.
- Production and processing time.
- Quality documentation.
- Sample availability.
- Return and warranty terms.
- Fulfillment capabilities.
- Reliability and performance history.

5.3 External sourcing

Use approved supplier APIs, authorized integrations, supplier catalogs and permitted public sources.

Do not bypass website restrictions, access controls or supplier terms.

If reliable live data or supplier confirmation is unavailable, mark the result as pending or unverified.

5.4 Customer retention

- Do not lose product requests between departments.
- Provide request tracking.
- Offer suitable alternatives.
- Provide sourcing progress updates with consent.
- Explain when a product cannot be sourced.
- Do not pressure or mislead customers.

6. MULTI-COUNTRY MARKETPLACE

Country activation must be controlled through the Admin Panel.

A country may become active only after verifying:

- Legal and business feasibility.
- Payment acceptance and settlement.
- Product availability.
- Supplier and fulfillment coverage.
- Shipping costs and delivery capability.
- Tax and customs requirements.
- Returns and customer support.
- Operational and financial feasibility.

Country-specific capabilities:

- Currency.
- Product availability.
- Pricing.
- Taxes.
- Shipping.
- Delivery estimates.
- Payment methods.
- Checkout eligibility.
- Customer support.

Do not allow checkout in unsupported markets.

Do not display products as deliverable when the destination cannot be served.

7. TWO FULFILLMENT MODES

Local warehouse fulfillment

- Verified local stock.
- Local shipping options.
- Accurate delivery estimates.
- Warehouse capability and stock monitoring.

Global/cross-border fulfillment

- Wider supplier catalog.
- Clearly disclosed longer delivery time.
- Shipping cost shown before checkout.
- Import duties and taxes handled transparently.
- No false local-stock or fast-delivery claims.

The customer must see the applicable fulfillment method, expected delivery time and total cost before placing an order.

8. PRODUCT, PRICING AND INVENTORY MANAGEMENT

- Central product database.
- Categories and subcategories.
- Product variants and SKU management.
- Supplier mapping.
- Warehouse mapping.
- Stock synchronization where supported.
- Product quality and compliance records.
- Product visibility by country.
- Currency-aware pricing.
- Landed-cost calculation.
- Shipping and tax calculation.
- Margin and competitive pricing analysis.
- Price change history.
- Low-stock and unavailable-product alerts.

Never trust client-submitted prices as the authoritative selling price.

The backend must verify product identity, availability, price, quantity and destination eligibility.

9. SUPPLIER AND 3PL MANAGEMENT

- Multiple supplier support.
- Multiple warehouse support.
- Supplier performance scorecards.
- Fulfillment status tracking.
- Shipment and tracking integration.
- Supplier communication records.
- Order routing based on approved rules.
- Quality monitoring.
- Return and damage tracking.
- Supplier dispute records.

Where feasible, support HR UNIVERSE branded packaging or neutral packaging with branded inserts.

Packaging rules should consider:

- SKU and variant.
- Dimensions and weight.
- Fragility.
- Destination.
- Warehouse capability.
- Packaging stock.
- Cost.
- Damage history.

Do not promise branded packaging unless the supplier or warehouse can confirm it.

10. ORDER MANAGEMENT

- Cart and checkout validation.
- Server-side price verification.
- Order creation and unique IDs.
- Customer and order records.
- Payment status tracking.
- Supplier assignment.
- Warehouse assignment.
- Fulfillment monitoring.
- Shipment tracking.
- Delivery confirmation.
- Cancellation workflow.
- Return and refund workflow.
- Failed and delayed order alerts.
- Customer notifications.

Order status must accurately reflect actual fulfillment and payment events.

11. AI COMMAND CENTER

Build a central AI operations console for the owner.

The owner should be able to type or speak commands such as:

- Show today's orders.
- Show today's sales and profit.
- Find delayed orders.
- Find products with low stock.
- Research a product in the USA.
- Compare suppliers.
- Calculate landed cost.
- Prepare a product listing.
- Show customer product requests.
- Diagnose a website issue.
- Prepare a supplier communication.
- Generate a weekly business report.
- Show unresolved business risks.

11.1 AI operational responsibilities

AI should:

- Monitor authorized business data.
- Identify anomalies and operational problems.
- Explain the cause where evidence is available.
- Identify affected records.
- Recommend solutions.
- Execute authorized routine actions.
- Escalate actions requiring approval.
- Verify the outcome.
- Record the result in an audit trail.

AI must never claim that an action succeeded without verifying it.

12. AUTOMATION

Automate routine work where technically supported and authorized:

- Product research.
- Supplier comparisons.
- Product listing preparation.
- Catalog updates.
- Inventory monitoring.
- Order monitoring.
- Fulfillment monitoring.
- Shipping alerts.
- Customer support drafts and routine responses.
- Product request handling.
- Reports.
- Operational reminders.
- Error detection.
- System health monitoring.

Automation must include:

- Permissions.
- Failure handling.
- Retry limits.
- Duplicate prevention.
- Audit records.
- Notifications.
- Human escalation.

13. FINANCIAL CONTROL — OWNER ONLY

The following activities remain under the owner's direct control:

- Payment account authorization.
- Payment receiving account changes.
- Bank account changes.
- Withdrawal.
- Money transfers.
- Payout destination changes.
- Sensitive payment authorization.
- Supplier purchases and financial commitments.
- Material refunds.
- Other significant financial approvals.

AI may:

- Monitor payment status.
- Reconcile business records.
- Calculate costs and margins.
- Prepare financial reports.
- Prepare payment-related documents.
- Identify discrepancies.
- Recommend actions.

AI must not independently withdraw, transfer or authorize money.

14. ADMIN PANEL AND ACCESS CONTROL

Provide a secure Admin Panel for:

- Products and categories.
- Countries and market activation.
- Pricing and margins.
- Suppliers and warehouses.
- Shipping and fulfillment.
- Orders and customer support.
- Product requests.
- Promotions.
- Policies and documents.
- AI permissions.
- Automation settings.
- Staff roles.
- Reports and audit logs.

Access must follow role-based permissions.

The owner must have final authority over critical business settings.

15. SECURITY AND PRIVACY

Required controls:

- Secure owner authentication.
- Multi-factor authentication where supported.
- Role-based access control.
- Secure secret management.
- API authorization.
- Input validation.
- Rate limiting.
- Abuse prevention.
- Customer data privacy.
- Secure file handling.
- Audit logs.
- Database backups.
- Recovery and rollback.
- Staging and production separation.
- Dependency and vulnerability review.

Never expose supplier credentials, API secrets, customer private data or internal financial records to unauthorized users.

16. DATABASE AND BACKEND ARCHITECTURE

The backend and database must support the full business lifecycle.

Required logical data domains include:

- Products.
- Categories.
- Product variants and SKUs.
- Countries and currencies.
- Customers.
- Customer conversations.
- Product requests.
- Suppliers.
- Supplier products and quotations.
- Warehouses.
- Inventory.
- Shipping and tracking.
- Orders and order items.
- Payment records and statuses.
- Returns and refunds.
- Admin users and permissions.
- AI commands and tasks.
- Automation jobs.
- Reports.
- Notifications.
- Audit logs.
- System errors and monitoring.

Database migrations must be versioned, tested and reversible where feasible.

Do not destroy existing order records or business data during migration.

17. CUSTOMER TRUST AND BUSINESS POLICIES

Prepare clear and legally reviewed policies covering:

- Terms and conditions.
- Privacy.
- Shipping.
- Returns and refunds.
- Cancellation.
- Customer support.
- Product descriptions.
- Payment methods.
- Country-specific disclosures.

Do not publish unsupported product claims or misleading discounts.

Do not hide disclosures legally required in the destination market.

18. TESTING AND QUALITY ASSURANCE

Before production launch, test:

- Mobile and desktop storefront.
- Search and filters.
- AI product discovery.
- Voice input.
- Image search where implemented.
- Product comparison.
- Product requests.
- Server-side pricing.
- Stock and availability.
- Country eligibility.
- Shipping and tax calculations.
- Cart and checkout.
- Order creation.
- Supplier routing.
- Fulfillment and tracking.
- Customer privacy.
- Admin permissions.
- Owner financial restrictions.
- Backup and recovery.
- Error handling.
- Performance and security.

Use staging and test data before production.

Do not claim a feature is complete until its acceptance tests pass.

19. IMPLEMENTATION PHASES

Phase 0 — Project safety and requirements

- Preserve existing backup branch.
- Preserve main branch.
- Work only on the development branch.
- Maintain the master requirements document.
- Audit existing files and current functionality.

Phase 1 — Foundation

- Backend architecture.
- Database schema and migrations.
- Authentication and permissions.
- Secure configuration.
- Logging and error handling.

Phase 2 — Marketplace

- Premium storefront.
- Categories and product catalog.
- Search, filters and product details.
- Cart and checkout foundation.

Phase 3 — Global operations

- Countries and currencies.
- Supplier and warehouse management.
- Shipping and fulfillment.
- Landed-cost and pricing engine.

Phase 4 — AI experiences

- Customer AI Shopping Assistant.
- Voice and image-based discovery.
- Product comparison.
- Product request and sourcing workflows.

Phase 5 — AI business operations

- AI Command Center.
- Supplier research.
- Automation.
- Monitoring.
- Reports and diagnostics.

Phase 6 — Payments and launch readiness

- Verify eligible payment providers.
- Configure payment integrations.
- Keep financial authorization under owner control.
- Test country-specific checkout.
- Complete compliance and operational checks.

Phase 7 — Production launch and maintenance

- Controlled market activation.
- Monitoring.
- Backups.
- Incident response.
- Continuous testing and improvement.

20. PROJECT WORK RULES

1. Review existing requirements and previous decisions before each major implementation.
2. Do not discard previously agreed features without explicit owner approval.
3. Do not replace existing files without reviewing their current contents and preserving a backup.
4. Provide complete replacement files rather than partial code edits whenever practical.
5. Do not ask the owner to repeat information already available.
6. Avoid unnecessary screenshots and repeated instructions.
7. Give simple, phone-friendly, one-step-at-a-time instructions.
8. Record completed, pending, blocked and unverified tasks.
9. Record errors, root causes, fixes and verification results.
10. Consider future compatibility, security, scalability and operational cost.
11. Do not deploy untested changes.
12. Do not claim successful deployment or functionality without evidence.
13. Keep a continuation checkpoint at the end of each work session.
14. Preserve customer, order and business data.
15. Obtain owner approval for sensitive or material actions.

21. COMPLETION CRITERIA

HR UNIVERSE is not considered fully complete merely because a homepage is visible.

Each feature must have:

- Defined requirements.
- Implemented functionality.
- Backend and database support where needed.
- Security and permission checks.
- Error handling.
- Relevant automated or manual tests.
- Verified results.
- Documentation.

A country is not launch-ready until payment, fulfillment, compliance, customer support and operational feasibility are verified.

A product is not order-ready until price, availability, destination eligibility and fulfillment are verified.

A sourcing request is not complete until its outcome is recorded and communicated appropriately.

22. PROJECT CONTINUITY CHECKPOINT

Maintain a separate project progress record with:

- Current branch.
- Current commit.
- Files reviewed.
- Files changed.
- Database migration status.
- Features implemented.
- Features tested.
- Features not tested.
- Known issues.
- Blockers.
- Security concerns.
- Decisions made.
- Next exact action.

At every stopping point, record where work must resume next time.

---

FINAL PROJECT PRINCIPLE

HR UNIVERSE must operate as one connected, secure, intelligent international business platform.

AI should handle as much routine research, customer assistance, sourcing, monitoring, reporting and operational work as safely possible.

The owner retains direct control over money, banking, payment authorization, major commitments, legal declarations and critical business decisions.

Accuracy, customer trust, security, verified information, continuity and long-term reliability take priority over rushing to launch.
