import assert from 'node:assert/strict'
import test from 'node:test'
import { DesktopUiRuntime } from './client-runtime.ts'
import { SlotRegistry } from './slot-registry.ts'
import { ClientPluginRunner, PluginScope } from './plugin-runner.ts'
import { UiRuntimeHostLifecycle } from './host-lifecycle.ts'
import { loadProtocolClientModule, PROTOCOL_IMPORT_TIMEOUT_MS } from './module-loader.ts'
import {
  CapabilityDeniedError,
  PluginEventScope,
  createScopedRemote,
  createScopedSettings,
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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

function fakeRuntime({ items = [], modules = {}, responses = new Map(), resolveBundle, importModule, activateTimeoutMs, deactivateTimeoutMs } = {}) {
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
    ...(activateTimeoutMs === undefined ? {} : { activateTimeoutMs }),
    ...(deactivateTimeoutMs === undefined ? {} : { deactivateTimeoutMs }),
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

test('sync and async activation rejection each invoke module cleanup exactly once', async () => {
  let syncCleanup = 0
  let asyncCleanup = 0
  const syncFailure = descriptor({
    pluginId: 'p.sync-failure',
    slots: ['composer.actions'],
    capabilities: { remotes: [] },
    client: { entryId: 'p.sync-failure/client', format: 'esm', sdkVersion: '^1.0.0' },
  })
  const asyncFailure = descriptor({
    pluginId: 'p.async-failure',
    slots: ['inspector.tabs'],
    capabilities: { remotes: [] },
    client: { entryId: 'p.async-failure/client', format: 'esm', sdkVersion: '^1.0.0' },
  })
  const { runtime } = fakeRuntime({
    items: [syncFailure, asyncFailure],
    modules: {
      'p.sync-failure/client': async () => ({
        activate() { throw new Error('sync failure') },
        deactivate() { syncCleanup += 1 },
      }),
      'p.async-failure/client': async () => ({
        async activate() { throw new Error('async failure') },
        deactivate() { asyncCleanup += 1 },
      }),
    },
  })
  await runtime.start()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(runtime.status, 'partial')
  assert.equal(syncCleanup, 1)
  assert.equal(asyncCleanup, 1)
  await runtime.stop()
  assert.equal(syncCleanup, 1)
  assert.equal(asyncCleanup, 1)
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
  const detach = scope.add(() => { calls += 1 })
  assert.equal(typeof detach, 'function')
  detach()
  detach()
  assert.equal(calls, 1, 'an early disposer releases the resource immediately and only once')
  let lateCalls = 0
  scope.add(() => { lateCalls += 1 })
  assert.equal(lateCalls, 1, 'resources added after disposal are released immediately')
})

test('plugin deactivation revokes scope capabilities before waiting and is bounded', async () => {
  const release = deferred()
  let sessionListenerDisposed = false
  let deactivateStarted = false
  const runner = new ClientPluginRunner({
    descriptor: descriptor({ client: { entryId: 'example.session-pins/client', format: 'esm', sdkVersion: '^1.0.0' } }),
    runtimeSdkVersion: '1.0.0',
    loadModule: async () => ({
      activate(context) {
        context.session.onChange(() => undefined)
        context.ui.register('session.context-menu', { kind: 'action', id: 'owned', render: () => null })
      },
      async deactivate() {
        deactivateStarted = true
        await release.promise
      },
    }),
    buildContext: (_descriptor, scope) => ({
      plugin: { id: 'example.session-pins', version: '0.1.0', descriptor: descriptor() },
      ui: { register: () => scope.add(() => { sessionListenerDisposed = true }) },
      locale: 'en', host: { prompt: async () => null, notify: () => undefined },
      remote: { invoke: async () => undefined, invokeIn: async () => undefined },
      events: { on: () => scope.add(() => undefined) },
      storage: { get: async () => null, set: async () => undefined, delete: async () => undefined },
      session: { current: null, generation: 0, onChange: () => scope.add(() => { sessionListenerDisposed = true }) },
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
      signal: new AbortController().signal,
    }),
    deactivateTimeoutMs: 20,
  })
  await runner.activate()
  const deactivation = runner.deactivate('host-restarted')
  await flushMicrotasks()
  assert.equal(deactivateStarted, true)
  assert.equal(sessionListenerDisposed, true)
  await assert.rejects(deactivation, /deactivate timed out/)
  assert.equal(runner.state, 'disposed')
  release.resolve()
})

test('plugin activation is bounded and a late registration cannot revive its timed-out entry', async () => {
  const release = deferred()
  let deactivated = 0
  const lateSessions = []
  const full = descriptor({
    client: { entryId: 'example.session-pins/client', format: 'esm', sdkVersion: '^1.0.0' },
  })
  const { runtime } = fakeRuntime({
    items: [full],
    activateTimeoutMs: 20,
    deactivateTimeoutMs: 20,
    modules: {
      'example.session-pins/client': async () => ({
        async activate(context) {
          await release.promise
          context.session.onChange(session => lateSessions.push(session?.sessionId ?? null))
          context.ui.register('session.context-menu', { kind: 'action', id: 'late', render: () => null })
        },
        deactivate() { deactivated += 1 },
      }),
    },
  })

  await runtime.start()
  assert.equal(runtime.status, 'partial')
  assert.equal(runtime.entries.get('example.session-pins')?.runner.state, 'activate-failed')
  assert.equal(runtime.slots.snapshot('session.context-menu').length, 0)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(deactivated, 1, 'a timed-out activate receives bounded module cleanup')
  runtime.updateSession({ sessionId: 'late-session', title: 'Late', running: false, blank: false })

  release.resolve()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(lateSessions.length, 0, 'late activate cannot receive an initial Session callback after disposal')
  assert.equal(runtime.slots.snapshot('session.context-menu').length, 0, 'late activation sees an already disposed scope')
  await runtime.stop()
})

test('a late activation receives one follow-up cleanup for private resources', async () => {
  const release = deferred()
  let interval = null
  let deactivateCalls = 0
  const full = descriptor({
    client: { entryId: 'example.session-pins/client', format: 'esm', sdkVersion: '^1.0.0' },
  })
  const { runtime } = fakeRuntime({
    items: [full],
    activateTimeoutMs: 20,
    deactivateTimeoutMs: 20,
    modules: {
      'example.session-pins/client': async () => ({
        async activate() {
          await release.promise
          interval = setInterval(() => undefined, 60_000)
          interval.unref?.()
        },
        deactivate() {
          deactivateCalls += 1
          clearInterval(interval)
          interval = null
        },
      }),
    },
  })
  await runtime.start()
  assert.equal(runtime.status, 'partial')
  assert.equal(deactivateCalls, 1, 'primary cleanup begins while activate is still pending')
  release.resolve()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(deactivateCalls, 2, 'late activation receives one independent follow-up cleanup')
  assert.equal(interval, null, 'the follow-up cleanup releases late private resources')
  await runtime.stop()
  assert.equal(deactivateCalls, 2)
})

test('a module that resolves after load timeout receives one bounded cleanup', async () => {
  const load = deferred()
  let interval = null
  let deactivateCalls = 0
  const full = descriptor({
    client: { entryId: 'example.session-pins/client', format: 'esm', sdkVersion: '^1.0.0' },
  })
  const { runtime } = fakeRuntime({
    items: [full],
    activateTimeoutMs: 20,
    deactivateTimeoutMs: 20,
    modules: {
      'example.session-pins/client': async () => load.promise,
    },
  })
  await runtime.start()
  assert.equal(runtime.status, 'partial')
  interval = setInterval(() => undefined, 60_000)
  interval.unref?.()
  load.resolve({
    activate() { throw new Error('late module must never activate') },
    deactivate() {
      deactivateCalls += 1
      clearInterval(interval)
      interval = null
    },
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(deactivateCalls, 1)
  assert.equal(interval, null, 'late loaded module cleans private resources')
  await runtime.stop()
  assert.equal(deactivateCalls, 1, 'the primary disposal does not clean late load twice')
})

test('plugin loading is bounded when a bundle factory never settles', async () => {
  const load = deferred()
  const full = descriptor({
    client: { entryId: 'example.session-pins/client', format: 'esm', sdkVersion: '^1.0.0' },
  })
  const { runtime } = fakeRuntime({
    items: [full],
    activateTimeoutMs: 20,
    modules: {
      'example.session-pins/client': async () => load.promise,
    },
  })
  await runtime.start()
  assert.equal(runtime.status, 'partial')
  assert.equal(runtime.entries.get('example.session-pins')?.runner.state, 'load-failed')
  load.resolve({ activate() {} })
  await new Promise(resolve => setImmediate(resolve))
  await runtime.stop()
})

test('Host down aborts a hanging module load instead of blocking the lifecycle queue', async () => {
  const load = deferred()
  const full = descriptor({
    client: { entryId: 'example.session-pins/client', format: 'esm', sdkVersion: '^1.0.0' },
  })
  const { runtime } = fakeRuntime({
    items: [full],
    activateTimeoutMs: 1_000,
    modules: {
      'example.session-pins/client': async () => load.promise,
    },
  })
  const starting = runtime.start()
  await flushMicrotasks()
  const unavailable = runtime.handleHostUnavailable()
  let timer
  try {
    await Promise.race([
      Promise.all([starting, unavailable]),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('hanging module load blocked Host teardown')), 250) }),
    ])
  } finally {
    clearTimeout(timer)
  }
  assert.deepEqual(runtime.pluginViews, [])
  load.resolve({ activate() {} })
  await new Promise(resolve => setImmediate(resolve))
})

