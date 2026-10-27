import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { dataSpan } from "@/server/analytics/profitability";
import { ask, type AssistantAnswer } from "@/server/assistant/assistant";
import { LlmConfigError, LlmUnavailableError, OpenAICompatibleModel } from "@/server/assistant/llm";
import { jsonError, requireBi } from "@/server/bi/api";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const body = z.object({ question: z.string().trim().min(3).max(500) });
const recent = new Map<string, number[]>();

/** Ask the assistant. Read-only; any member of the business may ask. Rate-limited per user. */
export async function POST(request: NextRequest) {
  const bi = await requireBi(request);
  if (bi instanceof NextResponse) return bi;
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return jsonError(400, "INVALID_INPUT", "Ask a question of 3 to 500 characters");
  const now = Date.now();
  const times = (recent.get(bi.userId) ?? []).filter((t) => now - t < 60_000);
  if (times.length >= 20) return jsonError(429, "RATE_LIMITED", "Too many questions; wait a minute");
  recent.set(bi.userId, [...times, now]);

  const ctx = { db: bi.db, tenantId: bi.tenant.id, domainPack: bi.tenant.domainPack, business: bi.tenant.name, dataEnd: (await dataSpan(bi.db))?.to ?? null };
  const started = Date.now();
  let modelName: string | null = null;
  let answer: AssistantAnswer;
  try {
    const model = new OpenAICompatibleModel();
    modelName = model.name;
    answer = await ask(ctx, parsed.data.question, model);
  } catch (error) {
    if (!(error instanceof LlmUnavailableError || error instanceof LlmConfigError)) throw error;
    answer = await ask(ctx, parsed.data.question, null);
    answer.note = `${error.message}. Answered from the matching report instead.`;
  }
  await bi.db.assistantLog.create({
    data: {
      tenantId: bi.tenant.id,
      userId: bi.userId,
      question: parsed.data.question,
      mode: answer.mode,
      // Tool names, arguments and titles only: results can contain customer data.
      tools: answer.tools.map((t) => ({ name: t.name, args: t.args, title: t.result?.title ?? null, error: t.error ?? null })),
      guardOk: answer.guard?.ok ?? null,
      unmatched: answer.guard?.unmatched ?? [],
      model: modelName,
      latencyMs: Date.now() - started
    }
  });
  return NextResponse.json(answer);
}
