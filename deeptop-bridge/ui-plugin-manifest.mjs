// Pure validation layer for the Deeptop desktop UI plugin protocol. This file
// must stay free of @deepseek-ai/* and zod imports so `node --test` can exercise
// it from the repository root, outside the bundled DSH runtime.
//
// Slot names are duplicated in src/app/ui-plugin-model.ts (client side); keep
// the two lists identical when extending them.

export const UI_PLUGIN_SCHEMA_VERSION = 1

export const UI_PLUGIN_SLOTS = Object.freeze([
  'session.sidebar.header',
  'session.context-menu',
  'session.row.leading',
  'session.row.trailing',
  'conversation.header.actions',
  'conversation.message.actions',
  'inspector.tabs',
  'settings.sections',
  'composer.actions',
])

const SLOT_SET = new Set(UI_PLUGIN_SLOTS)

export const UI_PLUGIN_STATUS = Object.freeze({
  available: 'available',
  disabled: 'disabled',
})

export const UI_PLUGIN_ERROR_CODES = Object.freeze({
  pluginNotFound: 'ui-plugin-not-found',
  pluginDisabled: 'ui-plugin-disabled',
  capabilityDenied: 'ui-capability-denied',
  remoteMethodNotDeclared: 'ui-remote-method-not-declared',
  remoteInvalidArgs: 'ui-remote-invalid-args',
  hostUnavailable: 'ui-host-unavailable',
  invalidRequest: 'ui-invalid-request',
  manifestInvalid: 'ui-manifest-invalid',
  moduleUnavailable: 'ui-module-unavailable',
  storageLimitExceeded: 'ui-storage-limit-exceeded',
  storageInvalidKey: 'ui-storage-invalid-key',
})

/** Create an Error carrying a stable wire error code; the bridge forwards the code alongside the message. */
export function uiPluginError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

const PLUGIN_ID_RE = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/
const NAMESPACE_RE = /^[A-Za-z][A-Za-z0-9_]*$/
const EVENT_NAME_RE = /^[A-Za-z][A-Za-z0-9_.-]*(?:\/[A-Za-z][A-Za-z0-9_.-]*)?$/
const SEMVERISH_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/
const SDK_RANGE_RE = /^(?:\^|~)?\d+\.\d+\.\d+$/
const STORAGE_NAMESPACE_RE = /^[a-z][a-z0-9_-]{2,63}$/

export const STORAGE_LIMITS = Object.freeze({
  maxKeyLength: 128,
  maxEntriesPerNamespace: 256,
  maxValueBytes: 64 * 1024,
})

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPlainArgs(value, depth = 0) {
  if (depth > 8) return false
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true
  if (Array.isArray(value)) return value.every(item => isPlainArgs(item, depth + 1))
  if (!isRecord(value)) return false
  return Object.values(value).every(item => isPlainArgs(item, depth + 1))
}

function fail(manifestError, message) {
  throw uiPluginError(UI_PLUGIN_ERROR_CODES.manifestInvalid, `${manifestError}: ${message}`)
}

function validateRemoteCapabilities(input, pluginId) {
  if (!Array.isArray(input)) return []
  return input.map(entry => {
    if (!isRecord(entry) || typeof entry.namespace !== 'string' || !NAMESPACE_RE.test(entry.namespace)) {
      fail(pluginId, 'each declared remote needs a namespace matching [A-Za-z][A-Za-z0-9_]*')
    }
    if (!Array.isArray(entry.methods) || entry.methods.length === 0
      || !entry.methods.every(method => typeof method === 'string' && NAMESPACE_RE.test(method))) {
      fail(pluginId, `remote "${entry.namespace}" needs a non-empty methods array of identifier strings`)
    }
    const methods = [...new Set(entry.methods)]
    return { namespace: entry.namespace, methods }
  })
}

