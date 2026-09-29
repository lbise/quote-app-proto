import { createAssistantMessageEventStream, fauxAssistantMessage, fauxProvider, type AssistantMessage } from "@earendil-works/pi-ai";

import type { QuoteAIModelBoundary } from "./quote-assistant.server";

/** A credential the scripted model puts in its payload; Turn Traces must never store it. */
export const secret = "sk-turn-trace-test-credential-0123456789";

/** A model boundary that answers each call with the next scripted message and reports a provider payload, like real providers do. */
export function scriptedModel(messages: AssistantMessage[], hooks: { beforeCall?: (call: number) => Promise<void> | void } = {}) {
  const model = fauxProvider().getModel();
  let calls = 0;
  const boundary: QuoteAIModelBoundary = {
    model,
    timeoutMs: 2_000,
    streamFn: async (requestModel, context, options) => {
      calls += 1;
      await hooks.beforeCall?.(calls);
      await options?.onPayload?.({
        model: requestModel.id,
        system: context.systemPrompt,
        messages: context.messages,
        tools: context.tools?.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters })),
        // Providers never put credentials in the payload; the Turn Trace must drop them even if one did.
        apiKey: secret,
        headers: { Authorization: `Bearer ${secret}` },
        note: `key ${secret} in text`,
      }, requestModel);
      const message = messages.shift();
      if (!message) throw new Error("No scripted response left.");
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        stream.push({ type: "start", partial: message });
        if (message.stopReason === "error" || message.stopReason === "aborted") stream.push({ type: "error", reason: message.stopReason, error: message });
        else stream.push({ type: "done", reason: message.stopReason as "stop" | "length" | "toolUse", message });
        stream.end();
      });
      return stream;
    },
  };
  return boundary;
}

/** A scripted model response with usage. */
export function response(content: Parameters<typeof fauxAssistantMessage>[0], options: { stopReason?: AssistantMessage["stopReason"]; errorMessage?: string; input?: number; output?: number; cost?: number } = {}): AssistantMessage {
  const message = fauxAssistantMessage(content, { stopReason: options.stopReason, errorMessage: options.errorMessage });
  const input = options.input ?? 100;
  const output = options.output ?? 20;
  return { ...message, provider: "faux", model: "faux-1", usage: { input, output, cacheRead: 0, cacheWrite: 0, totalTokens: input + output, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: options.cost ?? 0.001 } } };
}
