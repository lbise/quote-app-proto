import { describe, expect, it } from "vitest";

import { turnTraceSteps, type TurnTraceModelCall, type TurnTraceToolCall } from "./turn-trace";

const modelCall = (sequence: number, toolCallIds: string[] = []): TurnTraceModelCall => ({
  sequence, provider: "faux", model: "faux-1", startedAt: "2026-09-01T08:00:00.000Z",
  settings: { maxTokens: 4096, reasoning: "off", timeoutMs: 20_000 },
  response: { role: "assistant", content: [{ type: "text", text: "…" }, ...toolCallIds.map((id) => ({ type: "toolCall", id, name: "edit_quote_lines", arguments: {} }))] },
});
const toolCall = (toolCallId: string): TurnTraceToolCall => ({ toolCallId, name: "edit_quote_lines", arguments: {}, outcome: "applied", result: {} });

describe("turnTraceSteps", () => {
  it("puts each model call before the tool calls it asked for, in order", () => {
    const steps = turnTraceSteps({
      modelCalls: [modelCall(1, ["a", "b"]), modelCall(2, ["c"]), modelCall(3)],
      toolCalls: [toolCall("a"), toolCall("b"), toolCall("c")],
    });
    expect(steps.map((step) => step.kind === "model" ? `model ${step.call.sequence}` : `tool ${step.call.toolCallId}`))
      .toEqual(["model 1", "tool a", "tool b", "model 2", "tool c", "model 3"]);
  });

  it("keeps tool calls it cannot match to a response at the end", () => {
    const steps = turnTraceSteps({ modelCalls: [modelCall(1), { ...modelCall(2), response: undefined }], toolCalls: [toolCall("orphan")] });
    expect(steps.map((step) => step.kind)).toEqual(["model", "model", "tool"]);
  });
});
