HR UNIVERSE — DATABASE ARCHITECTURE

Project: HR UNIVERSE
Repository: hr-universe-bd
Branch: feature/global-hybrid-rebuild
Status: Architecture Baseline — Pending Implementation

1. Purpose

Design a secure, scalable, multi-country database foundation for the HR UNIVERSE international e-commerce marketplace.

The database must support the customer storefront, AI Shopping Assistant, AI Sourcing Team, AI Command Center, suppliers, warehouses, products, inventory, pricing, orders, shipping, payments, customer support, administration, reporting and audit history.

2. Existing Infrastructure

- Cloudflare Workers backend
- Cloudflare D1 database
- Static frontend assets
- Existing D1 database: "hr-universe-orders"
- Existing database ID: "b43d5b0b-e62a-4ca4-9256-a477dd81be10"
- Existing database binding: "DB"

3. Existing Orders Table — Preserve

The existing "orders" table must not be dropped or destructively recreated.

Existing fields:

- id
- product_id
- product_name
- unit_price
- quantity
- total
- payment_method
- customer_name
- customer_phone
- customer_address
- district
- status
- created_at

Preserve existing order records and maintain compatibility during migration.

4. Planned Database Domains

The database architecture should support these domains:

1. Countries and market activation
2. Currencies and exchange-rate records
3. Categories and category images
4. Products and product variants
5. Product images and specifications
6. Suppliers and supplier products
7. Warehouses and fulfillment locations
8. Inventory and stock movements
9. Shipping methods, rates and delivery estimates
10. Landed costs and pricing calculations
11. Customers and customer accounts
12. Shopping carts and wishlists
13. Orders and order items
14. Payments and payment status records
15. Refund requests and approval records
16. Shipments and tracking events
17. Returns and customer claims
18. Coupons and promotions
19. Product reviews and ratings
20. Customer support tickets
21. AI Shopping Assistant conversations
22. AI product sourcing requests
23. Supplier communication records
24. AI tasks, automation jobs and execution logs
25. Admin users, roles and permissions
26. Owner approvals and approval history
27. Audit logs and security events
28. System settings and operational reports

5. Country Activation Rules

Each country must have an independent activation status.

A country cannot become active for customer checkout until the owner-approved operational requirements are verified:

- Legal and compliance readiness
- Supported payment acceptance and settlement
- Available fulfillment method
- Verified shipping costs and delivery estimates
- Customer support and return handling
- Product availability

Inactive countries must not receive an active checkout option.

6. Product and Inventory Rules

- A product may have multiple variants.
- A product may be available from multiple suppliers.
- Inventory must be tracked by warehouse and variant.
- Unverified stock must never be displayed as confirmed stock.
- Supplier cost and internal sourcing details must remain private.
- Customer-facing availability must reflect verified destination eligibility.

7. Fulfillment Rules

Support two fulfillment types:

- LOCAL_WAREHOUSE
- GLOBAL_CROSS_BORDER

Store the fulfillment type, warehouse or supplier reference, shipping method, estimated delivery range and relevant cost records.

Customer-facing delivery promises must be based on verified information.

8. Order Data Rules

Orders should support:

- Customer and destination information
- Product and variant references
- Quantity and verified price snapshots
- Currency
- Shipping and tax breakdown
- Fulfillment type
- Payment status
- Order status
- Shipment and tracking information
- Creation and update timestamps

Order records must preserve the price and product details that applied when the order was placed.

9. Financial Security

AI may:

- Read authorized payment status records
- Reconcile order and payment records
- Calculate costs and margins
- Prepare financial reports
- Prepare approval requests

AI must not independently:

- Withdraw or transfer money
- Change payout destinations
- Change payment credentials
- Authorize sensitive payment actions
- Make material refunds or financial commitments

Owner approval is mandatory for sensitive financial actions.

10. AI Operations Data

Support records for:

- AI tasks and their status
- Sourcing requests
- Supplier comparisons
- Customer product requests
- Automation executions
- Errors and troubleshooting
- Approval requests
- Verification results
- Customer follow-up consent and status

AI must distinguish verified, pending, failed and unverified information.

11. Security and Access

- Separate customer and admin access.
- Apply role-based permissions.
- Protect sensitive customer and business data.
- Store secrets outside database source files.
- Record important administrative and AI actions in audit logs.
- Restrict sensitive financial operations to owner-controlled approval.
- Apply data retention and deletion policies.

12. Migration Requirements

- Use additive database migrations wherever possible.
- Never delete existing orders during migration.
- Do not assume that a new table or column already exists.
- Test every migration before production deployment.
- Maintain a rollback and recovery plan.
- Preserve compatibility with the existing Worker until replacement endpoints are tested.

13. Implementation Sequence

1. Inspect the actual current database schema.
2. Confirm existing order records and compatibility.
3. Design additive migration files.
4. Add country, category, product and variant foundations.
5. Add supplier, warehouse, inventory and shipping foundations.
6. Add customer, cart and order-item foundations.
7. Add payment and fulfillment records.
8. Add AI operations and sourcing records.
9. Add admin permissions and audit logs.
10. Test migrations and API compatibility before deployment.

14. Completion Standard

This document defines the planned database architecture. It does not claim that the tables, APIs, permissions or workflows have already been implemented.

Implementation is complete only after migrations, compatibility, security and functional tests have been verified.
