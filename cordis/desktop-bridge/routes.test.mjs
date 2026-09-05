import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readdir, readFile, rm as removePath, stat, writeFile } from 'node:fs/promises'
import test from 'node:test'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { constants, zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import { routeDesktopRequest } from './routes.mjs'
import { resolveDshHome } from './dsh-home.mjs'
import { bridgeErrorFrame, DesktopBridge, writeBridgeFrame } from './bridge.mjs'
import { applyProxy, initNetworkProxy, loadProxySetting, normalizeProxyOverride, parseWindowsProxyServer, setProxySetting, stopSystemProxyWatch } from './network-proxy.mjs'
import { describePluginConfig, mutatePluginConfig } from './plugin-config.mjs'
import { parseGitHubSource, selectSkillPath, validateRelativeRepoPath } from '../skill-installer/installer.mjs'
import { reconstructContiguous, rowSeqs, scanZstdFrames, verifyReadable } from './session-repair.mjs'
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
    await applyProxy({ enabled: false, url: '' })
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
    applyProxy({ enabled: false, url: '' })
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await removePath(root, { recursive: true, force: true })
  }
})

test('routes Node global fetch through the selected HTTP proxy', async () => {
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
  const address = proxy.address()
  if (address === null || typeof address === 'string') throw new Error('test proxy did not bind a TCP port')
  try {
    await applyProxy({ enabled: true, url: `http://127.0.0.1:${address.port}` })
    const response = await fetch('http://model.invalid/probe')
    assert.equal(await response.text(), 'proxied')
    assert.deepEqual(received, { method: 'GET', url: 'http://model.invalid/probe', host: 'model.invalid' })
    await assert.rejects(fetch('https://model.invalid/probe'))
    assert.deepEqual(receivedConnect, { method: 'CONNECT', url: 'model.invalid:443', host: 'model.invalid' })
  } finally {
    await applyProxy({ enabled: false, url: '' })
    await new Promise((resolve, reject) => proxy.close(error => error === undefined ? resolve() : reject(error)))
  }
})

test('parses Windows ProxyServer into a usable proxy URL', () => {
  assert.equal(parseWindowsProxyServer('127.0.0.1:7890'), 'http://127.0.0.1:7890')
  assert.equal(parseWindowsProxyServer('http=127.0.0.1:7890;https=127.0.0.1:7891'), 'http://127.0.0.1:7891')
  assert.equal(parseWindowsProxyServer('http=127.0.0.1:7890'), 'http://127.0.0.1:7890')
  assert.equal(parseWindowsProxyServer(''), undefined)
})

test('normalizes ProxyOverride into a rule list for the custom dispatcher', () => {
  assert.deepEqual(normalizeProxyOverride('localhost;127.*;192.168.*;10.*;<local>'), ['localhost', '127.*', '192.168.*', '10.*', 'localhost'])
  assert.deepEqual(normalizeProxyOverride(''), [])
})

test('routes an allowlisted API method with a generated RPC id', async () => {
  const registry = {
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
  })
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
      : key === 'sessionSkillCatalog' ? { list: async () => ({ skills: [] }) }
      : key === 'agentPresets' ? { remoteExportList: async () => ({ presets: [], authorable: true }) }
      : key === 'goals' ? { create: async () => ({}) }
      : key === 'settingsController' ? { describe: async () => ({}) }
      : key === 'credentialsController' ? { describe: async () => ({}) }
      : key === 'llm' ? { resolveModelInfo: async () => ({}) }
      : key === 'typertGateway' ? { invoke: async () => ({}) }
      : key === 'sessionPersistence' ? { readRaw: async () => ({ filename: 'session.jsonl', content: '' }) }
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
    skills: true,
    agentPresets: true,
    goals: true,
    settings: true,
    credentials: true,
    llm: true,
    plugins: true,
    tools: true,
    sessionExport: true,
    commands: true,
    uiPlugins: false,
  })
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
    get: key => key === 'workspaceRegistry' ? { get: id => id === workspace.id ? workspace : undefined } : undefined,
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
  const registry = { get: id => id === workspace.id ? workspace : undefined }
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
  const registry = { get: id => id === workspace.id ? workspace : undefined }
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

