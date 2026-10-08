# HR UNIVERSE — Bangladesh Launch V1

## Overview

HR UNIVERSE Bangladesh Launch V1 is the initial Bangladesh-first commerce foundation for HR UNIVERSE.

This version is designed to establish a simple, secure starting point for Bangladesh COD orders while keeping the architecture ready for future expansion into suppliers, automation, AI, global commerce, payments, warehouses, analytics, and additional countries.

## Current V1 Scope

- Bangladesh-first launch foundation
- Customer-facing product/order page
- Cash on Delivery (COD) order flow
- Cloudflare Workers
- Cloudflare D1 database
- Orders database
- Basic order creation and order listing API
- Mobile-friendly customer interface

## Payment

The initial customer payment method is:

- Cash on Delivery (COD)

International online payment methods are not enabled in this V1.

## Data

The D1 database used by this project is:

- Database name: `hr-universe-orders`
- Binding: `DB`

The database stores the initial order information required for the V1 workflow.

## Deployment

This project is intended to run on Cloudflare Workers with Cloudflare D1.

The Cloudflare configuration is stored in:

`wrangler.toml`

The customer frontend is located in:

`public/index.html`

The Worker/API code is located in:

`worker/index.js`

The database schema is located in:

`worker/schema.sql`

## Important

This is V1 of HR UNIVERSE and is not the final global commerce platform.

Future versions may add:

- Supplier management and supplier routing
- Product sourcing and import automation
- AI operating system
- Pricing and market intelligence
- Inventory and warehouse management
- Shipping and fulfillment automation
- Customer accounts
- Returns and refunds
- International payments
- Country and currency management
- Global storefronts
- Marketing and social automation
- Analytics and profit intelligence
- Private label
- Marketplace functionality
- Advanced security, monitoring, backups, and recovery

## Operating Principle

Customer-facing supplier identity should remain hidden. The customer relationship is with HR UNIVERSE.

The system should prioritize:

**Fair Price → More Sales → Repeat Customer → Higher Volume → Sustainable Profit → Long-Term Brand**

## Status

Bangladesh Launch V1 — foundation/deployment stage.