test('host unavailability revokes slots, bridge events and Session listeners before a slow plugin teardown', async () => {
  const release = deferred()
  let deactivateStarted = false
  let staleContext
  const sessions = []
  const eventPayloads = []
  const full = descriptor({
    client: { entryId: 'example.session-pins/client', format: 'esm', sdkVersion: '^1.0.0' },
  })
  const { runtime, handlers, requests } = fakeRuntime({
    items: [full],
    modules: {
      'example.session-pins/client': async () => ({
        activate(context) {
          staleContext = context
          context.session.onChange(session => sessions.push(session?.sessionId ?? null))
          context.events.on('sessionPins/changed', payload => eventPayloads.push(payload))
          context.ui.register('session.context-menu', { kind: 'action', id: 'owned', render: () => null })
        },
        async deactivate() {
          deactivateStarted = true
          await release.promise
        },
      }),
    },
    deactivateTimeoutMs: 100,
  })
  await runtime.start()
  runtime.updateSession({ sessionId: 's-1', title: 'One', running: false, blank: false })
  assert.deepEqual(sessions, [null, 's-1'])
  assert.equal(runtime.slots.snapshot('session.context-menu').length, 1)
  assert.equal(handlers.size, 1)

  const unavailable = runtime.handleHostUnavailable()
  assert.equal(runtime.status, 'loading')
  assert.deepEqual(runtime.pluginViews, [])
  assert.equal(runtime.slots.snapshot('session.context-menu').length, 0)
  assert.equal(handlers.size, 0, 'the old bridge listener detaches synchronously')
  const requestsBeforeStaleContext = requests.length
  assert.equal(staleContext.session.current, null)
  assert.equal(staleContext.session.generation, -1)
  await assert.rejects(staleContext.host.prompt({ title: 'stale' }), /plugin context is disposed/)
  await assert.rejects(staleContext.remote.invokeIn('sessionPins', 'list'), /plugin context is disposed/)
  await assert.rejects(staleContext.storage.get('key'), /plugin context is disposed/)
  assert.equal(requests.length, requestsBeforeStaleContext, 'a disposed context cannot reach the new Host')
  runtime.updateSession({ sessionId: 's-2', title: 'Two', running: false, blank: false })
  assert.deepEqual(sessions, [null, 's-1'], 'the old plugin cannot observe a later Session projection')
  assert.deepEqual(eventPayloads, [])

  await flushMicrotasks()
  assert.equal(deactivateStarted, true)
  release.resolve()
  await unavailable
})

