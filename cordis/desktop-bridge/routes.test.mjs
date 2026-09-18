import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readdir, readFile, rm as removePath, stat, writeFile } from 'node:fs/promises'
import test from 'node:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { routeDesktopRequest } from './routes.mjs'
import { resolveDshHome } from './dsh-home.mjs'
import { bridgeErrorFrame, DesktopBridge, writeBridgeFrame } from './bridge.mjs'
import { applyProxy, disposeNetworkProxy, initNetworkProxy, loadProxySetting, normalizeProxyOverride, parseWindowsProxyServer, setProxySetting, stopSystemProxyWatch } from './network-proxy.mjs'
import { describePluginConfig, mutatePluginConfig } from './plugin-config.mjs'
import { parseGitHubSource, selectSkillPath, validateRelativeRepoPath } from '../skill-installer/installer.mjs'
import { createSessionTailRegistry } from './session-tails.mjs'

const signal = new AbortController().signal

function historyEntry(seq, type, data = {}) {
  return { event: { seq, time: 1_000 + seq, type, data } }
}

/** Minimal ctx for session.history route tests: tail registry + page mock. */
function historyCtx({ page, tail, sessionQuery }) {
  const registry = createSessionTailRegistry()
  if (tail !== undefined) registry.remember('session-1', tail)
  return {
    get: key => {
      if (key === 'sessionController') return { page }
      if (key === 'deeptopSessionTails') return registry
      if (key === 'sessionQuery') return sessionQuery
      return undefined
    },
  }
}

/** Fake sessionQuery.observeSession over raw events (for cold tail reads). */
function observingSessionQuery(events) {
  return {
    observeSession: async () => ({
      events,
      [Symbol.dispose]: () => {},
    }),
  }
}

test('waits for stdout drain when the bridge writer applies backpressure', async () => {
  const output = new EventEmitter()
  const writes = []
  output.write = line => {
    writes.push(line)
    return false
  }
  let settled = false
  const pending = writeBridgeFrame(output, { type: 'event', value: 1 }).then(() => { settled = true })
  await Promise.resolve()
  assert.equal(settled, false)
  assert.deepEqual(writes, ['{"type":"event","value":1}\n'])
  output.emit('drain')
  await pending
  assert.equal(settled, true)
})

test('serializes bridge writes while stdout is backpressured', async () => {
  const output = new EventEmitter()
  const writes = []
  let blocked = true
  output.write = line => {
    writes.push(line)
    return !blocked
  }
  const bridge = new DesktopBridge({}, output)
  const first = bridge.write({ order: 1 })
  const second = bridge.write({ order: 2 })
  await Promise.resolve()
  await Promise.resolve()
  assert.deepEqual(writes, ['{"order":1}\n'])
  blocked = false
  output.emit('drain')
  await Promise.all([first, second])
  assert.deepEqual(writes, ['{"order":1}\n', '{"order":2}\n'])
})

test('rejects a blocked bridge write when stdout closes', async () => {
  const output = new EventEmitter()
  output.write = () => false
  const pending = writeBridgeFrame(output, { type: 'event' })
  output.emit('close')
  await assert.rejects(pending, /stdout closed before drain/)
})

test('aborts streams and exits when the bridge output fails', async () => {
  const exits = []
  const output = new EventEmitter()
  output.closed = true
  const bridge = new DesktopBridge({ get: key => key === 'appExit' ? code => exits.push(code) : undefined }, output)

  await assert.rejects(bridge.write({ type: 'event' }), /stdout is already closed/)
  await Promise.resolve()

  assert.equal(bridge.abort.signal.aborted, true)
  assert.deepEqual(exits, [1])
})

test('keeps workspace clipboard actions on the native bridge', async () => {
  const source = await readFile(join(import.meta.dirname, '..', '..', 'src', 'components', 'WorkspaceFilesPanel.tsx'), 'utf8')
  assert.match(source, /writeClipboard\(path\)/)
  assert.doesNotMatch(source, /navigator\.clipboard|document\.execCommand\(['"]copy/)
})

test('compacts session history before crossing the desktop bridge', async () => {
  const raw = [
    historyEntry(1, 'step/start', { turn: 1, step: 1 }),
    ...Array.from({ length: 2_000 }, (_, index) => historyEntry(index + 2, 'assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: { type: 'text-delta', index: 0, text: 'x' },
    })),
  ]
  const ctx = historyCtx({
    tail: 2_001,
    page: async request => {
      assert.deepEqual(request.address, { kind: 'session', sessionId: 'session-1' })
      assert.equal(request.throughSeq, 2_001)
      return { records: raw, hasMore: false }
    },
  })
  const response = await routeDesktopRequest(ctx, 'session.history', { sessionId: 'session-1' }, signal)

  assert.equal(response.events.length, 2)
  assert.equal(response.events[1].event.data.chunk.text.length, 2_000)
  assert.deepEqual(response.events[1].compactedEventSeqRanges, [[2, 2_001]])
})

test('keeps raw session history for diagnostics and JSON export', async () => {
  const raw = [
    historyEntry(1, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'a' } }),
    historyEntry(2, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'b' } }),
  ]
  let forwardedPayload
  const ctx = historyCtx({
    tail: 2,
    page: async request => {
      forwardedPayload = { sessionId: request.address.sessionId, throughSeq: request.throughSeq, maxMessages: request.maxMessages }
      return { records: raw, hasMore: false }
    },
  })
  const response = await routeDesktopRequest(ctx, 'session.history', { sessionId: 'session-1', display: false }, signal)

  assert.deepEqual(forwardedPayload, { sessionId: 'session-1', throughSeq: 2, maxMessages: undefined })
  assert.equal(response.events.length, 2)
  assert.equal(response.events[0].event.seq, 1)
  assert.equal(response.events[1].event.seq, 2)
  assert.equal(response.hasMore, false)
})

test('resolves a cold session history cut from one log observation', async () => {
  const log = [
    { seq: 3, time: 1_003, type: 'assistant/message', data: { turn: 1, step: 1 } },
    { seq: 4, time: 1_004, type: 'user/message', data: { turn: 2, step: 1 } },
  ]
  const raw = [
    historyEntry(3, 'assistant/message', { turn: 1, step: 1 }),
    historyEntry(4, 'user/message', { turn: 2, step: 1 }),
  ]
  let observed = false
  const ctx = historyCtx({
    sessionQuery: {
      observeSession: async (sessionId, options) => {
        observed = true
        assert.equal(sessionId, 'session-1')
        assert.deepEqual(options, { signal, projectionMode: 'none' })
        return { events: log, [Symbol.dispose]: () => {} }
      },
    },
    page: async request => {
      assert.equal(request.throughSeq, 4)
      assert.equal(request.beforeSeq, 3)
      return { records: raw, hasMore: false }
    },
  })
  const response = await routeDesktopRequest(ctx, 'session.history', {
    sessionId: 'session-1',
    beforeSeq: 3,
    maxMessages: 20,
  }, signal)

  assert.equal(observed, true)
  assert.equal(response.events.length, 2)
  assert.equal(response.hasMore, false)
})

test('short-circuits an empty cold session without calling page', async () => {
  let pageCalls = 0
  const ctx = historyCtx({
    sessionQuery: observingSessionQuery([]),
    page: async () => {
      pageCalls += 1
      return { records: [], hasMore: false }
    },
  })
  const response = await routeDesktopRequest(ctx, 'session.history', { sessionId: 'session-1' }, signal)

  assert.equal(pageCalls, 0)
  assert.deepEqual(response.events, [])
  assert.equal(response.hasMore, false)
})

test('maps an unknown cold session to session-not-found', async () => {
  const ctx = historyCtx({
    sessionQuery: {
      observeSession: async () => {
        const error = new Error('session "session-1" not found')
        error.code = 'SESSION_QUERY_SESSION_NOT_FOUND'
        throw error
      },
    },
    page: async () => {
      throw new Error('page must not run for an unknown session')
    },
  })

  await assert.rejects(
    routeDesktopRequest(ctx, 'session.history', { sessionId: 'session-1' }, signal),
    error => error?.code === 'session-not-found' && /session-1/.test(error.message),
  )
})

test('evicts a stale cached cut and retries once after a past-cursor rejection', async () => {
  const calls = []
  const ctx = historyCtx({
    tail: 10,
    sessionQuery: observingSessionQuery([
      { seq: 1, time: 1_001, type: 'user/message', data: { turn: 1, step: 1 } },
      { seq: 5, time: 1_005, type: 'assistant/message', data: { turn: 1, step: 2 } },
    ]),
    page: async request => {
      calls.push(request.throughSeq)
      if (request.throughSeq === 10) {
        const error = new Error('session page through seq 10 is past cursor 5')
        error.code = 'gateway/bad-request'
        throw error
      }
      return { records: [historyEntry(5, 'assistant/message', { turn: 1, step: 2 })], hasMore: false }
    },
  })
  const response = await routeDesktopRequest(ctx, 'session.history', { sessionId: 'session-1' }, signal)

  assert.deepEqual(calls, [10, 5])
  assert.equal(response.events.length, 1)
  assert.equal(response.events[0].event.seq, 5)
  assert.equal(response.hasMore, false)
})

test('keeps the history route cut registry fresh from the live tail registry', async () => {
  const raw = [
    historyEntry(7, 'assistant/message', { turn: 1, step: 2 }),
    historyEntry(8, 'user/message', { turn: 2, step: 1 }),
  ]
  const ctx = historyCtx({
    tail: 8,
    page: async request => {
      assert.equal(request.throughSeq, 8)
      return { records: raw, hasMore: true }
    },
  })
  const response = await routeDesktopRequest(ctx, 'session.history', { sessionId: 'session-1' }, signal)

  assert.equal(response.events.length, 2)
  assert.equal(response.hasMore, true)
})

test('pages subagent history through the child durable tail cut', async () => {
  const raw = [
    historyEntry(2, 'user/message', { turn: 1, step: 1 }),
    historyEntry(3, 'assistant/message', { turn: 1, step: 1 }),
  ]
  const registry = createSessionTailRegistry()
  registry.remember('child-1', 3)
  const ctx = {
    get: key => {
      if (key === 'sessionController') return {
        page: async request => {
          assert.deepEqual(request.address, {
            kind: 'subagent',
            parentSessionId: 'parent-1',
            childSessionId: 'child-1',
            mode: 'continuable',
          })
          assert.equal(request.throughSeq, 3)
          return { records: raw, hasMore: false }
        },
      }
      if (key === 'deeptopSessionTails') return registry
      return undefined
    },
  }
  const response = await routeDesktopRequest(ctx, 'subagent.history', {
    parentSessionId: 'parent-1',
    childSessionId: 'child-1',
  }, signal)

  assert.equal(response.events.length, 2)
  assert.equal(response.events[1].event.seq, 3)
  assert.equal(response.hasMore, false)
})

test('describes an empty plugin config without requiring a browser dialog', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deeptop-plugin-config-'))
  try {
    const result = await describePluginConfig({ get: key => key === 'dshHome' ? root : undefined })
    assert.equal(result.plugins.length, 0)
    assert.match(result.path, /deeptop-plugins\.json$/)
  } finally {
    await removePath(root, { recursive: true, force: true })
  }
})

