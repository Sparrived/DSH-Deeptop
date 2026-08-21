import assert from 'node:assert/strict'
import test from 'node:test'
import {
  encodeStorageValue,
  normalizeUiPluginRegistration,
  toListDescriptor,
  uiPluginError,
  validateScopedInvoke,
  validateScopedStorageKey,
  STORAGE_LIMITS,
  UI_PLUGIN_ERROR_CODES,
  UI_PLUGIN_SLOTS,
} from './ui-plugin-manifest.mjs'
import {
  deleteUiPluginStorage,
  getUiPluginModule,
  getUiPluginStorage,
  invokeUiPluginRemote,
  listUiPlugins,
  setUiPluginStorage,
} from './ui-routes.mjs'
import { routeDesktopRequest } from './routes.mjs'

const sessionPinsManifest = {
  schemaVersion: 1,
  pluginId: 'example.session-pins',
  version: '0.1.0',
  displayName: 'Session Pins',
  client: { entryId: 'example.session-pins/client', format: 'esm', sdkVersion: '^1.0.0' },
  ui: { slots: ['session.context-menu', 'session.row.trailing'] },
  capabilities: {
    remotes: [{ namespace: 'sessionPins', methods: ['list', 'toggle'] }],
    events: ['sessionPins/changed'],
    storage: 'session-pins',
  },
}

const declarativeManifest = {
  schemaVersion: 1,
  pluginId: 'vendor.notes-tools',
  version: '1.2.3',
  displayName: 'Notes Tools',
  ui: {
    slots: ['session.context-menu'],
    contributions: [
      { kind: 'action', id: 'notes.append', slot: 'session.context-menu', label: '追加笔记', order: 40, invoke: { namespace: 'notesTools', method: 'append' } },
      { kind: 'badge', id: 'notes.count', slot: 'session.context-menu', label: '3 条笔记' },
    ],
  },
  capabilities: {
    remotes: [{ namespace: 'notesTools', methods: ['append'] }],
    storage: 'notes_tools',
  },
}

function registryWith(...records) {
  const map = new Map(records.map(record => [record.pluginId, record]))
  return {
    list: () => [...map.values()].map(toListDescriptor),
    getModule: pluginId => {
      const record = map.get(pluginId)
      if (!record?.client) return undefined
      return { pluginId, entryId: record.client.entryId, format: record.client.format, sdkVersion: record.client.sdkVersion }
    },
    require: pluginId => map.get(pluginId),
    storageGet: async (namespace, key) => (namespace === 'session-pins' && key === 'last' ? { pinned: true } : undefined),
    storageSet: async () => {},
    storageDelete: async () => {},
  }
}

function ctxWith(registry, extra = {}) {
  return {
    get: key => ({
      deeptopUiRegistry: registry,
      typertGateway: {
        invoke: async request => ({ echoed: request, signalAborted: request.signal?.aborted === true }),
      },
      ...extra,
    })[key],
  }
}

test('known slot list stays aligned with the desktop client model', () => {
  assert.ok(UI_PLUGIN_SLOTS.includes('session.context-menu'))
  assert.ok(UI_PLUGIN_SLOTS.includes('session.row.trailing'))
})

test('normalizes a full client-module registration', () => {
  const record = normalizeUiPluginRegistration(sessionPinsManifest)
  assert.equal(record.pluginId, 'example.session-pins')
  assert.equal(record.status, 'available')
  assert.deepEqual(record.slots, ['session.context-menu', 'session.row.trailing'])
  assert.deepEqual(record.capabilities.remotes, [{ namespace: 'sessionPins', methods: ['list', 'toggle'] }])
  assert.equal(record.capabilities.storage, 'session-pins')
  assert.equal(record.client.entryId, 'example.session-pins/client')
})

test('accepts a doc-style registration with a private clientEntry path', () => {
  const record = normalizeUiPluginRegistration({ ...sessionPinsManifest, manifest: sessionPinsManifest, clientEntry: 'D:\\plugins\\session-pins\\dist\\client.mjs' })
  assert.equal(record.client.entryId, 'example.session-pins/client')
  assert.equal(record.clientPath, 'D:\\plugins\\session-pins\\dist\\client.mjs')
  const descriptor = toListDescriptor(record)
  assert.equal(descriptor.client.entryId, 'example.session-pins/client')
  assert.equal(JSON.stringify(descriptor).includes('clientPath'), false, 'raw bundle paths never cross the wire')
})

