import assert from 'node:assert/strict'
import test from 'node:test'
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
