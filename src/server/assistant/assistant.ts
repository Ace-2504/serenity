import { checkAnswer, collectNumbers, type GuardResult } from "@/server/assistant/guard";
import type { ChatMessage, ChatModel } from "@/server/assistant/llm";
import { runTool, toolDefinitions, ToolArgsError, TOOLS, type ToolContext, type ToolResult } from "@/server/assistant/tools";

/**
 * Question -> model chooses tools -> server validates and runs them -> model writes the answer
 * -> numeric guard. Ollama cannot be forced to call a tool, so a reply without one is retried
 * once with a stricter instruction, then answered by the deterministic router. An answer whose
 * numbers are not all in the tool results is withheld and replaced by the tools' own summaries.
 */

export type ToolTrace = { name: string; args: unknown; result?: ToolResult; error?: string };
export type AssistantAnswer = {
  answer: string;
  /** llm: the model's wording passed the guard; template: deterministic summaries; unsupported: no tool fits. */
  mode: "llm" | "template" | "unsupported";
  tools: ToolTrace[];
  guard: GuardResult | null;
  note?: string;
};

const MAX_ROUNDS = 4;

export const SUPPORTED_QUESTIONS = [
  "How profitable was the last 12 months?",
  "Which products made the most profit?",
  "Which stock is not moving?",
  "Which valuable customers have gone quiet?",
  "Who owes me money?",
  "How long do customers take to pay?",
  "Which channels make money after fees?",
  "What should I look at first?"
];

/** Deterministic keyword router: works with no language model at all. */
const ROUTES: [RegExp, string, Record<string, unknown>][] = [
  [/recommend|what should|look at first|problem|opportunit|finding/i, "open_findings", {}],
  [/channel|amazon|meesho|blinkit|zepto|instamart|marketplace|fee|payout|fill rate/i, "channel_performance", {}],
  [/owe|receivable|overdue|outstanding|collect money/i, "receivables", {}],
  [/days to (pay|collect)|dso|dpo|cash cycle|take to pay/i, "cash_cycle", {}],
  [/slow|dead stock|not moving|not selling|stuck stock/i, "slow_stock", {}],
  [/lapsing|gone quiet|stopped (buying|ordering)|lost customer|inactive customer/i, "customer_segments", { segment: "lapsing" }],
  [/(top|best|most profitable).*(product|item)|(product|item).*(profit|best)/i, "top_products", {}],
  [/(worst|least|loss).*(product|item)/i, "top_products", { order: "worst" }],
  [/profit|margin|sales|revenue|how (did|are) we doing/i, "profit_overview", {}]
];

export function route(question: string): { tool: string; args: Record<string, unknown> } | null {
  const hit = ROUTES.find(([re]) => re.test(question));
  return hit ? { tool: hit[1], args: hit[2] } : null;
}

function systemPrompt(business: string, dataEnd: string | null): string {
  return [
    `You are the business assistant for ${business}, an Indian trading business. Data runs to ${dataEnd ?? "an unknown date"}.`,
    "Always call one of the provided tools to get figures. Never calculate, estimate or invent numbers: every number you write must appear in a tool result.",
    "Write money in rupees with Indian units as the tool summaries do (₹ L for lakh, ₹ Cr for crore). Keep answers to at most five short sentences.",
    "If no tool can answer, say so plainly and suggest one of the questions the tools cover."
  ].join(" ");
}

async function templated(ctx: ToolContext, question: string, traces: ToolTrace[], note?: string): Promise<AssistantAnswer> {
  if (!traces.some((t) => t.result)) {
    const r = route(question);
    if (!r) {
      return { answer: `I can't map that to one of the approved reports. Try: ${SUPPORTED_QUESTIONS.join(" · ")}`, mode: "unsupported", tools: traces, guard: null, note };
    }
    try {
      traces.push({ name: r.tool, args: r.args, result: await runTool(ctx, r.tool, r.args) });
    } catch (error) {
      traces.push({ name: r.tool, args: r.args, error: (error as Error).message });
    }
  }
  const answer = traces.filter((t) => t.result).map((t) => t.result!.summary).join(" ");
  return { answer: answer || "The report could not be produced.", mode: "template", tools: traces, guard: null, note };
}

export async function ask(ctx: ToolContext & { business: string; dataEnd: string | null }, question: string, model: ChatModel | null): Promise<AssistantAnswer> {
  const q = question.trim().slice(0, 500);
  if (!model) return templated(ctx, q, [], "No language model is connected; answered from the matching report.");

  const traces: ToolTrace[] = [];
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(ctx.business, ctx.dataEnd) },
    { role: "user", content: q }
  ];
  const tools = toolDefinitions();
  let retried = false;
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const reply = await model.chat(messages, tools);
    if (reply.toolCalls.length === 0) {
      if (!traces.some((t) => t.result)) {
        if (retried) return templated(ctx, q, traces, "The model did not use a report, so the matching report answered instead.");
        retried = true;
        messages.push({ role: "assistant", content: reply.content }, { role: "user", content: "Call one of the tools now to get the figures; do not answer from memory." });
        continue;
      }
      const answer = (reply.content ?? "").trim();
      const allowed = collectNumbers(traces.map((t) => ({ args: t.args, result: t.result })));
      const guard = checkAnswer(answer, allowed, q);
      if (!answer || !guard.ok) {
        const t = await templated(ctx, q, traces, guard.ok ? "The model gave no answer." : `The model's wording was withheld because it contained numbers not found in the reports (${guard.unmatched.join(", ")}).`);
        return { ...t, guard };
      }
      return { answer, mode: "llm", tools: traces, guard };
    }
    messages.push({ role: "assistant", content: reply.content, tool_calls: reply.toolCalls });
    for (const call of reply.toolCalls) {
      let args: unknown = {};
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        args = null;
      }
      try {
        if (args === null) throw new ToolArgsError("Arguments are not valid JSON");
        const result = await runTool(ctx, call.function.name, args);
        traces.push({ name: call.function.name, args, result });
        messages.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: JSON.stringify({ title: result.title, summary: result.summary, facts: result.facts, rows: result.rows }) });
      } catch (error) {
        const message = error instanceof ToolArgsError ? error.message : "The report failed";
        traces.push({ name: call.function.name, args, error: message });
        messages.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: JSON.stringify({ error: message, available_tools: TOOLS.map((t) => t.name) }) });
      }
    }
  }
  return templated(ctx, q, traces, "The model used too many steps; answered from the reports it requested.");
}
