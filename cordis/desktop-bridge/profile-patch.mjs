import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

const patchTails = new Map()
const PROFILE_LOCK_TIMEOUT_MS = 30_000
const PROFILE_LOCK_STALE_MS = 2 * 60_000

/** IDs already owned by the bundled desktop profile or its host services. */
export const DEEPTOP_PROFILE_ENTRY_IDS = new Set([
  'system-prompt',
  'tools',
  'agent',
  'session',
  'settings',
  'code-runtime',
  'storage',
  'storage-json',
  'storage-domain',
  'message-feedback',
  'message-annotations',
  'session-pins',
  'session-stats',
  'theme-settings',
  'workspace',
  'session-projection-cache',
  'directory-picker',
  'plugin-inventory',
  'api-gateway',
  'cordis-host-runner',
  'agent-presets',
  'file-reference-local',
  'session-reference',
  'deeptop-ui-registry',
  'message-annotations-ui',
  'desktop-bridge',
  'skill-installer',
  'tool-bash',
  'tool-pwsh',
  'tool-jobs',
  'tool-fs',
  'tool-fs-search',
  'tool-str-replace-editor',
  'skill-filesystem',
  'tool-skill',
  'tool-goal',
  'plan-mode',
  'compaction-basic',
  'command-compact',
  'tool-result-pruner',
  'subagent-routing',
  'tool-subagent-control',
  'tool-subagent-list-agents',
  'tool-subagent',
  'tool-subagent-fork',
  'workflow-worker-thread',
  'tool-workflow',
  'tool-ralph',
  'agent-instructions',
  'tool-todo',
  'tool-web',
])

function abortError(signal) {
  const error = signal?.reason instanceof Error ? signal.reason : new Error('操作已取消')
  if (error.code === undefined) error.code = 'cancelled'
  return error
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal)
}

