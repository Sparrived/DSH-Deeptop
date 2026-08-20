/**
 * Pricing snapshot sourced from models.dev (USD per 1M tokens).
 *
 * Keep this deliberately small and provider-oriented: models.dev contains
 * thousands of routes, while the desktop needs a dependable estimate for the
 * models that are commonly exposed by DSH. Unknown/custom models remain
 * explicitly unpriced instead of being assigned a misleading zero cost.
 * Snapshot refreshed: 2026-08-21.
 */
export type ModelPricing = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
};

export type ModelPricingMatch = ModelPricing & {
  provider: string;
  model: string;
  displayName: string;
  source: "models.dev";
};

const PRICING: Record<string, ModelPricing> = {
  // DeepSeek
  "deepseek/deepseek-chat": { input: 0.14, output: 0.28, cacheRead: 0.0028 },
  "deepseek/deepseek-reasoner": { input: 0.14, output: 0.28, cacheRead: 0.0028 },
  "deepseek/deepseek-v4-flash": { input: 0.14, output: 0.28, cacheRead: 0.0028 },
  "deepseek/deepseek-v4-pro": { input: 0.435, output: 0.87, cacheRead: 0.003625 },
  // OpenAI
  "openai/gpt-4o": { input: 2.5, output: 10, cacheRead: 1.25 },
  "openai/gpt-4o-mini": { input: 0.15, output: 0.6, cacheRead: 0.075 },
  "openai/gpt-4.1": { input: 2, output: 8, cacheRead: 0.5 },
  "openai/gpt-4.1-mini": { input: 0.4, output: 1.6, cacheRead: 0.1 },
  "openai/gpt-4.1-nano": { input: 0.1, output: 0.4, cacheRead: 0.025 },
  "openai/o3": { input: 2, output: 8, cacheRead: 0.5 },
  "openai/o3-mini": { input: 1.1, output: 4.4, cacheRead: 0.55 },
  "openai/o4-mini": { input: 1.1, output: 4.4, cacheRead: 0.275 },
  // Anthropic
  "anthropic/claude-3-5-sonnet": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "anthropic/claude-3-5-haiku": { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
  "anthropic/claude-3-7-sonnet": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "anthropic/claude-sonnet-4-5": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "anthropic/claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "anthropic/claude-opus-4-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "anthropic/claude-opus-4-6": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "anthropic/claude-opus-4-7": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "anthropic/claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  // Google
  "google/gemini-2.0-flash": { input: 0.1, output: 0.4, cacheRead: 0.025 },
  "google/gemini-2.5-pro": { input: 1.25, output: 10, cacheRead: 0.125 },
  "google/gemini-2.5-flash": { input: 0.3, output: 2.5, cacheRead: 0.03 },
  "google/gemini-2.5-flash-lite": { input: 0.1, output: 0.4, cacheRead: 0.01 },
  // Moonshot / Kimi
  "moonshotai/kimi-k2": { input: 0.6, output: 2.5, cacheRead: 0.15 },
  "moonshotai/kimi-k2-0711-preview": { input: 0.6, output: 2.5, cacheRead: 0.15 },
  "moonshotai/kimi-k2.5": { input: 0.6, output: 3, cacheRead: 0.1 },
  "moonshotai/kimi-k2.7-code": { input: 0.95, output: 4, cacheRead: 0.19 },
  // Zhipu / GLM
  "zhipuai/glm-4-plus": { input: 5, output: 5 },
  "zhipuai/glm-4.5": { input: 0.6, output: 2.2, cacheRead: 0.11 },
  "zhipuai/glm-4.5-air": { input: 0.2, output: 1.1, cacheRead: 0.03 },
  "zhipuai/glm-4.6": { input: 0.6, output: 2.2, cacheRead: 0.11 },
  "zhipuai/glm-4.7": { input: 0.6, output: 2.2, cacheRead: 0.1 },
  "zhipuai/glm-5": { input: 1, output: 3.2, cacheRead: 0.2 },
  // Mistral
  "mistral/mistral-large-latest": { input: 0.5, output: 1.5 },
  "mistral/codestral-latest": { input: 0.3, output: 0.9 },
  // MiniMax
  "minimax/minimax-m2": { input: 0.3, output: 1.2 },
  "minimax/minimax-m2.1": { input: 0.3, output: 1.2, cacheRead: 0.03, cacheWrite: 0.375 },
  "minimax/minimax-m2.5": { input: 0.3, output: 1.2, cacheRead: 0.03, cacheWrite: 0.375 },
  "minimax/minimax-m2.7": { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0.375 },
};

const aliases: Record<string, string> = {
  "deepseek-chat": "deepseek/deepseek-chat",
  "deepseek-reasoner": "deepseek/deepseek-reasoner",
  "deepseek-coder": "deepseek/deepseek-chat",
  "gpt-4o": "openai/gpt-4o",
  "gpt-4o-mini": "openai/gpt-4o-mini",
  "claude-3-5-sonnet": "anthropic/claude-3-5-sonnet",
  "claude-3-7-sonnet": "anthropic/claude-3-7-sonnet",
  "claude-sonnet-4": "anthropic/claude-sonnet-4-5",
  "claude-opus-4": "anthropic/claude-opus-4-7",
  "gemini-2.5-pro": "google/gemini-2.5-pro",
  "gemini-2.5-flash": "google/gemini-2.5-flash",
  "kimi-k2.5": "moonshotai/kimi-k2.5",
  "glm-4.5": "zhipuai/glm-4.5",
  "glm-4.6": "zhipuai/glm-4.6",
  "glm-5": "zhipuai/glm-5",
  "codestral-latest": "mistral/codestral-latest",
  "mistral-large-latest": "mistral/mistral-large-latest",
};

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/\\/gu, "/");
}