function fakeLifecycleRuntime() {
  const calls = []
  const starts = []
  const runtime = {
    start: async () => {
      calls.push('start')
      const gate = deferred()
      starts.push(gate)
      return gate.promise
    },
    stop: async () => { calls.push('stop') },
    handleHostUnavailable: async () => { calls.push('down') },
    handleHostRestart: async () => { calls.push('restart') },
    refresh: async () => { calls.push('refresh'); return true },
  }
  return { runtime, calls, starts }
}

test('component contribution host prompts are bound to the plugin AbortSignal', async () => {
  const promptGate = deferred()
  let receivedSignal
  let capturedHost
  const full = descriptor({
    client: { entryId: 'example.session-pins/client', format: 'esm', sdkVersion: '^1.0.0' },
  })
  const runtime = new DesktopUiRuntime({
    request: async method => {
      if (method === 'ui.plugin.list') return { items: [full] }
      throw new Error(`unexpected ${method}`)
    },
    listen: () => () => undefined,
    hostActions: {
      prompt: (_request, signal) => {
        receivedSignal = signal
        return promptGate.promise
      },
      notify: () => undefined,
    },
    bundledModules: {
      'example.session-pins/client': async () => ({
        activate(context) {
          context.ui.register('session.context-menu', {
            kind: 'action',
            id: 'prompt',
            render(slot) {
              capturedHost = slot.host
              return null
            },
          })
        },
      }),
    },
  })
  await runtime.start()
  const entry = runtime.slots.snapshot('session.context-menu')[0]
  const element = entry.render({ session: null, activeSessionId: null, sessionGeneration: 0, locale: 'en', host: { prompt: async () => 'wrong host', notify: () => undefined } })
  element.type(element.props)
  const pending = capturedHost.prompt({ title: 'stale prompt' })
  await flushMicrotasks()
  assert.equal(receivedSignal?.aborted, false)
  const unavailable = runtime.handleHostUnavailable()
  await assert.rejects(pending, /plugin context is disposed/)
  assert.equal(receivedSignal?.aborted, true)
  promptGate.resolve('late answer')
  await unavailable
})