test('mutates plugin config and rejects duplicate ids before writing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deeptop-plugin-config-'))
  const ctx = { get: key => key === 'dshHome' ? root : undefined }
  // Keep the module path platform-absolute: a Windows drive letter is not
  // absolute on POSIX and would fall into the npm-package rejection.
  const pluginPath = join(tmpdir(), 'plugins', 'local-tools', 'index.ts')
  try {
    const result = await mutatePluginConfig(ctx, {
      expectedRevision: 0,
      plugins: [{ id: 'local-tools', name: pluginPath, enabled: true }],
    })
    assert.equal(result.changed, true)
    assert.equal(result.restartRequired, true)
    assert.equal(result.plugins[0].id, 'local-tools')
    await assert.rejects(
      mutatePluginConfig(ctx, {
        expectedRevision: result.revision,
        plugins: [
          { id: 'local-tools', name: pluginPath, enabled: true },
          { id: 'local-tools', name: '@scope/other', enabled: true },
        ],
      }),
      /插件 id 重复/,
    )
  } finally {
    await removePath(root, { recursive: true, force: true })
  }
})

test('describes and mutates MCP settings without exposing literal secrets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deeptop-tool-config-'))
  const ctx = { get: key => key === 'dshHome' ? root : undefined }
  try {
    const empty = await routeDesktopRequest(ctx, 'tool.settings.describe', {}, signal)
    assert.deepEqual(empty.mcp.servers, [])
    assert.deepEqual(empty.mcp.nativeServers, [])
    const server = {
      id: 'github',
      serverName: 'github',
      transport: 'stdio',
      enabled: false,
      command: 'node',
      args: ['server.mjs'],
      env: [
        { name: 'TOKEN', source: 'literal', value: 'super-secret' },
        { name: 'HOME', source: 'env', value: 'HOME', prefix: '' },
      ],
      toolCallTimeoutMs: 60_000,
      reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 },
    }
    const saved = await routeDesktopRequest(ctx, 'mcp.settings.mutate', { expectedRevision: 0, servers: [server] }, signal)
    assert.equal(saved.mcp.revision, 1)
    assert.equal(saved.mcp.servers[0].env[0].value, '')
    assert.equal(saved.mcp.servers[0].env[0].redacted, true)
    assert.equal(JSON.stringify(saved).includes('super-secret'), false)
    const persisted = await readFile(join(root, 'profiles', 'desktop', 'deeptop-mcp.json'), 'utf8')
    assert.match(persisted, /super-secret/)
    await assert.rejects(
      routeDesktopRequest(ctx, 'mcp.settings.mutate', { servers: saved.mcp.servers }, signal),
      error => error?.code === 'invalid-payload',
    )
    await assert.rejects(
      routeDesktopRequest(ctx, 'mcp.settings.mutate', { expectedRevision: 0, servers: saved.mcp.servers }, signal),
      error => error?.code === 'revision-conflict',
    )
    const preserved = await routeDesktopRequest(ctx, 'mcp.settings.mutate', { expectedRevision: 1, servers: saved.mcp.servers }, signal)
    assert.equal(preserved.changed, false)
    assert.equal(preserved.mcp.servers[0].env[0].value, '')
    assert.equal((await readFile(join(root, 'profiles', 'desktop', 'deeptop-mcp.json'), 'utf8')).includes('super-secret'), true)
  } finally {
    await removePath(root, { recursive: true, force: true })
  }
})

test('projects native MCP entries separately without exposing their configuration values', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deeptop-native-mcp-'))
  const ctx = {
    get: key => key === 'dshHome' ? root : key === 'loader' ? {
      *entries() {
        yield {
          id: 'mcp-codegraph',
          options: {
            id: 'mcp-codegraph',
            name: '@deepseek-ai/dsh-mcp-client',
            config: { serverName: 'codegraph', transport: 'stdio' },
          },
          fiber: {
            state: 2,
            config: {
              serverName: 'codegraph',
              transport: 'stdio',
              args: ['serve', '--mcp', '--token=top-secret'],
              env: { CODEGRAPH_TOKEN: 'top-secret' },
            },
          },
        }
        yield {
          id: 'mcp-expression',
          options: {
            id: 'mcp-expression',
            name: '@deepseek-ai/dsh-mcp-client',
            config: { serverName: { __jsExpr: 'process.env.MCP_NAME' }, transport: 'stdio' },
          },
          fiber: { config: { serverName: 'must-not-render', transport: 'stdio' } },
        }
        yield {
          id: 'deeptop-mcp-managed',
          options: {
            id: 'deeptop-mcp-managed',
            name: '@deepseek-ai/dsh-mcp-client',
            config: { serverName: 'managed', transport: 'stdio' },
          },
          fiber: { config: { serverName: 'managed', transport: 'stdio', args: ['top-secret'] } },
        }
      },
    } : undefined,
  }
  try {
    const result = await routeDesktopRequest(ctx, 'tool.settings.describe', {}, signal)
    assert.deepEqual(result.mcp.servers, [])
    assert.deepEqual(result.mcp.nativeServers, [
      { entryId: 'mcp-codegraph', serverName: 'codegraph', transport: 'stdio' },
      { entryId: 'mcp-expression', transport: 'stdio' },
    ])
    assert.equal(JSON.stringify(result).includes('top-secret'), false)
    assert.equal(JSON.stringify(result).includes('must-not-render'), false)
  } finally {
    await removePath(root, { recursive: true, force: true })
  }
})

test('preserves native MCP patch text and rejects enabled namespace collisions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deeptop-native-mcp-save-'))
  const profile = join(root, 'profiles', 'desktop')
  const nativePatch = [
    '# Native CodeGraph MCP',
    '- insert:',
    '    - id: mcp-codegraph',
    "      name: '@deepseek-ai/dsh-mcp-client'",
    '      config:',
    '        serverName: codegraph',
    '        transport: stdio',
    '        command: codegraph',
    "        args: ['serve', '--mcp']",
    '',
  ].join('\n')
  const ctx = {
    get: key => key === 'dshHome' ? root : key === 'loader' ? {
      *entries() {
        yield {
          id: 'mcp-codegraph',
          options: { id: 'mcp-codegraph', name: '@deepseek-ai/dsh-mcp-client' },
          fiber: { state: 2, config: { serverName: 'codegraph', transport: 'stdio' } },
        }
        yield {
          id: 'mcp-disabled',
          options: {
            id: 'mcp-disabled',
            name: '@deepseek-ai/dsh-mcp-client',
            disabled: true,
            config: { serverName: 'disabled-native', transport: 'stdio' },
          },
          fiber: { state: 3, config: { serverName: 'disabled-native', transport: 'stdio' } },
        }
      },
    } : undefined,
  }
  const server = (id, serverName = id) => ({
    id,
    serverName,
    transport: 'stdio',
    enabled: true,
    command: 'node',
    args: ['server.mjs'],
    env: [],
    toolCallTimeoutMs: 60_000,
    reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 },
  })
  try {
    await mkdir(profile, { recursive: true })
    await writeFile(join(profile, 'cordis.patch.yml'), nativePatch, 'utf8')
    await assert.rejects(
      routeDesktopRequest(ctx, 'mcp.settings.mutate', {
        expectedRevision: 0,
        servers: [server('duplicate', 'codegraph')],
      }, signal),
      error => error?.code === 'native-conflict',
    )
    assert.equal(await readFile(join(profile, 'cordis.patch.yml'), 'utf8'), nativePatch)
    await assert.rejects(stat(join(profile, 'deeptop-mcp.json')), error => error?.code === 'ENOENT')

    const saved = await routeDesktopRequest(ctx, 'mcp.settings.mutate', {
      expectedRevision: 0,
      servers: [server('github'), server('disabled-native')],
    }, signal)
    assert.equal(saved.changed, true)
    const patch = await readFile(join(profile, 'cordis.patch.yml'), 'utf8')
    assert.equal(patch.includes(nativePatch.trim()), true)
    assert.match(patch, /deeptop-mcp-github/)
    const stored = JSON.parse(await readFile(join(profile, 'deeptop-mcp.json'), 'utf8'))
    assert.deepEqual(stored.servers.map(item => item.serverName), ['github', 'disabled-native'])
  } finally {
    await removePath(root, { recursive: true, force: true })
  }
})

test('replaces a literal MCP secret while rejecting an ambiguous clear request', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deeptop-tool-secret-'))
  const ctx = { get: key => key === 'dshHome' ? root : undefined }
  const server = (value) => ({
    id: 'secret-server',
    serverName: 'secret-server',
    transport: 'stdio',
    enabled: false,
    command: 'node',
    args: ['server.mjs'],
    env: [{ name: 'TOKEN', source: 'literal', value }],
    toolCallTimeoutMs: 60_000,
    reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 },
  })
  try {
    const first = await routeDesktopRequest(ctx, 'mcp.settings.mutate', {
      expectedRevision: 0,
      servers: [server('first-secret')],
    }, signal)
    assert.equal(first.mcp.revision, 1)
    assert.deepEqual(first.mcp.servers[0].env[0], {
      name: 'TOKEN',
      source: 'literal',
      value: '',
      redacted: true,
    })

    const replaced = await routeDesktopRequest(ctx, 'mcp.settings.mutate', {
      expectedRevision: first.mcp.revision,
      servers: [server('replacement-secret')],
    }, signal)
    assert.equal(replaced.mcp.revision, 2)
    assert.equal(replaced.mcp.servers[0].env[0].value, '')
    const configPath = join(root, 'profiles', 'desktop', 'deeptop-mcp.json')
    const afterReplacement = await readFile(configPath, 'utf8')
    assert.equal(afterReplacement.includes('first-secret'), false)
    assert.equal(afterReplacement.includes('replacement-secret'), true)

    // The redacted form returned by describe means “keep the stored literal”; it
    // is deliberately not an empty-value delete operation.
    const preserved = await routeDesktopRequest(ctx, 'mcp.settings.mutate', {
      expectedRevision: replaced.mcp.revision,
      servers: replaced.mcp.servers,
    }, signal)
    assert.equal(preserved.changed, false)
    assert.equal((await readFile(configPath, 'utf8')).includes('replacement-secret'), true)

    await assert.rejects(
      routeDesktopRequest(ctx, 'mcp.settings.mutate', {
        expectedRevision: preserved.mcp.revision,
        servers: [server('')],
      }, signal),
      /value 不能为空/,
    )
    const afterRejectedClear = JSON.parse(await readFile(configPath, 'utf8'))
    assert.equal(afterRejectedClear.revision, preserved.mcp.revision)
    assert.equal(afterRejectedClear.servers[0].env[0].value, 'replacement-secret')

    const clearDraft = structuredClone(preserved.mcp.servers)
    clearDraft[0].env[0] = { name: 'TOKEN', source: 'literal', value: '', redacted: true, clearSecret: true }
    const cleared = await routeDesktopRequest(ctx, 'mcp.settings.mutate', {
      expectedRevision: preserved.mcp.revision,
      servers: clearDraft,
    }, signal)
    assert.equal(cleared.mcp.revision, preserved.mcp.revision + 1)
    assert.deepEqual(cleared.mcp.servers[0].env, [])
    const afterClear = await readFile(configPath, 'utf8')
    assert.equal(afterClear.includes('replacement-secret'), false)
    assert.equal(afterClear.includes('clearSecret'), false)
  } finally {
    await removePath(root, { recursive: true, force: true })
  }
})