test('normalizes a host-only declarative registration and validates its invoke targets', () => {
  const record = normalizeUiPluginRegistration(declarativeManifest)
  assert.equal(record.client, undefined)
  assert.equal(record.contributions.length, 2)
  assert.deepEqual(record.contributions[0].invoke, { namespace: 'notesTools', method: 'append' })
})

test('rejects invalid registrations with coded errors', () => {
  const cases = [
    [null, /must be an object/],
    [{ ...sessionPinsManifest, pluginId: 'Bad Id' }, /pluginId/],
    [{ ...sessionPinsManifest, schemaVersion: 2 }, /schemaVersion/],
    [{ ...sessionPinsManifest, version: 'dev' }, /version/],
    [{ ...sessionPinsManifest, ui: { slots: ['made.up.slot'] } }, /known desktop slot/],
    [{ ...sessionPinsManifest, client: { entryId: 'x/client', format: 'cjs', sdkVersion: '^1.0.0' } }, /format/],
    [{ ...sessionPinsManifest, client: { entryId: 'x/client', sdkVersion: 'latest' } }, /sdkVersion/],
    [{ ...declarativeManifest, capabilities: { remotes: [{ namespace: 'other', methods: ['x'] }] } }, /does not declare|invokes/],
    [{
      schemaVersion: 1, pluginId: 'a.host-only', version: '0.1.0',
      ui: { slots: ['session.context-menu'], contributions: [{ kind: 'action', id: 'x', slot: 'session.context-menu', label: 'X' }] },
      capabilities: {},
    }, /needs an invoke target/],
    [{
      schemaVersion: 1, pluginId: 'a.host-only', version: '0.1.0',
      ui: { slots: ['session.context-menu'], contributions: [{ kind: 'badge', id: 'b', slot: 'settings.sections', label: 'B' }] },
      capabilities: {},
    }, /slot/],
  ]
  for (const [input, matcher] of cases) {
    assert.throws(() => normalizeUiPluginRegistration(input), error => error.code === UI_PLUGIN_ERROR_CODES.manifestInvalid && matcher.test(error.message), JSON.stringify(input?.pluginId ?? String(input)))
  }
})

test('rejects duplicate contribution ids within one slot', () => {
  assert.throws(() => normalizeUiPluginRegistration({
    schemaVersion: 1,
    pluginId: 'a.dup',
    version: '0.1.0',
    ui: {
      slots: ['session.context-menu'],
      contributions: [
        { kind: 'badge', id: 'same', slot: 'session.context-menu', label: 'A' },
        { kind: 'badge', id: 'same', slot: 'session.context-menu', label: 'B' },
      ],
    },
    capabilities: {},
  }), /duplicate contribution id/)
})

test('scoped invoke validates the whole chain before reaching the gateway', () => {
  const record = normalizeUiPluginRegistration(sessionPinsManifest)

  assert.throws(() => validateScopedInvoke(null, { pluginId: 'missing.x', namespace: 'n', method: 'm', args: {} }),
    error => error.code === UI_PLUGIN_ERROR_CODES.pluginNotFound)
  assert.throws(() => validateScopedInvoke({ ...record, status: 'disabled' }, { pluginId: record.pluginId, namespace: 'sessionPins', method: 'list', args: {} }),
    error => error.code === UI_PLUGIN_ERROR_CODES.pluginDisabled)
  assert.throws(() => validateScopedInvoke(record, { pluginId: record.pluginId, namespace: 'notDeclared', method: 'list', args: {} }),
    error => error.code === UI_PLUGIN_ERROR_CODES.capabilityDenied)
  assert.throws(() => validateScopedInvoke(record, { pluginId: record.pluginId, namespace: 'sessionPins', method: 'purgeAll', args: {} }),
    error => error.code === UI_PLUGIN_ERROR_CODES.remoteMethodNotDeclared)
  assert.throws(() => validateScopedInvoke(record, { pluginId: record.pluginId, namespace: 'sessionPins', method: 'list' }),
    error => error.code === UI_PLUGIN_ERROR_CODES.remoteInvalidArgs)
  assert.throws(() => validateScopedInvoke(record, { pluginId: record.pluginId, namespace: 'sessionPins', method: 'list', args: { callback: () => {} } }),
    error => error.code === UI_PLUGIN_ERROR_CODES.remoteInvalidArgs)
  assert.throws(() => validateScopedInvoke(record, { pluginId: record.pluginId, namespace: 'sessionPins', method: 'list', args: 'nope' }),
    error => error.code === UI_PLUGIN_ERROR_CODES.remoteInvalidArgs)

  const call = validateScopedInvoke(record, { pluginId: record.pluginId, namespace: 'sessionPins', method: 'toggle', args: { sessionId: 's-1' } })
  assert.deepEqual(call.args, { sessionId: 's-1' })
})

