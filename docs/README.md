# Documentation Index

## Phase 1

1. [product-requirements.md](./product-requirements.md): business goals, MVP scope, user roles, requirements, and phase 1 acceptance criteria.
2. [ux-blueprint.md](./ux-blueprint.md): brand direction, color and type system, page principles, and component inventory.
3. [information-architecture.md](./information-architecture.md): sitemap, taxonomy, filter model, product fields, and page inventory.
4. [event-tracking-map.md](./event-tracking-map.md): storefront and admin analytics events with KPI mapping.
5. [user-journeys.md](./user-journeys.md): customer and admin flows from discovery through fulfillment and support.
6. [business-rules.md](./business-rules.md): product, checkout, catalog, operations, and support rules that anchor implementation.
7. [phase-1-handoff.md](./phase-1-handoff.md): locked decisions, remaining questions, and exit criteria for phase completion.
8. [detailed-phase-plan.md](./detailed-phase-plan.md): detailed plan for phases 1 through 6 with workstreams, outputs, dependencies, risks, and exit criteria.

## Phase 2

1. [phase-2-wireframe-specs.md](./phase-2-wireframe-specs.md): screen-by-screen layout and module specifications for the storefront.
2. [design-token-spec.md](./design-token-spec.md): implementation-ready tokens for type, color, spacing, layout, and motion.
3. [interaction-state-matrix.md](./interaction-state-matrix.md): default, failure, and recovery behaviors for customer flows.
4. [content-microcopy-guidelines.md](./content-microcopy-guidelines.md): tone, CTA, trust copy, and error-message rules.
5. [phase-2-handoff.md](./phase-2-handoff.md): locked phase 2 decisions, remaining questions, and exit criteria.

## Phase 3

1. [admin-information-architecture.md](./admin-information-architecture.md): owner and admin module structure, screen inventory, and navigation model.
2. [role-permission-matrix.md](./role-permission-matrix.md): role-level permissions and sensitive-action controls.
3. [admin-workflow-specs.md](./admin-workflow-specs.md): step-by-step operational workflows and validation rules.
4. [admin-ui-behavior-rules.md](./admin-ui-behavior-rules.md): interaction standards for tables, forms, statuses, alerts, and exports.
5. [phase-3-handoff.md](./phase-3-handoff.md): locked decisions, dependencies for phase 4, open questions, and exit criteria.

## Phase 4

1. [technical-architecture.md](./technical-architecture.md): stack recommendation, module boundaries, routing model, and system behavior.
2. [data-model-schema.md](./data-model-schema.md): core entities, fields, relationships, statuses, and index guidance.
3. [api-contract-outline.md](./api-contract-outline.md): customer and admin REST endpoint inventory and conventions.
4. [integration-map.md](./integration-map.md): external integrations, contracts, failure modes, and security requirements.
5. [non-functional-requirements.md](./non-functional-requirements.md): performance, reliability, security, observability, and testing baselines.
6. [phase-4-handoff.md](./phase-4-handoff.md): locked technical decisions, build inputs, open questions, and exit criteria.

## Phase 5

1. [phase-5-handoff.md](./phase-5-handoff.md): implementation status, added modules, and remaining build work.

## Recommended Next Work

1. Close remaining policy and provider decisions captured in phase-4-handoff and phase-5-handoff.
2. Implement auth, checkout, and order workflows over Prisma-backed services.
3. Start phase 6 verification planning with test matrices for customer and admin critical paths.