# Admin Workflow Specs

## Purpose

Define step-by-step internal workflows for the core operational modules in MVP.

## Workflow 1: Product Creation And Publishing

### Trigger

New product or variant needs to be listed.

### Steps

1. Catalog Manager opens Product Create.
2. Enter product basics: title, brand, category, subcategory, description.
3. Add media gallery and set primary media.
4. Add variant attributes and SKU-level details.
5. Enter pricing fields and compare price if applicable.
6. Enter stock quantity and low-stock threshold.
7. Enter HSN code and GST percentage.
8. Mark bulk-eligible and invoice-eligible flags.
9. Save draft and run validation.
10. Publish if validation passes and role permits.

### Validation Rules

1. SKU must be unique.
2. Price, stock, and tax fields are mandatory before publish.
3. Category and brand must be valid references.

### Failure Handling

1. Validation errors are inline and grouped by section.
2. Duplicate SKU blocks publish and links to conflicting record.

## Workflow 2: Inventory Update

### Trigger

Stock correction, restock, or low-stock alert.

### Steps

1. User opens Inventory module or alert.
2. Locate product or variant by SKU or name.
3. Enter adjustment quantity and reason.
4. Confirm update.
5. System records movement log.

### Validation Rules

1. Negative stock is not allowed unless override permission exists.
2. Adjustment reason is required for manual correction.

### Failure Handling

1. Concurrent update conflict prompts refresh and merge decision.
2. Unauthorized adjustment attempt returns permission warning.

## Workflow 3: Coupon Lifecycle

### Trigger

Campaign launch or performance tuning.

### Steps

1. Owner or Admin opens Coupon Create.
2. Set code, discount type, value, validity dates.
3. Set eligibility rules: min cart value, category include or exclude, product include or exclude, usage cap.
4. Save draft and preview.
5. Activate coupon.
6. Monitor usage and disable or expire as needed.

### Validation Rules

1. Coupon code must be unique.
2. Date range must be valid.
3. Rule conflicts should be detected before activation.

### Failure Handling

1. Invalid rule combinations block activation with clear explanation.
2. Coupon edits on active campaign require confirmation and audit log entry.

## Workflow 4: Order Fulfillment

### Trigger

New order enters queue.

### Steps

1. Order Operations opens pending order.
2. Review payment status, address, item availability, and tax details.
3. Move status to confirmed.
4. Prepare packing list and move status to packed.
5. Add shipment reference if available and move to shipped.
6. Mark delivered on confirmation.
7. Handle cancellation or return when applicable.

### Validation Rules

1. Status transitions must follow allowed sequence.
2. Delivered status requires shipped state first.
3. Cancellation after shipped requires override or return flow.

### Failure Handling

1. Invalid transition attempt displays allowed next statuses.
2. Missing required fields such as shipment reference for shipped state prompts correction.

## Workflow 5: Invoice Generation

### Trigger

Order reaches invoice-eligible state.

### Steps

1. User opens order detail.
2. Verify tax fields and customer billing details.
3. Generate invoice.
4. Store invoice record with immutable invoice number.
5. Expose invoice to customer order detail view.

### Validation Rules

1. HSN and GST values must exist per line item.
2. Invoice number must be unique and sequential by configured format.

### Failure Handling

1. Missing tax data blocks generation and lists required corrections.
2. Regeneration rules must prevent unauthorized overwrite.

## Workflow 6: Bulk Request Handling

### Trigger

Customer submits bulk quote request.

### Steps

1. Order Operations opens new bulk request.
2. Verify request completeness and contact details.
3. Add response notes and proposed pricing or steps.
4. Update request status: new, contacted, quoted, converted, closed.
5. If converted, create linked order record or checkout path.

### Validation Rules

1. Contact details and product intent are required.
2. Status updates require note for non-terminal transitions.

### Failure Handling

1. Incomplete requests are flagged for follow-up.
2. Duplicate requests from same context are merged or linked.

## Workflow 7: Support Resolution

### Trigger

Support issue received from order or checkout context.

### Steps

1. Support ticket or conversation appears in queue.
2. Agent opens linked order or bulk context.
3. Agent adds note and selects resolution action.
4. If order update needed, perform allowed operational action.
5. Mark resolved with resolution summary.

### Validation Rules

1. Resolution status requires summary note.
2. Any status-changing action must be logged.

### Failure Handling

1. Missing context triggers lookup prompt by order ID or customer contact.
2. Unauthorized operations return escalation instruction.

## Phase 3 Acceptance Criteria

1. Catalog, inventory, coupon, order, invoice, bulk, and support workflows are fully defined.
2. Allowed transitions and validation rules are explicit.
3. Engineering can implement workflow logic without inventing business behavior.