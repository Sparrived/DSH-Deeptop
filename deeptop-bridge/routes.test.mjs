import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm as removePath, stat, writeFile } from 'node:fs/promises'
import test from 'node:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { constants, zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import { routeDesktopRequest } from './routes.mjs'
import { describePluginConfig, mutatePluginConfig } from './plugin-config.mjs'
import { parseGitHubSource, validateRelativeRepoPath } from './skill-installer.mjs'
import { reconstructContiguous, rowSeqs, scanZstdFrames, verifyReadable } from './session-repair.mjs'

const signal = new AbortController().signal

test('keeps workspace clipboard actions on the native bridge', async () => {
  const source = await readFile(join(import.meta.dirname, '..', 'src', 'components', 'WorkspaceFilesPanel.tsx'), 'utf8')
  assert.match(source, /writeClipboard\(path\)/)
  assert.doesNotMatch(source, /navigator\.clipboard|document\.execCommand\(['"]copy/)
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
  try {
    const result = await mutatePluginConfig(ctx, {
      expectedRevision: 0,
      plugins: [{ id: 'local-tools', name: 'D:/plugins/local-tools/index.ts', enabled: true }],
    })
    assert.equal(result.changed, true)
    assert.equal(result.restartRequired, true)
    assert.equal(result.plugins[0].id, 'local-tools')
    await assert.rejects(
      mutatePluginConfig(ctx, {
        expectedRevision: result.revision,
        plugins: [
          { id: 'local-tools', name: 'D:/plugins/local-tools/index.ts', enabled: true },
          { id: 'local-tools', name: '@scope/other', enabled: true },
        ],
      }),
      /插件 id 重复/,
    )
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

test('routes an allowlisted API method with a generated RPC id', async () => {
  const ctx = {
    apiProxy: {
      workspace: {
        list: async request => request,
      },
    },
  }

  const result = await routeDesktopRequest(ctx, 'workspace.list', { cwd: 'D:/repo' }, signal)

  assert.match(result.rpcId, /^[0-9a-f-]{36}$/)
  assert.deepEqual(result.payload, { cwd: 'D:/repo' })
})

test('forwards image prompt content without changing the DSH wire shape', async () => {
  let received
  const ctx = {
    apiProxy: {
      sessions: {
        prompt: async request => {
          received = request
          return { ok: true, value: { accepted: true } }
        },
      },
    },
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

  assert.deepEqual(result, { ok: true, value: { accepted: true } })
  assert.match(received.rpcId, /^[0-9a-f-]{36}$/)
  assert.deepEqual(received.payload, payload)
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

test('stops a running archived session before deleting its artifact', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deeptop-archive-running-'))
  const artifact = join(root, 'session.jsonl.zstd')
  await writeFile(artifact, 'session')
  let state = { initialized: true, workspaceIds: [], archivedSessionIds: ['session-running'] }
  let live = true
  let cancelPayload
  const registry = {
    state,
    global: {
      get: () => state,
      set: async next => { state = next },
    },
    enqueueOperation: operation => operation(),
    list: () => [{ detachSession: async () => {} }],
  }
  const persistence = {
    list: async () => [{ id: 'session-running' }],
    locate: () => ({ path: artifact }),
  }

  try {
    const result = await routeDesktopRequest({
      apiProxy: {
        sessions: {
          cancel: async request => {
            cancelPayload = request.payload
            live = false
            return { ok: true, value: { accepted: true } }
          },
        },
      },
      get: key => ({
        workspaceRegistry: registry,
        sessionPersistence: persistence,
        sessions: { get: () => live ? {} : undefined },
      })[key],
    }, 'workspace.deleteArchivedSession', { sessionId: 'session-running' }, signal)

    assert.deepEqual(result, { deleted: true, archivedSessionIds: [] })
    assert.deepEqual(cancelPayload, { sessionId: 'session-running' })
    await assert.rejects(stat(artifact), { code: 'ENOENT' })
  } finally {
    await removePath(root, { recursive: true, force: true })
  }
})

test('does not delete a running archived session when cancellation cannot stop it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deeptop-archive-timeout-'))
  const artifact = join(root, 'session.jsonl.zstd')
  await writeFile(artifact, 'session')
  let state = { initialized: true, workspaceIds: [], archivedSessionIds: ['session-stuck'] }
  const registry = {
    state,
    global: {
      get: () => state,
      set: async next => { state = next },
    },
    enqueueOperation: operation => operation(),
    list: () => [{ detachSession: async () => {} }],
  }
  const persistence = {
    list: async () => [{ id: 'session-stuck' }],
    locate: () => ({ path: artifact }),
  }

  try {
    await assert.rejects(
      routeDesktopRequest({
        sessionStopTimeoutMs: 0,
        apiProxy: { sessions: { cancel: async () => ({ ok: true }) } },
        get: key => ({
          workspaceRegistry: registry,
          sessionPersistence: persistence,
          sessions: { get: () => ({}) },
        })[key],
      }, 'workspace.deleteArchivedSession', { sessionId: 'session-stuck' }, signal),
      /did not stop after the cancellation request/,
    )
    await stat(artifact)
    assert.deepEqual(state.archivedSessionIds, ['session-stuck'])
  } finally {
    await removePath(root, { recursive: true, force: true })
  }
})

test('adds model context windows and input modalities without changing the API response shape', async () => {
  const ctx = {
    apiProxy: {
      sessions: {
        models: async () => ({
          result: {
            ok: true,
            value: {
              current: { provider: 'demo', model: 'chat' },
              groups: [{ id: 'demo', models: [{ id: 'chat' }, { id: 'text-only' }] }],
            },
          },
        }),
      },
    },
    llm: {
      resolveModelInfo: async (_provider, model) => ({
        context: { contextWindow: model === 'chat' ? 262144 : 0 },
        inputModalities: model === 'chat' ? ['text', 'image'] : ['text'],
      }),
    },
  }

  const result = await routeDesktopRequest(ctx, 'session.models', {}, signal)

  assert.equal(result.result.value.contextWindow, 262144)
  assert.equal(result.result.value.groups[0].models[0].contextWindow, 262144)
  assert.deepEqual(result.result.value.groups[0].models[0].inputModalities, ['text', 'image'])
  assert.deepEqual(result.result.value.groups[0].models[1].inputModalities, ['text'])
})

test('enriches the host model catalog with image capabilities', async () => {
  const ctx = {
    apiProxy: {
      llm: {
        models: async () => ({
          result: {
            ok: true,
            value: { groups: [{ id: 'demo', models: [{ id: 'vision' }] }], failures: [] },
          },
        }),
      },
    },
    llm: {
      resolveModelInfo: async () => ({ inputModalities: ['text', 'image'] }),
    },
  }

  const result = await routeDesktopRequest(ctx, 'llm.models', {}, signal)

  assert.deepEqual(result.result.value.groups[0].models[0].inputModalities, ['text', 'image'])
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
  assert.throws(() => validateRelativeRepoPath('../outside'), /仓库内的相对路径/)
})

test('buffers the official session ZIP endpoint for the native download surface', async () => {
  const result = await routeDesktopRequest({
    apiProxy: {
      downloads: {
        sessionLog: async request => {
          assert.deepEqual(request, { sessionId: 'session-123', includeDescendants: true })
          return new Response(Uint8Array.from([80, 75, 3, 4]), {
            headers: { 'content-type': 'application/zip' },
          })
        },
      },
    },
  }, 'session.exportZip', { sessionId: 'session-123', includeDescendants: true }, signal)

  assert.equal(result.filename, 'dsh-session-session-123.zip')
  assert.equal(result.contentType, 'application/zip')
  assert.equal(result.size, 4)
  assert.equal(Buffer.from(result.base64, 'base64').toString('hex'), '504b0304')
})

test('reports the official session ZIP error body without fabricating a file', async () => {
  await assert.rejects(
    routeDesktopRequest({
      apiProxy: {
        downloads: {
          sessionLog: async () => new Response('session export denied', { status: 403 }),
        },
      },
    }, 'session.exportZip', { sessionId: 'session-123' }, signal),
    /session export denied/,
  )
})

test('passes cancellation to the official session ZIP endpoint', async () => {
  const controller = new AbortController()
  controller.abort()
  let receivedSignal
  await assert.rejects(
    routeDesktopRequest({
      apiProxy: {
        downloads: {
          sessionLog: async (_request, requestSignal) => {
            receivedSignal = requestSignal
            requestSignal.throwIfAborted()
            return new Response('unreachable')
          },
        },
      },
    }, 'session.exportZip', { sessionId: 'session-123' }, controller.signal),
    /aborted/,
  )
  assert.equal(receivedSignal, controller.signal)
})

test('rejects invalid native session ZIP requests before contacting DSH', async () => {
  let called = false
  const ctx = { apiProxy: { downloads: { sessionLog: async () => { called = true; return new Response() } } } }
  await assert.rejects(routeDesktopRequest(ctx, 'session.exportZip', { sessionId: '' }, signal), /requires sessionId/)
  await assert.rejects(routeDesktopRequest(ctx, 'session.exportZip', { sessionId: 'session-123', includeDescendants: 'yes' }, signal), /requires sessionId/)
  assert.equal(called, false)
})

test('keeps message file-card validation on the native Tauri command', async () => {
  const transcript = await readFile(join(import.meta.dirname, '..', 'src', 'components', 'ConversationTranscript.tsx'), 'utf8')
  const desktop = await readFile(join(import.meta.dirname, '..', 'src', 'lib', 'desktop.ts'), 'utf8')
  const native = await readFile(join(import.meta.dirname, '..', 'src-tauri', 'src', 'main.rs'), 'utf8')
  assert.match(transcript, /onCheckPath=\{checkPath\}/)
  assert.match(desktop, /invoke<boolean>\("is_file_path", \{ path \}\)/)
  assert.match(native, /fn is_file_path\(path: String\) -> bool/)
  assert.match(native, /metadata\.is_file\(\)/)
  assert.match(transcript, /isFilePath\(sessionPath\(activeSession\.cwd, path\)\)/)
})

test('keeps file export in the native save bridge instead of browser downloads', async () => {
  const app = await readFile(join(import.meta.dirname, '..', 'src', 'App.tsx'), 'utf8')
  const desktop = await readFile(join(import.meta.dirname, '..', 'src', 'lib', 'desktop.ts'), 'utf8')
  assert.doesNotMatch(app, /link\.download|URL\.createObjectURL|window\.open/)
  assert.doesNotMatch(desktop, /window\.open/)
  assert.match(app, /saveExportFile\(result\.filename, bytes\)/)
  assert.match(app, /saveExportFile\(fileName, new TextEncoder\(\)\.encode\(content\)\)/)
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
