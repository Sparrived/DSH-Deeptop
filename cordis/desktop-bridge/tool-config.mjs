import { chmod, lstat, mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { installSkillFromSource, MANAGED_SKILL_MARKER, parseGitHubSource, SKILL_MUTATION_LOCK_KEY, validateGitRef, validateRelativeRepoPath, validateSkillName } from '../skill-installer/installer.mjs'
import { managedSkillRecordMatches, readManagedSkillRegistry, removeManagedSkillRegistration } from '../skill-installer/managed-registry.mjs'
import { locateManagedBlock, normalizeProfilePatchDocument, withProfilePatchLock } from './profile-patch.mjs'
import { resolveDshHome } from './dsh-home.mjs'

const MCP_CONFIG_FILE = 'deeptop-mcp.json'
const PROFILE_PATCH_FILE = 'cordis.patch.yml'
const MCP_PATCH_START = '# BEGIN DEEPTOP MANAGED MCP'
const MCP_PATCH_END = '# END DEEPTOP MANAGED MCP'
const MCP_CLIENT_PACKAGE = '@deepseek-ai/dsh-mcp-client'
const MANAGED_MCP_ENTRY_PREFIX = 'deeptop-mcp-'
const MCP_CONFIG_VERSION = 1
const SERVER_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/
const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/
const OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const HTTP_HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
const SERVER_FIELDS = new Set([
  'id',
  'serverName',
  'transport',
  'enabled',
  'command',
  'args',
  'cwd',
  'env',
  'url',
  'headers',
  'toolCallTimeoutMs',
  'reconnect',
])
const BINDING_FIELDS = new Set(['name', 'source', 'value', 'redacted', 'clearSecret', 'prefix'])
const RECONNECT_FIELDS = new Set(['enabled', 'initialDelayMs', 'maxDelayMs', 'maxAttempts'])
const DEFAULT_RECONNECT = Object.freeze({
  enabled: true,
  initialDelayMs: 500,
  maxDelayMs: 30_000,
  maxAttempts: 10,
})
const MAX_MANAGED_SKILLS = 1024
const MAX_MANAGED_SKILL_FILE_BYTES = 8 * 1024 * 1024
const MAX_MANAGED_FRONTMATTER_BYTES = 128 * 1024
const SKILL_REMOVAL_JOURNAL = '.dsh-skill-removal.json'
const MAX_SKILL_REMOVAL_JOURNAL_BYTES = 64 * 1024
const activeSkillInstalls = new WeakMap()

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasCode(error, code) {
  return typeof error === 'object' && error !== null && error.code === code
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return
  const error = signal.reason instanceof Error ? signal.reason : new Error('工具设置操作已取消')
  if (error.code === undefined) error.code = 'cancelled'
  throw error
}

function errorSummary(error) {
  return {
    message: error instanceof Error ? error.message : String(error),
    ...(error instanceof Error && typeof error.code === 'string' ? { code: error.code } : {}),
  }
}

function dshHome(ctx) {
  // A mounted Cordis context is authoritative. When it reports no home, do not
  // fall back to a process-wide one: that could make one Profile mutate another
  // user's files.
  const home = resolveDshHome(ctx)
  if (home === undefined) throw new Error('工具设置需要 DSH_HOME')
  return home
}

export function managedSkillDirectory(ctx) {
  return join(dshHome(ctx), 'skills')
}

async function assertSafeDirectoryRoot(path, label) {
  let current = resolve(path)
  const missing = []
  for (;;) {
    const info = await lstat(current).catch(error => {
      if (hasCode(error, 'ENOENT')) return undefined
      throw error
    })
    if (info?.isSymbolicLink()) throw new Error(`${label} 及其父级不能是符号链接或 junction`)
    if (info !== undefined && !info.isDirectory()) throw new Error(`${label} 必须是目录`)
    if (info === undefined) missing.push(current)
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return missing
}

async function ensureSafeDirectoryRoot(path, label) {
  const missing = await assertSafeDirectoryRoot(path, label)
  if (missing.length > 0) await mkdir(path, { recursive: true })
  await assertSafeDirectoryRoot(path, label)
}

function desktopProfileDirectory(ctx) {
  return join(dshHome(ctx), 'profiles', 'desktop')
}

function mcpConfigPath(ctx) {
  return join(desktopProfileDirectory(ctx), MCP_CONFIG_FILE)
}

function profilePatchPath(ctx) {
  return join(desktopProfileDirectory(ctx), PROFILE_PATCH_FILE)
}

function parseFrontmatterScalar(frontmatter, field) {
  const match = frontmatter.match(new RegExp(`^\\s*${field}\\s*:\\s*(.*?)\\s*$`, 'im'))
  if (!match) return undefined
  const raw = match[1]
  if (raw.startsWith('"') && raw.endsWith('"')) {
    try {
      const decoded = JSON.parse(raw)
      return typeof decoded === 'string' ? decoded : undefined
    } catch {
      return undefined
    }
  }
  if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1).replaceAll("''", "'")
  return raw
}

function removableSkillDirectory(name) {
  if (name === '.system') return false
  try {
    return validateSkillName(name) === name
  } catch {
    return false
  }
}

function canonicalManagedSkillSource(parsed) {
  const path = parsed.path && parsed.path !== '.'
    ? `/${parsed.path.split('/').map((segment) => encodeURIComponent(segment)).join('/')}`
    : ''
  return `https://github.com/${parsed.owner}/${parsed.repo}/tree/${encodeURIComponent(parsed.ref)}${path}`
}

async function readManagedSkillMarker(path, directoryName) {
  const markerPath = join(path, MANAGED_SKILL_MARKER)
  const info = await lstat(markerPath).catch(() => undefined)
  if (!info?.isFile() || info.isSymbolicLink() || info.size > 32 * 1024) return undefined
  try {
    const marker = JSON.parse(await readFile(markerPath, 'utf8'))
    if (!isRecord(marker)
      || marker.version !== 1
      || marker.owner !== 'deeptop'
      || marker.directoryName !== directoryName
      || typeof marker.skillName !== 'string'
      || typeof marker.source !== 'string'
      || typeof marker.ref !== 'string'
      || typeof marker.path !== 'string'
       || typeof marker.installationId !== 'string'
       || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(marker.installationId)) return undefined
    validateSkillName(marker.skillName)
    validateGitRef(marker.ref)
    validateRelativeRepoPath(marker.path)
    const parsed = parseGitHubSource({ source: marker.source, ref: marker.ref, path: marker.path })
    if (parsed.ref !== marker.ref || (parsed.path ?? '.') !== marker.path || canonicalManagedSkillSource(parsed) !== marker.source) return undefined
    return marker
  } catch {
    return undefined
  }
}

async function hasManagedSkillMarker(path, directoryName, expectedSkillName, registration) {
  const marker = await readManagedSkillMarker(path, directoryName)
  return marker !== undefined
    && (expectedSkillName === undefined || marker.skillName === expectedSkillName)
    && managedSkillRecordMatches(registration, marker)
}

async function describeSkillEntry(root, entry, registrations) {
  if (entry.isSymbolicLink()) return undefined
  const entryPath = join(root, entry.name)
  const kind = entry.isDirectory() ? 'directory' : entry.isFile() && entry.name.toLowerCase().endsWith('.md') ? 'file' : undefined
  if (kind === undefined || entry.name === '.system') return undefined
  const skillFile = kind === 'directory' ? join(entryPath, 'SKILL.md') : entryPath
  const fallbackName = kind === 'directory' ? entry.name : entry.name.slice(0, -3)
  const base = { directoryName: entry.name, kind, removable: false }
  const skillInfo = await lstat(skillFile).catch(() => undefined)
  if (skillInfo === undefined) return undefined
  if (!skillInfo.isFile() || skillInfo.isSymbolicLink()) {
    return { ...base, name: fallbackName, description: '', valid: false, error: 'SKILL.md 必须是普通文件' }
  }
  if (skillInfo.size > MAX_MANAGED_SKILL_FILE_BYTES) {
    return { ...base, name: fallbackName, description: '', valid: false, error: 'SKILL.md 超过大小限制' }
  }
  let content
  try {
    content = await readFile(skillFile, 'utf8')
  } catch (error) {
    return { ...base, name: fallbackName, description: '', valid: false, error: `无法读取 SKILL.md：${error.message}` }
  }
  if (Buffer.byteLength(content, 'utf8') > MAX_MANAGED_SKILL_FILE_BYTES) {
    return { ...base, name: fallbackName, description: '', valid: false, error: 'SKILL.md 超过大小限制' }
  }
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)?.[1]
  if (frontmatter !== undefined && Buffer.byteLength(frontmatter, 'utf8') > MAX_MANAGED_FRONTMATTER_BYTES) {
    return { ...base, name: fallbackName, description: '', valid: false, error: 'SKILL.md frontmatter 超过大小限制' }
  }
  if (frontmatter === undefined) {
    return { ...base, name: fallbackName, description: '', valid: false, error: 'SKILL.md 缺少 YAML frontmatter' }
  }
  const name = parseFrontmatterScalar(frontmatter, 'name')?.trim()
  const description = parseFrontmatterScalar(frontmatter, 'description')?.trim()
  if (!name) return { ...base, name: fallbackName, description: description ?? '', valid: false, error: 'frontmatter 缺少 name' }
  try {
    validateSkillName(name)
  } catch (error) {
    return { ...base, name, description: description ?? '', valid: false, error: error.message }
  }
  if (!description) return { ...base, name, description: '', valid: false, error: 'frontmatter 缺少 description' }
  const removable = kind === 'directory'
    && removableSkillDirectory(entry.name)
    && await hasManagedSkillMarker(entryPath, entry.name, name, registrations.get(entry.name))
  return { ...base, removable, name, description, valid: true }
}

