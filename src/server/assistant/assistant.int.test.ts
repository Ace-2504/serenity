import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ask } from "@/server/assistant/assistant";
import { LlmConfigError, OpenAICompatibleModel, type ChatMessage, type ChatModel, type ChatReply } from "@/server/assistant/llm";
import { runTool, ToolArgsError, toolDefinitions, TOOLS } from "@/server/assistant/tools";
import { forTenant } from "@/server/db/tenant";
import { commitImport, stageImport } from "@/server/ingest/pipeline";
import { TEMPLATE_EXAMPLES } from "@/server/ingest/template-docs";

/**
 * The assistant against a real (small) business, with a scripted model standing in for Ollama:
 * tool routing, argument validation, the numeric guard, retries and the no-model fallback.
 */

let tenantId: string;
let ctx: Parameters<typeof ask>[0];

/** Replays a fixed list of replies and records what it was sent. */
class ScriptedModel implements ChatModel {
  name = "scripted";
  calls: ChatMessage[][] = [];
  constructor(private readonly replies: ((messages: ChatMessage[]) => ChatReply)[]) {}
  async chat(messages: ChatMessage[]): Promise<ChatReply> {
    this.calls.push(messages.map((m) => ({ ...m })));
    const next = this.replies.shift();
    if (!next) throw new Error("script exhausted");
    return next(messages);
  }
}
const toolCall = (name: string, args: unknown, id = "c1"): ChatReply => ({ content: null, toolCalls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
const say = (content: string): ChatReply => ({ content, toolCalls: [] });
const lastToolMessage = (messages: ChatMessage[]) => JSON.parse([...messages].reverse().find((m) => m.role === "tool")!.content as string);

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: "Assistant test", domainPack: "stationery" } })).id;
  const db = forTenant(tenantId);
  const source = await db.dataSource.create({ data: { tenantId, kind: "csv_template", name: "Template upload" } });
  const files = Object.entries(TEMPLATE_EXAMPLES).map(([name, text]) => ({ name, content: Buffer.from(text) }));
  const staged = await stageImport(db, { tenantId, dataSourceId: source.id, files });
  await commitImport(db, tenantId, staged.batchId);
  ctx = { db, tenantId, domainPack: "stationery", business: "Assistant test", dataEnd: "2026-04-10" };
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("tools", () => {
  it("offer JSON-schema definitions for every tool and nothing that runs SQL", () => {
    const defs = toolDefinitions();
    expect(defs.map((d) => d.function.name)).toEqual(TOOLS.map((t) => t.name));
    for (const d of defs) expect(d.function.parameters).toMatchObject({ type: "object" });
    expect(defs.some((d) => /sql|query/i.test(d.function.name))).toBe(false);
  });

  it("refuse unknown tools and invalid arguments", async () => {
    await expect(runTool(ctx, "run_sql", { sql: "select 1" })).rejects.toBeInstanceOf(ToolArgsError);
    await expect(runTool(ctx, "top_products", { limit: 500 })).rejects.toThrow(/limit/);
  });

  it("read only this business's data", async () => {
    const result = await runTool(ctx, "profit_overview", { period: "all" });
    // The template example: one invoice of Rs 380.00 taxable value.
    expect(result.facts.net_sales).toBe(380);
  });
});

describe("assistant", () => {
  it("answers in the model's words when every number is in the tool results", async () => {
    const model = new ScriptedModel([() => toolCall("profit_overview", { period: "all" }), (m) => say(`Net sales were ₹${lastToolMessage(m).facts.net_sales} in the period.`)]);
    const a = await ask(ctx, "How are sales?", model);
    expect(a).toMatchObject({ mode: "llm", guard: { ok: true } });
    expect(a.answer).toBe("Net sales were ₹380 in the period.");
  });

  it("withholds an answer with an altered number and shows the report's summary instead", async () => {
    const model = new ScriptedModel([() => toolCall("profit_overview", { period: "all" }), () => say("Net sales were ₹480 in the period.")]);
    const a = await ask(ctx, "How are sales?", model);
    expect(a.mode).toBe("template");
    expect(a.guard).toMatchObject({ ok: false, unmatched: ["₹480"] });
    expect(a.answer).toContain("net sales were ₹380");
    expect(a.note).toMatch(/withheld/);
  });

  it("feeds argument errors back so the model can correct itself", async () => {
    const model = new ScriptedModel([() => toolCall("top_products", { limit: 99 }), () => toolCall("top_products", { limit: 3 }, "c2"), () => say("Ruled notebook A5 is the top product.")]);
    const a = await ask(ctx, "Best products?", model);
    expect(a.tools.map((t) => (t.error ? "error" : "ok"))).toEqual(["error", "ok"]);
    expect(a.mode).toBe("llm");
    const firstToolReply = JSON.parse(model.calls[1].find((m) => m.role === "tool")!.content as string);
    expect(firstToolReply.error).toMatch(/limit/);
  });

  it("retries once when the model answers without a tool, then falls back to the matching report", async () => {
    const model = new ScriptedModel([() => say("Sales are about ₹10 lakh."), () => say("Still about ₹10 lakh.")]);
    const a = await ask(ctx, "How profitable were we?", model);
    expect(model.calls.length).toBe(2);
    expect(model.calls[1].at(-1)).toMatchObject({ role: "user", content: expect.stringMatching(/Call one of the tools/) });
    expect(a.mode).toBe("template");
    expect(a.tools[0].name).toBe("profit_overview");
    expect(a.answer).not.toContain("10 lakh");
  });

  it("works with no model at all, and says when a question is not supported", async () => {
    expect((await ask(ctx, "Who owes me money?", null)).tools[0].name).toBe("receivables");
    const unsupported = await ask(ctx, "Write me a poem about pens", null);
    expect(unsupported.mode).toBe("unsupported");
    expect(unsupported.answer).toMatch(/approved reports/);
  });
});

describe("model endpoint", () => {
  it("refuses a non-local model server unless the operator allows it", () => {
    expect(() => new OpenAICompatibleModel({ LLM_BASE_URL: "https://api.example-ai.com" })).toThrow(LlmConfigError);
    expect(() => new OpenAICompatibleModel({ LLM_BASE_URL: "https://api.example-ai.com", LLM_ALLOW_REMOTE: "1" })).not.toThrow();
    expect(() => new OpenAICompatibleModel({ LLM_BASE_URL: "http://localhost:11434" })).not.toThrow();
  });
});
