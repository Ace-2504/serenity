# Interaction State Matrix

## Purpose

This matrix defines key user interactions, the expected default behavior, failure handling, and recovery path for phase 2 customer flows.

## Search

1. Default state: search field focused, predictive suggestions show categories, products, and recent queries.
2. Active state: typed query updates suggestions with debounce.
3. Empty query state: show recent searches and top categories.
4. Zero-result state: show correction suggestions, popular categories, and a curated fallback rail.
5. Error state: show retry prompt and preserve query.

## Filters

1. Default state: relevant filter groups collapsed or partly expanded by category.
2. Applied state: active filter chips visible above results.
3. No-results-after-filter state: explain which filters constrained results and offer clear-all.
4. Mobile drawer state: filter drawer can be applied or dismissed without losing current results context.

## Product Card

1. Default state: image, title, price, offer badge if applicable, and wishlist action.
2. Hover or focus state: elevate slightly and reveal quick metadata without layout shift.
3. Out-of-stock state: visually marked but still linkable if product remains discoverable.
4. Wishlist-success state: heart toggles immediately and preserves page position.

## Product Detail

1. Default state: first variant preselected if valid.
2. Variant-unavailable state: disable the option and explain availability.
3. Quantity-limit state: prevent exceeding available stock and explain constraint.
4. Add-to-cart success: confirm addition non-disruptively and provide cart shortcut.
5. Bulk-eligible state: display bulk CTA without obscuring standard purchase actions.

## Cart

1. Default state: all line items valid and summary visible.
2. Item-invalid state: highlight out-of-stock or changed-price item with required user action.
3. Coupon-success state: show applied savings and updated total.
4. Coupon-failure state: keep field value, explain failure reason, and preserve item state.
5. Empty-cart state: show prominent return-to-shopping actions and recommendation rail.

## Checkout

1. Logged-out state: checkout begins with login or account confirmation step.
2. Address-incomplete state: inline field errors and preserve entered values.
3. Payment-selection state: one method selected at a time, UPI visually prioritized.
4. COD-ineligible state: disable option with reason text.
5. Payment-failed state: preserve order summary, selected method, and allow retry or switch method.
6. Order-success state: confirmation page with order ID, next steps, and support link.

## Wishlist

1. Default state: saved items visible with image, price, stock state, and move-to-cart action.
2. Out-of-stock state: item remains saved with notification-style treatment.
3. Move-to-cart success: item added to cart and optionally remains in wishlist unless removed by user.
4. Empty state: encourage browsing through bestsellers and category links.

## Account And Orders

1. Orders-list default: reverse chronological list with concise status chips.
2. Order-detail default: status timeline, item list, invoice access, and support entry.
3. Reorder state: add all available items to cart and flag unavailable items.
4. Support-trigger state: pass order context into selected support channel.

## Support Entry

1. Default state: contextual support options displayed based on page type.
2. WhatsApp entry: opens prefilled context where possible.
3. Live-chat entry: starts in-page conversation with page or order metadata.
4. Phone entry: show number and service hours where available.

## Phase 2 Acceptance Criteria

1. Every major customer flow includes default, failure, and recovery behavior.
2. No critical action relies on users starting over after failure.
3. Designers and engineers can implement consistent state behavior across templates.