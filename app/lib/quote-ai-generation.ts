import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { getSupportedThinkingLevels, type Api, type Model } from "@earendil-works/pi-ai";

/** Requested settings from deployment configuration or an evaluation launch. */
export type QuoteAIGenerationOptions = {
  /** Untrusted configuration is validated before it reaches Agent. */
  reasoning?: string;
  maxOutputTokens?: number;
};

export type QuoteAIGeneration = {
  reasoning: ThinkingLevel;
  maxOutputTokens: number;
};

export const quoteAIThinkingLevels: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const defaultMaxOutputTokens = 4096;

/** Requested generation settings are not supported by the selected model. */
export class QuoteAIGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuoteAIGenerationError";
  }
}

/**
 * Resolves requested generation settings before they reach Agent. A level is
 * accepted only when the model genuinely supports it; the SDK would otherwise
 * substitute another level (for example, Gemini 3 Flash models send MINIMAL
 * for `off`) and the recorded setting would be false. Unset reasoning means
 * `off` only where off is supported; otherwise an explicit level is required.
 */
export function resolveQuoteAIGeneration(model: Model<Api>, requested?: QuoteAIGenerationOptions): QuoteAIGeneration {
  const supported = getSupportedThinkingLevels(model);
  const choices = supported.join(", ");
  if (requested?.reasoning === undefined && !supported.includes("off")) {
    throw new QuoteAIGenerationError(`${model.provider}/${model.id} cannot turn reasoning off and requires an explicit reasoning setting: ${choices}.`);
  }
  const reasoning = requested?.reasoning ?? "off";
  const maxOutputTokens = requested?.maxOutputTokens ?? defaultMaxOutputTokens;
  if (!quoteAIThinkingLevels.includes(reasoning as ThinkingLevel)) throw new QuoteAIGenerationError("Unsupported reasoning setting.");
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > model.maxTokens) {
    throw new QuoteAIGenerationError(`maxOutputTokens must be an integer from 1 through ${model.maxTokens}.`);
  }
  if (!supported.includes(reasoning as ThinkingLevel)) {
    throw new QuoteAIGenerationError(`Reasoning ${reasoning} is not supported by ${model.provider}/${model.id}; choose one of: ${choices}.`);
  }
  return { reasoning: reasoning as ThinkingLevel, maxOutputTokens };
}