function validateContribution(input, pluginId, remoteIndex, slotSet) {
  if (!isRecord(input)) fail(pluginId, 'contributions must be objects')
  if (typeof input.id !== 'string' || input.id.trim() === '' || input.id.length > 128) {
    fail(pluginId, 'contribution id must be a non-empty string of at most 128 characters')
  }
  if (typeof input.slot !== 'string' || !slotSet.has(input.slot)) {
    fail(pluginId, `contribution "${input.id}" declares slot ${JSON.stringify(input.slot)} which is not a known desktop slot`)
  }
  if (input.kind !== 'action' && input.kind !== 'badge') {
    fail(pluginId, `contribution "${input.id}" has kind ${JSON.stringify(input.kind)}; declarative contributions support "action" and "badge"`)
  }
  if (typeof input.label !== 'string' || input.label.trim() === '' || input.label.length > 256) {
    fail(pluginId, `contribution "${input.id}" needs a label of at most 256 characters`)
  }
  let order
  if (input.order !== undefined) {
    if (typeof input.order !== 'number' || !Number.isFinite(input.order) || input.order < -1000 || input.order > 1000) {
      fail(pluginId, `contribution "${input.id}" order must be a finite number between -1000 and 1000`)
    }
    order = input.order
  }
  let invoke
  if (input.invoke !== undefined) {
    if (!isRecord(input.invoke)
      || typeof input.invoke.namespace !== 'string'
      || typeof input.invoke.method !== 'string') {
      fail(pluginId, `contribution "${input.id}" invoke requires namespace and method`)
    }
    const declared = remoteIndex.get(input.invoke.namespace)
    if (!declared) {
      fail(pluginId, `contribution "${input.id}" invokes namespace "${input.invoke.namespace}" which the manifest does not declare`)
    }
    if (!declared.methods.includes(input.invoke.method)) {
      fail(pluginId, `contribution "${input.id}" invokes undeclared method "${input.invoke.namespace}.${input.invoke.method}"`)
    }
    invoke = { namespace: input.invoke.namespace, method: input.invoke.method }
  } else if (input.kind === 'action') {
    fail(pluginId, `declarative action "${input.id}" needs an invoke target because host plugins cannot render React`)
  }
  return { kind: input.kind, id: input.id, slot: input.slot, label: input.label, ...(order !== undefined ? { order } : {}), ...(invoke ? { invoke } : {}) }
}

/**
 * Validate one registration payload for the ui registry. Accepts either a flat
 * descriptor or `{ manifest }` plus an optional resolved `clientEntry` path,
 * so doc-style callers (`registerUiPlugin({ pluginId, manifest, clientEntry })`)
 * and inline descriptors both work.
 */