function sleep(ms, signal) {
  return new Promise((resolveSleep, reject) => {
    try {
      throwIfAborted(signal)
    } catch (error) {
      reject(error)
      return
    }
    let timer
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(abortError(signal))
    }
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolveSleep()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function awaitWithAbort(promise, signal) {
  throwIfAborted(signal)
  if (signal === undefined) return promise
  return await new Promise((resolvePromise, reject) => {
    let settled = false
    const onAbort = () => {
      if (settled) return
      settled = true
      reject(abortError(signal))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(value => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      resolvePromise(value)
    }, error => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      reject(error)
    })
  })
}

async function canonicalPath(path) {
  let current = resolve(path)
  const suffix = []
  for (;;) {
    const info = await lstat(current).catch(error => {
      if (error?.code === 'ENOENT') return undefined
      throw error
    })
    if (info !== undefined) {
      if (info.isSymbolicLink()) throw new Error('Profile 路径不能是符号链接或 junction')
      const real = await realpath(current)
      return resolve(real, ...suffix.reverse())
    }
    suffix.push(basename(current))
    const parent = dirname(current)
    if (parent === current) return current
    current = parent
  }
}

async function assertSafeDirectoryAncestors(path, label) {
  let current = resolve(path)
  for (;;) {
    const info = await lstat(current).catch(error => {
      if (error?.code === 'ENOENT') return undefined
      throw error
    })
    if (info?.isSymbolicLink()) throw new Error(`${label} 及其父级不能是符号链接或 junction`)
    if (info !== undefined && !info.isDirectory()) throw new Error(`${label} 必须是目录`)
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

async function reclaimStaleProfileLock(lockPath, lockInfo, signal) {
  throwIfAborted(signal)
  if (lockInfo === undefined || Date.now() - lockInfo.mtimeMs <= PROFILE_LOCK_STALE_MS) return false
  let metadata
  try {
    metadata = JSON.parse(await readFile(lockPath, 'utf8'))
  } catch {
    metadata = undefined
  }
  // A live owner is never reclaimed merely because a task runs for a long
  // time. Unknown/malformed locks are reclaimable only after the lease age.
  if (Number.isSafeInteger(metadata?.pid) && processIsAlive(metadata.pid)) return false
  const quarantine = `${lockPath}.stale-${randomUUID()}`
  try {
    await rename(lockPath, quarantine)
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
  await rm(quarantine, { force: true }).catch(() => undefined)
  return true
}

async function acquireExternalProfileLock(path, signal) {
  throwIfAborted(signal)
  const lockPath = `${resolve(path)}.lock`
  await assertSafeDirectoryAncestors(dirname(lockPath), 'desktop Profile 目录')
  await mkdir(dirname(lockPath), { recursive: true })
  const deadline = Date.now() + PROFILE_LOCK_TIMEOUT_MS
  for (;;) {
    throwIfAborted(signal)
    let handle
    let created = false
    const token = randomUUID()
    try {
      handle = await open(lockPath, 'wx', 0o600)
      created = true
      await handle.writeFile(JSON.stringify({ pid: process.pid, token, acquiredAt: new Date().toISOString() }), 'utf8')
      throwIfAborted(signal)
      let released = false
      return async () => {
        if (released) return
        released = true
        await handle.close().catch(() => undefined)
        let metadata
        try {
          metadata = JSON.parse(await readFile(lockPath, 'utf8'))
        } catch {
          return
        }
        if (metadata?.token === token) await rm(lockPath, { force: true }).catch(() => undefined)
      }
    } catch (error) {
      await handle?.close().catch(() => undefined)
      if (created) {
        let metadata
        try {
          metadata = JSON.parse(await readFile(lockPath, 'utf8'))
        } catch {
          metadata = undefined
        }
        if (metadata?.token === token) await rm(lockPath, { force: true }).catch(() => undefined)
      }
      if (error?.code !== 'EEXIST') throw error
      const lockInfo = await lstat(lockPath).catch(lockError => {
        if (lockError?.code === 'ENOENT') return undefined
        throw lockError
      })
      if (lockInfo?.isSymbolicLink()) throw new Error('desktop Profile 锁文件不能是符号链接')
      if (await reclaimStaleProfileLock(lockPath, lockInfo, signal)) continue
      if (Date.now() >= deadline) {
        const timeout = new Error('desktop Profile 正在被其他进程修改，请稍后重试')
        timeout.code = 'profile-lock-timeout'
        throw timeout
      }
      await sleep(50, signal)
    }
  }
}

/** Serialize edits that share one desktop Profile patch file in and across processes. */
export async function withProfilePatchLock(path, task, signal) {
  throwIfAborted(signal)
  const key = await canonicalPath(path)
  const previous = patchTails.get(key) ?? Promise.resolve()
  let releaseGate
  const gate = new Promise(resolveGate => { releaseGate = resolveGate })
  const tail = previous.catch(() => undefined).then(() => gate)
  patchTails.set(key, tail)
  let releaseExternal
  try {
    await awaitWithAbort(previous.catch(() => undefined), signal)
    throwIfAborted(signal)
    releaseExternal = await acquireExternalProfileLock(key, signal)
    throwIfAborted(signal)
    return await task()
  } finally {
    await releaseExternal?.()
    releaseGate()
    if (patchTails.get(key) === tail) patchTails.delete(key)
  }
}

/**
 * Locate a managed block only when each marker occupies its own complete line.
 * Ordinary comments or strings containing marker text are deliberately ignored.
 */
export function locateManagedBlock(value, startMarker, endMarker, label = '受管配置') {
  const text = String(value)
  const lines = text.split('\n')
  const starts = []
  const ends = []
  const offsets = []
  let offset = 0
  for (let index = 0; index < lines.length; index += 1) {
    offsets.push(offset)
    const line = lines[index].endsWith('\r') ? lines[index].slice(0, -1) : lines[index]
    const trimmed = line.trim()
    if (line === startMarker) starts.push({ line: index, end: offset + lines[index].length })
    if (line === endMarker) ends.push({ line: index, end: offset + lines[index].length })
    offset += lines[index].length + (index < lines.length - 1 ? 1 : 0)
  }
  if (starts.length === 0 && ends.length === 0) return null
  if (starts.length !== 1 || ends.length !== 1 || starts[0].line >= ends[0].line) {
    throw new Error(`${label}标记必须恰好成对且顺序正确`)
  }
  return {
    start: offsets[starts[0].line],
    end: ends[0].end,
    startLine: starts[0].line,
    endLine: ends[0].line,
  }
}

/** Keep managed comments while ensuring the document remains one YAML patch array. */
export function normalizeProfilePatchDocument(value) {
  const sourceLines = String(value).split(/\r?\n/)
  // `[]` is a valid empty Profile patch, but it cannot remain as a separate
  // root scalar once a managed sequence is appended. Only remove an exact
  // top-level empty-array line; indented nested arrays are user data.
  const lines = sourceLines.filter(line => !(line.trim() === '[]' && line.length === line.trimStart().length))
  const contentLines = lines.filter(line => {
    const trimmed = line.trim()
    return trimmed !== '' && !trimmed.startsWith('#')
  })
  for (const line of contentLines) {
    if (/\t/.test(line)) throw new Error('desktop Profile patch 不允许使用 Tab 缩进')
    const trimmed = line.trim()
    const indentation = line.length - line.trimStart().length
    if (indentation === 0 && !/^-(?:\s|$)/.test(trimmed)) {
      throw new Error('desktop Profile patch 必须是 YAML 数组')
    }
  }
  const content = lines.join('\n').trimEnd()
  return `${content}${content ? '\n' : ''}${contentLines.length > 0 ? '' : '[]\n'}`
}