test('a caller-cancelled scoped prompt never enqueues a host popup', async () => {
  let promptCalls = 0
  let capturedHost
  const full = descriptor({
    client: { entryId: 'example.session-pins/client', format: 'esm', sdkVersion: '^1.0.0' },
  })
  const runtime = new DesktopUiRuntime({
    request: async method => {
      if (method === 'ui.plugin.list') return { items: [full] }
      throw new Error(`unexpected ${method}`)
    },
    listen: () => () => undefined,
    hostActions: {
      prompt: async () => {
        promptCalls += 1
        return 'unexpected'
      },
      notify: () => undefined,
    },
    bundledModules: {
      'example.session-pins/client': async () => ({
        activate(context) {
          context.ui.register('session.context-menu', {
            kind: 'action',
            id: 'prompt-cancel',
            render(slot) {
              capturedHost = slot.host
              return null
            },
          })
        },
      }),
    },
  })
  await runtime.start()
  const entry = runtime.slots.snapshot('session.context-menu')[0]
  const element = entry.render({ session: null, activeSessionId: null, sessionGeneration: 0, locale: 'en', host: { prompt: async () => 'wrong host', notify: () => undefined } })
  element.type(element.props)
  const caller = new AbortController()
  const pending = capturedHost.prompt({ title: 'cancel before prompt' }, caller.signal)
  caller.abort(new Error('caller cancelled prompt'))
  await assert.rejects(pending, /caller cancelled prompt/)
  await flushMicrotasks()
  assert.equal(promptCalls, 0)
  await runtime.stop()
})

test('host lifecycle revokes stale recovery during rapid down/up and unmount', async () => {
  const harness = fakeLifecycleRuntime()
  const lifecycle = new UiRuntimeHostLifecycle(harness.runtime)
  lifecycle.start()
  assert.deepEqual(harness.calls, ['start'])
  lifecycle.statusChanged(false)
  assert.deepEqual(harness.calls, ['start', 'down'])
  lifecycle.statusChanged(true)
  assert.equal(harness.starts.length, 1, 'an in-flight start is not duplicated')
  harness.starts[0].resolve(true)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(harness.calls, ['start', 'down', 'restart', 'refresh'], 'the invalidated runtime recovers without a stale shared stop')

  lifecycle.statusChanged(true)
  await flushMicrotasks()
  assert.deepEqual(harness.calls, ['start', 'down', 'restart', 'refresh'])

  lifecycle.statusChanged(false)
  lifecycle.statusChanged(true)
  lifecycle.dispose()
  await flushMicrotasks()
  assert.equal(harness.calls.filter((call) => call === 'refresh').length, 1, 'unmount prevents stale recovery refresh')
  assert.equal(harness.calls.at(-1), 'stop')
})

test('start does not stale an in-flight Host recovery after a ready transition', async () => {
  const calls = []
  const restart = deferred()
  const runtime = {
    start: async () => { calls.push('start'); return true },
    stop: async () => { calls.push('stop') },
    handleHostUnavailable: async () => { calls.push('down') },
    handleHostRestart: async () => { calls.push('restart'); await restart.promise },
    refresh: async () => { calls.push('refresh'); return true },
  }
  const lifecycle = new UiRuntimeHostLifecycle(runtime)
  lifecycle.start()
  await flushMicrotasks()

  lifecycle.statusChanged(false)
  lifecycle.statusChanged(true)
  assert.deepEqual(calls, ['start', 'down', 'restart'])

  // The listener-first checkDsh seed may finish here. It must leave the
  // recovery epoch alone instead of scheduling a second restart.
  lifecycle.start()
  restart.resolve()
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(calls.filter(call => call === 'restart').length, 1)
  assert.equal(calls.filter(call => call === 'refresh').length, 1)
})

test('a stale initial start never stops a newer shared Runtime generation', async () => {
  const harness = fakeLifecycleRuntime()
  const lifecycle = new UiRuntimeHostLifecycle(harness.runtime)
  lifecycle.start()
  lifecycle.statusChanged(false)
  harness.starts[0].resolve(true)
  await flushMicrotasks()
  assert.equal(harness.calls.filter(call => call === 'stop').length, 0)
  assert.equal(harness.calls.filter(call => call === 'down').length, 1)
})

test('host lifecycle retries after an initial catalog failure when Host reports ready', async () => {
  const harness = fakeLifecycleRuntime()
  const lifecycle = new UiRuntimeHostLifecycle(harness.runtime)
  lifecycle.start()
  harness.starts[0].resolve(false)
  await flushMicrotasks()
  lifecycle.statusChanged(true)
  await flushMicrotasks()
  assert.equal(harness.starts.length, 2)
  harness.starts[1].resolve(true)
  await flushMicrotasks()
  assert.equal(harness.calls.filter((call) => call === 'start').length, 2)
})

test('a ready frame during pending discovery retries when that discovery resolves false', async () => {
  const harness = fakeLifecycleRuntime()
  const lifecycle = new UiRuntimeHostLifecycle(harness.runtime)
  lifecycle.start()
  lifecycle.statusChanged(true)
  harness.starts[0].resolve(false)
  await flushMicrotasks()
  assert.equal(harness.starts.length, 2, 'the ready frame is retained until the first start settles')
  harness.starts[1].resolve(true)
  await flushMicrotasks()
  assert.equal(harness.calls.filter((call) => call === 'start').length, 2)
})