test('deletes an archived session artifact and removes its workspace membership', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deeptop-archive-'))
  const artifact = join(root, 'session.jsonl.zstd')
  await writeFile(artifact, 'session')
  let state = { initialized: true, workspaceIds: [], archivedSessionIds: ['session-1'] }
  let detachedSessionId
  const registry = {
    state,
    global: {
      get: () => state,
      set: async next => { state = next },
    },
    enqueueOperation: operation => operation(),
    list: () => [{ detachSession: async sessionId => { detachedSessionId = sessionId } }],
  }
  const persistence = {
    list: async () => [{ id: 'session-1' }],
    locate: () => ({ path: artifact }),
  }

  try {
    const result = await routeDesktopRequest({
      get: key => ({
        workspaceRegistry: registry,
        sessionPersistence: persistence,
      })[key],
    }, 'workspace.deleteArchivedSession', { sessionId: 'session-1' }, signal)

    assert.deepEqual(result, { deleted: true, archivedSessionIds: [] })
    assert.equal(detachedSessionId, 'session-1')
    assert.deepEqual(state.archivedSessionIds, [])
    await assert.rejects(stat(artifact), { code: 'ENOENT' })
  } finally {
    await removePath(root, { recursive: true, force: true })
  }
})

test('refuses an attached archived session without treating turn cancellation as lifecycle disposal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deeptop-archive-attached-'))
  const artifact = join(root, 'session.jsonl.zstd')
  await writeFile(artifact, 'session')
  let state = { initialized: true, workspaceIds: [], archivedSessionIds: ['session-attached'] }
  let cancels = 0
  let detaches = 0
  const registry = {
    state,
    global: {
      get: () => state,
      set: async next => { state = next },
    },
    enqueueOperation: operation => operation(),
    list: () => [{ detachSession: async () => { detaches += 1 } }],
  }

  try {
    await assert.rejects(
      routeDesktopRequest({
        apiProxy: { sessions: { cancel: async () => { cancels += 1 } } },
        get: key => ({
          workspaceRegistry: registry,
          sessionPersistence: {
            list: async () => [{ id: 'session-attached' }],
            locate: () => ({ path: artifact }),
          },
          sessions: { get: () => ({ id: 'session-attached' }) },
        })[key],
      }, 'workspace.deleteArchivedSession', { sessionId: 'session-attached' }, signal),
      error => error.code === 'session-attached'
        && error.details?.sessionId === 'session-attached'
        && /不代表仍在运行/.test(error.message),
    )
    assert.equal(cancels, 0)
    assert.equal(detaches, 0)
    await stat(artifact)
    assert.deepEqual(state.archivedSessionIds, ['session-attached'])
  } finally {
    await removePath(root, { recursive: true, force: true })
  }
})

test('keeps a stale archive tombstone while attached and reconciles it after runtime restart', async () => {
  let state = { initialized: true, workspaceIds: [], archivedSessionIds: ['session-agent-only'] }
  let attached = true
  const registry = {
    state,
    global: {
      get: () => state,
      set: async next => { state = next },
    },
    enqueueOperation: operation => operation(),
    list: () => [],
  }
  const context = {
    get: key => ({
      workspaceRegistry: registry,
      sessionPersistence: { list: async () => [] },
      agents: { get: () => attached ? { id: 'session-agent-only' } : undefined },
    })[key],
  }

  await assert.rejects(
    routeDesktopRequest(context, 'workspace.deleteArchivedSession', { sessionId: 'session-agent-only' }, signal),
    error => error.code === 'session-attached' && /重启 DSH 运行时/.test(error.message),
  )
  assert.deepEqual(state.archivedSessionIds, ['session-agent-only'])

  attached = false
  const result = await routeDesktopRequest(
    context,
    'workspace.deleteArchivedSession',
    { sessionId: 'session-agent-only' },
    signal,
  )
  assert.deepEqual(result, { deleted: true, archivedSessionIds: [] })
  assert.deepEqual(state.archivedSessionIds, [])
})

