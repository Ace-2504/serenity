import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { dataSpan } from "@/server/analytics/profitability";
import { ask, type AssistantAnswer } from "@/server/assistant/assistant";
import { LlmConfigError, LlmUnavailableError, OpenAICompatibleModel } from "@/server/assistant/llm";
import { jsonError, requireBi } from "@/server/bi/api";
import { LIMITS, tooManyRequests } from "@/server/security/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const body = z.object({ question: z.string().trim().min(3).max(500) });

/** Ask the assistant. Read-only; any member of the business may ask. Rate-limited per user. */
export async function POST(request: NextRequest) {
  const bi = await requireBi(request);
  if (bi instanceof NextResponse) return bi;
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return jsonError(400, "INVALID_INPUT", "Ask a question of 3 to 500 characters");
  const limited = LIMITS.assistantPerUser.take(bi.userId);
  if (!limited.ok) return tooManyRequests(limited.retryAfterSec, "Too many questions; wait a minute");

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