test('host lifecycle honors an initial unavailable snapshot before starting discovery', async () => {
  const harness = fakeLifecycleRuntime()
  const lifecycle = new UiRuntimeHostLifecycle(harness.runtime, { initialHostAvailable: false })
  lifecycle.start()
  assert.deepEqual(harness.calls, [])
  lifecycle.statusChanged(true)
  assert.deepEqual(harness.calls, ['start'])
  harness.starts[0].resolve(true)
  await flushMicrotasks()
  assert.equal(harness.calls.filter(call => call === 'start').length, 1)
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

test('aborted plugin facades refuse stale Remote and Storage calls before wire traffic', async () => {
  const controller = new AbortController()
  const requests = []
  const send = { request: async (method, payload, signal) => {
    requests.push({ method, payload, signal })
    return { value: 'unexpected' }
  } }
  const remote = createScopedRemote('p.stale', {
    remotes: [{ namespace: 'alpha', methods: ['list'] }],
  }, send, controller.signal)
  const storage = createScopedStorage('p.stale', send, controller.signal)
  controller.abort(new Error('plugin context is disposed'))

  await assert.rejects(remote.invokeIn('alpha', 'list'), /plugin context is disposed/)
  await assert.rejects(storage.get('key'), /plugin context is disposed/)
  await assert.rejects(storage.set('key', { value: true }), /plugin context is disposed/)
  await assert.rejects(storage.delete('key'), /plugin context is disposed/)
  assert.equal(requests.length, 0)
})

test('late Remote and Storage responses are rejected when their context aborts', async () => {
  const controller = new AbortController()
  const remoteGate = deferred()
  const storageGate = deferred()
  const seenSignals = []
  const send = {
    request(method, _payload, signal) {
      seenSignals.push(signal)
      return method === 'ui.plugin.invoke' ? remoteGate.promise : storageGate.promise
    },
  }
  const remote = createScopedRemote('p.late', {
    remotes: [{ namespace: 'alpha', methods: ['list'] }],
  }, send, controller.signal)
  const storage = createScopedStorage('p.late', send, controller.signal)
  const pendingRemote = remote.invokeIn('alpha', 'list')
  const pendingStorage = storage.get('key')
  controller.abort(new Error('plugin context is disposed'))
  await assert.rejects(pendingRemote, /plugin context is disposed/)
  await assert.rejects(pendingStorage, /plugin context is disposed/)
  remoteGate.resolve({ value: 'late remote' })
  storageGate.resolve({ value: 'late storage' })
  await flushMicrotasks()
  assert.equal(seenSignals.length, 2)
  assert.ok(seenSignals.every(signal => signal?.aborted), 'the sender receives the context AbortSignal')
})

test('async plugin event handlers report failures without blocking healthy siblings', async () => {
  const errors = []
  const events = new PluginEventScope('p.events', () => ['allowed/event'], error => errors.push(String(error.message ?? error)))
  const seen = []
  events.on('allowed/event', async () => { throw new Error('async event boom') })
  events.on('allowed/event', payload => seen.push(payload))
  assert.equal(events.dispatch('allowed/event', { n: 1 }), true)
  await flushMicrotasks()
  assert.deepEqual(seen, [{ n: 1 }])
  assert.deepEqual(errors, ['async event boom'])
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

test('a throwing bridge unlisten cannot block synchronous plugin revocation', async () => {
  const handlers = []
  const logs = []
  let eventDeliveries = 0
  let sessionDeliveries = 0
  const full = descriptor({
    client: { entryId: 'example.session-pins/client', format: 'esm', sdkVersion: '^1.0.0' },
  })
  const runtime = new DesktopUiRuntime({
    request: async method => {
      if (method === 'ui.plugin.list') return { items: [full] }
      throw new Error(`unexpected ${method}`)
    },
    listen: handler => {
      handlers.push(handler)
      return () => { throw new Error('unlisten failed') }
    },
    log: message => logs.push(message),
    bundledModules: {
      'example.session-pins/client': async () => ({
        activate(context) {
          context.events.on('sessionPins/changed', () => { eventDeliveries += 1 })
          context.session.onChange(() => { sessionDeliveries += 1 })
          context.ui.register('session.context-menu', { kind: 'action', id: 'owned', render: () => null })
        },
      }),
    },
  })
  await runtime.start()
  assert.equal(sessionDeliveries, 1)
  assert.equal(runtime.slots.snapshot('session.context-menu').length, 1)
  await runtime.handleHostUnavailable()
  assert.equal(runtime.slots.snapshot('session.context-menu').length, 0)
  handlers[0]({ channel: 'host', frame: { payload: { event: 'sessionPins/changed' } } })
  runtime.updateSession({ sessionId: 'after-down', title: 'After down', running: false, blank: false })
  assert.equal(eventDeliveries, 0)
  assert.equal(sessionDeliveries, 1)
  assert.ok(logs.some(message => message.includes('unlisten failed')))
})

test('an asynchronously unlistened old bridge handler cannot dispatch into a recovered generation', async () => {
  const seen = []
  const handlers = []
  const full = descriptor({ client: { entryId: 'example.session-pins/client', format: 'esm', sdkVersion: '^1.0.0' } })
  const runtime = new DesktopUiRuntime({
    request: async method => {
      if (method === 'ui.plugin.list') return { items: [full] }
      throw new Error(`unexpected ${method}`)
    },
    listen: handler => {
      handlers.push(handler)
      return () => undefined
    },
    bundledModules: {
      'example.session-pins/client': async () => ({
        activate(context) {
          context.events.on('sessionPins/changed', payload => seen.push(payload))
        },
      }),
    },
  })
  await runtime.start()
  assert.equal(handlers.length, 1)
  await runtime.handleHostUnavailable()
  await runtime.handleHostRestart()
  await runtime.refresh()
  assert.equal(handlers.length, 2)
  const frame = { channel: 'host', frame: { rpcId: 'recovered', payload: { event: 'sessionPins/changed', args: [2] } } }
  handlers[0](frame)
  assert.deepEqual(seen, [], 'the old listener is ignored by token and Host epoch')
  handlers[1](frame)
  assert.deepEqual(seen, [{ event: 'sessionPins/changed', args: [2] }])
  await runtime.stop()
})

test('down → up → down during slow teardown never reattaches a stale bridge listener', async () => {
  const release = deferred()
  const handlers = []
  const seen = []
  const full = descriptor({
    client: { entryId: 'example.session-pins/client', format: 'esm', sdkVersion: '^1.0.0' },
  })
  const runtime = new DesktopUiRuntime({
    request: async method => {
      if (method === 'ui.plugin.list') return { items: [full] }
      throw new Error(`unexpected ${method}`)
    },
    listen: handler => {
      handlers.push(handler)
      return () => undefined
    },
    deactivateTimeoutMs: 1_000,
    bundledModules: {
      'example.session-pins/client': async () => ({
        activate(context) {
          context.events.on('sessionPins/changed', payload => seen.push(payload))
        },
        async deactivate() {
          await release.promise
        },
      }),
    },
  })
  await runtime.start()
  assert.equal(handlers.length, 1)
  const downOne = runtime.handleHostUnavailable()
  const recovering = runtime.handleHostRestart()
  await flushMicrotasks()
  const downTwo = runtime.handleHostUnavailable()
  release.resolve()
  await Promise.all([downOne, recovering, downTwo])
  assert.equal(handlers.length, 1, 'the stale recovery must not install a second listener')
  handlers[0]({ channel: 'host', frame: { payload: { event: 'sessionPins/changed' } } })
  assert.deepEqual(seen, [], 'the detached generation cannot reach deactivated plugins')
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

test('DSH restart clears old plugin state and restores the active Session to fresh descriptors', async () => {
  const moduleInstances = []
  const makeModule = () => {
    const instance = {
      sessions: [],
      activate(context) {
        this.disposeSession = context.session.onChange(session => this.sessions.push(session?.sessionId ?? null))
        this.disposeMenu = context.ui.register('session.context-menu', { kind: 'action', id: 'pins.toggle', render: () => null })
      },
      deactivate() {
        this.disposeSession?.()
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
  assert.equal(runtime.sessionContext?.sessionId, 's-1', 'the App-owned projection survives Host teardown')
  assert.equal(runtime.sessionGeneration, 2)

  source.items = [{ ...first, version: '0.2.0' }]
  await runtime.refresh()
  assert.equal(moduleInstances.length, 2, 'a fresh activation runs after the restart')
  assert.deepEqual(moduleInstances[1].sessions, ['s-1'], 'fresh plugins immediately reload the active Session')
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

test('async Session handler failures do not block healthy plugin siblings', async () => {
  const logs = []
  const sessions = []
  const failing = descriptor({
    pluginId: 'p.fail-session',
    client: { entryId: 'p.fail-session/client', format: 'esm', sdkVersion: '^1.0.0' },
  })
  const healthy = descriptor({
    pluginId: 'p.healthy-session',
    client: { entryId: 'p.healthy-session/client', format: 'esm', sdkVersion: '^1.0.0' },
  })
  const runtime = new DesktopUiRuntime({
    request: async method => {
      if (method === 'ui.plugin.list') return { items: [failing, healthy] }
      throw new Error(`unexpected ${method}`)
    },
    listen: () => () => undefined,
    log: message => logs.push(message),
    bundledModules: {
      'p.fail-session/client': async () => ({
        activate(context) {
          context.session.onChange(async session => {
            if (session) throw new Error('async Session boom')
          })
        },
      }),
      'p.healthy-session/client': async () => ({
        activate(context) {
          context.session.onChange(session => sessions.push(session?.sessionId ?? null))
        },
      }),
    },
  })
  await runtime.start()
  runtime.updateSession({ sessionId: 's-1', title: 'One', running: false, blank: false })
  await flushMicrotasks()
  assert.deepEqual(sessions, [null, 's-1'])
  assert.ok(logs.some(message => message.includes('async Session boom')))
  await runtime.stop()
})

test('disabled runtime exposes a disabled snapshot before and after start', async () => {
  const runtime = new DesktopUiRuntime({
    enabled: false,
    request: async () => { throw new Error('disabled runtime must not request the Host') },
    listen: () => () => {},
  })
  assert.equal(runtime.catalogSnapshot().status, 'disabled')
  assert.equal(await runtime.start(), false)
  assert.equal(runtime.catalogSnapshot().status, 'disabled')
  assert.equal(await runtime.refresh(), false)
  assert.equal(runtime.catalogSnapshot().status, 'disabled')
})

test('a disabled Runtime can re-enable and discover a fresh plugin catalog', async () => {
  let activated = 0
  const full = descriptor({
    client: { entryId: 'example.session-pins/client', format: 'esm', sdkVersion: '^1.0.0' },
  })
  const { runtime, handlers } = fakeRuntime({
    items: [full],
    modules: {
      'example.session-pins/client': async () => ({
        activate(context) {
          activated += 1
          context.ui.register('session.context-menu', { kind: 'action', id: 'toggle', render: () => null })
        },
      }),
    },
  })
  await runtime.setEnabled(false)
  assert.equal(runtime.status, 'disabled')
  assert.equal(runtime.slots.snapshot('session.context-menu').length, 0)
  await runtime.setEnabled(true)
  assert.equal(runtime.status, 'loading')
  assert.equal(await runtime.start(), true)
  assert.equal(activated, 1)
  assert.equal(runtime.status, 'ready')
  assert.equal(handlers.size, 1)
  assert.equal(runtime.slots.snapshot('session.context-menu').length, 1)
  await runtime.setEnabled(false)
  assert.equal(runtime.status, 'disabled')
  assert.equal(handlers.size, 0)
  assert.equal(runtime.slots.snapshot('session.context-menu').length, 0)
})

test('a settings panel contribution carries its label to the settings slot', async () => {
  const { runtime } = fakeRuntime({
    items: [descriptor({
      slots: ['settings.sections'],
      client: { entryId: 'example.session-pins/client', format: 'esm', sdkVersion: '^1.0.0' },
    })],
    modules: {
      'example.session-pins/client': async () => ({
        activate(context) {
          context.ui.register('settings.sections', {
            kind: 'panel',
            id: 'settings',
            label: '提示词注入',
            order: 10,
            render: () => null,
          })
        },
      }),
    },
  })
  await runtime.start()
  const panels = runtime.slots.snapshot('settings.sections')
  assert.equal(panels.length, 1)
  // The settings nav names the section from the contribution itself, so the
  // app never hardcodes a plugin's display text.
  assert.equal(panels[0].kind, 'panel')
  assert.equal(panels[0].label, '提示词注入')
  assert.equal(panels[0].pluginId, 'example.session-pins')
  assert.equal(panels[0].contributionId, 'settings')
  assert.equal(typeof panels[0].render, 'function')
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
  const badge = { kind: 'badge', id: 'pins.badge', slot: 'session.row.trailing', label: 'B' }
  const declarative = descriptor({ client: undefined, contributions: [contribution, badge] })
  const { runtime, requests } = fakeRuntime({ items: [declarative] })
  await runtime.start()
  const activeAction = runtime.slots.snapshot('session.context-menu').find(item => item.contributionId === contribution.id).declarative
  const activeBadge = runtime.slots.snapshot('session.row.trailing').find(item => item.contributionId === badge.id).declarative
  await runtime.invokeDeclarative('example.session-pins', activeAction, { sessionId: 's-42' })
  const invoke = requests.find(request => request.method === 'ui.plugin.invoke')
  assert.deepEqual(invoke.payload, { pluginId: 'example.session-pins', namespace: 'sessionPins', method: 'toggle', args: { sessionId: 's-42' } })
  await assert.rejects(runtime.invokeDeclarative('example.session-pins', activeBadge), /invoke target/)
})

test('a captured declarative callback cannot invoke the Host after down invalidates its entry', async () => {
  const contribution = { kind: 'action', id: 'pins.toggle', slot: 'session.context-menu', label: '置顶会话', invoke: { namespace: 'sessionPins', method: 'toggle' } }
  const declarative = descriptor({ client: undefined, contributions: [contribution] })
  const { runtime, requests } = fakeRuntime({ items: [declarative] })
  await runtime.start()
  const captured = runtime.slots.snapshot('session.context-menu')[0].declarative
  const requestsBeforeDown = requests.length
  const unavailable = runtime.handleHostUnavailable()
  await assert.rejects(
    runtime.invokeDeclarative('example.session-pins', captured, { sessionId: 'stale' }),
    /no longer active/,
  )
  assert.equal(requests.length, requestsBeforeDown, 'stale declarative actions do not reach the bridge')
  await unavailable
})

test('a pending declarative invocation rejects immediately when Host goes down', async () => {
  const invokeGate = deferred()
  let receivedSignal
  const contribution = { kind: 'action', id: 'pins.toggle', slot: 'session.context-menu', label: '置顶会话', invoke: { namespace: 'sessionPins', method: 'toggle' } }
  const declarative = descriptor({ client: undefined, contributions: [contribution] })
  const runtime = new DesktopUiRuntime({
    request: async (method, _payload, signal) => {
      if (method === 'ui.plugin.list') return { items: [declarative] }
      if (method === 'ui.plugin.invoke') {
        receivedSignal = signal
        return invokeGate.promise
      }
      throw new Error(`unexpected ${method}`)
    },
    listen: () => () => undefined,
  })
  await runtime.start()
  const active = runtime.slots.snapshot('session.context-menu')[0].declarative
  const pending = runtime.invokeDeclarative('example.session-pins', active, { sessionId: 's-1' })
  await flushMicrotasks()
  const unavailable = runtime.handleHostUnavailable()
  await assert.rejects(pending, /Host runtime is unavailable/)
  assert.equal(receivedSignal?.aborted, true)
  invokeGate.resolve({ value: 'late result' })
  await unavailable
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

test('scoped settings narrows to the declared namespaces over the restricted routes', async () => {
  const calls = []
  const view = ns => ({ ns, schema: { uid: ns, refs: {} }, value: { enabled: true }, applies: 'live', secrets: [], revision: 3 })
  const { request } = fakeRuntime({
    responses: new Map([
      ['ui.plugin.settings.describe', async payload => { calls.push(payload); return { value: view(payload.ns) } }],
      ['ui.plugin.settings.mutate', async payload => { calls.push(payload); return { value: { ...view(payload.ns), revision: 4 } } }],
    ]),
  })
  const settings = createScopedSettings(
    'example.session-pins',
    { remotes: [], settings: ['session-pins-config'] },
    { request },
  )
  assert.deepEqual([...settings.namespaces], ['session-pins-config'])
  assert.equal((await settings.describe('session-pins-config')).revision, 3)
  const written = await settings.mutate('session-pins-config', [{ op: 'set', path: ['enabled'], value: false }], 3)
  assert.equal(written.revision, 4)
  assert.deepEqual(calls.map(call => call.ns), ['session-pins-config', 'session-pins-config'])
  assert.deepEqual(calls[1].ops, [{ op: 'set', path: ['enabled'], value: false }])
  assert.equal(calls[1].expectedRevision, 3)
  assert.equal(calls.every(call => call.pluginId === 'example.session-pins'), true)
})

test('scoped settings refuses an undeclared namespace before any wire traffic', async () => {
  const calls = []
  const { request } = fakeRuntime({
    responses: new Map([['ui.plugin.settings.describe', async payload => { calls.push(payload); return { value: {} } }]]),
  })
  const settings = createScopedSettings('example.session-pins', { remotes: [], settings: ['mine'] }, { request })
  // Another plugin's namespace, a host-owned one, and the empty-capability case
  // all fail locally, so a misdeclared plugin never even reaches the bridge.
  for (const namespace of ['ui-theme', 'locale', 'deeptop-prompt-injection']) {
    await assert.rejects(settings.describe(namespace), CapabilityDeniedError)
    await assert.rejects(settings.mutate(namespace, []), CapabilityDeniedError)
  }
  const none = createScopedSettings('example.session-pins', { remotes: [] }, { request })
  assert.deepEqual([...none.namespaces], [])
  await assert.rejects(none.describe('anything'), CapabilityDeniedError)
  assert.deepEqual(calls, [])
})

test('scoped settings stops after disposal even when a call is in flight', async () => {
  const gate = deferred()
  const { request } = fakeRuntime({
    responses: new Map([['ui.plugin.settings.describe', async () => gate.promise]]),
  })
  const controller = new AbortController()
  const settings = createScopedSettings('example.session-pins', { remotes: [], settings: ['mine'] }, { request }, controller.signal)
  const pending = settings.describe('mine')
  await flushMicrotasks()
  controller.abort(new Error('plugin context is disposed'))
  gate.resolve({ value: { ns: 'mine', revision: 1 } })
  // A late host answer must not reach a disposed plugin.
  await assert.rejects(pending, /plugin context is disposed/)
})