test('reconciles an archived session whose persisted artifact is already absent', async () => {
  let state = { initialized: true, workspaceIds: [], archivedSessionIds: ['session-missing'] }
  let detached = 0
  let listed = 0
  let cancels = 0
  const registry = {
    state,
    global: {
      get: () => state,
      set: async next => { state = next },
    },
    enqueueOperation: operation => operation(),
    list: () => [{ detachSession: async () => { detached += 1 } }],
  }
  const context = {
    apiProxy: { sessions: { cancel: async () => { cancels += 1 } } },
    get: key => ({
      workspaceRegistry: registry,
      sessionPersistence: { list: async () => { listed += 1; return [] } },
    })[key],
  }

  const first = await routeDesktopRequest(context, 'workspace.deleteArchivedSession', { sessionId: 'session-missing' }, signal)
  const second = await routeDesktopRequest(context, 'workspace.deleteArchivedSession', { sessionId: 'session-missing' }, signal)

  assert.deepEqual(first, { deleted: true, archivedSessionIds: [] })
  assert.deepEqual(second, { deleted: false, archivedSessionIds: [] })
  assert.equal(listed, 1)
  assert.equal(detached, 1)
  assert.equal(cancels, 0)
  assert.deepEqual(state.archivedSessionIds, [])
})

test('retries metadata cleanup when the artifact was deleted before workspace cleanup failed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deeptop-archive-retry-'))
  const artifact = join(root, 'session.jsonl.zstd')
  await writeFile(artifact, 'session')
  let state = { initialized: true, workspaceIds: [], archivedSessionIds: ['session-retry'] }
  let detachAttempts = 0
  let listAttempts = 0
  const registry = {
    state,
    global: {
      get: () => state,
      set: async next => { state = next },
    },
    enqueueOperation: operation => operation(),
    list: () => [{
      detachSession: async () => {
        detachAttempts += 1
        if (detachAttempts === 1) throw new Error('simulated workspace cleanup failure')
      },
    }],
  }
  const context = {
    get: key => ({
      workspaceRegistry: registry,
      sessionPersistence: {
        list: async () => {
          listAttempts += 1
          return listAttempts === 1 ? [{ id: 'session-retry' }] : []
        },
        locate: () => ({ path: artifact }),
      },
    })[key],
  }

  try {
    await assert.rejects(
      routeDesktopRequest(context, 'workspace.deleteArchivedSession', { sessionId: 'session-retry' }, signal),
      /simulated workspace cleanup failure/,
    )
    await assert.rejects(stat(artifact), { code: 'ENOENT' })
    assert.deepEqual(state.archivedSessionIds, ['session-retry'])

    const result = await routeDesktopRequest(
      context,
      'workspace.deleteArchivedSession',
      { sessionId: 'session-retry' },
      signal,
    )
    assert.deepEqual(result, { deleted: true, archivedSessionIds: [] })
    assert.equal(listAttempts, 2)
    assert.equal(detachAttempts, 2)
  } finally {
    await removePath(root, { recursive: true, force: true })
  }
})