test('serializes concurrent MCP mutations and rejects the stale revision without a partial publish', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deeptop-tool-lock-'))
  const ctx = { get: key => key === 'dshHome' ? root : undefined }
  const server = (id) => ({
    id,
    serverName: id,
    transport: 'streamable-http',
    enabled: true,
    url: `https://${id}.example.test/mcp`,
    headers: [],
    toolCallTimeoutMs: 60_000,
    reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 },
  })
  try {
    const outcomes = await Promise.allSettled([
      routeDesktopRequest(ctx, 'mcp.settings.mutate', { expectedRevision: 0, servers: [server('first')] }, signal),
      routeDesktopRequest(ctx, 'mcp.settings.mutate', { expectedRevision: 0, servers: [server('second')] }, signal),
    ])
    const successes = outcomes.filter(outcome => outcome.status === 'fulfilled')
    const failures = outcomes.filter(outcome => outcome.status === 'rejected')
    assert.equal(successes.length, 1)
    assert.equal(failures.length, 1)
    assert.equal(failures[0].reason?.code, 'revision-conflict')

    const described = await routeDesktopRequest(ctx, 'tool.settings.describe', {}, signal)
    assert.equal(described.mcp.revision, 1)
    assert.equal(described.mcp.servers.length, 1)
    const persisted = JSON.parse(await readFile(join(root, 'profiles', 'desktop', 'deeptop-mcp.json'), 'utf8'))
    assert.equal(persisted.revision, 1)
    assert.equal(persisted.servers.length, 1)
    const patch = await readFile(join(root, 'profiles', 'desktop', 'cordis.patch.yml'), 'utf8')
    assert.match(patch, /# BEGIN DEEPTOP MANAGED MCP/)
    assert.match(patch, /# END DEEPTOP MANAGED MCP/)
    assert.match(patch, new RegExp(`deeptop-mcp-${persisted.servers[0].id}`))
  } finally {
    await removePath(root, { recursive: true, force: true })
  }
})

test('routes plugin inventory and config methods through the desktop bridge', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deeptop-plugin-route-'))
  try {
    const result = await routeDesktopRequest({
      get: key => key === 'dshHome' ? root : undefined,
      pluginInventory: { list: async () => ({ entries: [] }) },
    }, 'plugin.list', {}, signal)
    assert.deepEqual(result, { entries: [], excluded: [] })
    const config = await routeDesktopRequest({ get: key => key === 'dshHome' ? root : undefined }, 'plugin.config.describe', {}, signal)
    assert.deepEqual(config.plugins, [])
  } finally {
    await removePath(root, { recursive: true, force: true })
  }
})

test('resolves the harness home from the boot-provided dshHomePath accessor', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deeptop-boot-home-'))
  try {
    // Shape of the real mounted context: app-boot provides `dshHomePath` on the
    // root context before any profile entry mounts and never provides a
    // `dshHome` service, so the bridge must resolve the home through it.
    const ctx = {
      get: key => key === 'dshHomePath' ? ((...segments) => join(root, ...segments))
        : key === 'sessionController' ? { canOpenWorkspacePath: async () => true, list: async () => ({ items: [] }) }
        : undefined,
    }
    const config = await routeDesktopRequest(ctx, 'plugin.config.describe', {}, signal)
    assert.deepEqual(config.plugins, [])
    assert.equal(config.path, join(root, 'profiles', 'desktop', 'deeptop-plugins.json'))
    const tools = await routeDesktopRequest(ctx, 'tool.settings.describe', {}, signal)
    assert.deepEqual(tools.skills.entries, [])
    assert.deepEqual(tools.mcp.servers, [])
    const capabilities = await routeDesktopRequest(ctx, 'desktop.capabilities', {}, signal)
    assert.equal(capabilities.services.tools, true)
  } finally {
    await removePath(root, { recursive: true, force: true })
  }
})

test('resolveDshHome prefers mounted accessors and keeps a context from reading the ambient home', () => {
  const previousHome = process.env.DSH_HOME
  const bootHome = join(tmpdir(), 'deeptop-resolve-boot-home')
  const slotHome = join(tmpdir(), 'deeptop-resolve-slot-home')
  process.env.DSH_HOME = join(tmpdir(), 'deeptop-resolve-env-home')
  try {
    assert.equal(resolveDshHome({ get: key => key === 'dshHomePath' ? ((...segments) => join(bootHome, ...segments)) : undefined }), bootHome)
    assert.equal(
      resolveDshHome({
        get: key => key === 'dshHomePath'
          ? ((...segments) => join(bootHome, ...segments))
          : key === 'dshHome' ? slotHome : undefined,
      }),
      bootHome,
      'the boot accessor wins over a launcher-provided home slot',
    )
    assert.equal(resolveDshHome({ get: key => key === 'dshHome' ? ` ${slotHome} ` : undefined }), slotHome)
    assert.equal(
      resolveDshHome({ get: () => undefined }),
      undefined,
      'a mounted context that reports no home must not fall back to the ambient DSH_HOME',
    )
    assert.equal(resolveDshHome(undefined), process.env.DSH_HOME)
    assert.equal(resolveDshHome({}), process.env.DSH_HOME)
    assert.equal(resolveDshHome({ get: key => key === 'dshHome' ? '   ' : undefined }), undefined)
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  }
})

test('validates, persists, and routes the desktop HTTP proxy setting', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deeptop-network-proxy-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  try {
    await assert.rejects(
      setProxySetting({ enabled: true, url: 'socks5://127.0.0.1:7890' }),
      /HTTP\/HTTPS/,
    )
    assert.deepEqual(await loadProxySetting(), { enabled: false, url: '' })

    const saved = await routeDesktopRequest({}, 'network.setProxy', {
      proxy: { enabled: true, url: ' http://127.0.0.1:7890 ' },
    }, signal)
    assert.equal(saved.applied, true)
    assert.deepEqual(saved.proxy, { enabled: true, url: 'http://127.0.0.1:7890/' })
    assert.equal(saved.effective.source, 'explicit')
    assert.equal(saved.effective.url, 'http://127.0.0.1:7890/')

    const snapshot = await routeDesktopRequest({}, 'network.getProxy', {}, signal)
    assert.deepEqual(snapshot.explicit, { enabled: true, url: 'http://127.0.0.1:7890/' })
    assert.equal(snapshot.effective.source, 'explicit')

    const direct = await routeDesktopRequest({}, 'network.setProxy', {
      proxy: { enabled: false, url: '' },
    }, signal)
    assert.equal(direct.applied, true)
    assert.deepEqual(direct.proxy, { enabled: false, url: '' })
    // With no explicit proxy, the effective source falls back to the system proxy (or none).
    assert.ok(direct.effective.source === 'system' || direct.effective.source === 'none')
  } finally {
    await disposeNetworkProxy()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await removePath(root, { recursive: true, force: true })
  }
})

test('does not block bridge startup when a persisted proxy is unusable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deeptop-network-proxy-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  try {
    await writeFile(join(root, 'network-proxy.json'), JSON.stringify({ enabled: true, url: 'socks5://127.0.0.1:7890' }), 'utf8')
    const result = await initNetworkProxy()
    assert.equal(result.ok, false)
    assert.equal(result.applied, false)
    assert.match(result.error, /HTTP\/HTTPS/)
  } finally {
    stopSystemProxyWatch()
    await disposeNetworkProxy()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await removePath(root, { recursive: true, force: true })
  }
})

test('serializes concurrent desktop proxy settings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deeptop-network-proxy-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  try {
    await Promise.all([
      setProxySetting({ enabled: true, url: 'http://127.0.0.1:7890' }),
      setProxySetting({ enabled: true, url: 'http://127.0.0.1:7891' }),
    ])
    assert.deepEqual(await loadProxySetting(), { enabled: true, url: 'http://127.0.0.1:7891/' })
  } finally {
    await disposeNetworkProxy()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await removePath(root, { recursive: true, force: true })
  }
})

test('does not reapply the proxy after its watcher stops', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deeptop-network-proxy-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  try {
    const initializing = initNetworkProxy()
    stopSystemProxyWatch()
    const result = await initializing
    assert.equal(result.ok, true)
    assert.equal(result.applied, false)
  } finally {
    await disposeNetworkProxy()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await removePath(root, { recursive: true, force: true })
  }
})

test('routes Node global fetch through the official DSH proxy policy', async () => {
  let received
  let receivedConnect
  const proxy = createServer((request, response) => {
    received = { method: request.method, url: request.url, host: request.headers.host }
    response.writeHead(200, { 'content-type': 'text/plain' })
    response.end('proxied')
  })
  proxy.on('connect', (request, socket) => {
    receivedConnect = { method: request.method, url: request.url, host: request.headers.host }
    socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n')
  })
  await new Promise((resolve, reject) => {
    proxy.once('error', reject)
    proxy.listen(0, '127.0.0.1', resolve)
  })
  const origin = createServer((_request, response) => { response.end('direct') })
  await new Promise((resolve, reject) => {
    origin.once('error', reject)
    origin.listen(0, '127.0.0.1', resolve)
  })
  const address = proxy.address()
  const originAddress = origin.address()
  if (address === null || typeof address === 'string' || originAddress === null || typeof originAddress === 'string') {
    throw new Error('test proxy or origin did not bind a TCP port')
  }
  try {
    await applyProxy({ enabled: true, url: `http://127.0.0.1:${address.port}` })
    const response = await fetch('http://model.invalid/probe')
    assert.equal(await response.text(), 'proxied')
    assert.deepEqual(received, { method: 'GET', url: 'http://model.invalid/probe', host: 'model.invalid' })
    await assert.rejects(fetch('https://model.invalid/probe'))
    assert.deepEqual(receivedConnect, { method: 'CONNECT', url: 'model.invalid:443', host: 'model.invalid' })
    const direct = await fetch(`http://127.0.0.1:${originAddress.port}/probe`)
    assert.equal(await direct.text(), 'direct', 'official policy never proxies loopback traffic')
  } finally {
    await disposeNetworkProxy()
    await Promise.all([
      new Promise((resolve, reject) => proxy.close(error => error === undefined ? resolve() : reject(error))),
      new Promise((resolve, reject) => origin.close(error => error === undefined ? resolve() : reject(error))),
    ])
  }
})

test('parses Windows ProxyServer into a usable proxy URL', () => {
  assert.equal(parseWindowsProxyServer('127.0.0.1:7890'), 'http://127.0.0.1:7890')
  assert.equal(parseWindowsProxyServer('http=127.0.0.1:7890;https=127.0.0.1:7891'), 'http://127.0.0.1:7891')
  assert.equal(parseWindowsProxyServer('http=127.0.0.1:7890'), 'http://127.0.0.1:7890')
  assert.equal(parseWindowsProxyServer('https=127.0.0.1:7891'), 'http://127.0.0.1:7891')
  assert.equal(parseWindowsProxyServer(''), undefined)
})

test('normalizes ProxyOverride into DSH NO_PROXY rules', () => {
  assert.deepEqual(normalizeProxyOverride('localhost;127.*;192.168.*;10.*;<LOCAL>'), ['localhost', '127.*', '192.168.*', '10.*', 'localhost', '<local>'])
  assert.deepEqual(normalizeProxyOverride(''), [])
})