export function normalizeUiPluginRegistration(input) {
  if (!isRecord(input)) throw uiPluginError(UI_PLUGIN_ERROR_CODES.manifestInvalid, 'ui registration payload must be an object')
  const source = isRecord(input.manifest) ? { ...input.manifest } : input
  const pluginId = source.pluginId
  if (typeof pluginId !== 'string' || !PLUGIN_ID_RE.test(pluginId)) {
    throw uiPluginError(
      UI_PLUGIN_ERROR_CODES.manifestInvalid,
      `pluginId ${JSON.stringify(pluginId ?? null)} must look like "vendor.plugin-name" (lowercase, dot separated)`,
    )
  }
  if (source.schemaVersion !== UI_PLUGIN_SCHEMA_VERSION) {
    fail(pluginId, `schemaVersion must be ${UI_PLUGIN_SCHEMA_VERSION}, got ${JSON.stringify(source.schemaVersion ?? null)}`)
  }
  if (typeof source.version !== 'string' || !SEMVERISH_RE.test(source.version)) {
    fail(pluginId, 'version must be a semver string such as 0.1.0')
  }
  if (source.displayName !== undefined && (typeof source.displayName !== 'string' || source.displayName.length > 128)) {
    fail(pluginId, 'displayName must be a string of at most 128 characters')
  }

  const slots = source.ui?.slots
  if (!Array.isArray(slots) || slots.length === 0 || !slots.every(slot => typeof slot === 'string' && SLOT_SET.has(slot))) {
    fail(pluginId, `ui.slots must list at least one known desktop slot (${UI_PLUGIN_SLOTS.join(', ')})`)
  }
  const uniqueSlots = [...new Set(slots)]

  const remotes = validateRemoteCapabilities(source.capabilities?.remotes, pluginId)
  const remoteIndex = new Map(remotes.map(remote => [remote.namespace, remote]))

  const events = source.capabilities?.events
  if (events !== undefined) {
    if (!Array.isArray(events) || !events.every(event => typeof event === 'string' && EVENT_NAME_RE.test(event))) {
      fail(pluginId, 'capabilities.events must be an array of names like "namespace/event"')
    }
  }
  const storage = source.capabilities?.storage
  if (storage !== undefined && (typeof storage !== 'string' || !STORAGE_NAMESPACE_RE.test(storage))) {
    fail(pluginId, `capabilities.storage must match ${STORAGE_NAMESPACE_RE} when declared`)
  }

  let client
  const rawClient = isRecord(source.client) ? source.client : {}
  if (rawClient.entryId !== undefined || rawClient.format !== undefined || rawClient.sdkVersion !== undefined) {
    if (typeof rawClient.entryId !== 'string' || rawClient.entryId.trim() === '' || rawClient.entryId.length > 256) {
      fail(pluginId, 'client.entryId must be a non-empty string of at most 256 characters')
    }
    if (rawClient.format !== undefined && rawClient.format !== 'esm') {
      fail(pluginId, 'client.format only supports "esm" in this version')
    }
    if (typeof rawClient.sdkVersion !== 'string' || !SDK_RANGE_RE.test(rawClient.sdkVersion)) {
      fail(pluginId, 'client.sdkVersion must be a range like ^1.0.0 or ~1.2.3')
    }
    if (rawClient.integrity !== undefined
      && (typeof rawClient.integrity !== 'string' || !/^sha256-[0-9a-f]{64}$/.test(rawClient.integrity))) {
      fail(pluginId, 'client.integrity must look like sha256-<lowercase hex sha256 digest>')
    }
    client = {
      entryId: rawClient.entryId,
      format: 'esm',
      sdkVersion: rawClient.sdkVersion,
      ...(typeof rawClient.integrity === 'string' ? { integrity: rawClient.integrity } : {}),
    }
  } else if (typeof input.clientEntry === 'string') {
    // Doc-style callers pass a resolved bundle path; it stays host-private for
    // the future controlled resource protocol and never crosses the wire.
    if (input.clientEntry.trim() === '' || input.clientEntry.length > 1024) {
      fail(pluginId, 'clientEntry must be a non-empty path of at most 1024 characters')
    }
  }

  const rawContributions = source.ui?.contributions
  if (rawContributions !== undefined && !Array.isArray(rawContributions)) {
    fail(pluginId, 'ui.contributions must be an array when present')
  }
  const seenContributionIds = new Set()
  const contributions = (rawContributions ?? []).map(item => {
    const contribution = validateContribution(item, pluginId, remoteIndex, SLOT_SET)
    const key = `${contribution.slot}\u0000${contribution.id}`
    if (seenContributionIds.has(key)) fail(pluginId, `duplicate contribution id "${contribution.id}" in slot "${contribution.slot}"`)
    seenContributionIds.add(key)
    return contribution
  })
  if (uniqueSlots.some(slot => !contributions.some(contribution => contribution.slot === slot))
    && client === undefined) {
    fail(pluginId, 'a host-only registration must provide ui.contributions for every declared slot (no client bundle will fill them)')
  }

  return {
    pluginId,
    version: source.version,
    ...(typeof source.displayName === 'string' ? { displayName: source.displayName } : {}),
    status: UI_PLUGIN_STATUS.available,
    client,
    ...(typeof input.clientEntry === 'string' ? { clientPath: input.clientEntry } : {}),
    slots: uniqueSlots,
    capabilities: {
      remotes,
      ...(events !== undefined ? { events: [...new Set(events)] } : {}),
      ...(storage !== undefined ? { storage } : {}),
    },
    contributions,
  }
}

/** Project one normalized registration into the `ui.plugin.list` response item. */
export function toListDescriptor(record) {
  return {
    pluginId: record.pluginId,
    version: record.version,
    ...(record.displayName ? { displayName: record.displayName } : {}),
    status: record.status,
    client: record.client ? { entryId: record.client.entryId, format: record.client.format, sdkVersion: record.client.sdkVersion } : undefined,
    slots: [...record.slots],
    capabilities: {
      remotes: record.capabilities.remotes.map(remote => ({ namespace: remote.namespace, methods: [...remote.methods] })),
      ...(record.capabilities.events ? { events: [...record.capabilities.events] } : {}),
      ...(record.capabilities.storage ? { storage: record.capabilities.storage } : {}),
    },
    contributions: record.contributions.map(contribution => ({ ...contribution })),
  }
}

