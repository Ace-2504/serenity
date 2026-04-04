# Business Rules

## Purpose

This document captures operational and product rules that should stay stable through design and implementation. Where open questions remain, they are marked explicitly so they can be resolved before checkout and admin features are built.

## Commerce Scope Rules

1. The platform is B2C only for MVP.
2. All products are sold from first-party inventory.
3. No third-party seller accounts or seller dashboards are included in MVP.
4. Supplier onboarding is out of scope for launch.

## Account And Access Rules

1. Guests can browse and build intent, but checkout requires authentication.
2. Customers can maintain profile, addresses, wishlist, and order history.
3. Admin access is separated from customer access.
4. Admin capabilities are permission-based by role.

## Catalog Rules

1. Every product must belong to one primary category and one subcategory.
2. Every sellable product must have a unique SKU.
3. Variant products must define variant attributes consistently within their category.
4. Every product must have stock state and price before publishing.
5. Every taxable product must store HSN code and GST percentage.
6. Products can be flagged for bulk ordering eligibility.

## Pricing And Promotion Rules

1. Prices are displayed in INR.
2. Discounted products should display current price and compare-at price where applicable.
3. Coupons must support eligibility rules such as minimum cart value, category inclusion, product exclusion, and usage limits.
4. Only one standard coupon is applied per order unless a future stacking policy is defined.
5. Coupon validation must occur both in cart and at final checkout confirmation.
6. Bulk pricing may differ from retail pricing, but rules must remain explicit.

## Checkout Rules

1. Login is required before order placement.
2. Checkout must preserve cart state if payment fails.
3. Payment methods supported in MVP are UPI, cards, and Cash on Delivery.
4. COD eligibility may be restricted by future order-value, category, or location rules.
5. Final payable amount must remain visible at every checkout step.

## Order Management Rules

1. Orders move through explicit statuses only.
2. Suggested statuses for MVP are pending payment, confirmed, packed, shipped, delivered, cancelled, and returned.
3. Status changes must be auditable.
4. Customer-facing statuses should stay simpler than internal system states when appropriate.
5. Invoice generation must be tied to order and tax records.

## Fulfillment Rules

1. Fulfillment is manual in MVP.
2. Standard delivery promise is three to seven days.
3. Tracking references are optional at launch but supported by the data model.
4. Support teams should be able to view operational status before responding to users.

## Bulk Order Rules

1. Bulk ordering supports both request-a-quote and direct purchase paths.
2. Direct bulk purchase may be limited by stock, pricing policy, or customer eligibility.
3. Bulk request records must be actionable by internal teams without requiring external spreadsheets.

## Support Rules

1. Support channels in MVP are WhatsApp, phone, and in-app live chat.
2. Support entry points must be available in checkout-sensitive and post-purchase pages.
3. Support interactions should reference order or bulk request context where possible.

## Open Rules To Finalize Before Checkout Build

1. COD maximum order value.
2. Return and refund policy by category.
3. Pincode serviceability logic.
4. Bulk discount visibility policy.
5. Coupon stacking exceptions, if any.