async function describeManagedSkillsUnlocked(ctx, directory = managedSkillDirectory(ctx)) {
  await assertSafeDirectoryRoot(directory, '用户 Skills 目录')
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return { directory, entries: [] }
    throw new Error(`无法读取用户 Skills：${error.message}`)
  }
  if (entries.length > MAX_MANAGED_SKILLS) throw new Error('用户 Skills 数量超过限制')
  // A damaged registry must not hide the inventory. It merely revokes app-side
  // deletion until the next managed install rewrites a valid record.
  let registrations = new Map()
  try {
    const registry = await readManagedSkillRegistry(directory)
    registrations = new Map(registry.entries.map(record => [record.directoryName, record]))
  } catch {
    registrations = new Map()
  }
  const rows = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const row = await describeSkillEntry(directory, entry, registrations)
    if (row !== undefined) rows.push(row)
  }
  rows.sort((left, right) => left.name.localeCompare(right.name) || left.directoryName.localeCompare(right.directoryName))
  return { directory, entries: rows }
}

export async function describeManagedSkills(ctx) {
  const directory = managedSkillDirectory(ctx)
  return withProfilePatchLock(join(directory, SKILL_MUTATION_LOCK_KEY), async () => {
    await ensureSafeDirectoryRoot(directory, '用户 Skills 目录')
    await recoverSkillRemoval(directory)
    return describeManagedSkillsUnlocked(ctx, directory)
  })
}

function assertContainedChild(root, child, label) {
  const fromRoot = relative(resolve(root), resolve(child))
  if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot) || fromRoot.includes(sep)) {
    throw new Error(`${label} 必须是用户 Skills 目录中的一级子目录`)
  }
}