test('routes an allowlisted API method with a generated RPC id', async () => {
  const registry = {
    archivedSessionIds: ['archived-1'],
    list: () => [{
      id: 'workspace-1',
      path: 'D:/repo',
      title: 'repo',
      sessionIds: [],
      createdAt: '2026-08-15T00:00:00.000Z',
      updatedAt: '2026-08-15T00:00:00.000Z',
    }],
  }
  const ctx = {
    get: key => key === 'workspaceRegistry' ? registry : undefined,
  }

  const result = await routeDesktopRequest(ctx, 'workspace.list', {}, signal)

  assert.deepEqual(result, {
    items: [{
      workspaceId: 'workspace-1',
      path: 'D:/repo',
      title: 'repo',
      sessionIds: [],
      pinnedSessionIds: [],
      createdAt: '2026-08-15T00:00:00.000Z',
      updatedAt: '2026-08-15T00:00:00.000Z',
    }],
    archivedSessionIds: ['archived-1'],
  })
  registry.archivedSessionIds = []
  assert.deepEqual((await routeDesktopRequest(ctx, 'workspace.list', {}, signal)).archivedSessionIds, [])
})

test('respond forwards the top-level answer payload to its pending request', async () => {
  const calls = []
  const ctx = {
    get: key => key === 'deeptopAnswerRegistry' ? {
      resolve: async (rpcId, answer) => { calls.push({ rpcId, answer }) },
    } : undefined,
  }

  assert.deepEqual(
    await routeDesktopRequest(ctx, 'respond', {
      type: 'client-response',
      rpcId: 'question-1',
      answer: { answer: { answers: [{ id: 'mode', selected: ['Fast'] }] } },
    }, signal),
    { accepted: true },
  )
  assert.deepEqual(calls, [{
    rpcId: 'question-1',
    answer: { answer: { answers: [{ id: 'mode', selected: ['Fast'] }] } },
  }])
  await assert.rejects(
    routeDesktopRequest(ctx, 'respond', {
      type: 'client-response',
      rpcId: 'question-1',
      result: { ok: true, value: {} },
    }, signal),
    /requires an answer payload/,
  )
})

test('probes official Host capabilities without failing when services are missing', async () => {
  const agent = { id: 'session-target' }
  const registry = { list: () => [], get: () => ({}) }
  const ctx = {
    get: key => key === 'agents' ? { get: () => agent }
      : key === 'workspaceRegistry' ? registry
      : key === 'sessionController' ? { list: async () => ({ items: [] }), canOpenWorkspacePath: async () => true, page: async () => ({ records: [], hasMore: false }) }
      : key === 'workspaceController' ? { list: async () => ({ items: [] }) }
      : key === 'fileReferences' ? { list: async () => [] }
      : key === 'sessionReferenceResolver' ? { remoteExportCandidates: async () => [] }
      : key === 'messageAnnotations' ? { list: async () => [], put: async () => ({}), delete: async () => ({}) }
      : key === 'subagents' ? { remoteExportList: async () => ({ entries: [], parentAvailable: true }) }
      : key === 'jobs' ? { list: () => [], peek: () => ({ available: true, text: '', snapshot: {} }) }
      : key === 'sessionSkillCatalog' ? { list: async () => ({ skills: [] }) }
      : key === 'agentPresets' ? { remoteExportList: async () => ({ presets: [], authorable: true }) }
      : key === 'goals' ? { create: async () => ({}) }
      : key === 'settingsController' ? { describe: async () => ({}) }
      : key === 'credentialsController' ? { describe: async () => ({}) }
      : key === 'llm' ? { resolveModelInfo: async () => ({}) }
      : key === 'typertGateway' ? { invoke: async () => ({}) }
      : key === 'fileUploads' ? { uploadStream: async () => ({}) }
      : key === 'attachments' ? { readFileStream: () => (async function * () {})() }
      : key === 'dshHome' ? '/tmp/deeptop-capabilities-test'
      : undefined,
    pluginInventory: { list: async () => ({ entries: [] }) },
  }

  const result = await routeDesktopRequest(ctx, 'desktop.capabilities', {}, signal)
  assert.equal(typeof result.probedAt, 'number')
  assert.deepEqual(result.services, {
    bootstrap: true,
    sessions: true,
    workspace: true,
    references: true,
    annotations: true,
    subagents: true,
    tasks: true,
    skills: true,
    agentPresets: true,
    goals: true,
    settings: true,
    credentials: true,
    llm: true,
    plugins: true,
    tools: true,
    sessionExport: false,
    sessionDelete: false,
    commands: true,
    uiPlugins: false,
    fileAttachments: true,
  })
})

test('stages a dropped file path through the official fileUploads service', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deeptop-stage-file-'))
  const path = join(root, 'report.txt')
  await writeFile(path, 'hello file attachment')
  const received = []
  const ctx = {
    get: key => key === 'fileUploads' ? {
      uploadStream: async (request) => {
        const chunks = []
        for await (const chunk of request.data) chunks.push(chunk)
        const body = Buffer.concat(chunks)
        received.push({ sessionId: request.sessionId, name: request.name, body: body.toString('utf8') })
        return { receiptId: 'receipt-1', file: { attachmentId: 'sha256:abc', name: request.name, bytes: body.length } }
      },
    } : undefined,
  }

  const result = await routeDesktopRequest(ctx, 'session.stageFile', { sessionId: 'session-1', path }, signal)
  assert.deepEqual(result, { receiptId: 'receipt-1', file: { attachmentId: 'sha256:abc', name: 'report.txt', bytes: 21 } })
  assert.deepEqual(received, [{ sessionId: 'session-1', name: 'report.txt', body: 'hello file attachment' }])
  await removePath(root, { recursive: true, force: true })
})

test('refuses to stage a path that is not a readable regular file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deeptop-stage-missing-'))
  const ctx = { get: () => ({ uploadStream: async () => ({}) }) }
  for (const path of [join(root, 'nope.txt'), root]) {
    await assert.rejects(
      routeDesktopRequest(ctx, 'session.stageFile', { sessionId: 'session-1', path }, signal),
      error => {
        assert.equal(error?.code, 'attachment-unreadable')
        return true
      },
    )
  }
  await assert.rejects(
    routeDesktopRequest(ctx, 'session.stageFile', { sessionId: 'session-1' }, signal),
    /requires path/,
  )
  await assert.rejects(
    routeDesktopRequest(ctx, 'session.stageFile', { path: '/tmp/x' }, signal),
    /requires sessionId/,
  )
  await removePath(root, { recursive: true, force: true })
})

test('reports the missing fileUploads service instead of failing opaquely', async () => {
  const path = await mkdtemp(join(tmpdir(), 'deeptop-stage-capability-'))
  await writeFile(join(path, 'a.txt'), 'x')
  await assert.rejects(
    routeDesktopRequest({ get: () => undefined }, 'session.stageFile', { sessionId: 's', path: join(path, 'a.txt') }, signal),
    error => {
      assert.equal(error?.code, 'attachment-unavailable')
      return true
    },
  )
  await removePath(path, { recursive: true, force: true })
})

test('restages a durable file reference by streaming the stored bytes back', async () => {
  const uploaded = []
  const ref = { attachmentId: 'sha256:deadbeef', name: 'notes.md', bytes: 7 }
  const ctx = {
    get: key => key === 'attachments' ? {
      readFileStream: (received) => {
        assert.deepEqual(received, ref)
        return (async function * () { yield new TextEncoder().encode('content') })()
      },
    } : key === 'fileUploads' ? {
      uploadStream: async (request) => {
        const chunks = []
        for await (const chunk of request.data) chunks.push(chunk)
        uploaded.push({ sessionId: request.sessionId, name: request.name, body: Buffer.concat(chunks).toString('utf8') })
        return { receiptId: 'receipt-2', file: { attachmentId: 'sha256:deadbeef', name: request.name, bytes: 7 } }
      },
    } : undefined,
  }

  const result = await routeDesktopRequest(ctx, 'session.restageAttachment', { sessionId: 'session-1', ...ref }, signal)
  assert.deepEqual(result, { receiptId: 'receipt-2', file: { attachmentId: 'sha256:deadbeef', name: 'notes.md', bytes: 7 } })
  assert.deepEqual(uploaded, [{ sessionId: 'session-1', name: 'notes.md', body: 'content' }])
  await assert.rejects(
    routeDesktopRequest(ctx, 'session.restageAttachment', { sessionId: 'session-1', attachmentId: 'sha256:x', name: 'a' }, signal),
    /requires attachmentId, name and bytes/,
  )
})

test('maps Host upload rejections onto desktop error codes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deeptop-stage-reject-'))
  const path = join(root, 'big.bin')
  await writeFile(path, 'bytes')
  const reject = code => ({ get: key => key === 'fileUploads' ? {
    uploadStream: async () => { throw Object.assign(new Error('refused'), { code }) },
  } : undefined })
  for (const [code, expected] of [
    ['session/attachment-invalid', 'attachment-unreadable'],
    ['subagent/attachment-invalid', 'attachment-unreadable'],
    ['session/not-found', 'session-not-found'],
  ]) {
    await assert.rejects(
      routeDesktopRequest(reject(code), 'session.stageFile', { sessionId: 'session-1', path }, signal),
      error => {
        assert.equal(error?.code, expected)
        return true
      },
    )
  }
  await removePath(root, { recursive: true, force: true })
})

test('classifies dropped host paths so folders keep reference behaviour', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deeptop-path-kinds-'))
  await writeFile(join(root, 'file.txt'), 'x')
  await mkdir(join(root, 'nested'))
  const result = await routeDesktopRequest({ get: () => undefined }, 'host.pathKinds', {
    paths: [join(root, 'file.txt'), join(root, 'nested'), join(root, 'gone.txt'), '  '],
  }, signal)
  assert.deepEqual(result, { kinds: ['file', 'directory', 'missing', 'missing'] })
  await assert.rejects(
    routeDesktopRequest({ get: () => undefined }, 'host.pathKinds', { paths: [1] }, signal),
    /requires a paths array/,
  )
  await removePath(root, { recursive: true, force: true })
})

test('reports Tools unavailable when home or native directory opening is missing', async () => {
  const home = '/tmp/deeptop-capabilities-test'
  const emptyHome = await routeDesktopRequest({ get: key => key === 'dshHome' ? '   ' : undefined }, 'desktop.capabilities', {}, signal)
  assert.equal(emptyHome.services.tools, false)
  const noHost = await routeDesktopRequest({ get: key => key === 'dshHome' ? home : undefined }, 'desktop.capabilities', {}, signal)
  assert.equal(noHost.services.tools, false)
  const noOpenPath = await routeDesktopRequest({
    get: key => key === 'dshHome' ? home : key === 'sessionController' ? {} : undefined,
  }, 'desktop.capabilities', {}, signal)
  assert.equal(noOpenPath.services.tools, false)
  const incompleteSkills = await routeDesktopRequest({
    get: key => key === 'dshHome' ? home : key === 'sessionController' ? { canOpenWorkspacePath: async () => true, list: async () => ({ items: [] }) } : undefined,
  }, 'desktop.capabilities', {}, signal)
  assert.equal(incompleteSkills.services.skills, false)
  // 只有带非消费式投影的 jobs 注册表才让任务面板提供输出入口。
  const consumingJobs = await routeDesktopRequest({
    get: key => key === 'jobs' ? { list: () => [], read: () => ({}) } : undefined,
  }, 'desktop.capabilities', {}, signal)
  assert.equal(consumingJobs.services.tasks, false)
})

