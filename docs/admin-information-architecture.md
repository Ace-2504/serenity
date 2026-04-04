# Admin Information Architecture

## Purpose

Define the owner and operations admin structure for MVP so each internal role can perform day-to-day tasks with minimal clicks and clear accountability.

## IA Principles

1. Optimize for operational speed over visual complexity.
2. Keep high-frequency tasks at the top level.
3. Keep state transitions explicit and auditable.
4. Avoid hidden logic in nested screens.

## Admin Navigation Model

### Primary Navigation

1. Dashboard
2. Catalog
3. Inventory
4. Promotions
5. Orders
6. Customers
7. Bulk Requests
8. Support
9. Reports
10. Settings

### Secondary Navigation

Under Catalog:
1. Products
2. Categories
3. Brands
4. Collections

Under Promotions:
1. Coupons
2. Campaign Banners

Under Settings:
1. Roles and Permissions
2. Tax and Invoice Config
3. Checkout Rules
4. Notification Templates

## Screen Inventory

### Dashboard

1. KPI Overview
2. Pending Actions Queue
3. Inventory Alerts
4. Recent Order Activity
5. Coupon Performance Snapshot

### Catalog

1. Product List
2. Product Create
3. Product Edit
4. Category Manager
5. Brand Manager
6. Collection Manager

### Inventory

1. Inventory List
2. Bulk Inventory Update
3. Inventory Movement Log
4. Low Stock Alerts

### Promotions

1. Coupon List
2. Coupon Create
3. Coupon Edit
4. Campaign Banner Manager

### Orders

1. Order List
2. Order Detail
3. Status Transition Panel
4. Invoice View and Generate
5. Cancellation and Return Queue

### Customers

1. Customer List
2. Customer Detail
3. Order History by Customer
4. Support Notes

### Bulk Requests

1. Bulk Request List
2. Bulk Request Detail
3. Quote Response Action
4. Conversion to Order Action

### Support

1. Support Queue
2. Conversation Detail
3. Linked Order and Bulk Context
4. Resolution Notes

### Reports

1. Sales Summary
2. Order Status Throughput
3. Coupon Usage
4. Top Categories and Products

### Settings

1. Role Matrix Screen
2. Invoice and GST Setup
3. COD Rule Configuration
4. Pincode Serviceability Table
5. Notification and Template Settings

## Core Navigation Flows

1. Dashboard -> Pending Orders -> Order Detail -> Status Update -> Invoice
2. Catalog -> Product List -> Product Edit -> Publish
3. Inventory -> Low Stock Alert -> Product Variant -> Stock Adjustment
4. Promotions -> Coupon List -> Coupon Edit -> Activate or Deactivate
5. Bulk Requests -> Request Detail -> Quote Response -> Mark Converted

## Default Landing By Role

1. Owner or Admin lands on Dashboard.
2. Catalog Manager lands on Catalog Product List.
3. Order Operations lands on Orders Queue.

## Global Elements

1. Role badge in top bar.
2. Global search for order ID, customer phone or email, SKU, and product name.
3. Notification bell for urgent actions.
4. Audit trail shortcut on critical records.

## Phase 3 Acceptance Criteria

1. Every high-frequency task has a direct and clear route.
2. Admin screen inventory covers catalog, orders, promotions, support, and settings.
3. Navigation reflects role responsibilities and task volume.