/**
 * Validate a scoped `ui.plugin.invoke` payload against one registration.
 * Returns the validated call; throws coded errors on every denial path so the
 * WebView sees stable codes instead of gateway exceptions.
 */
export function validateScopedInvoke(record, payload) {
  if (!isRecord(payload)
    || typeof payload.pluginId !== 'string' || payload.pluginId.trim() === ''
    || typeof payload.namespace !== 'string' || payload.namespace.trim() === ''
    || typeof payload.method !== 'string' || payload.method.trim() === '') {
    throw uiPluginError(UI_PLUGIN_ERROR_CODES.invalidRequest, 'ui.plugin.invoke requires pluginId, namespace and method strings')
  }
  if (!isRecord(payload.args)) {
    throw uiPluginError(UI_PLUGIN_ERROR_CODES.remoteInvalidArgs, 'ui.plugin.invoke args must be an object')
  }
  if (!isPlainArgs(payload.args)) {
    throw uiPluginError(UI_PLUGIN_ERROR_CODES.remoteInvalidArgs, 'ui.plugin.invoke args must be JSON primitives, flat arrays thereof, or nested objects')
  }
  if (!record) throw uiPluginError(UI_PLUGIN_ERROR_CODES.pluginNotFound, `ui plugin ${JSON.stringify(payload.pluginId)} is not registered`)
  if (record.status !== UI_PLUGIN_STATUS.available) {
    throw uiPluginError(UI_PLUGIN_ERROR_CODES.pluginDisabled, `ui plugin ${payload.pluginId} is not enabled`)
  }
  const declared = record.capabilities.remotes.find(remote => remote.namespace === payload.namespace)
  if (!declared) {
    throw uiPluginError(UI_PLUGIN_ERROR_CODES.capabilityDenied, `ui plugin ${record.pluginId} does not declare remote namespace ${payload.namespace}`)
  }
  if (!declared.methods.includes(payload.method)) {
    throw uiPluginError(UI_PLUGIN_ERROR_CODES.remoteMethodNotDeclared, `ui plugin ${record.pluginId} does not declare method ${payload.namespace}.${payload.method}`)
  }
  return { pluginId: record.pluginId, namespace: payload.namespace, method: payload.method, args: payload.args }
}

/** Validate a scoped storage key; returns the composed durable key `<namespace>/<key>`. */
export function validateScopedStorageKey(namespace, key) {
  if (typeof key !== 'string' || key.length === 0 || key.length > STORAGE_LIMITS.maxKeyLength) {
    throw uiPluginError(UI_PLUGIN_ERROR_CODES.storageInvalidKey, `ui storage key must be a non-empty string of at most ${STORAGE_LIMITS.maxKeyLength} characters`)
  }
  if (key.includes('/') || key.includes('\\') || key.includes('\u0000') || key === '.' || key === '..') {
    throw uiPluginError(UI_PLUGIN_ERROR_CODES.storageInvalidKey, 'ui storage keys must not contain separators or path segments')
  }
  return `${namespace}/${key}`
}

/** Enforce JSON round-trip and size caps for one storage write; returns the serialized payload. */
export function encodeStorageValue(value) {
  let serialized
  try {
    serialized = JSON.stringify({ v: value })
  } catch {
    throw uiPluginError(UI_PLUGIN_ERROR_CODES.remoteInvalidArgs, 'ui storage values must be JSON-compatible')
  }
  if (serialized === undefined) {
    throw uiPluginError(UI_PLUGIN_ERROR_CODES.remoteInvalidArgs, 'ui storage values must be JSON-compatible')
  }
  if (Buffer.byteLength(serialized, 'utf8') > STORAGE_LIMITS.maxValueBytes) {
    throw uiPluginError(UI_PLUGIN_ERROR_CODES.storageLimitExceeded, `ui storage values are limited to ${STORAGE_LIMITS.maxValueBytes} bytes`)
  }
  return serialized
}
