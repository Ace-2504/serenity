# Non-Functional Requirements

## Purpose

Define baseline performance, reliability, security, and operability targets for MVP.

## Performance Targets

1. Home, listing, and product detail initial render should be fast enough for mobile-first commerce expectations.
2. Key page response targets:
   - Catalog read APIs: p95 under 400ms.
   - Cart and wishlist mutations: p95 under 500ms.
   - Checkout validation endpoints: p95 under 700ms.
3. Largest Contentful Paint target for key storefront pages under 2.5 seconds on representative mobile conditions.

## Reliability Targets

1. Core checkout and order APIs should target 99.9 percent monthly availability.
2. Payment webhook processing should be idempotent and resilient to retries.
3. Critical background jobs (invoice, notification) must include retry and dead-letter handling.

## Security Requirements

1. Passwords stored as strong hashes with modern algorithm.
2. Session cookies must be HTTP-only and secure.
3. CSRF protections enabled for authenticated mutations.
4. Role-based authorization enforced in admin routes and service layer.
5. Input validation on every mutation endpoint.
6. Audit logging for sensitive changes.
7. Secrets managed outside source code.

## Privacy And Compliance

1. Minimize stored personal data to what is needed for operations.
2. Restrict customer data export to authorized roles.
3. Store tax and invoice records with retention policy.
4. Ensure support records avoid unnecessary sensitive detail.

## Observability Requirements

1. Structured logs with correlation IDs.
2. Metrics for request latency, error rate, checkout conversion, payment failures, and order-state throughput.
3. Alerting thresholds for payment failure spikes and order-processing backlogs.
4. Dashboard views for API health and queue health.

## Scalability And Maintainability

1. Keep module boundaries clean enough to split services later.
2. Avoid hard coupling between storefront and admin UI logic.
3. Use shared domain schemas for validation consistency.
4. Version APIs to support backward-compatible evolution.

## Accessibility Requirements

1. Customer and admin interfaces must support keyboard navigation.
2. Color contrast and focus states should satisfy accessibility best practices.
3. Forms must provide readable validation messaging.

## Backup And Recovery

1. Daily automated database backups.
2. Point-in-time recovery strategy for production database.
3. Documented restore drill cadence.

## Testing Requirements

1. Unit tests for domain logic and validation.
2. Integration tests for checkout, payment webhook, and order transitions.
3. End-to-end tests for purchase and admin fulfillment critical paths.

## Phase 4 Acceptance Criteria

1. NFR targets are concrete enough to guide implementation and monitoring.
2. Reliability and security requirements cover checkout and admin risk areas.
3. Observability requirements align with business-critical workflows.