test('nested JSON args are accepted while hostile payloads are not', () => {
  const record = normalizeUiPluginRegistration(sessionPinsManifest)
  const nested = { filter: { tags: ['a', 'b'], limit: 10, cursor: null } }
  assert.deepEqual(validateScopedInvoke(record, { pluginId: record.pluginId, namespace: 'sessionPins', method: 'list', args: nested }).args, nested)

  const sixLevels = { a: { b: { c: { d: { e: { f: 1 } } } } } }
  assert.deepEqual(
    validateScopedInvoke(record, { pluginId: record.pluginId, namespace: 'sessionPins', method: 'list', args: sixLevels }).args,
    sixLevels,
    'ordinary nested filters stay inside the JSON depth budget',
  )

  let deep = 1
  for (let i = 0; i < 64; i++) deep = { nested: deep }
  assert.throws(() => validateScopedInvoke(record, { pluginId: record.pluginId, namespace: 'sessionPins', method: 'list', args: deep }),
    error => error.code === UI_PLUGIN_ERROR_CODES.remoteInvalidArgs)
})

test('ui.plugin.list degrades to an empty catalog when the profile has no registry', async () => {
  assert.deepEqual(await listUiPlugins(ctxWith(undefined)), { items: [] })
  const response = await routeDesktopRequest(ctxWith(registryWith(normalizeUiPluginRegistration(sessionPinsManifest))), 'ui.plugin.list', {})
  assert.equal(response.items.length, 1)
  assert.equal(response.items[0].pluginId, 'example.session-pins')
  assert.equal(response.items[0].status, 'available')
  assert.deepEqual(response.items[0].slots, ['session.context-menu', 'session.row.trailing'])
})

test('ui.plugin.module returns metadata for registered modules only', async () => {
  const ctx = ctxWith(registryWith(normalizeUiPluginRegistration(sessionPinsManifest)))
  const descriptor = await getUiPluginModule(ctx, { pluginId: 'example.session-pins' })
  assert.deepEqual(descriptor, { pluginId: 'example.session-pins', entryId: 'example.session-pins/client', format: 'esm', sdkVersion: '^1.0.0' })
  await assert.rejects(getUiPluginModule(ctx, { pluginId: 'absent.x' }), error => error.code === UI_PLUGIN_ERROR_CODES.pluginNotFound)
  await assert.rejects(getUiPluginModule(ctxWith(undefined), { pluginId: 'example.session-pins' }), error => error.code === UI_PLUGIN_ERROR_CODES.hostUnavailable)
  const declarativeOnly = ctxWith(registryWith(normalizeUiPluginRegistration(declarativeManifest)))
  await assert.rejects(getUiPluginModule(declarativeOnly, { pluginId: 'vendor.notes-tools' }), error => error.code === UI_PLUGIN_ERROR_CODES.pluginNotFound)
})

test('ui.plugin.invoke forwards declared calls and preserves abort semantics', async () => {
  const controller = new AbortController()
  const ctx = ctxWith(registryWith(normalizeUiPluginRegistration(sessionPinsManifest)))
  const result = await invokeUiPluginRemote(ctx, { pluginId: 'example.session-pins', namespace: 'sessionPins', method: 'toggle', args: { sessionId: 's-1' } }, controller.signal)
  assert.equal(result.value.echoed.namespace, 'sessionPins')
  assert.equal(result.value.echoed.method, 'toggle')
  assert.equal(result.value.signalAborted, false)
  controller.abort()
  const aborted = await invokeUiPluginRemote(ctx, { pluginId: 'example.session-pins', namespace: 'sessionPins', method: 'toggle', args: {} }, controller.signal)
  assert.equal(aborted.value.signalAborted, true)
})