test('keeps typed error codes in the bridge error frame and plain text otherwise', () => {
  const structured = new Error('file reference service is unavailable')
  structured.code = 'reference-unavailable'
  structured.details = { capability: 'references' }
  assert.deepEqual(bridgeErrorFrame(structured), {
    code: 'reference-unavailable',
    message: 'file reference service is unavailable',
    details: { capability: 'references' },
  })
  assert.equal(bridgeErrorFrame(new Error('plain failure')), 'plain failure')
})

test('forwards an explicit session preset migration through the official fork API', async () => {
  let received
  const ctx = {
    get: key => key === 'sessionController' ? {
      fork: async request => {
        received = request
        return { sessionId: 'session-migrated' }
      },
    } : undefined,
  }

  const result = await routeDesktopRequest(ctx, 'session.fork', {
    sessionId: 'session-source',
    agentPreset: 'standard',
  }, signal)

  assert.deepEqual(result, { sessionId: 'session-migrated' })
  assert.deepEqual(received, {
    sessionId: 'session-source',
    agentPreset: 'standard',
  })
})

test('defaults direct child prompts to queue delivery and validates explicit delivery', async () => {
  const received = []
  const ctx = {
    get: key => key === 'subagents' ? {
      prompt: async request => { received.push(request); return { accepted: true } },
    } : undefined,
  }
  const payload = { parentSessionId: 'parent-1', childSessionId: 'child-1', content: [{ type: 'text', text: 'continue' }] }
  assert.deepEqual(await routeDesktopRequest(ctx, 'subagent.prompt', payload, signal), { accepted: true })
  assert.match(received[0].requestId, /^[0-9a-f-]{36}$/)
  const { requestId: ignored, ...queueRequest } = received[0]
  assert.deepEqual(queueRequest, { ...payload, mode: 'continuable', delivery: 'queue' })
  await routeDesktopRequest(ctx, 'subagent.prompt', { ...payload, delivery: 'steer' }, signal)
  assert.equal(received[1].delivery, 'steer')
  await assert.rejects(
    routeDesktopRequest(ctx, 'subagent.prompt', { ...payload, delivery: 'now' }, signal),
    error => error?.code === 'bad-request',
  )
})

test('projects task output through the non-consuming job projection', async () => {
  const agent = { id: 'session-target' }
  const snapshot = {
    id: 'bash-1',
    kind: 'bash',
    label: 'pnpm test',
    status: 'running',
    startedAt: 7,
    reported: false,
    outputLimitBytes: 1_024,
    ownerSession: 'session-target',
  }
  const reads = { count: 0 }
  const jobs = {
    list: caller => { assert.equal(caller, agent); return [snapshot] },
    peek: (id, caller) => {
      assert.equal(id, 'bash-1')
      assert.equal(caller, agent)
      return { available: true, text: 'out\n', snapshot }
    },
    read: () => { reads.count += 1; return { text: 'stolen', snapshot } },
  }
  const ctx = {
    get: key => key === 'agents' ? { get: id => id === agent.id ? agent : undefined }
      : key === 'jobs' ? jobs
      : undefined,
  }

  const result = await routeDesktopRequest(ctx, 'job.output', { sessionId: 'session-target', jobId: 'bash-1' }, signal)
  assert.deepEqual(result, {
    job: { id: 'bash-1', kind: 'bash', label: 'pnpm test', status: 'running', startedAt: 7 },
    available: true,
    text: 'out\n',
  })
  // 桌面读取绝不消费模型持有的读取游标。
  assert.equal(reads.count, 0)
})

test('reports an unavailable task projection instead of consuming it', async () => {
  const agent = { id: 'session-target' }
  const snapshot = { id: 'bash-2', kind: 'bash', label: 'legacy producer', status: 'completed', startedAt: 7 }
  const ctx = {
    get: key => key === 'agents' ? { get: () => agent }
      : key === 'jobs' ? { list: () => [snapshot], peek: () => ({ available: false, text: '', snapshot }) }
      : undefined,
  }
  assert.deepEqual(await routeDesktopRequest(ctx, 'job.output', { sessionId: 'session-target', jobId: 'bash-2' }, signal), {
    job: { id: 'bash-2', kind: 'bash', label: 'legacy producer', status: 'completed', startedAt: 7 },
    available: false,
    text: '',
  })
})

test('rejects malformed, missing, and foreign task output requests', async () => {
  const agent = { id: 'session-target' }
  const ctx = {
    get: key => key === 'agents' ? { get: id => id === agent.id ? agent : undefined }
      : key === 'jobs' ? { list: () => [], peek: () => ({ available: true, text: '', snapshot: {} }) }
      : undefined,
  }
  await assert.rejects(
    routeDesktopRequest(ctx, 'job.output', { sessionId: 'session-target' }, signal),
    error => error.code === 'bad-request',
  )
  // 别的会话的任务不出现在本会话的可见集合里，答案是“任务不存在”而不是泄露其存在。
  await assert.rejects(
    routeDesktopRequest(ctx, 'job.output', { sessionId: 'session-target', jobId: 'bash-9' }, signal),
    error => error.code === 'job-not-found' && error.details.jobId === 'bash-9',
  )
  await assert.rejects(
    routeDesktopRequest(ctx, 'job.output', { sessionId: 'session-gone', jobId: 'bash-1' }, signal),
    error => error.code === 'session-not-found',
  )
})

test('reports tasks unavailable when the Host exposes no non-consuming projection', async () => {
  const agent = { id: 'session-target' }
  const base = { get: key => key === 'agents' ? { get: () => agent } : undefined }
  await assert.rejects(
    routeDesktopRequest(base, 'job.output', { sessionId: 'session-target', jobId: 'bash-1' }, signal),
    error => error.code === 'tasks-unavailable',
  )
  const consuming = {
    get: key => key === 'agents' ? { get: () => agent }
      : key === 'jobs' ? { list: () => [], read: () => ({ text: '', snapshot: {} }) }
      : undefined,
  }
  await assert.rejects(
    routeDesktopRequest(consuming, 'job.output', { sessionId: 'session-target', jobId: 'bash-1' }, signal),
    error => error.code === 'tasks-unavailable',
  )
})

test('routes RC8 file and session reference candidates through official services', async () => {
  const agent = { id: 'session-target' };
  const ctx = {
    get: key => key === 'agents' ? { get: id => id === agent.id ? agent : undefined }
      : key === 'fileReferences' ? { list: async (received, query, receivedSignal) => { assert.equal(received, agent); assert.equal(query, 'src/'); assert.equal(receivedSignal, signal); return [{ path: 'src/main.ts', kind: 'file' }]; } }
      : key === 'sessionReferenceResolver' ? { remoteExportCandidates: async (received, query, receivedSignal) => { assert.equal(received, agent); assert.equal(query, 'notes'); assert.equal(receivedSignal, signal); return [{ sessionId: 'session-source', label: 'Notes', createdAt: 1, mention: '@[Notes](dsh-session:abc)' }]; } }
      : undefined,
  };
  assert.deepEqual(await routeDesktopRequest(ctx, 'reference.files', { sessionId: agent.id, query: 'src/' }, signal), { items: [{ path: 'src/main.ts', kind: 'file' }] });
  assert.deepEqual(await routeDesktopRequest(ctx, 'reference.sessions', { sessionId: agent.id, query: 'notes' }, signal), { items: [{ sessionId: 'session-source', label: 'Notes', createdAt: 1, mention: '@[Notes](dsh-session:abc)' }] });
  await assert.rejects(routeDesktopRequest(ctx, 'reference.files', { sessionId: 'missing' }, signal), error => error.code === 'session-not-found');
});

test('rejects malformed and unavailable RC8 reference requests', async () => {
  const agent = { id: 'session-target' };
  const context = { get: key => key === 'agents' ? { get: id => id === agent.id ? agent : undefined } : undefined };
  await assert.rejects(routeDesktopRequest(context, 'reference.files', { sessionId: agent.id, query: 'x'.repeat(257) }, signal), /no longer than 256/);
  await assert.rejects(routeDesktopRequest(context, 'reference.files', { sessionId: agent.id }, signal), error => error.code === 'reference-unavailable');
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(routeDesktopRequest({ get: key => key === 'agents' ? { get: () => agent } : key === 'fileReferences' ? { list: async () => [] } : undefined }, 'reference.files', { sessionId: agent.id }, controller.signal), /aborted|cancel/i);
});

test('forwards image prompt content without changing the DSH wire shape', async () => {
  let received
  const ctx = {
    get: key => key === 'sessionController' ? {
      prompt: async request => {
        received = request
        return { accepted: true }
      },
    } : undefined,
  }
  const payload = {
    sessionId: 'session-image',
    mode: 'queue',
    content: [
      { type: 'text', text: '描述这张图' },
      { type: 'image', mediaType: 'image/png', data: 'QUJD', name: '画面.png' },
    ],
    clientTimeZone: 'Asia/Shanghai',
  }

  const result = await routeDesktopRequest(ctx, 'session.prompt', payload, signal)

  assert.deepEqual(result, { accepted: true })
  assert.match(received.requestId, /^[0-9a-f-]{36}$/)
  const { requestId, ...withoutRequestId } = received
  assert.deepEqual(withoutRequestId, {
    sessionId: payload.sessionId,
    mode: payload.mode,
    content: payload.content,
    clientTimeZone: payload.clientTimeZone,
  })
})

test('attaches an existing session through the official workspace entity', async () => {
  const workspace = {
    id: 'workspace-1',
    path: 'D:/repo',
    title: 'repo',
    sessionIds: [],
    createdAt: '2026-08-15T00:00:00.000Z',
    updatedAt: '2026-08-15T00:00:00.000Z',
    attachSession: async sessionId => workspace.sessionIds.unshift(sessionId),
  }
  const result = await routeDesktopRequest({
    get: key => key === 'workspaceRegistry' ? { get: id => id === workspace.id ? workspace : undefined, enqueueOperation: operation => operation() } : undefined,
  }, 'workspace.attachSession', { workspaceId: workspace.id, sessionId: 'session-1' }, signal)

  assert.deepEqual(result.workspace.sessionIds, ['session-1'])
})

test('tags cwd-validation attach failures with the workspace-unavailable code', async () => {
  const workspace = {
    id: 'workspace-offline',
    path: 'E:/外接盘目录',
    title: '外接盘目录',
    sessionIds: [],
    attachSession: async () => {
      throw new Error(
        "cannot attach session 'session-offline' to workspace 'E:/外接盘目录': "
        + "its cwd 'E:/外接盘目录' does not resolve, so it cannot be validated",
      )
    },
  }
  const registry = { get: id => id === workspace.id ? workspace : undefined, enqueueOperation: operation => operation() }
  await assert.rejects(
    routeDesktopRequest({ get: key => key === 'workspaceRegistry' ? registry : undefined },
      'workspace.attachSession', { workspaceId: workspace.id, sessionId: 'session-offline' }, signal),
    error => error instanceof Error
      && error.code === 'workspace-unavailable'
      && error.message.includes('does not resolve'),
  )
})

