# Admin UI Behavior Rules

## Purpose

Standardize interaction patterns across admin modules to improve speed, reduce mistakes, and support auditability.

## Table Behavior

1. All major lists support search, sort, filtering, and pagination.
2. Default sort should match operational urgency.
3. Bulk actions require explicit selection and confirmation.
4. Column visibility preferences can be remembered per user.

## Filter Behavior

1. Filters should include status, date range, and responsible role when relevant.
2. Applied filters remain visible and removable individually.
3. Empty results should preserve filter context and suggest reset actions.

## Form Behavior

1. Required fields are labeled and validated inline.
2. Save draft and publish actions are clearly separated.
3. Long forms should use section grouping with sticky actions.
4. Unsaved changes warning appears on navigation away.

## State And Status Behavior

1. Status chips use consistent color and label semantics across modules.
2. Transition actions only show allowed next states.
3. Terminal states require explicit confirmation.
4. Backdated state edits require elevated permission and reason capture.

## Detail Pane Behavior

1. Record detail pages show key metadata at the top.
2. Secondary tabs separate operational details, history, and notes.
3. Audit timeline is visible for critical records.

## Notifications And Alerts

1. Toasts are used for transient success feedback.
2. Blocking failures appear inline and in summary at top.
3. Critical alerts use persistent banners until resolved.

## Export Behavior

1. Export actions require role permission.
2. Exported file format defaults to CSV for MVP.
3. Export metadata includes filter context and timestamp.

## Performance Rules

1. Lists should render useful content quickly, with skeletons for delayed sections.
2. Search and filter operations should avoid full page refresh.
3. Expensive operations show progress and completion status.

## Accessibility Rules

1. Keyboard navigation must work for all form controls and table actions.
2. Status and validation cues should not rely on color alone.
3. Interactive elements require clear focus states.

## Phase 3 Acceptance Criteria

1. Admin interaction rules are consistent across modules.
2. High-risk actions are guarded with confirmations and reasons.
3. Common list and form behaviors are predictable for all roles.