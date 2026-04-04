# Event Tracking Map

## Purpose

This document defines the minimum analytics event map required to evaluate conversion, discovery quality, merchandising performance, and admin-operational health in MVP.

## Tracking Principles

1. Track user intent and friction, not vanity interactions.
2. Ensure all revenue-impacting actions are measurable.
3. Maintain consistent event naming and payload shape.
4. Separate customer-side and admin-side events.

## Shared Event Payload Fields

1. session_id
2. user_id or anonymous_id
3. page_type
4. page_path
5. device_type
6. traffic_source
7. timestamp

## Storefront Events

### Discovery

1. home_view
Payload: campaign_id, recommendation_set_ids

2. category_view
Payload: category_name, subcategory_name, result_count

3. search_performed
Payload: query, result_count, suggestion_used

4. filter_applied
Payload: filter_name, filter_value, result_count

5. sort_changed
Payload: sort_key

### Product Engagement

1. product_card_clicked
Payload: product_id, category_context, rail_name, position_index

2. product_viewed
Payload: product_id, category_name, stock_state, price, bulk_eligible

3. wishlist_added
Payload: product_id, source_surface

4. wishlist_removed
Payload: product_id, source_surface

### Cart And Checkout

1. add_to_cart
Payload: product_id, variant_id, quantity, source_surface

2. remove_from_cart
Payload: product_id, variant_id, quantity

3. cart_viewed
Payload: item_count, cart_value

4. coupon_applied
Payload: coupon_code, discount_value, success_state

5. checkout_started
Payload: item_count, cart_value

6. address_added
Payload: address_type, city, state

7. payment_method_selected
Payload: payment_method

8. payment_failed
Payload: payment_method, error_code

9. order_placed
Payload: order_id, order_value, payment_method, coupon_code, item_count

### Bulk Ordering

1. bulk_request_started
Payload: source_surface, product_id_optional

2. bulk_request_submitted
Payload: request_id, product_count, quantity_band

3. bulk_direct_checkout_started
Payload: product_id, quantity, customer_type

## Support Events

1. support_entry_clicked
Payload: channel, source_surface

2. live_chat_started
Payload: source_surface

3. whatsapp_redirect_clicked
Payload: source_surface

## Admin Events

1. admin_login
Payload: role

2. product_created
Payload: product_id, category_name, role

3. product_updated
Payload: product_id, changed_fields, role

4. inventory_updated
Payload: product_id, variant_id, previous_stock, new_stock

5. coupon_created
Payload: coupon_code, rule_type, role

6. order_status_updated
Payload: order_id, old_status, new_status, role

7. invoice_generated
Payload: order_id, tax_total, role

8. role_permission_changed
Payload: role_name, changed_permissions, actor_role

## KPI Mapping

1. Conversion funnel: home_view -> category_view or search_performed -> product_viewed -> add_to_cart -> checkout_started -> order_placed
2. Search health: search_performed, filter_applied, product_card_clicked, zero-result rate
3. Merchandising health: product_card_clicked by rail, product_viewed by campaign context, add_to_cart by recommendation source
4. Checkout health: coupon_applied success, payment_failed rate, checkout_started to order_placed completion
5. Bulk opportunity: bulk_request_submitted volume and bulk_direct_checkout_started conversion
6. Operational health: order_status_updated cycle times, inventory_updated frequency, invoice_generated coverage

## Acceptance Criteria For Phase 1

1. All key discovery, cart, checkout, bulk, support, and admin actions are measurable.
2. Event naming is consistent enough for implementation across frontend and backend.
3. KPI mapping is sufficient for MVP business review without requiring advanced BI work.