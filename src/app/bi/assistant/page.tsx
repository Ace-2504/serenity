import { AssistantChat } from "@/components/bi/assistant-chat";
import { SUPPORTED_QUESTIONS } from "@/server/assistant/assistant";
import { llmSettings } from "@/server/assistant/llm";
import { getBiContext } from "@/server/bi/context";

export const dynamic = "force-dynamic";

async function modelStatus() {
  try {
    const s = llmSettings();
    if (!s.local && !s.remoteAllowed) return { online: false, text: `Configured for ${s.host}, which is outside this network; external AI is switched off.` };
    const r = await fetch(`${s.baseUrl}/v1/models`, { signal: AbortSignal.timeout(1500) }).catch(() => null);
    return r?.ok
      ? { online: true, text: `Local model ${s.model} at ${s.host}${s.local ? "" : " (external, enabled by the owner)"}.` }
      : { online: false, text: `No model server answering at ${s.host}. Questions are answered from the matching report until one is running (for example: ollama pull ${s.model}).` };
  } catch (error) {
    return { online: false, text: (error as Error).message };
  }
}

export default async function AssistantPage() {
  const bi = (await getBiContext())?.context;
  if (!bi) return null;
  const status = await modelStatus();
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <section className="rounded-xl2 border border-mist bg-canvas p-5">
        <h2 className="font-display text-2xl">Ask about your business</h2>
        <p className="mt-1 text-sm text-graphite">
          The assistant can only read your data through a fixed set of reports. It cannot run its own database queries, and any answer containing a number that is not in
          those reports is withheld and replaced by the report&apos;s own summary.
        </p>
        <p className={`mt-2 text-xs ${status.online ? "text-forest" : "text-graphite"}`}>{status.text}</p>
      </section>
      <AssistantChat suggestions={SUPPORTED_QUESTIONS} />
    </div>
  );
}