test('propagates non-validation attach failures unchanged', async () => {
  const workspace = {
    id: 'workspace-fault',
    path: 'D:/repo',
    title: 'repo',
    sessionIds: [],
    attachSession: async () => { throw new Error('storage exploded') },
  }
  const registry = { get: id => id === workspace.id ? workspace : undefined, enqueueOperation: operation => operation() }
  await assert.rejects(
    routeDesktopRequest({ get: key => key === 'workspaceRegistry' ? registry : undefined },
      'workspace.attachSession', { workspaceId: workspace.id, sessionId: 'session-1' }, signal),
    /storage exploded/,
  )
})

test('delegates workspace pins to the Cordis service and decorates listings', async () => {
  const workspace = {
    id: 'workspace-pins',
    path: 'D:/repo',
    title: 'repo',
    sessionIds: ['session-1', 'session-2'],
    createdAt: '2026-08-15T00:00:00.000Z',
    updatedAt: '2026-08-15T00:00:00.000Z',
  }
  const pinned = new Map()
  const sessionPins = {
    forWorkspace: target => pinned.get(target.id ?? target.workspaceId) ?? [],
    setSessionPinned: async (workspaceId, sessionId, enabled) => {
      if (!workspace.sessionIds.includes(sessionId)) throw new Error(`session "${sessionId}" is not accounted by workspace "${workspaceId}"`)
      const current = pinned.get(workspaceId) ?? []
      const next = enabled ? [...current.filter(id => id !== sessionId), sessionId] : current.filter(id => id !== sessionId)
      pinned.set(workspaceId, next)
      return { workspaceId, pinnedSessionIds: next }
    },
    clearWorkspace: async workspaceId => { pinned.delete(workspaceId) },
    clearSession: async sessionId => {
      for (const [workspaceId, ids] of pinned) pinned.set(workspaceId, ids.filter(id => id !== sessionId))
    },
  }
  const registry = {
    get: id => id === workspace.id ? workspace : undefined,
    list: () => [workspace],
    enqueueOperation: operation => operation(),
  }
  const ctx = {
    get: key => key === 'workspaceRegistry' ? registry : key === 'sessionPins' ? sessionPins : undefined,
  }
  assert.deepEqual(
    await routeDesktopRequest(ctx, 'workspace.setSessionPinned', { workspaceId: workspace.id, sessionId: 'session-2', pinned: true }, signal),
    { workspaceId: workspace.id, pinnedSessionIds: ['session-2'] },
  )
  const listed = await routeDesktopRequest(ctx, 'workspace.list', {}, signal)
  assert.deepEqual(listed.items[0].pinnedSessionIds, ['session-2'])
  assert.deepEqual(
    await routeDesktopRequest(ctx, 'workspace.setSessionPinned', { workspaceId: workspace.id, sessionId: 'session-2', pinned: false }, signal),
    { workspaceId: workspace.id, pinnedSessionIds: [] },
  )
  await assert.rejects(
    routeDesktopRequest(ctx, 'workspace.setSessionPinned', { workspaceId: workspace.id, sessionId: 'session-unknown', pinned: true }, signal),
    /not accounted/,
  )
  await sessionPins.setSessionPinned(workspace.id, 'session-1', true)
  const movedWorkspace = { ...workspace, id: 'workspace-moved', sessionIds: [], attachSession: async sessionId => movedWorkspace.sessionIds.unshift(sessionId) }
  const moveContext = {
    ...ctx,
    get: key => key === 'workspaceRegistry' ? {
      list: () => [workspace, movedWorkspace],
      get: id => id === movedWorkspace.id ? movedWorkspace : id === workspace.id ? workspace : undefined,
      enqueueOperation: operation => operation(),
    } : key === 'sessionPins' ? sessionPins : undefined,
  }
  await routeDesktopRequest(moveContext, 'workspace.attachSession', { workspaceId: movedWorkspace.id, sessionId: 'session-1' }, signal)
  const afterMove = await routeDesktopRequest(ctx, 'workspace.list', {}, signal)
  assert.deepEqual(afterMove.items[0].pinnedSessionIds, [])
})

test('rejects pin writes when the Cordis pin service is not mounted', async () => {
  const workspace = { id: 'workspace-without-pins', sessionIds: ['session-1'] }
  await assert.rejects(
    routeDesktopRequest({
      get: key => key === 'workspaceRegistry' ? { get: () => workspace } : undefined,
    }, 'workspace.setSessionPinned', { workspaceId: workspace.id, sessionId: 'session-1', pinned: true }, signal),
    /deeptop-bridge\/session-pins Cordis plugin/,
  )
})

test('delegates archive writes and returns the complete archive set', async () => {
  const requests = []
  const result = await routeDesktopRequest({
    get: key => key === 'workspaceController' ? {
      archiveSession: async request => {
        requests.push(request)
        return { archivedSessionIds: ['session-1'] }
      },
    } : undefined,
  }, 'workspace.archiveSession', { sessionId: 'session-1' }, signal)

  assert.deepEqual(requests, [{ sessionId: 'session-1' }])
  assert.deepEqual(result, { archivedSessionIds: ['session-1'] })
})

test('serializes archive and restore through the workspace registry queue', async () => {
  let state = { initialized: true, workspaceIds: [], archivedSessionIds: [] }
  let tail = Promise.resolve()
  let archiveStarted
  const archiveStart = new Promise(resolve => { archiveStarted = resolve })
  let releaseArchive
  const archiveGate = new Promise(resolve => { releaseArchive = resolve })
  const registry = {
    state,
    global: {
      get: () => state,
      set: async next => { state = next },
    },
    enqueueOperation: operation => {
      const next = tail.then(operation, operation)
      tail = next.then(() => undefined, () => undefined)
      return next
    },
  }
  const controller = {
    archiveSession: ({ sessionId }) => registry.enqueueOperation(async () => {
      archiveStarted()
      await archiveGate
      const next = { ...registry.state, archivedSessionIds: [...registry.state.archivedSessionIds, sessionId] }
      await registry.global.set(next)
      registry.state = next
      return { archivedSessionIds: next.archivedSessionIds }
    }),
  }
  const ctx = {
    get: key => key === 'workspaceRegistry' ? registry : key === 'workspaceController' ? controller : undefined,
  }

  const archive = routeDesktopRequest(ctx, 'workspace.archiveSession', { sessionId: 'session-1' }, signal)
  await archiveStart
  const restore = routeDesktopRequest(ctx, 'workspace.restoreSession', { sessionId: 'session-1' }, signal)
  releaseArchive()

  assert.deepEqual(await archive, { archivedSessionIds: ['session-1'] })
  assert.deepEqual(await restore, { archivedSessionIds: [] })
  assert.deepEqual(state.archivedSessionIds, [])
})

test('restores an archived session through the workspace registry state', async () => {
  let state = { initialized: true, workspaceIds: [], archivedSessionIds: ['session-1', 'session-2'] }
  const registry = {
    state,
    global: {
      get: () => state,
      set: async next => { state = next },
    },
    enqueueOperation: operation => operation(),
  }
  const result = await routeDesktopRequest({
    get: key => key === 'workspaceRegistry' ? registry : undefined,
  }, 'workspace.restoreSession', { sessionId: 'session-1' }, signal)

  assert.deepEqual(result, { archivedSessionIds: ['session-2'] })
  assert.deepEqual(state.archivedSessionIds, ['session-2'])
  assert.deepEqual(registry.state.archivedSessionIds, ['session-2'])
})

test('permanently removes an archived session through the persistence seam', async () => {
  let state = { initialized: true, workspaceIds: [], archivedSessionIds: ['session-gone', 'session-kept'] }
  const removed = []
  const registry = {
    state,
    global: {
      get: () => state,
      set: async next => { state = next },
    },
    enqueueOperation: operation => operation(),
    list: () => [],
  }
  const ctx = {
    get: key => ({
      workspaceRegistry: registry,
      sessionPersistence: { delete: async (id, options) => { removed.push({ id, options }); return true } },
    })[key],
  }

  assert.deepEqual(
    await routeDesktopRequest(ctx, 'workspace.deleteArchivedSession', { sessionId: 'session-gone' }, signal),
    { deleted: true, archivedSessionIds: ['session-kept'] },
  )
  assert.deepEqual(removed, [{ id: 'session-gone', options: { signal } }])
  assert.deepEqual(state.archivedSessionIds, ['session-kept'])
})

test('never destroys an active session and only drops archive state after durable removal', async () => {
  let state = { initialized: true, workspaceIds: [], archivedSessionIds: ['session-archived'] }
  const removed = []
  const registry = {
    state,
    global: {
      get: () => state,
      set: async next => { state = next },
    },
    enqueueOperation: operation => operation(),
  }
  const persistence = {
    delete: async id => {
      removed.push(id)
      if (id === 'session-archived') throw Object.assign(new Error('write handle owns the session'), { code: 'session-already-owned' })
      return false
    },
  }
  const ctx = { get: key => ({ workspaceRegistry: registry, sessionPersistence: persistence })[key] }

  // An unarchived session is refused outright; persistence is never asked.
  assert.deepEqual(
    await routeDesktopRequest(ctx, 'workspace.deleteArchivedSession', { sessionId: 'session-active' }, signal),
    { deleted: false, archivedSessionIds: ['session-archived'] },
  )
  assert.deepEqual(removed, [])

  // A refused removal leaves the session archived and retryable.
  await assert.rejects(
    routeDesktopRequest(ctx, 'workspace.deleteArchivedSession', { sessionId: 'session-archived' }, signal),
    error => error?.code === 'session-already-owned',
  )
  assert.deepEqual(removed, ['session-archived'])
  assert.deepEqual(state.archivedSessionIds, ['session-archived'])

  // An already-absent log reconciles the stale archive entry instead of reporting success.
  state = { ...state, archivedSessionIds: ['session-missing'] }
  registry.state = state
  assert.deepEqual(
    await routeDesktopRequest(ctx, 'workspace.deleteArchivedSession', { sessionId: 'session-missing' }, signal),
    { deleted: false, archivedSessionIds: [] },
  )
  assert.deepEqual(removed, ['session-archived', 'session-missing'])
  assert.deepEqual(state.archivedSessionIds, [])
})

test('refuses archived deletion when the mounted persistence backend implements no removal', async () => {
  const state = { initialized: true, workspaceIds: [], archivedSessionIds: ['session-1'] }
  const registry = {
    state,
    global: { get: () => state, set: async next => { state = next } },
    enqueueOperation: operation => operation(),
  }
  const ctx = {
    get: key => key === 'workspaceRegistry' ? registry
      : key === 'sessionPersistence' ? { list: async () => [] }
      : undefined,
  }

  await assert.rejects(
    routeDesktopRequest(ctx, 'workspace.deleteArchivedSession', { sessionId: 'session-1' }, signal),
    error => error?.code === 'session-delete-unavailable'
      && /未挂载支持永久删除的会话存储/.test(error.message),
  )
  assert.deepEqual(state.archivedSessionIds, ['session-1'])
})

