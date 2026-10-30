/**
 * Campaign approval state machine. The owner approves, in order: the audience, the content, the
 * offer (only if there is one) and finally the send. Nothing reaches a customer before the send
 * approval, and changing an approved part withdraws every later approval. Pure functions; the
 * caller persists the result and records who acted.
 */

export type CampaignStatus = "draft" | "audience_approved" | "content_approved" | "ready" | "sending" | "sent" | "cancelled";
export type Approval = "audience" | "content" | "offer" | "send";
export type Offer = { kind: "percent_off"; value: number; note?: string } | null;

export type CampaignState = {
  status: CampaignStatus;
  approvals: Partial<Record<Approval, { at: string; by: string }>>;
  hasOffer: boolean;
  eligibleTreatment: number;
  subject: string | null;
  body: string | null;
};

export const MAX_DISCOUNT_PCT = 50;
export class WorkflowError extends Error {}

const ORDER: Approval[] = ["audience", "content", "offer", "send"];

function statusFor(state: CampaignState): CampaignStatus {
  if (state.status === "sending" || state.status === "sent" || state.status === "cancelled") return state.status;
  const a = state.approvals;
  if (a.send) return "ready";
  if (a.content && (a.offer || !state.hasOffer)) return "content_approved";
  if (a.audience) return "audience_approved";
  return "draft";
}

/** What the owner must still approve, in order. */
export function pendingApprovals(state: CampaignState): Approval[] {
  return ORDER.filter((step) => (step !== "offer" || state.hasOffer) && !state.approvals[step]);
}

export function approve(state: CampaignState, step: Approval, by: string, at = new Date().toISOString()): CampaignState {
  if (state.status === "sending" || state.status === "sent" || state.status === "cancelled") throw new WorkflowError(`The campaign is ${state.status}`);
  if (step === "offer" && !state.hasOffer) throw new WorkflowError("There is no offer to approve");
  const before = pendingApprovals(state);
  if (before[0] !== step) throw new WorkflowError(before.length ? `Approve the ${before[0]} first` : "Everything is already approved");
  if (step === "audience" && state.eligibleTreatment === 0) throw new WorkflowError("No customer in the audience has agreed to be contacted on this channel");
  if (step === "content" && (!state.subject?.trim() || !state.body?.trim())) throw new WorkflowError("Write a subject and a message first");
  if (step === "offer" && !mentionsOffer(state)) throw new WorkflowError("The message does not mention the offer: add {{offer}} where it should appear, or remove the offer");
  const next = { ...state, approvals: { ...state.approvals, [step]: { at, by } } };
  return { ...next, status: statusFor(next) };
}

/** Editing a part withdraws its approval and every later one. */
export function edit(state: CampaignState, part: "audience" | "content" | "offer", changes: Partial<Pick<CampaignState, "hasOffer" | "eligibleTreatment" | "subject" | "body">>): CampaignState {
  if (state.status === "sending" || state.status === "sent" || state.status === "cancelled") throw new WorkflowError(`The campaign is ${state.status}`);
  const from = ORDER.indexOf(part);
  const approvals = Object.fromEntries(Object.entries(state.approvals).filter(([k]) => ORDER.indexOf(k as Approval) < from));
  const next = { ...state, ...changes, approvals };
  return { ...next, status: statusFor(next) };
}

export function startSending(state: CampaignState): CampaignState {
  if (state.status !== "ready" || pendingApprovals(state).length > 0) throw new WorkflowError("The owner has not approved every step");
  return { ...state, status: "sending" };
}

export function cancel(state: CampaignState): CampaignState {
  if (state.status === "sending" || state.status === "sent") throw new WorkflowError("A campaign that has started sending cannot be cancelled");
  return { ...state, status: "cancelled" };
}

/** Whether the subject or message shows the offer, so the customer sees what the owner approved. */
export const mentionsOffer = (state: Pick<CampaignState, "subject" | "body">) => /\{\{\s*offer\s*\}\}/.test(`${state.subject ?? ""} ${state.body ?? ""}`);

export function validateOffer(offer: Offer): string[] {
  if (!offer) return [];
  const problems: string[] = [];
  if (!(offer.value > 0)) problems.push("The discount must be more than 0%");
  if (offer.value > MAX_DISCOUNT_PCT) problems.push(`The discount cannot exceed ${MAX_DISCOUNT_PCT}%`);
  return problems;
}