function providerVariants(provider: string) {
  const value = normalize(provider);
  const compact = value.replace(/[^a-z0-9]+/gu, "");
  const family = value.replace(/(?:-official|-compatible|_official|_compatible)$/u, "");
  return [value, compact, family, family.replace(/[^a-z0-9]+/gu, "")];
}

function providerMatchesKey(provider: string, key: string) {
  const keyProvider = key.split("/", 1)[0];
  return providerVariants(provider).includes(keyProvider);
}

function findKey(provider: string, model: string) {
  const normalizedProvider = normalize(provider);
  const normalizedModel = normalize(model);
  const direct = `${normalizedProvider}/${normalizedModel}`;
  if (PRICING[direct]) return direct;
  if (PRICING[normalizedModel] && providerMatchesKey(normalizedProvider, normalizedModel)) return normalizedModel;
  const modelLeaf = normalizedModel.split("/").pop() ?? normalizedModel;
  const alias = aliases[normalizedModel] ?? aliases[modelLeaf];
  if (alias && PRICING[alias] && providerMatchesKey(normalizedProvider, alias)) return alias;
  const providerNames = providerVariants(normalizedProvider);
  const candidate = Object.keys(PRICING).find((key) => {
    const [keyProvider, keyModel] = key.split("/");
    return providerNames.includes(keyProvider) && (keyModel === modelLeaf || modelLeaf.startsWith(`${keyModel}-`));
  });
  return candidate;
}

export function modelPricing(provider: string | undefined, model: string | undefined): ModelPricingMatch | null {
  if (!provider || !model) return null;
  const key = findKey(provider, model);
  if (!key) return null;
  const pricing = PRICING[key];
  return {
    ...pricing,
    provider,
    model,
    displayName: key.split("/")[1],
    source: "models.dev",
  };
}

/**
 * Estimate USD spend from the disjoint DSH usage buckets. DSH defines
 * `inputTokens` as uncached input; the separate cache buckets are billed with
 * their own rates. If an older provider reports a combined input total, the
 * cache buckets are removed as a compatibility fallback.
 */
export function estimateTokenCost(
  usage: { inputTokens: number; uncachedInputTokens?: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number },
  pricing: ModelPricing | null,
) {
  if (!pricing) return null;
  const uncachedInputTokens = usage.uncachedInputTokens
    ?? Math.max(0, usage.inputTokens - usage.cacheReadTokens - usage.cacheWriteTokens);
  const cost = (
    uncachedInputTokens * (pricing.input ?? 0)
    + usage.outputTokens * (pricing.output ?? 0)
    + usage.cacheReadTokens * (pricing.cacheRead ?? pricing.input ?? 0)
    + usage.cacheWriteTokens * (pricing.cacheWrite ?? pricing.input ?? 0)
  ) / 1_000_000;
  return Number.isFinite(cost) ? cost : null;
}

export function formatUsd(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  if (value === 0) return "$0.00";
  if (value < 0.01) return `<$0.01`;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: value < 1 ? 4 : 2 }).format(value);
}

export const modelPricingSnapshot = "models.dev · 2026-08-21";
export const modelPricingSourceUrl = "https://models.dev";
