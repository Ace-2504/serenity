# Data Model And Schema

## Purpose

Define core entities, key fields, relationships, status enums, and index guidance for MVP.

## Entity Overview

1. users
2. roles
3. user_roles
4. customer_profiles
5. addresses
6. categories
7. brands
8. products
9. product_variants
10. inventory_items
11. collections
12. collection_products
13. carts
14. cart_items
15. coupons
16. coupon_rules
17. coupon_redemptions
18. orders
19. order_items
20. payments
21. invoices
22. bulk_requests
23. support_tickets
24. audit_logs
25. analytics_events

## Core Entity Fields

### users

1. id (uuid, primary key)
2. email (unique)
3. phone (unique, nullable)
4. password_hash
5. is_active
6. created_at
7. updated_at

### roles

1. id
2. code (`owner_admin`, `catalog_manager`, `order_operations`, `customer`)
3. name

### user_roles

1. user_id
2. role_id
3. assigned_at

### customer_profiles

1. user_id (unique foreign key)
2. first_name
3. last_name
4. default_address_id (nullable)

### addresses

1. id
2. user_id
3. label
4. line_1
5. line_2
6. city
7. state
8. postal_code
9. country
10. phone
11. is_default

### categories

1. id
2. name
3. slug (unique)
4. parent_id (nullable)
5. is_active

### brands

1. id
2. name
3. slug (unique)
4. is_active

### products

1. id
2. title
3. slug (unique)
4. description
5. category_id
6. brand_id
7. hsn_code
8. gst_percent
9. is_bulk_eligible
10. is_invoice_eligible
11. status (`draft`, `published`, `archived`)
12. created_at
13. updated_at

### product_variants

1. id
2. product_id
3. sku (unique)
4. attributes_json
5. price_inr
6. compare_at_price_inr (nullable)
7. is_active

### inventory_items

1. id
2. variant_id (unique)
3. stock_on_hand
4. low_stock_threshold
5. updated_at

### carts

1. id
2. user_id (unique)
3. created_at
4. updated_at

### cart_items

1. id
2. cart_id
3. variant_id
4. quantity
5. unit_price_snapshot_inr

### coupons

1. id
2. code (unique)
3. discount_type (`flat`, `percent`)
4. discount_value
5. status (`draft`, `active`, `paused`, `expired`)
6. starts_at
7. ends_at
8. usage_limit_total (nullable)
9. usage_limit_per_user (nullable)

### coupon_rules

1. id
2. coupon_id
3. min_cart_value_inr (nullable)
4. include_category_ids_json (nullable)
5. exclude_product_ids_json (nullable)
6. max_discount_inr (nullable)

### orders

1. id
2. order_number (unique)
3. user_id
4. status (`pending_payment`, `confirmed`, `packed`, `shipped`, `delivered`, `cancelled`, `returned`)
5. subtotal_inr
6. discount_total_inr
7. tax_total_inr
8. shipping_total_inr
9. grand_total_inr
10. payment_method (`upi`, `card`, `cod`)
11. payment_status (`pending`, `paid`, `failed`, `refunded`, `cod_pending`)
12. shipping_address_snapshot_json
13. billing_address_snapshot_json
14. coupon_code_applied (nullable)
15. placed_at
16. updated_at

### order_items

1. id
2. order_id
3. product_id
4. variant_id
5. title_snapshot
6. sku_snapshot
7. quantity
8. unit_price_inr
9. tax_percent
10. tax_amount_inr
11. line_total_inr

### payments

1. id
2. order_id
3. provider
4. provider_payment_id
5. provider_order_id
6. status (`created`, `authorized`, `captured`, `failed`, `refunded`)
7. amount_inr
8. currency
9. failure_code (nullable)
10. raw_payload_json
11. created_at

### invoices

1. id
2. order_id (unique)
3. invoice_number (unique)
4. invoice_date
5. gst_summary_json
6. file_url
7. created_by_user_id

### bulk_requests

1. id
2. user_id (nullable for guest inquiries if enabled later)
3. organization_name
4. contact_name
5. contact_email
6. contact_phone
7. request_details_json
8. status (`new`, `contacted`, `quoted`, `converted`, `closed`)
9. linked_order_id (nullable)
10. assigned_to_user_id (nullable)
11. created_at
12. updated_at

### support_tickets

1. id
2. channel (`whatsapp`, `phone`, `chat`)
3. user_id (nullable)
4. order_id (nullable)
5. bulk_request_id (nullable)
6. status (`open`, `in_progress`, `resolved`, `closed`)
7. subject
8. summary
9. resolution_notes (nullable)
10. assigned_to_user_id (nullable)
11. created_at
12. updated_at

### audit_logs

1. id
2. actor_user_id
3. actor_role_code
4. action
5. entity_type
6. entity_id
7. old_values_json
8. new_values_json
9. created_at

### analytics_events

1. id
2. event_name
3. user_id (nullable)
4. anonymous_id (nullable)
5. session_id
6. payload_json
7. occurred_at

## Relationship Notes

1. A product has many variants.
2. A variant has one inventory record.
3. A user has one cart and many addresses.
4. An order has many order items and may have one invoice.
5. A coupon can have many redemptions.
6. Support ticket can optionally link to order or bulk request.

## Index Guidance

1. Unique indexes: users.email, users.phone, products.slug, product_variants.sku, orders.order_number, invoices.invoice_number.
2. Query indexes: products.category_id, products.brand_id, products.status, orders.user_id, orders.status, orders.placed_at, bulk_requests.status, support_tickets.status.
3. Compound indexes: order_items.order_id + variant_id, cart_items.cart_id + variant_id, coupon_redemptions.coupon_id + user_id.

## Data Integrity Rules

1. Order item pricing and tax are immutable snapshots.
2. Invoice record is immutable after generation.
3. Payment webhook records are idempotent by provider payment identifiers.
4. Audit log writes are append-only.

## Migration Sequence Recommendation

1. Core identity and role tables.
2. Catalog and inventory tables.
3. Cart and coupon tables.
4. Order and payment tables.
5. Invoice, bulk request, support, and audit tables.

## Phase 4 Acceptance Criteria

1. Every workflow from phases 1 through 3 maps to entities and fields.
2. Status and snapshot rules prevent historical data drift.
3. Index strategy supports expected MVP query patterns.