async function inspectManagedSkillTree(path, budget = { files: 0, bytes: 0 }) {
  const entries = await readdir(path, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = join(path, entry.name)
    const info = await lstat(entryPath)
    if (info.isSymbolicLink()) throw new Error(`Skill 目录包含符号链接：${entry.name}`)
    if (info.isDirectory()) {
      await inspectManagedSkillTree(entryPath, budget)
      continue
    }
    if (!info.isFile()) throw new Error(`Skill 目录包含非普通文件：${entry.name}`)
    budget.files += 1
    budget.bytes += info.size
    if (budget.files > MAX_MANAGED_SKILLS || budget.bytes > MAX_MANAGED_SKILL_FILE_BYTES * 64) {
      throw new Error('Skill 目录超过文件数量或总大小限制')
    }
  }
  return budget
}

async function assertRemovableSkillTree(path) {
  await inspectManagedSkillTree(path)
}

async function writeSkillRemovalJournal(root, journal) {
  const path = join(root, SKILL_REMOVAL_JOURNAL)
  const temp = `${path}.tmp-${process.pid}-${randomUUID()}`
  let published = false
  try {
    await writeFile(temp, `${JSON.stringify(journal, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await rename(temp, path)
    published = true
  } finally {
    if (!published) await rm(temp, { force: true }).catch(() => undefined)
  }
}

function invalidSkillRemovalJournal(message) {
  const error = new Error(message)
  error.code = 'invalid-skill-removal-journal'
  return error
}

async function readBoundedUtf8File(path, maxBytes) {
  const handle = await open(path, 'r')
  try {
    const info = await handle.stat()
    if (!Number.isSafeInteger(info.size) || info.size > maxBytes) {
      throw invalidSkillRemovalJournal('Skill 删除日志超过大小限制')
    }
    const buffer = Buffer.alloc(maxBytes + 1)
    const result = await handle.read(buffer, 0, maxBytes + 1, 0)
    if (result.bytesRead > maxBytes) throw invalidSkillRemovalJournal('Skill 删除日志超过大小限制')
    return buffer.subarray(0, result.bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }
}

async function quarantineSkillRemovalJournal(root) {
  const path = join(root, SKILL_REMOVAL_JOURNAL)
  try {
    await rename(path, join(root, `.dsh-skill-removal.invalid-${randomUUID()}`))
  } catch (error) {
    // A concurrent retry may already have moved the journal. Invalid residue
    // must never make inventory fail just because quarantine lost a race.
    if (!hasCode(error, 'ENOENT')) return false
  }
  return true
}

async function readSkillRemovalJournal(root) {
  const path = join(root, SKILL_REMOVAL_JOURNAL)
  const info = await lstat(path).catch(error => {
    if (hasCode(error, 'ENOENT')) return undefined
    throw error
  })
  if (info === undefined) return undefined
  if (info.isSymbolicLink() || !info.isFile()) throw invalidSkillRemovalJournal('Skill 删除日志必须是普通文件')
  let journal
  try {
    journal = JSON.parse(await readBoundedUtf8File(path, MAX_SKILL_REMOVAL_JOURNAL_BYTES))
  } catch (error) {
    if (hasCode(error, 'invalid-skill-removal-journal')) throw error
    throw invalidSkillRemovalJournal(`Skill 删除日志损坏：${error.message}`)
  }
  if (!isRecord(journal) || journal.version !== 1 || typeof journal.directoryName !== 'string'
    || typeof journal.trashName !== 'string' || (journal.phase !== 'prepared' && journal.phase !== 'moved')) {
    throw invalidSkillRemovalJournal('Skill 删除日志格式无效')
  }
  try {
    validateSkillName(journal.directoryName)
  } catch {
    throw invalidSkillRemovalJournal('Skill 删除日志目录名无效')
  }
  if (!journal.trashName.startsWith(`.remove-${journal.directoryName}-`)
    || journal.trashName.includes('/') || journal.trashName.includes('\\')) {
    throw invalidSkillRemovalJournal('Skill 删除日志路径无效')
  }
  return journal
}

async function recoverSkillRemoval(root) {
  const journalPath = join(root, SKILL_REMOVAL_JOURNAL)
  let journal
  try {
    journal = await readSkillRemovalJournal(root)
  } catch (error) {
    if (!hasCode(error, 'invalid-skill-removal-journal')) throw error
    await quarantineSkillRemovalJournal(root)
    journal = undefined
  }
  if (journal !== undefined) {
    const target = join(root, journal.directoryName)
    const trash = join(root, journal.trashName)
    const targetInfo = await lstat(target).catch(error => {
      if (hasCode(error, 'ENOENT')) return undefined
      throw error
    })
    const trashInfo = await lstat(trash).catch(error => {
      if (hasCode(error, 'ENOENT')) return undefined
      throw error
    })
    if (trashInfo?.isSymbolicLink() || (trashInfo !== undefined && !trashInfo.isDirectory())) {
      // A malformed or user-created path must not become a recursive-delete
      // target. Quarantine only the journal; leave the referenced residue for
      // explicit inspection instead of blocking inventory forever.
      await quarantineSkillRemovalJournal(root)
      return
    }
    if (journal.phase === 'prepared' && targetInfo !== undefined && trashInfo === undefined) {
      await rm(journalPath, { force: true })
    } else {
      // Once the target has been atomically moved, never restore it: a crash may
      // have deleted part of the tree. Finish deleting the tombstone instead.
      if (trashInfo !== undefined) await rm(trash, { recursive: true, force: false })
      await rm(journalPath, { force: true })
    }
  }
  // Never infer deletion intent from a forgeable tombstone name. Without the
  // journal above, leave the directory untouched for explicit user cleanup;
  // silently deleting arbitrary `.remove-*` content would turn a recovery hint
  // into an untrusted deletion authority.
}

export async function removeManagedSkill(ctx, payload, signal) {
  if (!isRecord(payload) || typeof payload.directoryName !== 'string') throw new Error('skill.settings.remove requires directoryName')
  const name = validateSkillName(payload.directoryName)
  if (name === '.system') throw new Error('不能删除系统 Skill 目录')
  const root = managedSkillDirectory(ctx)
  await assertSafeDirectoryRoot(root, '用户 Skills 目录')
  return withProfilePatchLock(join(root, SKILL_MUTATION_LOCK_KEY), async () => {
    throwIfAborted(signal)
    await ensureSafeDirectoryRoot(root, '用户 Skills 目录')
    await recoverSkillRemoval(root)
    const target = resolve(root, name)
    assertContainedChild(root, target, 'Skill')
    const info = await lstat(target).catch(error => {
      if (hasCode(error, 'ENOENT')) return undefined
      throw error
    })
    if (info === undefined) throw new Error(`用户 Skill 不存在：${name}`)
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('只能删除非符号链接的用户 Skill 目录')
    const skillInfo = await lstat(join(target, 'SKILL.md')).catch(() => undefined)
    if (!skillInfo?.isFile() || skillInfo.isSymbolicLink()) throw new Error('目标目录不是可管理的用户 Skill')
    const content = await readFile(join(target, 'SKILL.md'), 'utf8')
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)?.[1]
    const skillName = frontmatter === undefined ? undefined : parseFrontmatterScalar(frontmatter, 'name')?.trim()
    if (!skillName) throw new Error('目标目录不是带有效 frontmatter 的用户 Skill')
    try {
      validateSkillName(skillName)
    } catch {
      throw new Error('目标目录不是带有效 frontmatter 的用户 Skill')
    }
    let registration
    try {
      registration = (await readManagedSkillRegistry(root)).entries.find(entry => entry.directoryName === name)
    } catch {
      throw new Error('无法验证 Deeptop 管理的 Skill 登记')
    }
    if (!await hasManagedSkillMarker(target, name, skillName, registration)) throw new Error('只能删除由 Deeptop 安装并登记的用户 Skill')
    await assertRemovableSkillTree(target)
    const trashName = `.remove-${name}-${randomUUID()}`
    const trash = join(root, trashName)
    let moved = false
    let removed = false
    let cleanupError
    try {
      // Persist intent before the atomic move. If the process dies after the
      // rename, the tombstone is deleted on the next inventory/retry pass and
      // is never presented as a restored, partially deleted Skill.
      await writeSkillRemovalJournal(root, {
        version: 1,
        directoryName: name,
        trashName,
        phase: 'prepared',
      })
      throwIfAborted(signal)
      await rename(target, trash)
      moved = true
      await writeSkillRemovalJournal(root, {
        version: 1,
        directoryName: name,
        trashName,
        phase: 'moved',
      })
      await rm(trash, { recursive: true, force: false })
      removed = true
      await rm(join(root, SKILL_REMOVAL_JOURNAL), { force: true })
      await removeManagedSkillRegistration(root, name, registration.installationId)
    } catch (error) {
      if (!moved) await rm(join(root, SKILL_REMOVAL_JOURNAL), { force: true }).catch(() => undefined)
      if (!removed) {
        // Once rename commits, do not restore the tree: deletion may already
        // have removed some descendants, and recovery must finish the tombstone
        // later. A failure after the trash was fully removed is already a
        // committed deletion and is reported below as a refresh error.
        throw error
      }
      cleanupError = error
    }
    try {
      const refreshed = await describeManagedSkillsUnlocked(ctx, root)
      return cleanupError === undefined
        ? { removed: true, skills: refreshed }
        : { removed: true, skills: refreshed, refreshError: errorSummary(cleanupError) }
    } catch (error) {
      // Filesystem deletion has committed. A refresh failure must not make the
      // caller retry an operation that could no longer be rolled back.
      return {
        removed: true,
        refreshError: errorSummary(cleanupError === undefined ? error : new Error(`${cleanupError.message}；${error.message}`)),
      }
    }
  }, signal)
}

function skillInstallMap(ctx) {
  if (!isRecord(ctx)) throw new Error('skill installation requires a Cordis context')
  let operations = activeSkillInstalls.get(ctx)
  if (operations === undefined) {
    operations = new Map()
    activeSkillInstalls.set(ctx, operations)
  }
  const expiry = Date.now() - 10 * 60_000
  for (const [id, operation] of operations) {
    if (operation.state.status !== 'running' && operation.updatedAt < expiry) operations.delete(id)
  }
  return operations
}

function installSignal(hostSignal, operationSignal) {
  return hostSignal === undefined ? operationSignal : AbortSignal.any([hostSignal, operationSignal])
}

function installFailure(error) {
  return {
    message: error instanceof Error ? error.message : String(error),
    ...(error instanceof Error && typeof error.code === 'string' ? { code: error.code } : {}),
    ...(error instanceof Error && error.details !== undefined ? { details: error.details } : {}),
  }
}

export function installManagedSkill(ctx, payload, hostSignal) {
  if (!isRecord(payload) || typeof payload.operationId !== 'string' || !OPERATION_ID.test(payload.operationId)) {
    throw new Error('skill.settings.install requires a valid operationId')
  }
  const operations = skillInstallMap(ctx)
  if (operations.has(payload.operationId)) throw new Error(`Skill 安装操作已存在：${payload.operationId}`)
  if ([...operations.values()].filter(operation => operation.state.status === 'running').length >= 4) {
    throw new Error('同时进行的 Skill 安装已达到上限')
  }
  const controller = new AbortController()
  const operation = {
    controller,
    state: { status: 'running' },
    committed: false,
    result: undefined,
    updatedAt: Date.now(),
  }
  operations.set(payload.operationId, operation)
  void (async () => {
    const installAbortSignal = installSignal(hostSignal, controller.signal)
    try {
      const result = await installSkillFromSource(payload, {
        dshHome: dshHome(ctx),
        signal: installAbortSignal,
        onCommit: committedResult => {
          operation.committed = true
          operation.result = committedResult
        },
      })
      operation.result = result
      try {
        operation.state = { status: 'completed', result, skills: await describeManagedSkills(ctx) }
      } catch (error) {
        // The filesystem rename has already committed. Keep the operation
        // successful even when a post-commit inventory refresh is unavailable.
        operation.state = { status: 'completed', result, refreshError: installFailure(error) }
      }
    } catch (error) {
      if (operation.committed && operation.result !== undefined) {
        operation.state = { status: 'completed', result: operation.result, refreshError: installFailure(error) }
      } else {
        operation.state = (controller.signal.aborted || installAbortSignal.aborted || hasCode(error, 'cancelled'))
          ? { status: 'cancelled' }
          : { status: 'failed', error: installFailure(error) }
      }
    } finally {
      operation.updatedAt = Date.now()
    }
  })()
  return { operationId: payload.operationId, status: 'running' }
}

export function managedSkillInstallStatus(ctx, payload) {
  if (!isRecord(payload) || typeof payload.operationId !== 'string' || !OPERATION_ID.test(payload.operationId)) {
    throw new Error('skill.settings.installStatus requires a valid operationId')
  }
  const operations = skillInstallMap(ctx)
  const operation = operations.get(payload.operationId)
  if (operation === undefined) return { operationId: payload.operationId, status: 'not-found' }
  return { operationId: payload.operationId, ...operation.state }
}

export function cancelManagedSkillInstall(ctx, payload) {
  if (!isRecord(payload) || typeof payload.operationId !== 'string' || !OPERATION_ID.test(payload.operationId)) {
    throw new Error('skill.settings.cancelInstall requires a valid operationId')
  }
  const operation = skillInstallMap(ctx).get(payload.operationId)
  if (operation === undefined || operation.state.status !== 'running') return { cancelled: false }
  operation.controller.abort(new Error('Skill 安装已取消'))
  return { cancelled: true }
}

function assertKnownFields(value, allowed, label) {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) throw new Error(`${label} 包含未知字段：${field}`)
  }
}

function stringValue(value, label, { max = 4096, empty = false, trim = true, allowLineBreak = false } = {}) {
  if (typeof value !== 'string') throw new Error(`${label} 必须是字符串`)
  const result = trim ? value.trim() : value
  if (!empty && !result) throw new Error(`${label} 不能为空`)
  if (result.length > max || result.includes('\0') || (!allowLineBreak && /[\r\n]/.test(result))) throw new Error(`${label} 无效或过长`)
  return result
}

function optionalString(value, label, max = 4096, trim = true) {
  if (value === undefined || value === '') return undefined
  return stringValue(value, label, { max, trim })
}

function boundedInteger(value, label, fallback, min, max) {
  const resolved = value === undefined ? fallback : value
  if (!Number.isInteger(resolved) || resolved < min || resolved > max) {
    throw new Error(`${label} 必须是 ${min}–${max} 之间的整数`)
  }
  return resolved
}

function normalizeBindings(value, kind, label) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 128) throw new Error(`${label} 必须是至多 128 项的数组`)
  const names = new Set()
  const normalized = []
  value.forEach((binding, index) => {
    const itemLabel = `${label}[${index}]`
    if (!isRecord(binding)) throw new Error(`${itemLabel} 必须是对象`)
    assertKnownFields(binding, BINDING_FIELDS, itemLabel)
    const name = stringValue(binding.name, `${itemLabel}.name`, { max: 256 })
    const validName = kind === 'env' ? ENVIRONMENT_NAME.test(name) : HTTP_HEADER_NAME.test(name)
    if (!validName) throw new Error(`${itemLabel}.name 格式无效`)
    const dedupeName = kind === 'headers' ? name.toLowerCase() : name
    if (names.has(dedupeName)) throw new Error(`${label} 包含重复名称：${name}`)
    names.add(dedupeName)
    if (binding.source !== 'literal' && binding.source !== 'env') throw new Error(`${itemLabel}.source 必须是 literal 或 env`)
    if (binding.redacted !== undefined && typeof binding.redacted !== 'boolean') throw new Error(`${itemLabel}.redacted 必须是 boolean`)
    if (binding.clearSecret !== undefined && typeof binding.clearSecret !== 'boolean') throw new Error(`${itemLabel}.clearSecret 必须是 boolean`)
    const clearSecret = binding.clearSecret === true
    if (clearSecret) {
      if (kind !== 'headers' && kind !== 'env') throw new Error(`${itemLabel}.clearSecret 仅适用于 MCP 值`)
      if (binding.source !== 'literal' || binding.value !== '' || (binding.redacted !== undefined && binding.redacted !== true)) {
        throw new Error(`${itemLabel}.clearSecret 只能用于清除 literal 值`)
      }
      // The clear marker is a renderer-only operation instruction. It must not
      // become an empty literal in the persisted MCP config.
      return
    }
    const redacted = binding.redacted === true
    if (redacted && binding.source !== 'literal') throw new Error(`${itemLabel}.redacted 只能用于 literal 值`)
    const valueText = redacted
      ? stringValue(binding.value, `${itemLabel}.value`, { max: 8192, empty: true, trim: false })
      : stringValue(binding.value, `${itemLabel}.value`, { max: 8192, trim: binding.source === 'env', allowLineBreak: false })
    if (!redacted && binding.source === 'env' && !ENVIRONMENT_NAME.test(valueText)) {
      throw new Error(`${itemLabel}.value 必须是宿主环境变量名`)
    }
    if (!redacted && binding.source === 'literal' && !valueText.trim()) throw new Error(`${itemLabel}.value 不能为空`)
    const prefix = binding.source === 'env' ? optionalString(binding.prefix, `${itemLabel}.prefix`, 512, false) : undefined
    normalized.push({
      name,
      source: binding.source,
      value: valueText,
      ...(prefix === undefined ? {} : { prefix }),
    })
  })
  return normalized
}

function normalizeReconnect(value, label) {
  if (value !== undefined && !isRecord(value)) throw new Error(`${label} 必须是对象`)
  const reconnect = value ?? {}
  assertKnownFields(reconnect, RECONNECT_FIELDS, label)
  const enabled = reconnect.enabled === undefined ? DEFAULT_RECONNECT.enabled : reconnect.enabled
  if (typeof enabled !== 'boolean') throw new Error(`${label}.enabled 必须是 boolean`)
  const initialDelayMs = boundedInteger(reconnect.initialDelayMs, `${label}.initialDelayMs`, DEFAULT_RECONNECT.initialDelayMs, 1, 300_000)
  const maxDelayMs = boundedInteger(reconnect.maxDelayMs, `${label}.maxDelayMs`, DEFAULT_RECONNECT.maxDelayMs, 1, 300_000)
  if (maxDelayMs < initialDelayMs) throw new Error(`${label}.maxDelayMs 不能小于 initialDelayMs`)
  return {
    enabled,
    initialDelayMs,
    maxDelayMs,
    maxAttempts: boundedInteger(reconnect.maxAttempts, `${label}.maxAttempts`, DEFAULT_RECONNECT.maxAttempts, 1, 100),
  }
}

function normalizeArgs(value, label) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 128) throw new Error(`${label} 必须是至多 128 项的字符串数组`)
  return value.map((argument, index) => stringValue(argument, `${label}[${index}]`, { max: 8192, empty: true, trim: false, allowLineBreak: false }))
}

function normalizeMcpServer(server, index) {
  const label = `servers[${index}]`
  if (!isRecord(server)) throw new Error(`${label} 必须是对象`)
  assertKnownFields(server, SERVER_FIELDS, label)
  const id = stringValue(server.id, `${label}.id`, { max: 32 })
  if (!SERVER_ID.test(id)) throw new Error(`${label}.id 格式无效`)
  const serverName = stringValue(server.serverName, `${label}.serverName`, { max: 32 })
  if (!SERVER_NAME.test(serverName)) throw new Error(`${label}.serverName 格式无效`)
  if (server.transport !== 'stdio' && server.transport !== 'streamable-http') {
    throw new Error(`${label}.transport 必须是 stdio 或 streamable-http`)
  }
  const enabled = server.enabled === undefined ? true : server.enabled
  if (typeof enabled !== 'boolean') throw new Error(`${label}.enabled 必须是 boolean`)
  const common = {
    id,
    serverName,
    transport: server.transport,
    enabled,
    toolCallTimeoutMs: boundedInteger(server.toolCallTimeoutMs, `${label}.toolCallTimeoutMs`, 60_000, 100, 300_000),
    reconnect: normalizeReconnect(server.reconnect, `${label}.reconnect`),
  }
  if (server.transport === 'stdio') {
    const cwd = optionalString(server.cwd, `${label}.cwd`, 4096)
    return {
      ...common,
      command: stringValue(server.command, `${label}.command`, { max: 2048 }),
      args: normalizeArgs(server.args, `${label}.args`),
      ...(cwd === undefined ? {} : { cwd }),
      env: normalizeBindings(server.env, 'env', `${label}.env`),
    }
  }
  const urlText = stringValue(server.url, `${label}.url`, { max: 4096 })
  let parsedUrl
  try {
    parsedUrl = new URL(urlText)
  } catch {
    throw new Error(`${label}.url 必须是有效 URL`)
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) {
    throw new Error(`${label}.url 必须是不含凭据的 HTTP(S) URL`)
  }
  return {
    ...common,
    url: parsedUrl.toString(),
    headers: normalizeBindings(server.headers, 'headers', `${label}.headers`),
  }
}

export function normalizeMcpServers(value, { preserveSecretsFrom } = {}) {
  if (!Array.isArray(value) || value.length > 64) throw new Error('MCP servers 必须是至多 64 项的数组')
  const ids = new Set()
  const names = new Set()
  return value.map((server, index) => {
    const sourceServer = preserveSecretsFrom?.find(item => item.id === server?.id)
    const input = isRecord(server) ? { ...server } : server
    if (isRecord(input) && Array.isArray(input.env)) {
      input.env = input.env.map(binding => {
        if (!isRecord(binding) || binding.clearSecret === true || binding.redacted !== true || binding.source !== 'literal' || binding.value !== '') return binding
        const stored = sourceServer?.env?.find(item => item.name === binding.name && item.source === 'literal')
        if (!stored) throw new Error(`无法保留 ${server.id} 的敏感环境值：${binding.name}`)
        return { ...binding, value: stored.value, redacted: undefined }
      })
    }
    if (isRecord(input) && Array.isArray(input.headers)) {
      input.headers = input.headers.map(binding => {
        if (!isRecord(binding) || binding.clearSecret === true || binding.redacted !== true || binding.source !== 'literal' || binding.value !== '') return binding
        const stored = sourceServer?.headers?.find(item => item.name.toLowerCase() === binding.name.toLowerCase() && item.source === 'literal')
        if (!stored) throw new Error(`无法保留 ${server.id} 的敏感请求头值：${binding.name}`)
        return { ...binding, value: stored.value, redacted: undefined }
      })
    }
    const normalized = normalizeMcpServer(input, index)
    if (ids.has(normalized.id)) throw new Error(`MCP server id 重复：${normalized.id}`)
    if (names.has(normalized.serverName)) throw new Error(`MCP serverName 重复：${normalized.serverName}`)
    ids.add(normalized.id)
    names.add(normalized.serverName)
    return normalized
  })
}

function redactMcpServers(servers) {
  return servers.map(server => ({
    ...server,
    ...(server.env ? { env: server.env.map(binding => binding.source === 'literal' ? { ...binding, value: '', redacted: true } : { ...binding }) } : {}),
    ...(server.headers ? { headers: server.headers.map(binding => binding.source === 'literal' ? { ...binding, value: '', redacted: true } : { ...binding }) } : {}),
  }))
}

function nativeMcpServerForEntry(entry) {
  const options = entry?.options
  if (!isRecord(options)
    || options.name !== MCP_CLIENT_PACKAGE
    || typeof options.id !== 'string'
    || options.id.startsWith(MANAGED_MCP_ENTRY_PREFIX)) return undefined
  // The Loader has already applied all Profile layers to options. Keep only
  // literal scalar fields so rendering neither evaluates nor exposes !!js.
  const config = isRecord(options.config) ? options.config : {}
  const entryId = typeof entry.id === 'string' ? entry.id : options.id
  return {
    entryId,
    ...(typeof config.serverName === 'string' && SERVER_NAME.test(config.serverName) ? { serverName: config.serverName } : {}),
    ...(config.transport === 'stdio' || config.transport === 'streamable-http' ? { transport: config.transport } : {}),
  }
}

/** Project effective native DSH MCP entries without exposing their configuration values. */
export function describeNativeMcpServers(ctx) {
  const loader = ctx?.get?.('loader')
  if (!loader || typeof loader.entries !== 'function') return []
  const seen = new Set()
  const servers = []
  for (const entry of loader.entries()) {
    const server = nativeMcpServerForEntry(entry)
    if (!server || seen.has(server.entryId)) continue
    seen.add(server.entryId)
    servers.push(server)
  }
  return servers
}

function activeNativeMcpServerNames(ctx) {
  const loader = ctx?.get?.('loader')
  if (!loader || typeof loader.entries !== 'function') return new Set()
  const names = new Set()
  for (const entry of loader.entries()) {
    if (entry?.options?.disabled === true || nativeMcpServerForEntry(entry) === undefined) continue
    const resolvedName = entry?.fiber?.config?.serverName
    const serverName = typeof resolvedName === 'string' ? resolvedName : entry?.options?.config?.serverName
    if (typeof serverName === 'string' && SERVER_NAME.test(serverName)) names.add(serverName)
  }
  return names
}

function assertNativeMcpNamesAvailable(ctx, servers) {
  const names = activeNativeMcpServerNames(ctx)
  for (const server of servers) {
    if (!server.enabled || !names.has(server.serverName)) continue
    const error = new Error(`MCP serverName 与原生 DSH 配置重复：${server.serverName}`)
    error.code = 'native-conflict'
    throw error
  }
}

function quoteYaml(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function environmentExpression(binding) {
  const variable = JSON.stringify(binding.value)
  const prefix = JSON.stringify(binding.prefix ?? '')
  const expression = `(() => ${prefix} + (process.env[${variable}] ?? ""))()`
  return `!!js ${quoteYaml(expression)}`
}

function bindingValue(binding) {
  return binding.source === 'env' ? environmentExpression(binding) : quoteYaml(binding.value)
}

function appendBindingMap(lines, indent, field, bindings) {
  if (bindings.length === 0) {
    lines.push(`${indent}${field}: {}`)
    return
  }
  lines.push(`${indent}${field}:`)
  for (const binding of bindings) lines.push(`${indent}  ${quoteYaml(binding.name)}: ${bindingValue(binding)}`)
}

function appendReconnect(lines, indent, reconnect) {
  lines.push(`${indent}reconnect:`)
  lines.push(`${indent}  enabled: ${reconnect.enabled}`)
  lines.push(`${indent}  initialDelayMs: ${reconnect.initialDelayMs}`)
  lines.push(`${indent}  maxDelayMs: ${reconnect.maxDelayMs}`)
  lines.push(`${indent}  maxAttempts: ${reconnect.maxAttempts}`)
}

export function renderManagedMcpBlock(servers) {
  const lines = [MCP_PATCH_START]
  const enabled = servers.filter(server => server.enabled)
  if (enabled.length === 0) {
    lines.push('# No MCP servers are enabled in Deeptop.')
  } else {
    lines.push('- insert:')
    for (const server of enabled) {
      lines.push(`    - id: deeptop-mcp-${server.id}`)
      lines.push("      name: '@deepseek-ai/dsh-mcp-client'")
      lines.push('      config:')
      lines.push(`        serverName: ${quoteYaml(server.serverName)}`)
      lines.push(`        transport: ${quoteYaml(server.transport)}`)
      if (server.transport === 'stdio') {
        lines.push(`        command: ${quoteYaml(server.command)}`)
        lines.push(`        args: ${JSON.stringify(server.args)}`)
        appendBindingMap(lines, '        ', 'env', server.env)
        if (server.cwd !== undefined) lines.push(`        cwd: ${quoteYaml(server.cwd)}`)
      } else {
        lines.push(`        url: ${quoteYaml(server.url)}`)
        appendBindingMap(lines, '        ', 'headers', server.headers)
      }
      lines.push(`        toolCallTimeoutMs: ${server.toolCallTimeoutMs}`)
      lines.push('        failOnStartupError: false')
      appendReconnect(lines, '        ', server.reconnect)
    }
  }
  lines.push(MCP_PATCH_END)
  return lines.join('\n')
}

export function mergeManagedMcpBlock(current, managed) {
  const block = locateManagedBlock(current, MCP_PATCH_START, MCP_PATCH_END, 'desktop Profile 中的 MCP 受管配置')
  const merged = block === null
    ? `${current.trimEnd()}${current.trim() ? '\n\n' : ''}${managed}\n`
    : `${current.slice(0, block.start)}${managed}${current.slice(block.end)}`
  return normalizeProfilePatchDocument(merged)
}

function defaultMcpConfig() {
  return { version: MCP_CONFIG_VERSION, revision: 0, servers: [] }
}

async function readMcpConfig(ctx) {
  const path = mcpConfigPath(ctx)
  await assertSafeDirectoryRoot(dirname(path), 'desktop Profile 目录')
  const file = await readOptionalText(path).catch(error => {
    throw new Error(`无法读取 Deeptop MCP 配置：${error.message}`)
  })
  if (!file.exists) return defaultMcpConfig()
  let parsed
  try {
    parsed = JSON.parse(file.content)
  } catch (error) {
    throw new Error(`无法读取 Deeptop MCP 配置：${error.message}`)
  }
  if (!isRecord(parsed) || parsed.version !== MCP_CONFIG_VERSION || !Number.isSafeInteger(parsed.revision) || parsed.revision < 0 || parsed.revision > 2_147_483_647) {
    throw new Error('Deeptop MCP 配置格式无效')
  }
  return { version: MCP_CONFIG_VERSION, revision: parsed.revision, servers: normalizeMcpServers(parsed.servers) }
}

async function readOptionalText(path) {
  const info = await lstat(path).catch(error => {
    if (hasCode(error, 'ENOENT')) return undefined
    throw error
  })
  if (info?.isSymbolicLink()) throw new Error(`配置文件不能是符号链接：${path}`)
  if (info !== undefined && !info.isFile()) throw new Error(`配置路径必须是普通文件：${path}`)
  if (info === undefined) return { exists: false, content: '' }
  return { exists: true, content: await readFile(path, 'utf8') }
}

async function writeTemp(path, content) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const temp = `${path}.tmp-${process.pid}-${randomUUID()}`
    let handle
    try {
      handle = await open(temp, 'wx', 0o600)
      await handle.writeFile(content, 'utf8')
      await handle.close()
      return temp
    } catch (error) {
      await handle?.close().catch(() => undefined)
      await rm(temp, { force: true }).catch(() => undefined)
      if (error?.code !== 'EEXIST' || attempt === 4) throw error
    }
  }
  throw new Error('无法创建安全的临时配置文件')
}

async function restoreText(path, previous) {
  if (!previous.exists) {
    await rm(path, { force: true })
    return
  }
  const rollback = await writeTemp(path, previous.content)
  let published = false
  try {
    await rename(rollback, path)
    published = true
  } finally {
    if (!published) await rm(rollback, { force: true }).catch(() => undefined)
  }
}

async function writeMcpTransaction(ctx, config, patchContent) {
  const configPath = mcpConfigPath(ctx)
  const patchPath = profilePatchPath(ctx)
  await ensureSafeDirectoryRoot(dirname(configPath), 'desktop Profile 目录')
  const previousConfig = await readOptionalText(configPath)
  const previousPatch = await readOptionalText(patchPath)
  let configTemp
  let patchTemp
  try {
    configTemp = await writeTemp(configPath, `${JSON.stringify(config, null, 2)}\n`)
    patchTemp = await writeTemp(patchPath, patchContent)
  } catch (error) {
    await rm(configTemp, { force: true }).catch(() => undefined)
    await rm(patchTemp, { force: true }).catch(() => undefined)
    throw error
  }
  let configPublished = false
  let patchPublished = false
  try {
    await rename(configTemp, configPath)
    configPublished = true
    await chmod(configPath, 0o600).catch(error => {
      if (process.platform !== 'win32') throw error
    })
    await rename(patchTemp, patchPath)
    patchPublished = true
  } catch (error) {
    await rm(configTemp, { force: true }).catch(() => undefined)
    await rm(patchTemp, { force: true }).catch(() => undefined)
    try {
      // Restore in reverse publication order so a failed two-file update does
      // not leave the Profile patch and JSON manifest describing different
      // revisions.
      if (patchPublished) await restoreText(patchPath, previousPatch)
      if (configPublished) await restoreText(configPath, previousConfig)
    } catch (rollbackError) {
      throw new Error(`MCP 配置写入失败且回滚失败：${error.message}；${rollbackError.message}`)
    }
    throw error
  }
}

export async function describeMcpSettings(ctx) {
  const config = await readMcpConfig(ctx)
  return {
    revision: config.revision,
    path: mcpConfigPath(ctx),
    servers: redactMcpServers(config.servers),
    nativeServers: describeNativeMcpServers(ctx),
  }
}

export async function describeToolSettings(ctx) {
  const [skills, mcp] = await Promise.all([describeManagedSkills(ctx), describeMcpSettings(ctx)])
  return { skills, mcp }
}

export async function mutateMcpSettings(ctx, payload, signal) {
  if (!isRecord(payload) || !Array.isArray(payload.servers) || !Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision < 0 || payload.expectedRevision > 2_147_483_647) {
    const error = new Error('mcp.settings.mutate requires a safe expectedRevision and servers')
    error.code = 'invalid-payload'
    throw error
  }
  const patchPath = profilePatchPath(ctx)
  return withProfilePatchLock(patchPath, async () => {
    throwIfAborted(signal)
    const current = await readMcpConfig(ctx)
    if (payload.expectedRevision !== undefined && payload.expectedRevision !== current.revision) {
      const error = new Error(`MCP 配置已被其他操作更新，请刷新后重试（当前 revision ${current.revision}）`)
      error.code = 'revision-conflict'
      error.details = { revision: current.revision }
      throw error
    }
    const servers = normalizeMcpServers(payload.servers, { preserveSecretsFrom: current.servers })
    assertNativeMcpNamesAvailable(ctx, servers)
    if (JSON.stringify(servers) === JSON.stringify(current.servers)) {
      return {
        ...(await describeToolSettings(ctx)),
        changed: false,
        restartRequired: false,
        newSessionRequired: false,
      }
    }
    if (current.revision >= 2_147_483_647) {
      const error = new Error('MCP 配置 revision 已达到上限')
      error.code = 'revision-limit'
      throw error
    }
    const next = { version: MCP_CONFIG_VERSION, revision: current.revision + 1, servers }
    const currentPatch = await readOptionalText(patchPath)
    const nextPatch = mergeManagedMcpBlock(currentPatch.content, renderManagedMcpBlock(servers))
    await writeMcpTransaction(ctx, next, nextPatch)
    return {
      ...(await describeToolSettings(ctx)),
      changed: true,
      restartRequired: false,
      newSessionRequired: true,
    }
  }, signal)
}

export async function ensureManagedSkillDirectory(ctx) {
  const directory = managedSkillDirectory(ctx)
  await ensureSafeDirectoryRoot(directory, '用户 Skills 目录')
  return directory
}
