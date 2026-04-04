# User Journeys

## Purpose

This document translates the product requirements into end-to-end journeys for core customer and internal user flows. These journeys are intended to guide UX design, technical architecture, QA, and operational readiness.

## Customer Journey 1: Discovery To Purchase

### Goal

Help a customer find a relevant product, evaluate it quickly, and complete purchase with minimal friction.

### Entry Points

1. Home page campaign or category rail.
2. Search query with intent such as notebooks, black gel pen, or exam kit.
3. Direct landing on category or product page from ads or referrals.

### Journey

1. Customer lands on home, category, search, or product page.
2. Customer navigates by category or uses search suggestions.
3. Customer refines by filters such as brand, price, pack size, ruling type, or stock status.
4. Customer opens a product detail page.
5. Customer reviews images, variant options, price, delivery promise, specifications, and bulk callout if applicable.
6. Customer adds item to cart or wishlist.
7. Customer opens cart, adjusts quantity, and applies coupon if available.
8. Customer is required to log in before checkout if not already authenticated.
9. Customer selects or adds delivery address.
10. Customer selects payment method.
11. Customer places order and receives confirmation with order identifier and status.

### UX Success Conditions

1. Discovery feels faster than on general marketplaces.
2. Product confidence is established without reading excessive copy.
3. Cart and checkout preserve pricing clarity and trust.
4. User never reaches a dead-end state without a clear next action.

### Failure States

1. Search returns no relevant results.
2. Variant selected is out of stock.
3. Coupon is invalid or ineligible.
4. Payment fails.
5. Delivery address is incomplete or unsupported.

### Recovery Rules

1. Zero-result search should offer alternate categories, popular products, and corrected suggestions.
2. Out-of-stock variant should keep user on page and present alternate variants or similar items.
3. Coupon failure should explain why the coupon failed without clearing the cart.
4. Payment failure should preserve checkout state and allow retry or method change.

## Customer Journey 2: Wishlist To Reorder

### Goal

Encourage repeat purchase and list-building behavior for commonly repurchased items.

### Journey

1. Customer saves one or more items to wishlist.
2. Customer later returns through account or header wishlist entry.
3. Customer moves one or more items to cart.
4. Customer completes standard checkout.
5. After delivery, customer revisits order history and uses reorder shortcut where appropriate.

### Success Conditions

1. Saved items remain easy to scan.
2. Variant and stock clarity are preserved when moving from wishlist to cart.
3. Reordering requires minimal effort.

## Customer Journey 3: Bulk Purchase

### Goal

Support larger or repeat institutional purchases without forcing every user through the same path.

### Entry Triggers

1. User sees bulk messaging on relevant product pages.
2. User visits Bulk Orders from main navigation.
3. User adds high quantity of a product to cart.

### Journey A: Request A Quote

1. Customer opens bulk request form.
2. Customer provides organization or buyer name, contact details, product interest, quantity, notes, and delivery location.
3. Submission creates a bulk request record.
4. Internal team reviews request and responds through operations workflow.

### Journey B: Direct Bulk Checkout

1. Customer is eligible for direct bulk purchase.
2. Customer adds higher quantity or bulk pack variant to cart.
3. System applies tiered or negotiated pricing rules where applicable.
4. Customer completes normal checkout flow.

### Success Conditions

1. Users understand whether they should request a quote or can buy directly.
2. Bulk pricing rules do not create confusion for standard shoppers.
3. Internal team receives complete information for manual follow-up.

## Customer Journey 4: Post-Purchase Support

### Goal

Make manual-ops fulfillment feel reliable and transparent.

### Journey

1. Customer receives order confirmation.
2. Customer tracks order through account order detail.
3. Customer sees status transitions such as confirmed, packed, and shipped.
4. Customer can reach support through WhatsApp, phone, or in-app live chat.
5. Customer can access invoice information from order detail where available.

### Success Conditions

1. Order status labels are easy to understand.
2. Manual fulfillment still looks professional and deliberate.
3. Support options are contextually accessible.

## Internal Journey 1: Catalog Manager Product Lifecycle

### Goal

Allow internal staff to create and maintain product data without engineering dependency.

### Journey

1. Catalog manager logs into admin.
2. Catalog manager creates or edits product title, media, description, attributes, variants, and tax fields.
3. Catalog manager assigns category, subcategory, brand, tags, and merchandising flags.
4. Catalog manager sets price, compare price, stock quantity, bulk eligibility, and invoice eligibility.
5. Catalog manager publishes or unpublishes product.

### Success Conditions

1. Required fields are clear and validated.
2. Product data structure supports filtering and merchandising.
3. Product changes are visible in storefront without manual developer intervention.

## Internal Journey 2: Order Operations Fulfillment

### Goal

Support manual order processing from placement to closure.

### Journey

1. Order operations user sees new order queue.
2. User reviews payment state, customer details, items, tax, and delivery details.
3. User confirms order and begins packing.
4. User updates status to packed and then shipped.
5. User adds tracking reference if available.
6. User closes order as delivered, cancelled, or returned.
7. User can generate or access invoice record.

### Success Conditions

1. Order state transitions are explicit and auditable.
2. Support and operations teams see the same operational truth.
3. Customer-facing statuses align with internal state changes.

## Internal Journey 3: Promotions And Coupon Setup

### Goal

Allow owner or admin users to run promotions safely.

### Journey

1. Owner or admin creates a coupon.
2. User selects discount type, amount, validity window, eligibility rules, and usage caps.
3. System validates rule conflicts and coupon naming.
4. Coupon is activated and made available to storefront.
5. Admin reviews usage performance and disables or expires coupon when required.

### Success Conditions

1. Promotion logic is easy to configure and hard to misuse.
2. Coupon failure messages are predictable for customers.
3. Coupon lifecycle supports common campaign use cases without custom engineering.