test('adds model context windows and input modalities without changing the API response shape', async () => {
  const ctx = {
    get: key => key === 'sessionController' ? {
      modelCatalog: async () => ({
        groups: [{ id: 'demo', models: [{ id: 'chat' }, { id: 'text-only' }] }],
        failures: [],
        routableProviders: ['demo'],
      }),
    } : key === 'agentDefaultModel' ? {
      currentSelection: () => ({ provider: 'demo', model: 'chat' }),
    } : key === 'llm' ? {
      resolveModelInfo: async (_provider, model) => ({
        context: { contextWindow: model === 'chat' ? 262144 : 0 },
        inputModalities: model === 'chat' ? ['text', 'image'] : ['text'],
      }),
    } : undefined,
  }

  const result = await routeDesktopRequest(ctx, 'session.models', {}, signal)

  assert.equal(result.contextWindow, 262144)
  assert.equal(result.groups[0].models[0].contextWindow, 262144)
  assert.deepEqual(result.groups[0].models[0].inputModalities, ['text', 'image'])
  assert.deepEqual(result.groups[0].models[1].inputModalities, ['text'])
  assert.deepEqual(result.current, { provider: 'demo', model: 'chat' })
  assert.equal(result.routable, true)
})

test('resolves an unlisted current model context window', async () => {
  const ctx = {
    get: key => key === 'sessionController' ? {
      modelCatalog: async () => ({
        groups: [{ id: 'demo', models: [{ id: 'listed' }] }],
        failures: [],
        routableProviders: ['demo'],
      }),
    } : key === 'sessions' ? {
      get: () => ({ id: 'session-1' }),
    } : key === 'sessionProjections' ? {
      snapshot: () => ({ values: { modelSelection: { next: { provider: 'demo', model: 'private-preview' } } } }),
    } : key === 'llm' ? {
      resolveModelInfo: async (_provider, model) => ({ context: { contextWindow: model === 'private-preview' ? 200_000 : 100_000 } }),
    } : undefined,
  }

  const result = await routeDesktopRequest(ctx, 'session.models', { sessionId: 'session-1' }, signal)

  assert.deepEqual(result.current, { provider: 'demo', model: 'private-preview' })
  assert.equal(result.contextWindow, 200_000)
})

test('enriches model metadata concurrently', async () => {
  const started = []
  let release
  const blocked = new Promise(resolve => { release = resolve })
  const ctx = {
    get: key => key === 'sessionController' ? {
      modelCatalog: async () => ({
        groups: [{ id: 'demo', models: [{ id: 'first' }, { id: 'second' }] }],
        failures: [],
        routableProviders: ['demo'],
      }),
    } : key === 'agentDefaultModel' ? {
      currentSelection: () => ({ provider: 'demo', model: 'first' }),
    } : key === 'llm' ? {
      resolveModelInfo: async (_provider, model) => {
        started.push(model)
        if (started.length === 2) release()
        await blocked
        return { context: { contextWindow: 1 } }
      },
    } : undefined,
  }

  const result = await routeDesktopRequest(ctx, 'session.models', {}, signal)

  assert.deepEqual(started, ['first', 'second'])
  assert.equal(result.groups[0].models.length, 2)
})

test('serves a cold session whole-log turn outline from the query projection', async () => {
  let disposed = false
  const ctx = {
    get: key => key === 'sessionQuery' ? {
      observeSession: async (sessionId, options) => {
        assert.equal(sessionId, 'session-1')
        assert.deepEqual(options, { signal, projectionMode: 'all' })
        return {
          projections: {
            values: {
              turnOutline: [
                { turn: 1, seq: 4, prompt: 'hello', response: 'hi back' },
                { turn: 2, seq: 21, prompt: 'next', response: '' },
              ],
            },
          },
          [Symbol.dispose]: () => { disposed = true },
        }
      },
    } : undefined,
  }

  const result = await routeDesktopRequest(ctx, 'session.turnOutline', { sessionId: 'session-1' }, signal)
  assert.equal(result.sessionId, 'session-1')
  assert.equal(result.entries.length, 2)
  assert.deepEqual(result.entries[0], { turn: 1, seq: 4, prompt: 'hello', response: 'hi back' })
  assert.equal(disposed, true)
})

test('turn outline degrades to an empty list when the projection unit is missing', async () => {
  const ctx = {
    get: key => key === 'sessionQuery' ? {
      observeSession: async () => ({ projections: { values: {} }, [Symbol.dispose]: () => {} }),
    } : undefined,
  }

  const result = await routeDesktopRequest(ctx, 'session.turnOutline', { sessionId: 'session-1' }, signal)
  assert.equal(result.sessionId, 'session-1')
  assert.deepEqual(result.entries, [])
})

test('turn outline rejects an unknown session', async () => {
  const ctx = {
    get: key => key === 'sessionQuery' ? {
      observeSession: async () => {
        const error = new Error('session "session-missing" not found')
        error.code = 'SESSION_QUERY_SESSION_NOT_FOUND'
        throw error
      },
    } : undefined,
  }
  await assert.rejects(
    routeDesktopRequest(ctx, 'session.turnOutline', { sessionId: 'session-missing' }, signal),
    error => error.code === 'session-not-found',
  )
})

test('enriches the host model catalog with image capabilities', async () => {
  const ctx = {
    get: key => key === 'sessionController' ? {
      modelCatalog: async () => ({
        groups: [{ id: 'demo', models: [{ id: 'vision' }] }],
        failures: [],
        routableProviders: ['demo'],
      }),
    } : key === 'llm' ? {
      resolveModelInfo: async () => ({ inputModalities: ['text', 'image'] }),
    } : undefined,
  }

  const result = await routeDesktopRequest(ctx, 'llm.models', {}, signal)

  assert.deepEqual(result.groups[0].models[0].inputModalities, ['text', 'image'])
  assert.deepEqual(result.failures, [])
})

test('forwards only allowlisted Typert Remote calls through the desktop bridge', async () => {
  let received
  const ctx = {
    get: key => key === 'typertGateway'
      ? {
          invoke: async request => {
            received = request
            return { accepted: true }
          },
        }
      : undefined,
  }

  const result = await routeDesktopRequest(ctx, 'remote.invoke', {
    namespace: 'commands',
    method: 'list',
    args: {},
  }, signal)

  assert.deepEqual(result, { value: { accepted: true } })
  assert.deepEqual(received, {
    namespace: 'commands',
    method: 'list',
    args: {},
    signal,
  })
  received = undefined
  await assert.rejects(
    routeDesktopRequest(ctx, 'remote.invoke', { namespace: 'fileUploads', method: 'stage', args: {} }, signal),
    error => {
      assert.equal(error?.code, 'remote-unavailable')
      assert.deepEqual(error?.details, { namespace: 'fileUploads', method: 'stage' })
      return true
    },
  )
  assert.equal(received, undefined)
})

test('rejects malformed Typert Remote calls before dispatch', async () => {
  const ctx = { get: () => ({ invoke: async () => ({}) }) }
  await assert.rejects(
    routeDesktopRequest(ctx, 'remote.invoke', { namespace: 'demo', method: 'inspect', args: [] }, signal),
    /requires namespace, method and object args/,
  )
})

test('rejects methods outside the bridge allowlist', async () => {
  await assert.rejects(
    routeDesktopRequest({ apiProxy: {} }, 'internal.secret', {}, signal),
    /does not expose/,
  )
})

test('lists, opens, and removes a user Skill through the settings routes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deeptop-skill-settings-'))
  const skillDir = join(root, 'skills', 'demo-skill')
  await writeFile(join(root, 'placeholder'), 'x')
  await mkdir(skillDir, { recursive: true })
  await writeFile(join(skillDir, 'SKILL.md'), '---\nname: demo-skill\ndescription: Demo\n---\n')
  const installationId = '11111111-1111-4111-8111-111111111111'
  await writeFile(join(skillDir, '.dsh-managed-skill.json'), JSON.stringify({
    version: 1,
    owner: 'deeptop',
    directoryName: 'demo-skill',
    skillName: 'demo-skill',
    source: 'https://github.com/acme/demo-skill/tree/main',
    ref: 'main',
    path: '.',
    installationId,
  }))
  await mkdir(join(root, 'profiles', 'desktop'), { recursive: true })
  await writeFile(join(root, 'profiles', 'desktop', 'deeptop-managed-skills.json'), JSON.stringify({
    version: 1,
    entries: [{
      directoryName: 'demo-skill',
      skillName: 'demo-skill',
      source: 'https://github.com/acme/demo-skill/tree/main',
      ref: 'main',
      path: '.',
      installationId,
    }],
  }))
  const opened = []
  const ctx = {
    get: key => key === 'dshHome' ? root
      : key === 'sessionController' ? {
          canOpenWorkspacePath: () => true,
          openWorkspacePath: async request => { opened.push(request.path); return { opened: true } },
        }
      : undefined,
  }
  try {
    const description = await routeDesktopRequest(ctx, 'tool.settings.describe', {}, signal)
    assert.equal(description.skills.entries[0].name, 'demo-skill')
    await routeDesktopRequest(ctx, 'skill.settings.openDirectory', {}, signal)
    assert.deepEqual(opened, [join(root, 'skills')])
    const removed = await routeDesktopRequest(ctx, 'skill.settings.remove', { directoryName: 'demo-skill' }, signal)
    assert.equal(removed.skills.entries.length, 0)
    await assert.rejects(routeDesktopRequest(ctx, 'skill.settings.remove', { directoryName: '../outside' }, signal), /Skill name 无效/)
  } finally {
    await removePath(root, { recursive: true, force: true })
  }
})

test('does not allow settings to delete an untracked user Skill', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deeptop-skill-untracked-'))
  const skillDir = join(root, 'skills', 'manual-skill')
  const ctx = { get: key => key === 'dshHome' ? root : undefined }
  try {
    await mkdir(skillDir, { recursive: true })
    await writeFile(join(skillDir, 'SKILL.md'), '---\nname: manual-skill\ndescription: Manual\n---\n')
    const description = await routeDesktopRequest(ctx, 'tool.settings.describe', {}, signal)
    assert.equal(description.skills.entries[0].removable, false)
    await assert.rejects(
      routeDesktopRequest(ctx, 'skill.settings.remove', { directoryName: 'manual-skill' }, signal),
      /由 Deeptop 安装并登记/,
    )
    await stat(join(skillDir, 'SKILL.md'))
  } finally {
    await removePath(root, { recursive: true, force: true })
  }
})

test('does not authorize a handwritten managed marker without its registry record', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deeptop-skill-forged-marker-'))
  const skillDir = join(root, 'skills', 'manual-skill')
  const ctx = { get: key => key === 'dshHome' ? root : undefined }
  try {
    await mkdir(skillDir, { recursive: true })
    await writeFile(join(skillDir, 'SKILL.md'), '---\nname: manual-skill\ndescription: Manual\n---\n')
    await writeFile(join(skillDir, '.dsh-managed-skill.json'), JSON.stringify({
      version: 1,
      owner: 'deeptop',
      directoryName: 'manual-skill',
      skillName: 'manual-skill',
      source: 'https://github.com/acme/manual-skill/tree/main',
      ref: 'main',
      path: '.',
      installationId: '33333333-3333-4333-8333-333333333333',
    }))
    const description = await routeDesktopRequest(ctx, 'tool.settings.describe', {}, signal)
    assert.equal(description.skills.entries[0].removable, false)
    await assert.rejects(
      routeDesktopRequest(ctx, 'skill.settings.remove', { directoryName: 'manual-skill' }, signal),
      /由 Deeptop 安装并登记/,
    )
    await stat(join(skillDir, 'SKILL.md'))
  } finally {
    await removePath(root, { recursive: true, force: true })
  }
})

