// Provider settings are normalized against the catalog returned by /api/health.
// The fallback keeps the panel usable while that catalog is still loading.

export const FALLBACK_PROVIDERS = {
  codex: {
    available: true,
    models: [
      { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", reasoning: ["low", "medium", "high", "xhigh", "max"], default_reasoning: "low" },
      { id: "gpt-5.5", label: "GPT-5.5", reasoning: ["low", "medium", "high", "xhigh"], default_reasoning: "medium" },
      { id: "gpt-5.4", label: "GPT-5.4", reasoning: ["low", "medium", "high", "xhigh"], default_reasoning: "medium" },
      { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", reasoning: ["low", "medium", "high", "xhigh"], default_reasoning: "low" },
    ],
  },
  claude: {
    available: true,
    models: [
      { id: "claude-sonnet-5", label: "Claude Sonnet 5", reasoning: ["low", "medium", "high", "xhigh", "max"], default_reasoning: "medium" },
      { id: "claude-opus-5", label: "Claude Opus 5", reasoning: ["low", "medium", "high", "xhigh", "max"], default_reasoning: "high" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", reasoning: ["default"], default_reasoning: "default" },
    ],
  },
}

export const DEFAULT_SETTINGS = { provider: "codex", model: "gpt-5.6-sol", reasoning: "low" }

function selectableProvider(catalog, preferred) {
  if (catalog[preferred]?.available && catalog[preferred].models.length) return preferred
  return Object.keys(catalog).find((provider) => catalog[provider]?.available && catalog[provider].models.length) ?? null
}

export function normalizeSettings(candidate, catalog) {
  const provider = selectableProvider(catalog, candidate?.provider) ?? candidate?.provider ?? DEFAULT_SETTINGS.provider
  const models = catalog[provider]?.models ?? []
  const model = models.find((option) => option.id === candidate?.model) ?? models[0]

  if (!model) return { ...DEFAULT_SETTINGS }
  return {
    provider,
    model: model.id,
    reasoning: model.reasoning.includes(candidate?.reasoning) ? candidate.reasoning : model.default_reasoning,
  }
}

export function isSelectableProvider(catalog, provider) {
  return Boolean(catalog[provider]?.available && catalog[provider].models.length)
}
