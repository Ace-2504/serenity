# Role Permission Matrix

## Purpose

Define permission boundaries for the MVP admin team to reduce operational risk while allowing fast execution.

## Roles

1. Owner or Admin
2. Catalog Manager
3. Order Operations

## Permission Levels

1. View
2. Create
3. Edit
4. Delete
5. Approve
6. Export

## Module Permissions

### Dashboard And Reports

1. Owner or Admin: View, Export.
2. Catalog Manager: View limited catalog metrics.
3. Order Operations: View limited order and fulfillment metrics.

### Catalog Products

1. Owner or Admin: View, Create, Edit, Delete, Approve.
2. Catalog Manager: View, Create, Edit.
3. Order Operations: View only.

### Categories And Brands

1. Owner or Admin: View, Create, Edit, Delete.
2. Catalog Manager: View, Create, Edit.
3. Order Operations: View only.

### Inventory

1. Owner or Admin: View, Create, Edit, Export.
2. Catalog Manager: View, Edit.
3. Order Operations: View, Edit stock correction related to order issues.

### Promotions And Coupons

1. Owner or Admin: View, Create, Edit, Delete, Approve.
2. Catalog Manager: View only.
3. Order Operations: View only.

### Orders

1. Owner or Admin: View, Edit, Approve, Export.
2. Catalog Manager: View only.
3. Order Operations: View, Edit status transitions, Export shipping or packing lists.

### Invoices And Tax

1. Owner or Admin: View, Create, Edit configuration, Export.
2. Catalog Manager: View product tax fields only.
3. Order Operations: View and generate invoice for eligible orders.

### Customers

1. Owner or Admin: View, Export.
2. Catalog Manager: View limited customer info linked to order context.
3. Order Operations: View customer delivery and support context.

### Bulk Requests

1. Owner or Admin: View, Edit, Approve conversion, Export.
2. Catalog Manager: View product and quantity details only.
3. Order Operations: View, Edit status, add response notes.

### Support

1. Owner or Admin: View, Edit, Export.
2. Catalog Manager: View only.
3. Order Operations: View, Edit resolution status.

### Roles And Permissions Settings

1. Owner or Admin: View, Create, Edit, Delete.
2. Catalog Manager: No access.
3. Order Operations: No access.

## Sensitive Action Controls

1. Coupon activation and deactivation requires owner or admin approval.
2. Product deletion requires owner or admin.
3. Backdated order status changes require owner or admin override.
4. Tax and invoice configuration changes require owner or admin.

## Audit Requirements

1. Capture actor role, actor ID, timestamp, action type, and record reference for all edit actions.
2. Store previous and new values for critical fields such as price, stock, coupon rules, and order status.
3. Exports of customer or order data should be logged.

## Phase 3 Acceptance Criteria

1. Permissions align with least-privilege access.
2. Operational roles can complete daily tasks without escalation for routine actions.
3. Sensitive actions are protected and auditable.