test('finishes an interrupted Skill deletion from its tombstone without restoring it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deeptop-skill-recovery-'))
  const skills = join(root, 'skills')
  const tombstoneName = '.remove-demo-skill-11111111-1111-1111-1111-111111111111'
  try {
    await mkdir(join(skills, tombstoneName), { recursive: true })
    await writeFile(join(skills, tombstoneName, 'partial.txt'), 'partial')
    await writeFile(join(skills, '.dsh-skill-removal.json'), JSON.stringify({
      version: 1,
      directoryName: 'demo-skill',
      trashName: tombstoneName,
      phase: 'moved',
    }))
    const result = await routeDesktopRequest({ get: key => key === 'dshHome' ? root : undefined }, 'tool.settings.describe', {}, signal)
    assert.deepEqual(result.skills.entries, [])
    await assert.rejects(stat(join(skills, tombstoneName)), { code: 'ENOENT' })
    await assert.rejects(stat(join(skills, '.dsh-skill-removal.json')), { code: 'ENOENT' })

    const orphanName = '.remove-user-notes-22222222-2222-2222-2222-222222222222'
    await mkdir(join(skills, orphanName), { recursive: true })
    await writeFile(join(skills, orphanName, 'keep.txt'), 'keep')
    const afterOrphan = await routeDesktopRequest({ get: key => key === 'dshHome' ? root : undefined }, 'tool.settings.describe', {}, signal)
    assert.deepEqual(afterOrphan.skills.entries, [])
    assert.equal(await readFile(join(skills, orphanName, 'keep.txt'), 'utf8'), 'keep')
  } finally {
    await removePath(root, { recursive: true, force: true })
  }
})

test('quarantines a malformed Skill deletion journal without blocking inventory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deeptop-skill-journal-invalid-'))
  const skills = join(root, 'skills')
  try {
    await mkdir(skills, { recursive: true })
    await writeFile(join(skills, '.dsh-skill-removal.json'), '{not json')
    const result = await routeDesktopRequest({ get: key => key === 'dshHome' ? root : undefined }, 'tool.settings.describe', {}, signal)
    assert.deepEqual(result.skills.entries, [])
    const names = await readdir(skills)
    assert.ok(names.some(name => name.startsWith('.dsh-skill-removal.invalid-')))
  } finally {
    await removePath(root, { recursive: true, force: true })
  }
})

test('rejects Tools settings routes when DSH_HOME is unavailable', async () => {
  const methods = [
    'tool.settings.describe',
    'skill.settings.installStatus',
    'skill.settings.cancelInstall',
    'skill.settings.remove',
    'mcp.settings.mutate',
  ]
  for (const method of methods) {
    const payload = method === 'skill.settings.remove'
      ? { directoryName: 'demo-skill' }
      : method === 'mcp.settings.mutate'
        ? { expectedRevision: 0, servers: [] }
        : { operationId: 'operation-1' }
    await assert.rejects(
      routeDesktopRequest({ get: () => undefined }, method, payload, signal),
      error => error?.code === 'tools-unavailable',
    )
  }
  await assert.rejects(
    routeDesktopRequest({ get: () => undefined }, 'skill.settings.openDirectory', {}, signal),
    error => error?.code === 'tools-unavailable',
  )
})

test('rejects opening the Skills directory when Host directory service is unavailable', async () => {
  await assert.rejects(
    routeDesktopRequest({ get: key => key === 'dshHome' ? tmpdir() : undefined, apiProxy: {} }, 'skill.settings.openDirectory', {}, signal),
    error => error?.code === 'host-unavailable',
  )
})

test('does not expose the direct Skill install route without approval', async () => {
  await assert.rejects(
    routeDesktopRequest({}, 'skill.install', { source: 'https://github.com/acme/skill' }, signal),
    error => error?.code === 'approval-required',
  )
})

test('validates GitHub skill install sources before any network request', async () => {
  await assert.rejects(
    routeDesktopRequest({}, 'skill.install', { source: 'https://example.com/acme/skill' }, signal),
    /只支持 HTTPS GitHub 地址/,
  )
})

test('parses Codex-compatible GitHub repository and tree sources', () => {
  assert.deepEqual(parseGitHubSource({ source: 'https://github.com/anthropics/skills/tree/main/skills/frontend-design' }), {
    owner: 'anthropics',
    repo: 'skills',
    ref: 'main',
    path: 'skills/frontend-design',
  })
  assert.deepEqual(parseGitHubSource({ source: 'https://github.com/Leonxlnx/taste-skill' }), {
    owner: 'Leonxlnx',
    repo: 'taste-skill',
    ref: 'main',
    path: undefined,
  })
  assert.deepEqual(parseGitHubSource({
    source: 'https://github.com/acme/repo/tree/feature/foo/skills/demo',
    ref: 'feature/foo',
  }), {
    owner: 'acme',
    repo: 'repo',
    ref: 'feature/foo',
    path: 'skills/demo',
  })
  assert.deepEqual(parseGitHubSource({
    source: 'https://github.com/acme/repo/tree/feature%2Ffoo/skills/demo',
    ref: 'feature/foo',
  }), {
    owner: 'acme',
    repo: 'repo',
    ref: 'feature/foo',
    path: 'skills/demo',
  })
  assert.throws(
    () => parseGitHubSource({ source: 'https://github.com/acme/repo/tree/feature/foo/skills/demo' }),
    /未编码斜杠/,
  )
  assert.throws(() => validateRelativeRepoPath('../outside'), /仓库内的相对路径/)
})

test('selects the canonical skills directory when a repository ships mirrored skill trees', () => {
  const candidates = [
    '.openclaw/skills/ponytail-audit',
    '.openclaw/skills/ponytail',
    'skills/ponytail',
    'skills/ponytail-audit',
  ]
  assert.equal(selectSkillPath(candidates, 'ponytail'), 'skills/ponytail')
  assert.equal(selectSkillPath([...candidates].reverse(), 'ponytail'), 'skills/ponytail')
  assert.equal(selectSkillPath(['.openclaw/skills/ponytail'], 'ponytail'), '.openclaw/skills/ponytail')
  assert.equal(selectSkillPath(['.openclaw/skills/only-skill'], 'other-repo'), '.openclaw/skills/only-skill')
  assert.equal(selectSkillPath(['skills/one', 'skills/two'], 'other-repo'), undefined)
})

test('keeps session export unavailable without a public alpha persistence archive API', async () => {
  const ctx = { get: () => { throw new Error('export must not query private persistence') } }
  await assert.rejects(
    routeDesktopRequest(ctx, 'session.exportZip', { sessionId: 'session-123', includeDescendants: true }, signal),
    error => error?.code === 'session-export-unavailable'
      && error.details?.sessionId === 'session-123'
      && /不公开安全的会话导出接口/.test(error.message),
  )
  await assert.rejects(routeDesktopRequest(ctx, 'session.exportZip', { sessionId: '' }, signal), /requires sessionId/)
  await assert.rejects(routeDesktopRequest(ctx, 'session.exportZip', { sessionId: 'session-123', includeDescendants: 'yes' }, signal), /requires sessionId/)
})

test('keeps session repair unavailable without private persistence access', async () => {
  const state = { initialized: true, workspaceIds: [], archivedSessionIds: ['session-123'] }
  const registry = {
    state,
    global: { get: () => state, set: async next => { Object.assign(state, next) } },
    enqueueOperation: operation => operation(),
  }
  let queriedPersistence = false
  const ctx = {
    get: key => {
      if (key === 'workspaceRegistry') return registry
      queriedPersistence = true
      throw new Error(`unexpected private service lookup: ${key}`)
    },
  }
  await assert.rejects(
    routeDesktopRequest(ctx, 'session.repairCorrupt', { sessionId: 'session-123' }, signal),
    error => error?.code === 'session-repair-unavailable' && error.details?.sessionId === 'session-123',
  )
  assert.equal(queriedPersistence, false)
  assert.deepEqual(state.archivedSessionIds, ['session-123'])
})

test('keeps message file-card validation on the native Tauri command', async () => {
  const transcript = await readFile(join(import.meta.dirname, '..', '..', 'src', 'components', 'ConversationTranscript.tsx'), 'utf8')
  const desktop = await readFile(join(import.meta.dirname, '..', '..', 'src', 'lib', 'desktop.ts'), 'utf8')
  const native = await readFile(join(import.meta.dirname, '..', '..', 'src-tauri', 'src', 'main.rs'), 'utf8')
  assert.match(transcript, /onCheckPath=\{checkPath\}/)
  assert.match(desktop, /invoke<boolean>\("is_file_path", \{ path \}\)/)
  assert.match(native, /fn is_file_path\(path: String\) -> bool/)
  assert.match(native, /metadata\.is_file\(\)/)
  assert.match(transcript, /isFilePath\(sessionPath\(activeSession\.cwd, path\)\)/)
})

test('keeps file export in the native save bridge instead of browser downloads', async () => {
  const app = await readFile(join(import.meta.dirname, '..', '..', 'src', 'App.tsx'), 'utf8')
  const desktop = await readFile(join(import.meta.dirname, '..', '..', 'src', 'lib', 'desktop.ts'), 'utf8')
  const native = await readFile(join(import.meta.dirname, '..', '..', 'src-tauri', 'src', 'main.rs'), 'utf8')
  assert.doesNotMatch(app, /link\.download|URL\.createObjectURL|window\.open/)
  assert.doesNotMatch(desktop, /window\.open/)
  assert.match(app, /moveExportTempFile\(result\.filename, result\.tempPath\)/)
  assert.match(app, /saveExportFile\(fileName, new TextEncoder\(\)\.encode\(content\)\)/)
  // 临时文件转移必须走原生另存为命令，不走浏览器下载。
  assert.match(desktop, /move_export_temp_file/)
  assert.match(native, /fn move_export_temp_file/)
})

test('routes message annotation operations through the Cordis service', async () => {
  const calls = []
  const service = {
    list: async payload => {
      calls.push(['list', payload])
      return { ok: true, value: { items: [] } }
    },
    put: async payload => {
      calls.push(['put', payload])
      return { ok: true, value: { messageId: 'message-1', note: '重点' } }
    },
    delete: async payload => {
      calls.push(['delete', payload])
      return { ok: true, value: { absent: true } }
    },
  }
  const ctx = {
    get: key => key === 'messageAnnotations' ? service : undefined,
  }

  assert.deepEqual(await routeDesktopRequest(ctx, 'messageAnnotations.list', { sessionId: 'session-1' }, signal), {
    ok: true,
    value: { items: [] },
  })
  assert.deepEqual(await routeDesktopRequest(ctx, 'messageAnnotations.put', {
    sessionId: 'session-1',
    messageId: 'message-1',
    note: '重点',
    ifVersion: null,
  }, signal), {
    ok: true,
    value: { messageId: 'message-1', note: '重点' },
  })
  assert.deepEqual(await routeDesktopRequest(ctx, 'messageAnnotations.delete', {
    sessionId: 'session-1',
    messageId: 'message-1',
    ifVersion: 'version-1',
  }, signal), {
    ok: true,
    value: { absent: true },
  })
  assert.deepEqual(calls, [
    ['list', { sessionId: 'session-1' }],
    ['put', { sessionId: 'session-1', messageId: 'message-1', note: '重点', ifVersion: null }],
    ['delete', { sessionId: 'session-1', messageId: 'message-1', ifVersion: 'version-1' }],
  ])
})
