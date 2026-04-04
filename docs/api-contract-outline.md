# API Contract Outline

## Purpose

Define the initial REST API surface for storefront, customer account, checkout, and admin operations.

## API Conventions

1. Base path: `/api/v1`.
2. Content type: `application/json`.
3. Auth: secure cookie sessions for web apps.
4. Error shape:
   - `code`
   - `message`
   - `details` (optional)
5. Pagination shape:
   - `items`
   - `page`
   - `pageSize`
   - `total`

## Public Storefront Endpoints

1. `GET /catalog/categories`
2. `GET /catalog/categories/:slug/products`
3. `GET /catalog/products/:slug`
4. `GET /catalog/search?q=&page=&filters=`
5. `GET /catalog/recommendations?context=`

## Customer Auth And Account

1. `POST /auth/register`
2. `POST /auth/login`
3. `POST /auth/logout`
4. `POST /auth/forgot-password`
5. `POST /auth/reset-password`
6. `GET /account/me`
7. `PATCH /account/me`

## Address Management

1. `GET /account/addresses`
2. `POST /account/addresses`
3. `PATCH /account/addresses/:id`
4. `DELETE /account/addresses/:id`

## Wishlist

1. `GET /wishlist`
2. `POST /wishlist/items`
3. `DELETE /wishlist/items/:variantId`

## Cart

1. `GET /cart`
2. `POST /cart/items`
3. `PATCH /cart/items/:itemId`
4. `DELETE /cart/items/:itemId`
5. `POST /cart/coupon/apply`
6. `POST /cart/coupon/remove`

## Checkout And Orders

1. `POST /checkout/validate`
2. `POST /checkout/payment-intent`
3. `POST /checkout/place-order`
4. `GET /orders`
5. `GET /orders/:orderId`
6. `GET /orders/:orderId/invoice`
7. `POST /orders/:orderId/reorder`

## Bulk Requests

1. `POST /bulk-requests`
2. `GET /bulk-requests` (customer-scoped)
3. `GET /bulk-requests/:id` (customer-scoped)

## Support

1. `POST /support/tickets`
2. `GET /support/tickets` (customer-scoped)
3. `GET /support/tickets/:id` (customer-scoped)

## Payment Webhooks

1. `POST /webhooks/payments/:provider`

## Admin Auth

1. `POST /admin/auth/login`
2. `POST /admin/auth/logout`
3. `GET /admin/auth/me`

## Admin Catalog

1. `GET /admin/products`
2. `POST /admin/products`
3. `GET /admin/products/:id`
4. `PATCH /admin/products/:id`
5. `DELETE /admin/products/:id`
6. `GET /admin/categories`
7. `POST /admin/categories`
8. `PATCH /admin/categories/:id`
9. `GET /admin/brands`
10. `POST /admin/brands`
11. `PATCH /admin/brands/:id`

## Admin Inventory

1. `GET /admin/inventory`
2. `POST /admin/inventory/adjustments`
3. `GET /admin/inventory/low-stock`

## Admin Promotions

1. `GET /admin/coupons`
2. `POST /admin/coupons`
3. `PATCH /admin/coupons/:id`
4. `POST /admin/coupons/:id/activate`
5. `POST /admin/coupons/:id/pause`

## Admin Orders And Invoices

1. `GET /admin/orders`
2. `GET /admin/orders/:id`
3. `POST /admin/orders/:id/status`
4. `POST /admin/orders/:id/invoice/generate`
5. `GET /admin/orders/:id/invoice`

## Admin Bulk Requests

1. `GET /admin/bulk-requests`
2. `GET /admin/bulk-requests/:id`
3. `POST /admin/bulk-requests/:id/status`
4. `POST /admin/bulk-requests/:id/convert`

## Admin Support

1. `GET /admin/support/tickets`
2. `GET /admin/support/tickets/:id`
3. `POST /admin/support/tickets/:id/status`
4. `POST /admin/support/tickets/:id/notes`

## Admin Settings

1. `GET /admin/settings/roles`
2. `PATCH /admin/settings/roles`
3. `GET /admin/settings/checkout-rules`
4. `PATCH /admin/settings/checkout-rules`
5. `GET /admin/settings/serviceability`
6. `PATCH /admin/settings/serviceability`

## Event Collection Endpoint

1. `POST /analytics/events/batch`

## Phase 4 Acceptance Criteria

1. API surface covers core customer and admin use cases.
2. Route separation between customer and admin contexts is explicit.
3. Endpoints align with workflows and role permissions from phase 3.