import assert from 'node:assert/strict'
import test from 'node:test'
import { DesktopUiRuntime } from './client-runtime.ts'
import { SlotRegistry } from './slot-registry.ts'
import { PluginScope } from './plugin-runner.ts'
import { loadProtocolClientModule, PROTOCOL_IMPORT_TIMEOUT_MS } from './module-loader.ts'
import {
  CapabilityDeniedError,
  PluginEventScope,
  createScopedRemote,
  createScopedStorage,
} from './capability-client.ts'

function descriptor(overrides = {}) {
  return {
    pluginId: 'example.session-pins',
    version: '0.1.0',
    displayName: 'Session Pins',
    status: 'available',
    slots: ['session.context-menu', 'session.row.trailing'],
    capabilities: {
      remotes: [{ namespace: 'sessionPins', methods: ['list', 'toggle'] }],
      events: ['sessionPins/changed'],
      storage: 'session-pins',
    },
    contributions: [],
    ...overrides,
  }
}

function fakeRuntime({ items = [], modules = {}, responses = new Map(), resolveBundle, importModule } = {}) {
  const requests = []
  const handlers = new Set()
  const request = async (method, payload) => {
    requests.push({ method, payload })
    if (method === 'ui.plugin.list') return { items }
    if (method === 'ui.plugin.invoke') return { value: { ok: true } }
    if (responses.has(method)) return responses.get(method)(payload)
    throw Object.assign(new Error(`no fake response for ${method}`), { code: 'ui-host-unavailable' })
  }
  const runtime = new DesktopUiRuntime({
    request,
    listen: handler => {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
    bundledModules: modules,
    ...(resolveBundle ? { resolveBundle } : {}),
    ...(importModule ? { importModule } : {}),
  })
  return { runtime, requests, handlers, request }
}

test('discovers a declarative-only host plugin without any client bundle', async () => {
  const declarative = descriptor({
    client: undefined,
    contributions: [
      { kind: 'action', id: 'pins.toggle', slot: 'session.context-menu', label: '置顶会话', order: 30, invoke: { namespace: 'sessionPins', method: 'toggle' } },
    ],
  })
  const { runtime } = fakeRuntime({ items: [declarative] })
  await runtime.start()
  assert.equal(runtime.status, 'ready')
  const menu = runtime.slots.snapshot('session.context-menu')
  assert.equal(menu.length, 1)
  assert.equal(menu[0].declarative.label, '置顶会话')
  await runtime.stop()
})

test('loads and activates a bundled client module and unregisters its slots on dispose', async () => {
  let activated = 0
  let deactivated = 0
  const disposers = []
  const module = {
    activate(context) {
      activated += 1
      disposers.push(context.ui.register('session.context-menu', {
        kind: 'action',
        id: 'pins.toggle',
        render: () => null,
      }))
    },
    deactivate() {
      deactivated += 1
      for (const dispose of disposers.splice(0)) dispose()
    },
  }
  const full = descriptor({ client: { entryId: 'example.session-pins/client', format: 'esm', sdkVersion: '^1.0.0' } })
  const { runtime } = fakeRuntime({ items: [full], modules: { 'example.session-pins/client': async () => module } })
  await runtime.start()
  assert.equal(runtime.status, 'ready')
  assert.equal(activated, 1)
  assert.equal(runtime.slots.snapshot('session.context-menu').length, 1)
  await runtime.stop()
  assert.equal(deactivated, 1)
  assert.equal(runtime.slots.snapshot('session.context-menu').length, 0, 'component contribution disappears with the plugin')
})

test('an SDK mismatch fails only the dynamic half while declarative UI stays available', async () => {
  const full = descriptor({
    client: { entryId: 'example.session-pins/client', format: 'esm', sdkVersion: '^9.0.0' },
    contributions: [
      { kind: 'badge', id: 'pins.badge', slot: 'session.row.trailing', label: '置顶' },
    ],
  })
  const { runtime } = fakeRuntime({ items: [full], modules: { 'example.session-pins/client': async () => ({}) } })
  await runtime.start()
  assert.equal(runtime.status, 'partial')
  assert.equal(runtime.entries.get('example.session-pins')?.runner.state, 'check-failed')
  assert.equal(runtime.slots.snapshot('session.row.trailing').length, 1, 'host-declared badge keeps working')
  assert.equal(runtime.slots.snapshot('session.context-menu').length, 0)
})

test('a missing bundle or throwing activate settles into coded failure states', async () => {
  const missing = fakeRuntime({
    items: [descriptor({
      pluginId: 'b.missing',
      slots: ['composer.actions'],
      capabilities: { remotes: [] },
      client: { entryId: 'b.missing/client', format: 'esm', sdkVersion: '^1.0.0' },
    })],
  })
  await missing.runtime.start()
  assert.equal(missing.runtime.entries.get('b.missing')?.runner.state, 'load-failed')
  assert.equal(missing.runtime.status, 'partial')

  const boom = fakeRuntime({
    items: [descriptor({
      pluginId: 'a.boom',
      slots: ['inspector.tabs'],
      capabilities: { remotes: [], events: [] },
      client: { entryId: 'a.boom/client', format: 'esm', sdkVersion: '^1.0.0' },
    })],
    modules: {
      'a.boom/client': async () => ({ activate() { throw new Error('boom during activate') } }),
    },
  })
  await boom.runtime.start()
  assert.equal(boom.runtime.entries.get('a.boom')?.runner.state, 'activate-failed')
  assert.equal(boom.runtime.status, 'partial')
})

const protocolModule = {
  activate(context) {
    context.ui.register('session.context-menu', { kind: 'action', id: 'pins.proto', render: () => null })
  },
  deactivate() {},
}

test('an external bundle loads through the controlled resource protocol', async () => {
  const resolvedIds = []
  const importedUrls = []
  const full = descriptor({
    client: { entryId: 'example.session-pins/client', format: 'esm', sdkVersion: '^1.0.0' },
  })
  const { runtime } = fakeRuntime({
    items: [full],
    resolveBundle: async (pluginId) => {
      resolvedIds.push(pluginId)
      return { url: `deeptop-plugin://localhost/${pluginId}/client.mjs`, sizeBytes: 1024 }
    },
    importModule: async (url) => {
      importedUrls.push(url)
      return protocolModule
    },
  })
  await runtime.start()
  assert.equal(runtime.status, 'ready')
  assert.deepEqual(resolvedIds, ['example.session-pins'])
  // Windows serves the same handler over http://deeptop-plugin.localhost/...;
  // the URL always comes from the desktop process, never assembled here.
  assert.match(importedUrls[0], /example\.session-pins\/client\.mjs$/)
  assert.equal(runtime.slots.snapshot('session.context-menu').length, 1)
  await runtime.stop()
  assert.equal(runtime.slots.snapshot('session.context-menu').length, 0)
})

test('protocol failures refuse to load without touching slots already contributed declaratively', async () => {
  const withDeclarative = descriptor({
    client: { entryId: 'example.session-pins/client', format: 'esm', sdkVersion: '^1.0.0' },
    contributions: [
      { kind: 'badge', id: 'pins.badge', slot: 'session.row.trailing', label: '置顶' },
    ],
  })
  const rejecting = fakeRuntime({
    items: [withDeclarative],
    resolveBundle: async () => {
      throw Object.assign(new Error('ui-integrity-mismatch: 完整性校验失败'), { code: 'ui-integrity-mismatch' })
    },
  })
  await rejecting.runtime.start()
  assert.equal(rejecting.runtime.status, 'partial')
  assert.equal(rejecting.runtime.entries.get('example.session-pins')?.runner.state, 'load-failed')
  assert.equal(rejecting.runtime.slots.snapshot('session.row.trailing').length, 1)

  const unavailable = fakeRuntime({
    items: [descriptor({
      pluginId: 'c.ext',
      slots: ['composer.actions'],
      capabilities: { remotes: [] },
      client: { entryId: 'c.ext/client', format: 'esm', sdkVersion: '^1.0.0' },
    })],
  })
  await unavailable.runtime.start()
  assert.equal(unavailable.runtime.entries.get('c.ext')?.runner.state, 'load-failed')
  assert.ok(
    JSON.stringify(unavailable.runtime.diagnostics).includes('controlled resource protocol'),
    'missing resolver produces an actionable diagnostic',
  )
})

test('loadProtocolClientModule enforces SDK range, export shape and deadline', async () => {
  let resolverCalls = 0
  const resolver = async () => {
    resolverCalls += 1
    return { url: 'deeptop-plugin://localhost/x/y/client.mjs' }
  }
  await assert.rejects(
    loadProtocolClientModule(
      { pluginId: 'x.y', entryId: 'x/y/client', sdkVersion: '^9.0.0', runtimeSdkVersion: '1.0.0' },
      resolver,
    ),
    error => error.code === 'check-failed',
  )
  assert.equal(resolverCalls, 0, 'SDK range is checked before any bundle resolution')

  await assert.rejects(
    loadProtocolClientModule(
      { pluginId: 'x.y', entryId: 'x/y/client', sdkVersion: '^1.0.0', runtimeSdkVersion: '1.0.0' },
      resolver,
      async () => ({ noActivate: true }),
    ),
    error => error.code === 'load-failed' && /does not export activate/.test(error.message),
  )

  await assert.rejects(
    loadProtocolClientModule(
      { pluginId: 'x.y', entryId: 'x/y/client', sdkVersion: '^1.0.0', runtimeSdkVersion: '1.0.0' },
      resolver,
      () => new Promise(() => undefined),
      20,
    ),
    error => error.code === 'load-failed' && /超时/.test(error.message),
  )
  assert.equal(PROTOCOL_IMPORT_TIMEOUT_MS, 30_000)

  const activated = await loadProtocolClientModule(
    { pluginId: 'x.y', entryId: 'x/y/client', sdkVersion: '~1.0.3', runtimeSdkVersion: '1.0.9' },
    resolver,
    async () => protocolModule,
  )
  assert.equal(typeof activated.activate, 'function')
})

test('deactivate is idempotent and scope disposal unwinds in reverse order', async () => {
  const scope = new PluginScope()
  const order = []
  scope.add(() => order.push('first'))
  scope.add(() => order.push('second'))
  scope.dispose()
  scope.dispose()
  assert.deepEqual(order, ['second', 'first'])
  let calls = 0
  const detach = scope.add(() => {})
  assert.equal(typeof detach, 'function')
  detach()
  scope.add(() => { calls += 1 })
  scope.dispose()
  assert.equal(calls, 0, 'resources added after disposal never run their cleanup')
})

test('scoped remote rejects undeclared namespaces and methods before any request', async () => {
  const requests = []
  const remote = createScopedRemote('p.x', {
    remotes: [{ namespace: 'alpha', methods: ['list'] }],
  }, { request: async (method, payload) => { requests.push({ method, payload }); return { value: 'ok' } } })
  await assert.rejects(remote.invokeIn('beta', 'list'), error => error instanceof CapabilityDeniedError)
  await assert.rejects(remote.invokeIn('alpha', 'purge'), error => error instanceof CapabilityDeniedError)
  assert.equal(requests.length, 0)
  assert.equal(await remote.invokeIn('alpha', 'list'), 'ok')
  await assert.rejects(
    createScopedRemote('p.y', { remotes: [{ namespace: 'a', methods: ['x'] }, { namespace: 'b', methods: ['y'] }] }, { request: async () => ({ value: 1 }) }).invoke('x'),
    error => error instanceof CapabilityDeniedError,
    'ambiguous single-namespace shortcut refuses to guess',
  )
})

test('scoped event delivery honors declarations and detaches on dispose', () => {
  const events = new PluginEventScope('p.z', () => ['allowed/event'])
  assert.throws(() => events.on('undeclared/event', () => {}), error => error instanceof CapabilityDeniedError)
  const seen = []
  events.on('allowed/event', payload => seen.push(payload))
  assert.equal(events.dispatch('allowed/event', { n: 1 }), true)
  events.dispose()
  assert.equal(events.dispatch('allowed/event', { n: 2 }), false)
  assert.deepEqual(seen, [{ n: 1 }])
})

test('runtime dispatches bridge frames only to plugins that declared the event', async () => {
  const seen = []
  const module = {
    activate(context) {
      context.events.on('sessionPins/changed', payload => seen.push(payload))
    },
  }
  const full = descriptor({ client: { entryId: 'example.session-pins/client', format: 'esm', sdkVersion: '^1.0.0' } })
  const { runtime, handlers } = fakeRuntime({ items: [full], modules: { 'example.session-pins/client': async () => module } })
  await runtime.start()
  for (const handler of handlers) handler({ channel: 'host', frame: { rpcId: 'r1', payload: { event: 'sessionPins/changed', args: [1] } } })
  for (const handler of handlers) handler({ channel: 'mux', frame: { rpcId: 'r2', payload: { event: 'unrelated/event' } } })
  assert.deepEqual(seen, [{ event: 'sessionPins/changed', args: [1] }])
  await runtime.stop()
  for (const handler of handlers) handler({ channel: 'host', frame: { rpcId: 'r3', payload: { event: 'sessionPins/changed' } } })
  assert.equal(seen.length, 1, 'disposed plugins stop receiving frames')
})

test('catalog snapshots and change notifications power the settings surface', async () => {
  const declarative = descriptor({
    client: undefined,
    contributions: [
      { kind: 'action', id: 'pins.toggle', slot: 'session.context-menu', label: '置顶会话', order: 30, invoke: { namespace: 'sessionPins', method: 'toggle' } },
    ],
  })
  const { runtime } = fakeRuntime({ items: [declarative] })
  const changes = []
  const unlisten = runtime.onCatalogChange(() => changes.push(runtime.catalogSnapshot()))
  await runtime.start()
  const snapshot = runtime.catalogSnapshot()
  assert.equal(snapshot.status, 'ready')
  assert.equal(snapshot.plugins.length, 1)
  const view = snapshot.plugins[0]
  assert.equal(view.pluginId, 'example.session-pins')
  assert.deepEqual(view.slots, ['session.context-menu', 'session.row.trailing'])
  assert.deepEqual(view.remotes, [{ namespace: 'sessionPins', methods: ['list', 'toggle'] }])
  assert.equal(view.storage, 'session-pins')
  assert.equal(view.hasClientModule, false)
  assert.ok(changes.length >= 1, 'refresh notifies catalog listeners')
  await runtime.stop()
  assert.equal(runtime.catalogSnapshot().plugins.length, 0)
  unlisten()
})

test('slot registry enforces whitelists, uniqueness and stable ordering', () => {
  const registry = new SlotRegistry()
  const allowed = ['session.context-menu']
  const disposeA = registry.register('plugin.a', allowed, 'session.context-menu', { kind: 'action', id: 'same.id', order: 10, render: () => null })
  assert.throws(() => registry.register('plugin.b', allowed, 'session.row.trailing', { kind: 'badge', id: 'x', render: () => null }), /not allowed/)
  assert.throws(() => registry.register('plugin.c', allowed, 'made.up.slot', { kind: 'action', id: 'x', render: () => null }), /known desktop UI slot/)
  assert.throws(
    () => registry.register('plugin.a', allowed, 'session.context-menu', { kind: 'action', id: 'same.id', render: () => null }),
    /already registered/,
    'the same plugin cannot register one contribution id twice',
  )
  // Cross-plugin contributions with equal ids stay legal (§7.6: uniqueness is pluginId + id).
  registry.register('plugin.d', allowed, 'session.context-menu', { kind: 'action', id: 'same.id', order: -5, render: () => null })

  registry.register('plugin.e', allowed, 'session.context-menu', { kind: 'action', id: 'later', order: 20, render: () => null })
  registry.register('plugin.f', allowed, 'session.context-menu', { kind: 'action', id: 'default-order', render: () => null })
  const snapshot = registry.snapshot('session.context-menu')
  assert.deepEqual(snapshot.map(item => item.pluginId), ['plugin.d', 'plugin.f', 'plugin.a', 'plugin.e'], 'order first, then pluginId, then id')
  assert.equal(registry.snapshot('session.context-menu'), snapshot, 'snapshots stay referentially stable between mutations')

  const notified = []
  const unsubscribe = registry.subscribe(() => notified.push('change'))
  disposeA()
  assert.notEqual(registry.snapshot('session.context-menu'), snapshot, 'mutations invalidate snapshots')
  assert.ok(notified.length >= 1)
  unsubscribe()
  registry.unregisterPlugin('plugin.f')
})

test('DSH restart clears old generation state and re-discovers fresh descriptors', async () => {
  const moduleInstances = []
  const makeModule = () => {
    const instance = {
      activate(context) {
        this.disposeMenu = context.ui.register('session.context-menu', { kind: 'action', id: 'pins.toggle', render: () => null })
      },
      deactivate() {
        this.disposeMenu?.()
      },
    }
    moduleInstances.push(instance)
    return instance
  }
  const first = descriptor({
    version: '0.1.0',
    client: { entryId: 'example.session-pins/client', format: 'esm', sdkVersion: '^1.0.0' },
  })
  const source = { items: [first] }
  const runtime = new DesktopUiRuntime({
    request: async (method) => {
      if (method === 'ui.plugin.list') return { items: source.items }
      throw new Error('unexpected')
    },
    listen: () => () => {},
    bundledModules: { 'example.session-pins/client': async () => makeModule() },
  })
  await runtime.start()
  assert.equal(moduleInstances.length, 1)
  runtime.updateSession({ sessionId: 's-1', title: 'T', running: false, blank: false })
  assert.equal(runtime.sessionGeneration, 1)

  await runtime.handleHostRestart()
  assert.equal(runtime.slots.snapshot('session.context-menu').length, 0, 'old contributions are gone immediately')
  assert.equal(runtime.sessionContext, null)
  assert.equal(runtime.sessionGeneration, 2)

  source.items = [{ ...first, version: '0.2.0' }]
  await runtime.refresh()
  assert.equal(moduleInstances.length, 2, 'a fresh activation runs after the restart')
  assert.equal(runtime.status, 'ready')
  assert.equal(runtime.slots.snapshot('session.context-menu').length, 1)
})

test('session subscribers receive initial and changed sessions but not same-session projections', () => {
  const runtime = new DesktopUiRuntime({ request: async () => ({ items: [] }), listen: () => () => {} })
  const sessions = []
  runtime.updateSession({ sessionId: 's-1', title: 'One', running: false, blank: false })
  runtime.onSessionChange(session => sessions.push(session?.sessionId ?? null))
  runtime.updateSession({ sessionId: 's-1', title: 'One updated', running: true, blank: false })
  runtime.updateSession({ sessionId: 's-2', title: 'Two', running: false, blank: false })
  assert.deepEqual(sessions, ['s-1', 's-2'])
  assert.equal(runtime.sessionGeneration, 2)
})

test('catalog failures keep the host app functional and report diagnostics', async () => {
  const runtime = new DesktopUiRuntime({
    request: async () => { throw new Error('bridge down') },
    listen: () => () => {},
  })
  await runtime.start()
  assert.equal(runtime.status, 'failed')
  assert.match(runtime.diagnostics[0]?.message ?? '', /bridge down/)
  runtime.updateSession(null)
  assert.equal(runtime.sessionGeneration, 1)

  const malformed = fakeRuntime({ items: [{ broken: true }, { pluginId: 'ok.host-only', version: '1.0.0', status: 'available', slots: ['settings.sections'], capabilities: {}, contributions: [] }] })
  await malformed.runtime.start()
  assert.equal(malformed.runtime.status, 'ready')
  assert.equal(malformed.runtime.slots.snapshot('settings.sections').length, 0, 'declared-but-empty slot renders nothing')
})

test('declarative invocation routes through the restricted route with session binding', async () => {
  const contribution = { kind: 'action', id: 'pins.toggle', slot: 'session.context-menu', label: '置顶会话', invoke: { namespace: 'sessionPins', method: 'toggle' } }
  const declarative = descriptor({ client: undefined, contributions: [contribution] })
  const { runtime, requests } = fakeRuntime({ items: [declarative] })
  await runtime.start()
  await runtime.invokeDeclarative('example.session-pins', contribution, { sessionId: 's-42' })
  const invoke = requests.find(request => request.method === 'ui.plugin.invoke')
  assert.deepEqual(invoke.payload, { pluginId: 'example.session-pins', namespace: 'sessionPins', method: 'toggle', args: { sessionId: 's-42' } })
  await assert.rejects(runtime.invokeDeclarative('example.session-pins', { kind: 'badge', id: 'b', slot: 'session.row.trailing', label: 'B' }), /invoke target/)
})

test('scoped storage passes through the restricted routes', async () => {
  const store = new Map()
  const { runtime, requests, request } = fakeRuntime({
    responses: new Map([
      ['ui.plugin.storage.set', async ({ key, value }) => { store.set(key, value); return { stored: true } }],
      ['ui.plugin.storage.get', async ({ key }) => ({ value: store.get(key) ?? null })],
      ['ui.plugin.storage.delete', async ({ key }) => { store.delete(key); return { deleted: true } }],
    ]),
  })
  const storage = createScopedStorage('example.session-pins', { request })
  await storage.set('last', { pinned: true })
  assert.deepEqual(await storage.get('last'), { pinned: true })
  await storage.delete('last')
  assert.equal(await storage.get('last'), null)
  const methods = requests.filter(item => item.method.startsWith('ui.plugin.storage.')).map(item => item.method)
  assert.deepEqual(methods, ['ui.plugin.storage.set', 'ui.plugin.storage.get', 'ui.plugin.storage.delete', 'ui.plugin.storage.get'])
})
