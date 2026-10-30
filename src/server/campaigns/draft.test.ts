import { describe, expect, it } from "vitest";
import type { ChatModel } from "@/server/assistant/llm";
import { suggestDraft } from "@/server/campaigns/draft";

const model = (content: string): ChatModel => ({ name: "scripted", chat: async () => ({ content, toolCalls: [] }) });
const offer = { kind: "percent_off" as const, value: 10 };

describe("suggested campaign wording", () => {
  it("uses the model's draft when it invents nothing", async () => {
    const d = await suggestDraft(model("Subject: {{offer}} on notebooks, {{name}}\nDear {{name}}, enjoy 10% off your next order."), "Kalamkaar", "Win back", offer);
    expect(d.source).toBe("model");
  });

  it("falls back to the template when the model invents a number", async () => {
    const d = await suggestDraft(model("Subject: Big sale\nDear {{name}}, 40% off everything until 31 March, prices from ₹99."), "Kalamkaar", "Win back", offer);
    expect(d.source).toBe("template");
    expect(d.note).toMatch(/40%/);
  });

  it("works without a model", async () => {
    const d = await suggestDraft(null, "Kalamkaar", "Win back schools", null);
    expect(d).toMatchObject({ source: "template" });
    expect(d.body).toContain("{{name}}");
  });
});
