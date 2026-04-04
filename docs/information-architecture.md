# Information Architecture

## Sitemap

### Public Storefront

1. Home
2. Search Results
3. Category Landing
4. Subcategory Listing
5. Brand Listing
6. Collection Landing
7. Product Detail
8. Wishlist
9. Cart
10. Login
11. Register
12. Forgot Password
13. Checkout
14. Order Confirmation
15. Help and Support
16. Bulk Order Request
17. Static Policy Pages

### Authenticated Customer Area

1. Account Overview
2. Orders
3. Order Detail
4. Addresses
5. Wishlist
6. Profile Settings
7. Bulk Orders
8. Support History

### Admin Area

1. Dashboard
2. Catalog
3. Product Editor
4. Categories
5. Brands
6. Inventory
7. Promotions and Coupons
8. Orders
9. Order Detail
10. Customers
11. Bulk Requests
12. Roles and Permissions
13. Settings

## Primary Navigation

Top-level storefront navigation should prioritize shopping intent rather than internal business organization.

1. Notebooks and Journals
2. Pens and Writing
3. Art and Craft
4. School Essentials
5. Office Essentials
6. Files and Organization
7. Desk Accessories
8. Bulk Orders

## Catalog Taxonomy

### Notebooks And Journals

1. Notebooks
2. Registers
3. Diaries
4. Planners
5. Sketchbooks
6. Sticky Notes

### Pens And Writing

1. Ball Pens
2. Gel Pens
3. Fountain Pens
4. Roller Pens
5. Markers and Highlighters
6. Pencils
7. Erasers and Sharpeners

### Art And Craft

1. Color Pencils
2. Crayons
3. Watercolors
4. Acrylic Colors
5. Brushes
6. Craft Paper
7. Glue and Adhesives
8. Cutting Tools

### School Essentials

1. Geometry Boxes
2. School Kits
3. Labels and Covers
4. Calculators
5. Project Supplies
6. Exam Supplies

### Office Essentials

1. Printer Paper
2. Staplers and Pins
3. Tape and Dispensers
4. Whiteboard Supplies
5. Filing Supplies
6. Desk Utility Items

### Files And Organization

1. Lever Files
2. Folders
3. Document Sleeves
4. Binders
5. Storage Boxes

### Desk Accessories

1. Pen Stands
2. Desk Organizers
3. Trays
4. Clips and Fasteners
5. Memo Boards

## Filter Model

Not every filter applies to every category. Filter groups should be category-aware.

Common filters:
1. Price
2. Brand
3. Rating
4. Availability
5. Discount
6. GST Invoice Eligible

Category-specific filters:
1. Color
2. Pack size
3. Sheet count
4. Page type
5. Ruling type
6. Ink color
7. Tip or nib size
8. Material
9. Use case

## Product Data Shape

Each product should support the following logical fields:

1. Product title
2. Brand
3. Category and subcategory
4. Product description
5. Key specifications
6. Variant attributes
7. Price and compare-at price
8. Stock quantity
9. SKU
10. HSN code
11. GST percentage
12. Media gallery
13. Tags and collection flags
14. Bulk order eligibility
15. Invoice eligibility

## Page Inventory

### Must-Have For MVP

1. Home
2. Category landing template
3. Listing template
4. Product detail template
5. Search results template
6. Wishlist
7. Cart
8. Login and registration
9. Checkout
10. Order confirmation
11. Account overview
12. Orders list and order detail
13. Addresses
14. Bulk request form
15. Help and support
16. Policy pages
17. Admin dashboard
18. Admin product list and editor
19. Admin inventory view
20. Admin orders list and detail
21. Admin coupons view
22. Admin roles and permissions

## Content Hierarchy Rules

1. Category pages should guide intent first, then breadth.
2. Product pages should place conversion actions before long descriptions.
3. Bulk-order information should appear where quantity-heavy products are sold, not only in the footer.
4. Support entry points should appear near checkout, order history, and returns-sensitive states.

## Acceptance Criteria For Phase 1

1. Taxonomy supports school, office, and creative shopping intents.
2. Sitemap clearly separates storefront, account, and admin surfaces.
3. Product model fields are sufficient for pricing, tax, filtering, and merchandising.
4. Page inventory is complete enough to unblock UX design and technical architecture.