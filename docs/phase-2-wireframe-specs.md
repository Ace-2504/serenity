# Phase 2 Wireframe Specs

## Purpose

This document translates the product and UX blueprint into screen-by-screen wireframe specifications for the customer-facing experience. It is written to guide UI design, prototyping, frontend implementation, and QA.

## Global Layout Rules

1. The storefront is mobile-first, with desktop layouts expanding density only where it improves scanability.
2. Primary navigation, search, wishlist, account, and cart must remain accessible from every storefront page.
3. Promotional surfaces must not obscure core shopping actions.
4. Every major page should preserve a clear primary action and a visible fallback path.
5. Support access should appear contextually, not as an intrusive persistent interruption.

## Screen 1: Home

### Primary Goal

Help users understand the brand quickly, enter the right category, and discover relevant products or campaigns with confidence.

### Mobile Layout

1. Sticky header with menu, logo, search entry, wishlist, and cart.
2. Hero panel with seasonal or category campaign, short headline, one primary CTA, and one secondary CTA.
3. Fast-entry category tiles in a two-column grid.
4. Trust strip with delivery, GST invoice, secure payments, and support promises.
5. Featured merchandising rails: Bestsellers, Exam Essentials, Study Desk Setup, and Bulk Picks.
6. Promotional banner for coupons or first-order offer.
7. Recommendation rail based on popularity or recent browsing.
8. Footer with support, policies, and bulk-order entry.

### Desktop Layout

1. Wider hero with editorial split layout: copy left, campaign image or product composition right.
2. Category row can expand to a horizontal card rail or multi-column block.
3. Recommendation and merchandising rails can show more products per row.
4. Support and trust modules sit inline with category and campaign content rather than in stacked blocks.

### Key Modules

1. Hero campaign module.
2. Category explorer module.
3. Trust rail module.
4. Product recommendation rail.
5. Promotional announcement module.

### Key Actions

1. Start search.
2. Enter category.
3. Open featured product.
4. Navigate to bulk ordering.

## Screen 2: Search And Listing Page

### Primary Goal

Help customers narrow quickly using category-aware filters without losing orientation.

### Mobile Layout

1. Sticky header with active search query or category title.
2. Breadcrumb compressed into back path and current category label.
3. Results toolbar with count, sort, and filter action.
4. Filter drawer opening from bottom sheet or side sheet.
5. Applied filter chips visible above product grid.
6. Two-column product grid when image legibility allows; otherwise one-column cards for dense categories.
7. Inline merchandising slot after every eight to twelve products depending on density.

### Desktop Layout

1. Left rail filters with sticky behavior.
2. Top content zone with breadcrumb, category title, optional description, result count, sort, and merchandising banner.
3. Three- or four-column product grid depending on card width.
4. Recommendation insertions used sparingly to avoid list disruption.

### Key Modules

1. Search header.
2. Filter system.
3. Applied filter chip bar.
4. Product grid.
5. Empty-state or zero-results module.

### Key Actions

1. Apply or clear filters.
2. Change sort.
3. Open product detail.
4. Add item to wishlist.

## Screen 3: Product Detail Page

### Primary Goal

Provide enough confidence for a fast purchase while supporting comparison, variant evaluation, and bulk intent.

### Mobile Layout

1. Sticky header with back, search, wishlist, and cart.
2. Swipeable product gallery.
3. Product title, brand, rating summary, price block, and tax or invoice badge.
4. Variant selectors stacked ahead of purchase actions.
5. Delivery and availability module.
6. Quantity stepper.
7. Primary CTA: Add to cart.
8. Secondary CTA: Buy now.
9. Bulk order card where eligible.
10. Information accordion for overview, specifications, shipping, and invoice eligibility.
11. Related and complementary products.

### Desktop Layout

1. Two-column hero zone with gallery left and commerce module right.
2. Sticky purchase summary may persist during detail scroll.
3. Related products can appear in wider grids or rails below the fold.

### Key Modules

1. Gallery.
2. Price and variant module.
3. Delivery and trust module.
4. Bulk inquiry module.
5. Product details accordion.
6. Recommendations.

### Key Actions

1. Change variant.
2. Adjust quantity.
3. Add to cart.
4. Buy now.
5. Save to wishlist.
6. Start bulk request.

## Screen 4: Cart

### Primary Goal

Give users a clean, trustworthy pricing and validation review before checkout begins.

### Mobile Layout

1. Cart item list with image, title, selected variant, price, quantity stepper, stock warnings, and remove action.
2. Coupon entry module.
3. Savings summary.
4. Delivery promise reminder.
5. Checkout CTA fixed near bottom when possible.

### Desktop Layout

1. Two-column structure with item list left and order summary right.
2. Summary column includes coupon, totals, estimated delivery, support link, and checkout CTA.

### Key Modules

1. Cart line-item module.
2. Coupon module.
3. Price summary module.
4. Low-stock or invalid-state banner.

### Key Actions

1. Adjust quantity.
2. Remove item.
3. Apply coupon.
4. Proceed to login or checkout.

## Screen 5: Checkout

### Primary Goal

Reduce abandonment with clear progression, explicit totals, and recovery paths for payment or address failure.

### Checkout Structure

1. Step 1: Account confirmation or login gate.
2. Step 2: Address selection or new address form.
3. Step 3: Delivery summary and item review.
4. Step 4: Payment selection.
5. Step 5: Final review and place order.

### Mobile Layout

1. Stepper or progress indicator.
2. One primary task visible per stage.
3. Persistent but compact price summary drawer.
4. UPI prioritized visually in payment method selection.
5. COD disabled state clearly explained if ineligible.

### Desktop Layout

1. Main step content left and sticky summary right.
2. Expanded payment method descriptions for trust and comprehension.

### Key Modules

1. Login or account confirmation panel.
2. Address selector and address form.
3. Payment method selector.
4. Final order review.
5. Payment failure recovery banner or panel.

### Key Actions

1. Continue to next step.
2. Edit cart or address.
3. Choose payment method.
4. Retry payment or switch method.
5. Place order.

## Screen 6: Account Area

### Primary Goal

Provide a useful post-purchase control center rather than a static profile page.

### Mobile Layout

1. Account overview header with quick links.
2. Orders section first.
3. Secondary sections for addresses, wishlist, bulk orders, support, and profile settings.
4. Order detail uses clear status timeline and support shortcut.

### Desktop Layout

1. Left navigation for account modules.
2. Main content pane for selected module.
3. Order list and order detail views support quick scanning and reorder action.

### Key Modules

1. Orders dashboard.
2. Order detail timeline.
3. Address book.
4. Wishlist grid.
5. Bulk order request history.
6. Support module.

### Key Actions

1. Track order.
2. Reorder.
3. Contact support.
4. Manage address.
5. Move wishlist item to cart.

## Support Surface Specification

1. Checkout and order detail should expose support entry points above the fold.
2. WhatsApp should be framed as fast assistance, not the only resolution path.
3. Phone support appears for trust and urgent resolution.
4. In-app live chat should attach context from checkout, order, or bulk request when possible.

## Responsive Priorities

1. Search, category access, and cart must stay fast and obvious on mobile.
2. Dense grids should never compromise product-image legibility or CTA clarity.
3. Desktop can expand discovery breadth, but mobile should always prioritize task completion.

## Phase 2 Acceptance Criteria

1. Each critical customer template has a clear layout structure and module list.
2. Mobile and desktop behavior differences are explicit.
3. Recovery and support surfaces are accounted for inside the flow, not treated as afterthoughts.