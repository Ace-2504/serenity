# Technical Architecture

## Purpose

Define the implementation blueprint for MVP across frontend, backend, data, auth, payments, admin, and observability.

## Recommended Stack For MVP

### Frontend

1. Framework: Next.js (App Router) with TypeScript.
2. Styling: Tailwind CSS plus CSS variables driven by the phase 2 token set.
3. UI composition: component-first with shared primitives for storefront and admin.
4. State model: server components for read-heavy pages, client state for cart, checkout forms, and admin interactions.

### Backend

1. Runtime: Node.js with TypeScript.
2. API style: REST for operational simplicity in MVP.
3. App framework: Next.js route handlers for early MVP or dedicated API service if scale or team separation is required.
4. Validation: Zod schemas for request and response validation.

### Data And Infra

1. Primary database: PostgreSQL.
2. ORM: Prisma.
3. Cache: Redis for session, rate limiting, and selected query caching.
4. Object storage: S3-compatible store for product images and invoice files.
5. Queue: lightweight job queue for notifications and invoice generation tasks.

### Payments And Messaging

1. Payment gateway: Razorpay or equivalent supporting UPI and cards.
2. COD: internal payment type with rule-based eligibility checks.
3. WhatsApp support: provider integration through webhook-enabled API.
4. Email or SMS: transactional notifications for order events.

## High-Level System Boundaries

1. Storefront web app.
2. Admin web app.
3. Commerce API modules.
4. Shared domain and validation layer.
5. Database and storage.
6. External integration adapters.

## Domain Modules

1. `auth`: customer login, admin login, sessions, password reset.
2. `catalog`: products, categories, brands, collections, media.
3. `inventory`: stock levels, adjustments, low-stock alerts.
4. `cart`: cart creation, item updates, coupon evaluation preview.
5. `checkout`: address selection, payment intent creation, COD checks.
6. `payments`: gateway orchestration, webhook verification, status reconciliation.
7. `promotions`: coupon definitions, rule evaluation, usage tracking.
8. `orders`: order creation, state transitions, customer order history.
9. `invoices`: GST-ready invoice generation and retrieval.
10. `bulk_requests`: quote requests, statuses, response notes, conversion to order.
11. `support`: support records linked to orders or bulk requests.
12. `admin`: role-based policies, moderation actions, reporting views.
13. `analytics`: event collection and forwarding to analytics sink.

## Frontend Architecture

### Route Structure

1. `/` home.
2. `/c/[category]` category and listing pages.
3. `/p/[slug]` product detail.
4. `/search` search results.
5. `/wishlist` wishlist.
6. `/cart` cart.
7. `/checkout` checkout.
8. `/account/*` customer account pages.
9. `/bulk-orders` bulk request entry page.
10. `/admin/*` admin modules (protected).

### Rendering Strategy

1. Static and revalidated content for category and product listing where possible.
2. Dynamic rendering for cart, checkout, account, and admin pages.
3. Edge caching for read-heavy catalog and category responses.

### UI Layering

1. `tokens`: design token map.
2. `primitives`: button, input, modal, chip, badge, table.
3. `commerce-components`: product card, filter drawer, cart summary, order timeline.
4. `admin-components`: table filters, status panel, activity timeline, bulk action bar.
5. `page-sections`: composed modules for each page template.

## Backend Architecture

### API Surface

1. Public read APIs: catalog, product detail, search, category browse.
2. Authenticated customer APIs: wishlist, cart, checkout, order history, bulk requests.
3. Webhook APIs: payment callback, optional messaging callback.
4. Admin APIs: catalog management, inventory, promotions, orders, invoices, support, reports.

### Security Model

1. Session-based authentication for web clients with secure HTTP-only cookies.
2. Role-based authorization checks at route and service layers.
3. CSRF protection for mutation endpoints.
4. Request-level validation before service logic.
5. Rate limits for auth, coupon apply, and checkout endpoints.

### State Machines

1. Order statuses: pending_payment, confirmed, packed, shipped, delivered, cancelled, returned.
2. Bulk request statuses: new, contacted, quoted, converted, closed.
3. Coupon statuses: draft, active, paused, expired.

## Data Consistency Rules

1. Checkout creates order and captures cart snapshot atomically.
2. Payment webhook reconciliation is idempotent.
3. Inventory deductions occur at order confirmation or payment success according to chosen policy.
4. Status transitions must be validated against allowed previous states.
5. Invoice numbers are immutable once generated.

## Observability Design

1. Structured logs for all API requests and key domain actions.
2. Correlation ID propagation across request and job boundaries.
3. Domain events emitted for add-to-cart, checkout, payment updates, status transitions, invoice generation.
4. Error monitoring with alerts on checkout and payment failure rate thresholds.

## Deployment Shape

1. Single deployable app for MVP is acceptable if module boundaries remain strict.
2. Split into separate storefront and API services later without changing domain contracts.
3. Use separate environments for dev, staging, and production.

## Open Technical Decisions

1. Final payment provider selection.
2. Inventory deduction strategy timing.
3. Initial hosting platform and CI deployment model.
4. Search implementation depth for MVP and fallback ranking logic.

## Phase 4 Acceptance Criteria

1. Every major capability from phases 1 to 3 maps to a concrete module.
2. API boundaries are clear enough for parallel implementation.
3. Data consistency and security constraints are explicit.