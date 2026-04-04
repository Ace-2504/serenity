# Product Requirements

## Product Summary

Project name: Stationery Webapp

This product is a B2C ecommerce platform focused on stationery, school supplies, office essentials, art materials, desk accessories, and adjacent products commonly found in a stationery shop. The launch market is India. The storefront is English-only for MVP and supports responsive web on mobile and desktop.

The product should match the shopping confidence of large ecommerce platforms while remaining category-focused, visually premium, and easier to browse for stationery-led use cases such as school preparation, exam season, office restocking, journaling, gifting, and bulk team purchases.

## Business Goals

1. Build a strong first-party ecommerce brand for stationery and essential supplies.
2. Make discovery faster than large general marketplaces by using sharper taxonomy, filters, and curated landing surfaces.
3. Support both everyday low-ticket purchases and higher-value bulk or corporate orders.
4. Keep operations manageable for a small internal team with role-based admin tooling.
5. Launch with GST-ready invoicing and manual fulfillment support without overbuilding logistics integrations.

## Success Metrics For MVP

1. User reaches a product detail page in three interactions or fewer from the home page.
2. User can complete checkout with login, address, coupon, and payment in under three minutes on mobile.
3. Search and filter usage contributes materially to product discovery for intent-led shoppers.
4. Admin team can add, update, and deactivate products without engineering support.
5. Orders can be processed manually end to end with invoice generation and customer-visible status updates.

## MVP Scope

### Included

1. Responsive storefront for mobile and desktop web.
2. Product discovery through navigation, search, recommendations, and filters.
3. Customer account creation, login, profile, address book, order history, and wishlist.
4. Cart, coupons, checkout, payments via UPI and cards, and Cash on Delivery.
5. Bulk ordering support through request-a-quote and direct bulk purchase paths.
6. Small-team admin with roles for owner or admin, catalog manager, and order operations.
7. Catalog, inventory, pricing, promotions, orders, customer support actions, and GST invoice handling.
8. Manual fulfillment workflow with status transitions and optional tracking placeholder fields.

### Excluded

1. Third-party sellers and C2C marketplace functionality.
2. Supplier onboarding at launch.
3. Native mobile apps.
4. Blog or editorial content hub.
5. Logistics aggregator integrations in MVP.
6. Advanced analytics, cohorts, and lifecycle automation.

## User Types

### Customer Segments

1. Students buying notebooks, pens, calculators, files, and exam supplies.
2. Parents purchasing school and project materials for children.
3. Office buyers restocking stationery and desk-use essentials.
4. Creators and hobbyists purchasing art supplies, journals, markers, sketchbooks, and accessories.
5. Small business or institutional buyers placing higher-quantity orders.

### Internal Roles

1. Owner or Admin: full access to reporting, pricing, promotions, catalog, and order management.
2. Catalog Manager: manages product details, media, variants, and stock information.
3. Order Operations: handles order confirmation, packing, shipping status, cancellation, and support actions.

## Core User Problems

1. General marketplaces make stationery browsing noisy and unfocused.
2. Users struggle to compare variants such as pack size, page type, color, nib type, or sheet count.
3. Bulk buyers need a smoother path than manually messaging a store on WhatsApp.
4. Owners need ecommerce controls without enterprise-grade complexity.
5. Manual fulfillment requires disciplined order states, invoicing, and customer communication.

## Product Principles

1. Category clarity over marketplace sprawl.
2. Premium, confident presentation without luxury-brand friction.
3. Mobile-first speed and legibility.
4. Conversion-friendly UX with minimal dead ends.
5. Admin workflows designed for a small operations team.

## Functional Requirements

### Storefront

1. Users can browse categories, subcategories, brands, and curated collections.
2. Users can search products with relevant suggestions and refine using filters.
3. Product listing pages must support sort, filtering, stock state, price visibility, and quick wishlist action.
4. Product detail pages must support image gallery, variant selection, quantity updates, recommendations, and bulk order callouts.
5. Cart must support quantity changes, coupon application, stock validation, and pricing transparency.

### Account And Checkout

1. Login is required before purchase.
2. Users can register, log in, reset password, and manage profile details.
3. Users can save, edit, and choose delivery addresses.
4. Checkout supports UPI, cards, and Cash on Delivery.
5. Orders produce a confirmation state, order identifier, and invoice record.
6. Users can view order history, current order status, and wishlist from the account area.

### Bulk Ordering

1. Users can submit a quote request for bulk purchases.
2. Users can place direct bulk orders when allowed by pricing and stock rules.
3. Bulk inquiries must capture organization name, quantity intent, contact details, and notes.

### Admin

1. Admin users can create, edit, publish, unpublish, and archive products.
2. Admin users can manage categories, brands, variants, pricing, stock, and HSN information.
3. Admin users can create and manage coupons with eligibility rules and validity windows.
4. Order operations can transition orders through fulfillment states.
5. Admin users can generate GST-ready invoices.
6. Role-based permissions must prevent lower-privilege users from accessing restricted areas.

## User States And Access Rules

1. Guest: can browse, search, wishlist locally or prompt-to-save, and view cart, but cannot place an order.
2. Authenticated customer: full purchase access, saved wishlist, addresses, order history, and account tools.
3. Bulk buyer: authenticated customer with access to quote requests and possibly direct bulk pricing rules.
4. Admin user: separate admin surface with permission-based modules.

## Policies And Constraints

1. India-first pricing, tax handling, and address conventions.
2. English-only copy for MVP.
3. Standard delivery promise of three to seven days.
4. Support channels are WhatsApp, phone, and in-app live chat.
5. Shipping is manually operated in MVP.

## Acceptance Criteria For Phase 1

1. Scope boundaries are clear enough to prevent C2C or seller-marketplace features from entering MVP.
2. Customer roles, internal roles, and access states are documented and approved.
3. Category structure supports both discovery-led and search-led shopping.
4. Phase 2 UX work can start without reopening baseline product decisions.
5. Phase 4 technical architecture can use this document as the authoritative functional scope.