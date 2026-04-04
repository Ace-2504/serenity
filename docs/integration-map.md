# Integration Map

## Purpose

Define third-party and external integration points, ownership boundaries, and failure-handling expectations for MVP.

## Integration Inventory

1. Payment gateway for UPI and cards.
2. WhatsApp channel integration.
3. Email or SMS provider for transactional notifications.
4. Object storage for media and invoice files.
5. Optional analytics sink.

## Payment Integration

### Scope

1. Create payment intent during checkout.
2. Verify and reconcile payment status via webhook.
3. Support UPI and card methods.
4. Handle COD as internal non-gateway method.

### Contract

1. Outbound create-order request to payment provider.
2. Inbound webhook for payment status updates.
3. Signature verification mandatory.
4. Idempotency keys for repeated webhook deliveries.

### Failure Handling

1. Webhook retries processed idempotently.
2. Failed payment keeps cart and checkout context.
3. Payment mismatch triggers reconciliation queue.

## WhatsApp Integration

### Scope

1. Launch support chat with order context where available.
2. Optional status message notifications for key order stages.

### Contract

1. Outbound message events from application.
2. Inbound delivery status callbacks optional for MVP.

### Failure Handling

1. Failed sends logged with retry policy.
2. Fallback channel remains in-app support and phone.

## Email Or SMS Integration

### Scope

1. Send order confirmation.
2. Send order status updates.
3. Send password reset and account verification messages if enabled.

### Failure Handling

1. Message jobs retried via queue.
2. Permanent failures logged for manual support follow-up.

## Storage Integration

### Scope

1. Product image upload and retrieval.
2. Invoice PDF storage and secure retrieval.

### Requirements

1. Signed upload URLs for admin uploads.
2. Public-read policy only for approved storefront media.
3. Private access for invoice files via signed URLs.

## Analytics Integration

### Scope

1. Internal event capture from event tracking map.
2. Optional forwarding to analytics tool.

### Requirements

1. Preserve event schema consistency.
2. Drop or quarantine malformed events.

## Integration Ownership

1. Payments adapter owned by checkout and payments module.
2. Messaging adapters owned by support and notifications module.
3. Storage adapter owned by media and invoice module.
4. Analytics adapter owned by analytics module.

## Integration Secrets And Security

1. All provider keys managed through environment secret manager.
2. No secrets logged in plaintext.
3. Webhook secrets rotated with documented process.

## Phase 4 Acceptance Criteria

1. Every external dependency has defined contract and failure behavior.
2. Integration ownership and module boundaries are explicit.
3. Security requirements are identified for each integration.