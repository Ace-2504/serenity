/**
 * OpenAI-compatible chat client for a local model server (Ollama, llama.cpp server). Data stays
 * on this machine by default: a non-local endpoint is refused unless the operator sets
 * LLM_ALLOW_REMOTE=1. The API key, if any, is sent but never logged.
 */

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string; name: string };
export type ChatReply = { content: string | null; toolCalls: ToolCall[] };
export interface ChatModel {
  name: string;
  chat(messages: ChatMessage[], tools: unknown[]): Promise<ChatReply>;
}

export class LlmConfigError extends Error {}
export class LlmUnavailableError extends Error {}

const LOCAL_HOSTS = /^(localhost|127\.\d+\.\d+\.\d+|::1|\[::1\]|host\.docker\.internal|ollama|llm|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/i;

export function llmSettings(env: Record<string, string | undefined> = process.env) {
  const baseUrl = (env.LLM_BASE_URL || "http://localhost:11434").replace(/\/+$/, "");
  const model = env.LLM_MODEL || "qwen2.5:7b-instruct";
  let host: string;
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    throw new LlmConfigError(`LLM_BASE_URL is not a URL`);
  }
  const local = LOCAL_HOSTS.test(host);
  return { baseUrl, model, host, local, remoteAllowed: env.LLM_ALLOW_REMOTE === "1" };
}

export class OpenAICompatibleModel implements ChatModel {
  readonly name: string;
  private readonly baseUrl: string;
  constructor(env: Record<string, string | undefined> = process.env) {
    const s = llmSettings(env);
    if (!s.local && !s.remoteAllowed) {
      throw new LlmConfigError(`The assistant is set to use ${s.host}, which is not on this machine or network. External AI services are off; set LLM_ALLOW_REMOTE=1 only if the owner agrees to send business data there.`);
    }
    this.name = s.model;
    this.baseUrl = s.baseUrl;
    this.apiKey = env.LLM_API_KEY;
  }
  private readonly apiKey: string | undefined;

  async chat(messages: ChatMessage[], tools: unknown[]): Promise<ChatReply> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) },
        body: JSON.stringify({ model: this.name, messages, tools, temperature: 0, stream: false }),
        signal: AbortSignal.timeout(120_000)
      });
    } catch (error) {
      throw new LlmUnavailableError(`No model server answered at ${new URL(this.baseUrl).host} (${(error as Error).name === "TimeoutError" ? "timed out" : "not reachable"})`);
    }
    if (!response.ok) throw new LlmUnavailableError(`The model server answered ${response.status}`);
    const body = (await response.json()) as { choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[] };
    const message = body.choices?.[0]?.message;
    return { content: message?.content ?? null, toolCalls: message?.tool_calls ?? [] };
  }
}
