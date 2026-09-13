// Pure routing-policy rules shared by the subagent-routing Host plugin and its tests.

export const ROUTING_NAMESPACE = 'deeptop-subagent-routing'
export const OFFICIAL_NAMESPACE = 'subagent-model-selection'
export const SECTION_NAME = 'deeptop:subagent-routing'
/** Sits between the first-party TOOL_SUBAGENT (2800) and TOOL_REPORT (2900) positions. */
export const SECTION_ORDER = 2850

export function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * Keep only complete provider/model pairs: trimmed, deduplicated in order, each
 * with its optional 「何时使用」 note. Malformed entries are dropped rather than
 * rejected so one bad row never disables the whole policy.
 * @param value - candidate `routes` value from settings.
 * @returns normalized routes.
 */
export function normalizeRoutes(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const routes = []
  for (const candidate of value) {
    if (!isRecord(candidate)) continue
    const provider = text(candidate.provider)
    const model = text(candidate.model)
    if (provider === undefined || model === undefined) continue
    const key = `${provider}\u0000${model}`
    if (seen.has(key)) continue
    seen.add(key)
    routes.push({ provider, model, note: text(candidate.note) ?? '' })
  }
  return routes
}

/**
 * Project routes onto the official `subagent-model-selection` route list.
 * @param routes - candidate routes.
 * @returns the exact-route array the DSH delegation policy expects.
 */
export function routesToAllowedModels(routes) {
  return normalizeRoutes(routes).map(({ provider, model }) => ({ provider, model }))
}

/**
 * Build the model-visible routing section. A non-empty custom text replaces the
 * generated block; no routes and no custom text yield an empty section, which
 * the prompt assembly drops.
 * @param routes - candidate routes.
 * @param custom - user-authored guidance override.
 * @returns the section text.
 */
export function renderGuidance(routes, custom) {
  const override = text(custom)
  if (override !== undefined) return override
  const configured = normalizeRoutes(routes)
  if (configured.length === 0) return ''
  const listed = configured.map((route) => (
    route.note === ''
      ? `- \`${route.provider}/${route.model}\``
      : `- \`${route.provider}/${route.model}\` — ${route.note}`
  ))
  return [
    'Subagent delegation on this machine can select the child LLM route. Choose by task:',
    ...listed,
    'Pass `provider` and `model` together to the delegation tool when the task matches a line above; '
    + 'call `list_subagent_models` first to confirm an advertised route and its reasoning efforts. '
    + 'Omitting both keeps the default route.',
  ].join('\n')
}

function nodeAt(envelope, uid) {
  if (!isRecord(envelope) || !isRecord(envelope.refs) || !Number.isInteger(uid)) return undefined
  return envelope.refs[String(uid)]
}

function dictChild(envelope, node, key) {
  if (!isRecord(node) || !isRecord(node.dict)) return undefined
  const uid = node.dict[key]
  return Number.isInteger(uid) ? nodeAt(envelope, uid) : undefined
}

/**
 * Whether a settings namespace's serialized schemastery schema accepts a
 * `description` on every `models` entry — the only data path that reaches the
 * model through `list_subagent_models`. Read from the schema rather than the
 * resolved value so a namespace stays unsupported when its own schema would
 * reject the field.
 * @param envelope - serialized `{ uid, refs }` schema envelope.
 * @returns whether `models[].description` is a declared field.
 */
export function supportsModelDescription(envelope) {
  if (!isRecord(envelope)) return false
  const models = dictChild(envelope, nodeAt(envelope, envelope.uid), 'models')
  if (!isRecord(models) || models.type !== 'array') return false
  const item = nodeAt(envelope, models.inner)
  return isRecord(item) && isRecord(item.dict) && Number.isInteger(item.dict.description)
}

/**
 * Resolve one namespace descriptor's resolved value at a settings path.
 * @param value - resolved namespace value.
 * @param path - path from the section root to the provider profile.
 * @returns the value at the path, or undefined when any step is absent.
 */
export function valueAtPath(value, path) {
  let current = value
  for (const part of path) {
    if (!isRecord(current)) return undefined
    current = current[part]
  }
  return current
}

/**
 * Apply routing notes to one provider's catalog as `description` values. Only
 * non-empty notes are written, and an entry already carrying that exact text is
 * left alone, so a save never rewrites unchanged models.
 * @param models - the provider's resolved `models` array.
 * @param notes - model id to note.
 * @returns the next array and whether anything changed.
 */
export function modelsWithNotes(models, notes) {
  if (!Array.isArray(models) || !(notes instanceof Map) || notes.size === 0) {
    return { models, changed: false }
  }
  let changed = false
  const next = models.map((model) => {
    if (!isRecord(model) || typeof model.id !== 'string') return model
    const note = notes.get(model.id)
    if (note === undefined || model.description === note) return model
    changed = true
    return { ...model, description: note }
  })
  return { models: changed ? next : models, changed }
}

/**
 * Group route notes by provider for the catalog projection.
 * @param routes - candidate routes.
 * @returns provider to (model id to note), skipping routes without a note.
 */
export function notesByProvider(routes) {
  const grouped = new Map()
  for (const route of normalizeRoutes(routes)) {
    if (route.note === '') continue
    const notes = grouped.get(route.provider) ?? new Map()
    notes.set(route.model, route.note)
    grouped.set(route.provider, notes)
  }
  return grouped
}