test('validates artifact deletion support before inspecting attached lifecycle state', async () => {
  let state = { initialized: true, workspaceIds: [], archivedSessionIds: ['session-locationless'] }
  let sessionReads = 0
  const registry = {
    state,
    global: {
      get: () => state,
      set: async next => { state = next },
    },
    enqueueOperation: operation => operation(),
    list: () => [],
  }

  await assert.rejects(
    routeDesktopRequest({
      get: key => ({
        workspaceRegistry: registry,
        sessionPersistence: { list: async () => [{ id: 'session-locationless' }], locate: () => undefined },
        sessions: { get: () => { sessionReads += 1; return {} } },
      })[key],
    }, 'workspace.deleteArchivedSession', { sessionId: 'session-locationless' }, signal),
    /does not expose a deletable session artifact/,
  )
  assert.equal(sessionReads, 0)
  assert.deepEqual(state.archivedSessionIds, ['session-locationless'])
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

test('serves the whole-log turn outline from the sessionProjections unit', async () => {
  const ctx = {
    get: key => key === 'sessions' ? {
      get: () => ({ id: 'session-1' }),
    } : key === 'sessionProjections' ? {
      snapshot: (session, keys) => {
        assert.equal(session.id, 'session-1')
        assert.deepEqual(keys, ['turnOutline'])
        return {
          asOfSeq: 40,
          values: {
            turnOutline: [
              { turn: 1, seq: 4, prompt: 'hello', response: 'hi back' },
              { turn: 2, seq: 21, prompt: 'next', response: '' },
            ],
          },
        }
      },
    } : undefined,
  }

  const result = await routeDesktopRequest(ctx, 'session.turnOutline', { sessionId: 'session-1' }, signal)
  assert.equal(result.sessionId, 'session-1')
  assert.equal(result.entries.length, 2)
  assert.deepEqual(result.entries[0], { turn: 1, seq: 4, prompt: 'hello', response: 'hi back' })
})

test('turn outline degrades to an empty list when the projection unit is missing', async () => {
  const ctx = {
    get: key => key === 'sessions' ? {
      get: () => ({ id: 'session-1' }),
    } : key === 'sessionProjections' ? {
      snapshot: () => ({ asOfSeq: 3, values: {} }),
    } : undefined,
  }

  const result = await routeDesktopRequest(ctx, 'session.turnOutline', { sessionId: 'session-1' }, signal)
  assert.equal(result.sessionId, 'session-1')
  assert.deepEqual(result.entries, [])
})

test('turn outline rejects an unknown session', async () => {
  const ctx = {
    get: key => key === 'sessions' ? {
      get: () => undefined,
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

test('forwards a validated Typert Remote call through the desktop bridge', async () => {
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
    namespace: 'demo',
    method: 'inspect',
    args: { id: 'session-1' },
  }, signal)

  assert.deepEqual(result, { value: { accepted: true } })
  assert.deepEqual(received, {
    namespace: 'demo',
    method: 'inspect',
    args: { id: 'session-1' },
    signal,
  })
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
      : key === 'sessionPersistence' ? { readRaw: async () => ({ filename: 'session.jsonl', content: '' }) }
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

test('builds a session ZIP into a temp file for the native save surface', async () => {
  const seen = []
  let result
  try {
    result = await routeDesktopRequest({
      get: key => key === 'sessionPersistence' ? {
        readRaw: async (sessionId, requestSignal) => {
          seen.push(sessionId)
          assert.equal(requestSignal, signal)
          return { filename: `session-${sessionId}.jsonl`, content: '{"session":"data"}\n' }
        },
        list: async () => [{
          id: 'session-descendant',
          parentSession: 'session-123',
          origin: 'subagent',
          createdAt: 1,
          cwd: '/tmp',
        }],
      } : undefined,
    }, 'session.exportZip', { sessionId: 'session-123', includeDescendants: true }, signal)
  } catch (error) {
    throw error
  }

  try {
    assert.deepEqual(seen, ['session-123', 'session-descendant'])
    assert.equal(result.filename, 'dsh-session-session-123.zip')
    assert.equal(result.contentType, 'application/zip')
    assert.match(result.tempPath, /deeptop-session-export-[^/\\]+[/\\]session\.zip$/)
    const bytes = await readFile(result.tempPath)
    assert.equal(bytes.length, result.size)
    // Valid ZIP: local-file magic for the first entry and the EOCD record tail.
    assert.equal(bytes.toString('utf8', 0, 4), 'PK\u0003\u0004')
    assert.equal(bytes.toString('utf8', bytes.length - 22, bytes.length - 18), 'PK\u0005\u0006')
  } finally {
    await removePath(dirname(result.tempPath), { recursive: true, force: true }).catch(() => undefined)
  }
})

test('reports a missing session artifact without fabricating a file', async () => {
  await assert.rejects(
    routeDesktopRequest({
      get: key => key === 'sessionPersistence' ? {
        readRaw: async () => undefined,
        list: async () => [],
      } : undefined,
    }, 'session.exportZip', { sessionId: 'session-123' }, signal),
    /没有可导出的日志文件/,
  )
})

test('passes cancellation to the official session persistence endpoint', async () => {
  const controller = new AbortController()
  controller.abort()
  let reachedPersistence = false
  await assert.rejects(
    routeDesktopRequest({
      get: key => key === 'sessionPersistence' ? {
        readRaw: async () => {
          reachedPersistence = true
          return { filename: 'session.jsonl', content: '' }
        },
        list: async () => [],
      } : undefined,
    }, 'session.exportZip', { sessionId: 'session-123' }, controller.signal),
    /aborted/,
  )
  assert.equal(reachedPersistence, false)
})

test('cleans up when the export is aborted before writing the temp file', async () => {
  const before = new Set((await readdir(tmpdir())).map(String))
  const controller = new AbortController()
  await assert.rejects(
    routeDesktopRequest({
      get: key => key === 'sessionPersistence' ? {
        readRaw: async () => {
          controller.abort()
          throw new Error('aborted by persistence')
        },
        list: async () => [],
      } : undefined,
    }, 'session.exportZip', { sessionId: 'session-123' }, controller.signal),
    /aborted by persistence/,
  )
  // The temp directories created by THIS export must be removed (the first
  // streaming export test cleaned up its own; other tests may run in parallel).
  const after = new Set((await readdir(tmpdir())).map(String))
  const created = [...after].filter(name => !before.has(name) && name.startsWith('deeptop-session-export-'))
  assert.deepEqual(created, [])
})

test('rejects invalid native session ZIP requests before contacting DSH', async () => {
  let called = false
  const ctx = { get: key => key === 'sessionPersistence' ? { list: async () => [], readRaw: async () => { called = true; return { filename: 'x', content: '' } } } : undefined }
  await assert.rejects(routeDesktopRequest(ctx, 'session.exportZip', { sessionId: '' }, signal), /requires sessionId/)
  await assert.rejects(routeDesktopRequest(ctx, 'session.exportZip', { sessionId: 'session-123', includeDescendants: 'yes' }, signal), /requires sessionId/)
  assert.equal(called, false)
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

// --- session.repairCorrupt ---

const repairHeader = {
  type: 'session',
  version: 0,
  id: 'session-repair-test',
  createdAt: 1786888612035,
  cwd: 'D:\\repo',
  delegationDepth: 0,
  agentPreset: 'standard',
}
const repairHeaderLine = JSON.stringify(repairHeader) + '\n'
const repairEventLine = (type, seq, extra = {}) => JSON.stringify({ type, seq, time: 1786888612035 + seq, data: { ...extra } }) + '\n'

function compressZstdFrame(text) {
  return zstdCompressSync(Buffer.from(text, 'utf8'), { params: { [constants.ZSTD_c_checksumFlag]: 1 } })
}

function buildRepairFixture(kind) {
  const events = repairEventLine('user/message', 0, { role: 'user', content: [{ type: 'text', text: 'hi' }] }) +
    repairEventLine('turn/start', 1, { turn: 1 }) +
    repairEventLine('step/start', 2, { turn: 1, step: 1 }) +
    repairEventLine('assistant/message', 3, { step: 1, message: { role: 'assistant', content: 'hello' } }) +
    repairEventLine('turn/end', 4, { turn: 1 })
  const headerFrame = compressZstdFrame(repairHeaderLine)
  const eventFrame = compressZstdFrame(events)
  if (kind === 'clean') return Buffer.concat([headerFrame, eventFrame])
  if (kind === 'torn-record') {
    const torn = JSON.stringify({ type: 'user/message', seq: 5, time: 1786888612040, data: { role: 'user', content: [{ type: 'text', text: 'partial' }] } }).slice(0, -7)
    return Buffer.concat([headerFrame, eventFrame, compressZstdFrame(torn)])
  }
  if (kind === 'seq-gap') {
    // A stale writer's overlapping branch (seqs 2-3 replay step 1) interleaved
    // before the surviving writer's continuation (seq 5, turn 2), mirroring two
    // DSH instances appending to one log after a crash restarted one of them.
    const stale = repairEventLine('assistant/message', 2, { step: 1, message: { role: 'assistant', content: 'stale' } }) +
      repairEventLine('assistant/message', 3, { step: 1, message: { role: 'assistant', content: 'stale2' } })
    const resume = repairEventLine('user/message', 5, { role: 'user', content: [{ type: 'text', text: '继续' }] })
    return Buffer.concat([headerFrame, eventFrame, compressZstdFrame(stale), compressZstdFrame(resume)])
  }
  throw new Error(`unknown fixture kind ${kind}`)
}

function committedBytesEqual(buffer) {
  const { frames } = scanZstdFrames(buffer)
  let committed = 0
  let input = 0
  for (let i = 0; i < frames.length; i++) {
    const plain = zstdDecompressSync(buffer.subarray(frames[i].start, frames[i].end))
    input += plain.length
    if (i === 0) {
      committed += plain.length
      continue
    }
    let lineStart = 0
    for (let nl = plain.indexOf(10); nl !== -1; nl = plain.indexOf(10, lineStart)) {
      committed += nl - lineStart + 1
      lineStart = nl + 1
    }
  }
  return committed === input
}

function repairCtx(path, running = false) {
  return {
    get: key => ({
      sessionPersistence: {
        list: async () => [{ id: 'session-repair-test' }],
        locate: () => ({ path }),
      },
      sessions: running ? { get: () => ({}) } : undefined,
      agents: undefined,
    })[key],
  }
}

test('session.repairCorrupt drops a torn record from a complete frame and rewrites the log', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deeptop-repair-'))
  const artifact = join(root, 'session.jsonl.zstd')
  await writeFile(artifact, buildRepairFixture('torn-record'))
  try {
    const result = await routeDesktopRequest(repairCtx(artifact), 'session.repairCorrupt', { sessionId: 'session-repair-test' }, signal)
    assert.deepEqual(result, { repaired: true, recoveredEvents: 5, droppedTorn: 1, droppedSeqGap: 0 })
    const after = await readFile(artifact)
    assert.equal(committedBytesEqual(after), true, 'repaired log reads clean')
    const text = scanZstdFrames(after).frames
      .map(f => zstdDecompressSync(after.subarray(f.start, f.end)).toString('utf8'))
      .join('')
    const lines = text.split('\n').filter(Boolean)
    assert.equal(lines.length, 6, 'header plus five committed records')
    assert.equal(JSON.parse(lines.at(-1)).type, 'turn/end')
  } finally {
    await removePath(root, { recursive: true, force: true })
  }
})

test('session.repairCorrupt leaves an already-readable log untouched', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deeptop-repair-'))
  const artifact = join(root, 'session.jsonl.zstd')
  const clean = buildRepairFixture('clean')
  await writeFile(artifact, clean)
  try {
    const result = await routeDesktopRequest(repairCtx(artifact), 'session.repairCorrupt', { sessionId: 'session-repair-test' }, signal)
    assert.deepEqual(result, { repaired: false, recoveredEvents: 5, droppedTorn: 0, droppedSeqGap: 0 })
    const after = await readFile(artifact)
    assert.equal(after.equals(clean), true, 'clean log bytes are not rewritten')
  } finally {
    await removePath(root, { recursive: true, force: true })
  }
})

test('session.repairCorrupt refuses a running session and an absent artifact', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deeptop-repair-'))
  const artifact = join(root, 'session.jsonl.zstd')
  await writeFile(artifact, buildRepairFixture('clean'))
  try {
    await assert.rejects(
      routeDesktopRequest(repairCtx(artifact, true), 'session.repairCorrupt', { sessionId: 'session-repair-test' }, signal),
      /仍在运行/,
    )
    const absent = repairCtx(artifact)
    absent.get = key => key === 'sessionPersistence' ? { list: async () => [], locate: () => ({ path: artifact }) } : undefined
    await assert.rejects(
      routeDesktopRequest(absent, 'session.repairCorrupt', { sessionId: 'session-repair-test' }, signal),
      /不存在/,
    )
  } finally {
    await removePath(root, { recursive: true, force: true })
  }
})

test('session.repairCorrupt reports an unrecoverable artifact instead of writing it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deeptop-repair-'))
  const artifact = join(root, 'session.jsonl.zstd')
  await writeFile(artifact, Buffer.from('this is not a zstd session log'))
  try {
    await assert.rejects(
      routeDesktopRequest(repairCtx(artifact), 'session.repairCorrupt', { sessionId: 'session-repair-test' }, signal),
      /frame magic|无法修复/,
    )
    assert.equal(await readFile(artifact, 'utf8'), 'this is not a zstd session log', 'artifact is left unchanged')
  } finally {
    await removePath(root, { recursive: true, force: true })
  }
})

test('rowSeqs expands packed chunk rows and rejects malformed or seq-less rows', () => {
  assert.deepEqual(rowSeqs({ type: 'reasoning-chunks', seq0: 10, time0: 1, data: { turn: 1, step: 1, index: 0, dt: [1, 1], texts: ['a', 'b', 'c'] } }), [10, 11, 12])
  assert.deepEqual(rowSeqs({ type: 'text-chunks', seq0: 20, time0: 1, data: { turn: 1, step: 2, index: 0, dt: [3], texts: ['x', 'y'] } }), [20, 21])
  assert.deepEqual(rowSeqs({ type: 'tool-call-chunks', seq0: 30, time0: 1, data: { turn: 1, step: 3, index: 0, id: 'call-1', name: 'pwsh', dt: [], args: ['{}'] } }), [30])
  assert.deepEqual(rowSeqs({ type: 'user/message', seq: 3 }), [3])
  assert.equal(rowSeqs({ type: 'user/message' }), null)
  assert.equal(rowSeqs({ type: 'reasoning-chunks', seq0: 10, time0: 1, data: { turn: 1, step: 1, index: 0, dt: [1, 1], texts: ['a', 'b'] } }), null)
  assert.equal(rowSeqs({ type: 'reasoning-chunks', seq0: 10, time0: 1, data: { turn: 1, step: 1, index: 0, dt: [1, 1], texts: ['a', 'b', 3] } }), null)
  assert.equal(rowSeqs({ type: 'text-chunks', seq0: -1, time0: 1, data: { turn: 1, step: 1, index: 0, dt: [], texts: ['a'] } }), null)
})

test('reconstructContiguous keeps the longest contiguous stream across overlapping branches', () => {
  const line = seq => repairEventLine('user/message', seq, { role: 'user' })
  const { kept, dropped, count } = reconstructContiguous([line(0), line(1), line(2), line(3), line(4), line(2), line(3), line(5)])
  assert.equal(dropped, 2)
  assert.equal(count, 6)
  assert.deepEqual(kept.map(record => JSON.parse(record).seq), [0, 1, 2, 3, 4, 5])
})

test('verifyReadable detects a seq gap that the old JSON-only check missed', () => {
  assert.equal(verifyReadable(buildRepairFixture('clean')), null)
  const corrupt = buildRepairFixture('seq-gap')
  assert.match(verifyReadable(corrupt), /seq gap/)
  assert.match(verifyReadable(corrupt), /expected 5, got 2/)
})

test('session.repairCorrupt resolves overlapping seq branches and keeps the later turn', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deeptop-repair-'))
  const artifact = join(root, 'session.jsonl.zstd')
  await writeFile(artifact, buildRepairFixture('seq-gap'))
  try {
    const result = await routeDesktopRequest(repairCtx(artifact), 'session.repairCorrupt', { sessionId: 'session-repair-test' }, signal)
    assert.deepEqual(result, { repaired: true, recoveredEvents: 6, droppedTorn: 0, droppedSeqGap: 2 })
    const after = await readFile(artifact)
    assert.equal(committedBytesEqual(after), true, 'repaired log reads clean')
    assert.equal(verifyReadable(after), null, 'repaired log passes the seq-continuity check')
    const text = scanZstdFrames(after).frames
      .map(f => zstdDecompressSync(after.subarray(f.start, f.end)).toString('utf8'))
      .join('')
    const records = text.split('\n').filter(Boolean).slice(1).map(record => JSON.parse(record))
    assert.equal(records.length, 6, 'five committed records plus the turn-2 user message')
    assert.deepEqual(records.map(record => record.seq), [0, 1, 2, 3, 4, 5])
    assert.equal(records.at(-1).data.content[0].text, '继续', 'the surviving branch (turn 2) is preserved')
  } finally {
    await removePath(root, { recursive: true, force: true })
  }
})