test('ui.plugin.invoke keeps gateway failures intact after capability checks pass', async () => {
  const failingGateway = {
    invoke: async () => { throw Object.assign(new Error('gateway exploded'), { code: 'remote-timeout' }) },
  }
  const ctx = ctxWith(registryWith(normalizeUiPluginRegistration(sessionPinsManifest)), { typertGateway: failingGateway })
  await assert.rejects(
    invokeUiPluginRemote(ctx, { pluginId: 'example.session-pins', namespace: 'sessionPins', method: 'list', args: {} }),
    /gateway exploded/,
  )
})

test('storage routes enforce declaration, keys and values', async () => {
  const registry = registryWith(normalizeUiPluginRegistration(sessionPinsManifest))
  const ctx = ctxWith(registry)

  const stored = await routeDesktopRequest(ctx, 'ui.plugin.storage.set', { pluginId: 'example.session-pins', key: 'last', value: { at: 5 } })
  assert.deepEqual(stored, { stored: true })
  const readBack = await routeDesktopRequest(ctx, 'ui.plugin.storage.get', { pluginId: 'example.session-pins', key: 'last' })
  assert.deepEqual(readBack, { value: { pinned: true } })

  await assert.rejects(routeDesktopRequest(ctx, 'ui.plugin.storage.set', { pluginId: 'vendor.notes-tools', key: 'k', value: 1 }),
    error => error.code === UI_PLUGIN_ERROR_CODES.pluginNotFound)
  await assert.rejects(routeDesktopRequest(ctx, 'ui.plugin.storage.get', { pluginId: 'example.session-pins', key: '../escape' }),
    error => error.code === UI_PLUGIN_ERROR_CODES.storageInvalidKey)
  await assert.rejects(routeDesktopRequest(ctx, 'ui.plugin.storage.delete', { pluginId: 'example.session-pins', key: 'a'.repeat(STORAGE_LIMITS.maxKeyLength + 1) }),
    error => error.code === UI_PLUGIN_ERROR_CODES.storageInvalidKey)
  const noStorage = registryWith(normalizeUiPluginRegistration({
    ...declarativeManifest,
    capabilities: { remotes: declarativeManifest.capabilities.remotes },
  }))
  await assert.rejects(routeDesktopRequest(ctxWith(noStorage), 'ui.plugin.storage.get', { pluginId: 'vendor.notes-tools', key: 'k' }),
    error => error.code === UI_PLUGIN_ERROR_CODES.capabilityDenied)
})

test('storage helpers reject oversized or non-JSON values', () => {
  assert.throws(() => encodeStorageValue('x'.repeat(STORAGE_LIMITS.maxValueBytes)), error => error.code === UI_PLUGIN_ERROR_CODES.storageLimitExceeded)
  assert.throws(() => encodeStorageValue(BigInt(12)), error => error.code === UI_PLUGIN_ERROR_CODES.remoteInvalidArgs)
  const circular = {}
  circular.self = circular
  assert.throws(() => encodeStorageValue(circular), error => error.code === UI_PLUGIN_ERROR_CODES.remoteInvalidArgs, 'circular structures fail through JSON.stringify')
  assert.equal(typeof encodeStorageValue({ ok: true }), 'string')
  const composed = validateScopedStorageKey('session-pins', 'last-toggle')
  assert.equal(composed, 'session-pins/last-toggle')
  assert.throws(() => validateScopedStorageKey('ns', ''), error => error.code === UI_PLUGIN_ERROR_CODES.storageInvalidKey)
  assert.throws(() => validateScopedStorageKey('ns', 'a\\b'), error => error.code === UI_PLUGIN_ERROR_CODES.storageInvalidKey)
  assert.throws(() => validateScopedStorageKey('ns', '..'), error => error.code === UI_PLUGIN_ERROR_CODES.storageInvalidKey)
})

test('unknown ui routes stay rejected like any other desktop method', async () => {
  await assert.rejects(routeDesktopRequest(ctxWith(undefined), 'ui.plugin.admin', {}), /does not expose/)
})

test('coded errors survive the pure error helper round trip', () => {
  const error = uiPluginError(UI_PLUGIN_ERROR_CODES.hostUnavailable, 'down')
  assert.equal(error.code, 'ui-host-unavailable')
  assert.equal(error instanceof Error, true)
})
