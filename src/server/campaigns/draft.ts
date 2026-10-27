import { checkAnswer } from "@/server/assistant/guard";
import type { ChatModel } from "@/server/assistant/llm";
import type { Offer } from "@/server/campaigns/workflow";

/**
 * Suggested campaign wording. The model may only use the campaign's own facts; a suggestion with
 * any number other than the offer is rejected for the template. Suggestions are never saved or
 * sent by themselves: the owner edits, saves and approves.
 */

export type Draft = { subject: string; body: string; source: "model" | "template"; note?: string };

export function templateDraft(business: string, goal: string, offer: Offer): Draft {
  return {
    subject: offer ? `{{offer}} for you, {{name}}` : `We have what you need, {{name}}`,
    body: [
      "Dear {{name}},",
      "",
      `It has been a while since your last order with ${business}. ${goal.endsWith(".") ? goal : `${goal}.`}`,
      offer ? "As a thank-you, we are offering {{offer}} on your next order." : "Reply to this message or call us and we will set aside what you need.",
      "",
      "Regards,",
      business
    ].join("\n"),
    source: "template"
  };
}

export async function suggestDraft(model: ChatModel | null, business: string, goal: string, offer: Offer): Promise<Draft> {
  const fallback = templateDraft(business, goal, offer);
  if (!model) return { ...fallback, note: "No language model is connected; this is a template." };
  const reply = await model.chat(
    [
      {
        role: "system",
        content:
          "You write short, polite customer emails for an Indian small business. Output exactly two parts: a first line starting with 'Subject:' and then the body. " +
          "Use {{name}} for the customer's name and {{offer}} for the offer. Do not write any other numbers, prices, dates or claims. Under 90 words."
      },
      { role: "user", content: `Business: ${business}. Goal: ${goal}. Offer: ${offer ? "yes, refer to it only as {{offer}}" : "none"}.` }
    ],
    []
  );
  const text = (reply.content ?? "").trim();
  const match = /^subject:\s*(.+)\n+([\s\S]+)$/i.exec(text);
  if (!match) return { ...fallback, note: "The model's draft was not in the expected form; this is a template." };
  const allowed = offer ? [offer.value] : [];
  const guard = checkAnswer(`${match[1]}\n${match[2]}`.replace(/\{\{\s*\w+\s*\}\}/g, ""), allowed);
  if (!guard.ok) return { ...fallback, note: `The model's draft contained numbers that are not part of this campaign (${guard.unmatched.join(", ")}); this is a template.` };
  return { subject: match[1].trim().slice(0, 200), body: match[2].trim().slice(0, 5000), source: "model" };
}
