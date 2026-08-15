import assert from 'node:assert/strict'
import { mkdtemp, rm as removePath, stat, writeFile } from 'node:fs/promises'
import test from 'node:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { routeDesktopRequest } from './routes.mjs'
import { parseGitHubSource, validateRelativeRepoPath } from './skill-installer.mjs'

const signal = new AbortController().signal

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

test('adds model context windows without changing the API response shape', async () => {
  const ctx = {
    apiProxy: {
      sessions: {
        models: async () => ({
          result: {
            ok: true,
            value: {
              current: { provider: 'demo', model: 'chat' },
              groups: [{ id: 'demo', models: [{ id: 'chat' }] }],
            },
          },
        }),
      },
    },
    llm: {
      resolveModelInfo: async (_provider, model) => ({
        context: { contextWindow: model === 'chat' ? 262144 : 0 },
      }),
    },
  }

  const result = await routeDesktopRequest(ctx, 'session.models', {}, signal)

  assert.equal(result.result.value.contextWindow, 262144)
  assert.equal(result.result.value.groups[0].models[0].contextWindow, 262144)
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
