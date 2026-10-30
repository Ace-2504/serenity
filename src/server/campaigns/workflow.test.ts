import { describe, expect, it } from "vitest";
import { inHoldout, readUnsubscribeToken, unsubscribeToken } from "@/server/campaigns/tokens";
import { approve, cancel, edit, mentionsOffer, pendingApprovals, startSending, validateOffer, WorkflowError, type CampaignState } from "@/server/campaigns/workflow";

const draft = (over: Partial<CampaignState> = {}): CampaignState => ({ status: "draft", approvals: {}, hasOffer: true, eligibleTreatment: 12, subject: "Back to school", body: "Hello {{name}}, {{offer}}", ...over });
const all = (s: CampaignState) => ["audience", "content", "offer", "send"].reduce((st, step) => approve(st, step as never, "owner"), s);

describe("campaign approvals", () => {
  it("requires audience, content, offer and send approvals in that order", () => {
    let s = draft();
    expect(pendingApprovals(s)).toEqual(["audience", "content", "offer", "send"]);
    expect(() => approve(s, "send", "owner")).toThrow(/audience first/);
    s = approve(s, "audience", "owner");
    expect(s.status).toBe("audience_approved");
    s = approve(s, "content", "owner");
    expect(s.status).toBe("audience_approved"); // offer still pending
    s = approve(s, "offer", "owner");
    expect(s.status).toBe("content_approved");
    s = approve(s, "send", "owner");
    expect(s.status).toBe("ready");
    expect(startSending(s).status).toBe("sending");
  });

  it("skips the offer step when there is no offer, and refuses to approve one", () => {
    const s = draft({ hasOffer: false });
    expect(pendingApprovals(s)).toEqual(["audience", "content", "send"]);
    expect(() => approve(approve(approve(s, "audience", "o"), "content", "o"), "offer", "o")).toThrow(WorkflowError);
  });

  it("cannot send before every approval", () => {
    expect(() => startSending(approve(draft(), "audience", "o"))).toThrow(/not approved every step/);
  });

  it("withdraws later approvals when an approved part is edited", () => {
    const ready = all(draft());
    const edited = edit(ready, "content", { body: "New wording" });
    expect(Object.keys(edited.approvals)).toEqual(["audience"]);
    expect(edited.status).toBe("audience_approved");
    expect(() => startSending(edited)).toThrow(WorkflowError);
    expect(Object.keys(edit(ready, "audience", { eligibleTreatment: 5 }).approvals)).toEqual([]);
  });

  it("will not approve an audience nobody consented in, or empty content", () => {
    expect(() => approve(draft({ eligibleTreatment: 0 }), "audience", "o")).toThrow(/agreed to be contacted/);
    expect(() => approve(approve(draft({ body: " " }), "audience", "o"), "content", "o")).toThrow(/Write a subject/);
  });

  it("cannot cancel or change a campaign that is sending", () => {
    const sending = startSending(all(draft()));
    expect(() => cancel(sending)).toThrow(WorkflowError);
    expect(() => edit(sending, "content", { body: "x" })).toThrow(WorkflowError);
    expect(cancel(draft()).status).toBe("cancelled");
  });

  it("bounds discounts; no discount is ever applied automatically", () => {
    expect(validateOffer({ kind: "percent_off", value: 60 })).toEqual(["The discount cannot exceed 50%"]);
    expect(validateOffer({ kind: "percent_off", value: 0 })).toEqual(["The discount must be more than 0%"]);
    expect(validateOffer(null)).toEqual([]);
  });
});

describe("unsubscribe tokens and holdout", () => {
  it("round-trips and rejects tampering", () => {
    const token = unsubscribeToken("t1", "p1", "email");
    expect(readUnsubscribeToken(token)).toEqual({ tenantId: "t1", partyId: "p1", channel: "email" });
    const [payload] = token.split(".");
    const forged = `${Buffer.from("t1.p2.email").toString("base64url")}.${token.split(".")[1]}`;
    expect(readUnsubscribeToken(forged)).toBeNull();
    expect(readUnsubscribeToken(`${payload}.AAAA`)).toBeNull();
  });

  it("splits a stable share of customers into the holdout", () => {
    const ids = Array.from({ length: 2000 }, (_, i) => `p${i}`);
    const held = ids.filter((id) => inHoldout("c1", id, 10));
    expect(held.length / ids.length).toBeGreaterThan(0.08);
    expect(held.length / ids.length).toBeLessThan(0.12);
    expect(ids.filter((id) => inHoldout("c1", id, 10))).toEqual(held);
    expect(ids.filter((id) => inHoldout("c1", id, 0))).toEqual([]);
  });
});

describe("offer wording", () => {
  it("refuses to approve an offer the message never mentions", () => {
    const s = ["audience", "content"].reduce((st, step) => approve(st, step as never, "owner"), draft({ body: "Hello {{name}}" }));
    expect(() => approve(s, "offer", "owner")).toThrow(/does not mention the offer/);
    expect(mentionsOffer({ subject: "{{ offer }} for you", body: "Hi" })).toBe(true);
  });
});
