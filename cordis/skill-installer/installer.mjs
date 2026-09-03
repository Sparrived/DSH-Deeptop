import { copyFile, lstat, mkdir, mkdtemp, open, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { inflateRawSync } from 'node:zlib'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { withProfilePatchLock } from '../desktop-bridge/profile-patch.mjs'
import { registerManagedSkill, removeManagedSkillRegistration } from './managed-registry.mjs'

const execFileAsync = promisify(execFile)
const DEFAULT_REF = 'main'
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024
const MAX_ARCHIVE_ENTRIES = 20_000
const MAX_EXPANDED_ARCHIVE_BYTES = 512 * 1024 * 1024
const COMMAND_TIMEOUT_MS = 120_000
export const SKILL_MUTATION_LOCK_KEY = '.dsh-skill-install'
export const MANAGED_SKILL_MARKER = '.dsh-managed-skill.json'
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export class SkillInstallError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'SkillInstallError'
    this.status = options.status
    this.code = options.code
  }
}

function abortIfNeeded(signal) {
  if (signal?.aborted) throw new SkillInstallError('Skill 安装已取消', { code: 'cancelled' })
}

function isAbortError(error, signal) {
  return signal?.aborted || error?.name === 'AbortError' || error?.code === 'ABORT_ERR'
}

export function validateGitRef(value) {
  const ref = String(value ?? '').trim()
  const parts = ref.split('/')
  if (!ref || ref.length > 512
    || /[\u0000-\u001f\u007f]/.test(ref)
    || ref === '@'
    || ref.startsWith('-')
    || ref.startsWith('+')
     || ref.startsWith('/')
    || ref.endsWith('/')
    || ref.endsWith('.')
    || ref.includes('..')
    || ref.includes('//')
    || ref.includes('@{')
    || ref.split('').some(character => ' ~^:?*[\\\\]'.includes(character))
    || parts.some(part => part === '' || part.startsWith('.') || part.endsWith('.lock') || part === '@')) {
    throw new SkillInstallError('GitHub ref 无效', { code: 'invalid-ref' })
  }
  return ref
}

/**
 * The approval gate for one Skill install, folded from the session's durable
 * `approval/policy` events and the approval service's configured default.
 *
 * - `'ask'` — prompt through the approval service (per-session consent).
 * - `'skip'` — the user's own `'never'` policy (e.g. the danger-full-access
 *   preset) already records global consent, so installs proceed without a
 *   one-shot prompt.
 * - `'reject'` — a delegation-pinned `'never'` must not install unattended;
 *   deterministic rejection keeps the delegated child inside its scope.
 *
 * The last event wins; an event without `source: 'delegation'` is a runtime or
 * initialization switch, i.e. user intent.
 * @param events - the agent session's durable events in log order.
 * @param defaultPolicy - the approval service's configured policy when the
 *   log records no override.
 * @returns the gate decision for this install.
 */
export function skillInstallGate(events, defaultPolicy) {
  let policy
  let delegated = false
  for (const event of events ?? []) {
    if (event?.type !== 'approval/policy') continue
    policy = event.data?.policy
    delegated = event.data?.source === 'delegation'
  }
  const effective = policy ?? defaultPolicy ?? 'ask'
  if (effective === 'never') return delegated ? 'reject' : 'skip'
  return 'ask'
}

function githubHeaders(accept = 'application/vnd.github+json') {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  return {
    accept,
    'user-agent': 'dsh-skill-installer',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  }
}

function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment)
  } catch {
    throw new SkillInstallError('GitHub URL 包含无效编码')
  }
}

function validateRepositoryPart(value, label) {
  if (!/^[A-Za-z0-9_.-]+$/.test(value) || value === '.' || value === '..') {
    throw new SkillInstallError(`GitHub ${label} 无效`)
  }
  return value
}

function hasExplicitUrlPort(raw) {
  if (!raw.includes('://')) return false
  const authority = raw.slice(raw.indexOf('://') + 3).split(/[/?#]/, 1)[0]
  const host = authority.slice(authority.lastIndexOf('@') + 1)
  return host.startsWith('[') ? host.includes(']:') : host.lastIndexOf(':') > -1
}

export function validateRelativeRepoPath(value, label = 'Skill path') {
  const raw = String(value ?? '').replaceAll('\\', '/')
  if (raw === '.') return raw
  if (isAbsolute(raw) || raw.startsWith('/') || /^[A-Za-z]:/.test(raw)
    || /[\u0000-\u001f\u007f*?\[\]]/.test(raw)) {
    throw new SkillInstallError(`${label} 必须是仓库内的不含 glob 的相对路径`)
  }
  if (raw.startsWith('/') || raw.endsWith('/')) throw new SkillInstallError(`${label} 必须是仓库内的相对路径`)
  const parts = raw.split('/')
  if (parts.length === 0 || parts.some(part => part === '' || part === '.' || part === '..')) {
    throw new SkillInstallError(`${label} 必须是仓库内的相对路径`)
  }
  return parts.join('/')
}

export function validateSkillName(value) {
  const name = String(value ?? '').trim()
  if (!SKILL_NAME.test(name)) throw new SkillInstallError(`Skill name 无效：${name || '(empty)'}`)
  return name
}

export function selectSkillPath(candidates, repo) {
  const preferred = candidates.filter(path => path.split('/').at(-1)?.toLowerCase() === repo.toLowerCase())
  // Prefer the source skill tree over generated adapter copies.
  const canonicalRoots = [`skills/${repo}`, `.openclaw/skills/${repo}`].map(path => path.toLowerCase())
  for (const root of canonicalRoots) {
    const matches = preferred.filter(path => path.toLowerCase() === root)
    if (matches.length === 1) return matches[0]
    if (matches.length > 1) return undefined
  }
  if (preferred.length === 1) return preferred[0]
  return preferred.length === 0 && candidates.length === 1 ? candidates[0] : undefined
}

export function parseGitHubSource(input) {
  if (!input || typeof input.source !== 'string' || input.source.trim() === '') {
    throw new SkillInstallError('skill.install 需要 source')
  }

  const raw = input.source.trim()
  let url
  try {
    url = raw.includes('://') ? new URL(raw) : new URL(`https://github.com/${raw}`)
  } catch {
    throw new SkillInstallError('GitHub URL 无效')
  }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com'
    || url.username || url.password || url.port || hasExplicitUrlPort(raw)
    || url.search || url.hash || raw.includes('?') || raw.includes('#')) {
    throw new SkillInstallError('只支持 HTTPS GitHub 地址：地址不得包含用户信息、端口、查询参数或片段')
  }

  const rawParts = url.pathname.split('/').filter(Boolean)
  const parts = rawParts.map(decodeSegment)
  if (parts.length < 2) throw new SkillInstallError('GitHub URL 缺少 owner/repo')
  const owner = validateRepositoryPart(parts[0], 'owner')
  const repo = validateRepositoryPart(parts[1].replace(/\.git$/i, ''), 'repo')
  const requestedRef = input.ref === undefined ? undefined : String(input.ref).trim()
  if (requestedRef !== undefined && requestedRef === '') throw new SkillInstallError('GitHub ref 不能为空')
  let ref
  let urlPath
  if (parts[2] === 'tree' || parts[2] === 'blob') {
    if (parts.length < 4) throw new SkillInstallError('GitHub URL 缺少 ref 或路径')
    if (parts[2] === 'blob') throw new SkillInstallError('GitHub Skill 地址必须指向目录，而不是单个文件')
    if (requestedRef !== undefined) {
      const requestedParts = requestedRef.split('/')
      const encodedRefAtUrl = parts[3]
      const matchesEncodedRef = encodedRefAtUrl === requestedRef && /%2f/i.test(rawParts[3] ?? '')
      const urlRefParts = parts.slice(3, 3 + requestedParts.length)
      const matchesSegmentedRef = requestedParts.length > 0
        && requestedParts.every((part, index) => urlRefParts[index] === part)
      const matchesUrlRef = matchesEncodedRef || matchesSegmentedRef
      if (!matchesUrlRef && input.path === undefined) {
        throw new SkillInstallError('GitHub URL 的 ref 与输入 ref 不一致；请同时填写正确的 path')
      }
      ref = requestedRef
      urlPath = matchesEncodedRef
        ? parts.slice(4).join('/')
        : matchesSegmentedRef ? parts.slice(3 + requestedParts.length).join('/') : undefined
    } else {
      ref = parts[3]
      urlPath = parts.slice(4).join('/')
      // An unencoded slash after `tree/feature` is ambiguous: it may be the
      // remainder of a `feature/foo` branch, or the first directory segment.
      // Keep the common default refs convenient, but reject other ambiguous
      // URLs instead of silently recording the wrong ref/path pair.
      const hasUnencodedRefSlash = !/%2f/i.test(rawParts[3] ?? '') && parts.length > 4
      if (hasUnencodedRefSlash && !new Set(['main', 'master', 'develop', 'trunk']).has(parts[3])) {
        throw new SkillInstallError('GitHub tree URL 的分支包含未编码斜杠；请填写 ref 与 path，或将分支斜杠编码为 %2F')
      }
    }
  } else {
    urlPath = parts.slice(2).join('/')
    ref = requestedRef
  }
  ref = validateGitRef(ref || DEFAULT_REF)
  const path = input.path === undefined ? (urlPath ? validateRelativeRepoPath(urlPath) : undefined) : validateRelativeRepoPath(input.path)
  return {
    owner,
    repo,
    ref,
    path,
  }
}

function canonicalSource(source) {
  const path = source.path && source.path !== '.'
    ? `/${source.path.split('/').map(segment => encodeURIComponent(segment)).join('/')}`
    : ''
  return `https://github.com/${source.owner}/${source.repo}/tree/${encodeURIComponent(source.ref)}${path}`
}

async function githubJson(url, signal) {
  abortIfNeeded(signal)
  let response
  try {
    response = await fetch(url, { headers: githubHeaders(), signal })
  } catch (error) {
    if (isAbortError(error, signal)) throw new SkillInstallError('Skill 安装已取消', { code: 'cancelled' })
    throw new SkillInstallError(`访问 GitHub API 失败：${error instanceof Error ? error.message : String(error)}`, { code: 'network-error' })
  }
  if (!response.ok) {
    throw new SkillInstallError(`GitHub API 返回 HTTP ${response.status}`, { status: response.status, code: 'http-error' })
  }
  try {
    const bytes = await readResponseBytes(response, MAX_GITHUB_JSON_BYTES, signal)
    return JSON.parse(bytes.toString('utf8'))
  } catch (error) {
    if (error instanceof SkillInstallError) throw error
    throw new SkillInstallError(`GitHub API 响应无效：${error instanceof Error ? error.message : String(error)}`)
  }
}

async function discoverSkillPath(source, signal) {
  const tree = await githubJson(`https://api.github.com/repos/${source.owner}/${source.repo}/git/trees/${encodeURIComponent(source.ref)}?recursive=1`, signal)
  if (tree?.truncated === true) {
    throw new SkillInstallError('GitHub 仓库目录过大，无法安全确定 Skill 路径', { code: 'archive-limit' })
  }
  const candidates = Array.isArray(tree?.tree)
    ? tree.tree
      .filter(entry => entry?.type === 'blob' && typeof entry.path === 'string' && /(?:^|\/)SKILL\.md$/i.test(entry.path))
      .map(entry => entry.path.replace(/^SKILL\.md$/i, '.').replace(/\/SKILL\.md$/i, ''))
      .filter(Boolean)
    : []
  const selected = selectSkillPath(candidates, source.repo)
  if (selected) return selected
  if (candidates.length === 0) throw new SkillInstallError(`仓库中没有找到 SKILL.md：${source.owner}/${source.repo}`)
  const shown = candidates.slice(0, 12).join(', ')
  throw new SkillInstallError(`GitHub 仓库包含多个 Skill，请指定 path；候选路径：${shown}`)
}

function gitCommandEnvironment() {
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1' }
  // Git URL rewrite rules (`url.*.insteadOf`) are configuration, not shell
  // syntax. Disable global/system/environment-injected config for the clone so
  // a GitHub source cannot silently resolve to a local or unrelated remote.
  env.GIT_CONFIG_GLOBAL = process.platform === 'win32' ? 'NUL' : '/dev/null'
  delete env.GIT_CONFIG_SYSTEM
  delete env.GIT_CONFIG_PARAMETERS
  delete env.GIT_CONFIG_COUNT
  for (const key of Object.keys(env)) {
    if (/^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(key)) delete env[key]
  }
  return env
}

async function runCommand(command, args, signal) {
  abortIfNeeded(signal)
  try {
    return await execFileAsync(command, args, {
      signal,
      maxBuffer: 16 * 1024 * 1024,
      timeout: COMMAND_TIMEOUT_MS,
      windowsHide: true,
      ...(command === 'git' ? { env: gitCommandEnvironment() } : {}),
    })
  } catch (error) {
    if (isAbortError(error, signal)) {
      throw new SkillInstallError('Skill 安装已取消', { code: 'cancelled' })
    }
    if (error?.code === 'ETIMEDOUT') throw new SkillInstallError(`${command} 执行超时`, { code: 'command-timeout' })
    const detail = error?.stderr?.trim() || error?.message || `${command} 执行失败`
    throw new SkillInstallError(detail, { code: 'command-error' })
  }
}

const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50
const ZIP_CENTRAL_FILE_SIGNATURE = 0x02014b50
const ZIP_END_SIGNATURE = 0x06054b50
const ZIP_MAX_PATH_BYTES = 4096
const MAX_ARCHIVE_FILE_BYTES = 128 * 1024 * 1024
const MAX_SKILL_FILES = 20_000
const MAX_SKILL_FILE_BYTES = 128 * 1024 * 1024
const MAX_SKILL_BYTES = 512 * 1024 * 1024
const MAX_GITHUB_JSON_BYTES = 16 * 1024 * 1024

function archiveEntryIsSafe(entry) {
  if (typeof entry !== 'string' || entry.includes('\\') || entry.includes('\0') || entry.length > ZIP_MAX_PATH_BYTES) return false
  const normalized = entry.replace(/\/+$/g, '')
  if (normalized === '' || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) return false
  const parts = normalized.split('/')
  return parts.every((part) => {
    if (part === '' || part === '.' || part === '..' || /[\u0000-\u001f\u007f:]/.test(part)) return false
    // These names are legal on POSIX but can resolve to devices or aliases on
    // Windows, so reject them for a cross-platform desktop archive format.
    if (/[ .]$/.test(part)) return false
    const device = part.replace(/[. ]+$/g, '').toUpperCase()
    return !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(device)
  })
}

function archiveEntryPath(entry) {
  return entry.replace(/\/+$/g, '')
}

function zipCanonicalPath(path) {
  return process.platform === 'win32' ? path.toLowerCase() : path
}

function zipCrc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function zipName(bytes, flags) {
  if ((flags & 0x800) === 0 && bytes.some(byte => byte > 0x7f)) {
    throw new SkillInstallError('GitHub 压缩包文件名必须使用 UTF-8', { code: 'archive-invalid' })
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new SkillInstallError('GitHub 压缩包包含无效 UTF-8 文件名', { code: 'archive-invalid' })
  }
}

function zipEntryIsSupported(entry) {
  const { versionMadeBy, externalAttributes, directory } = entry
  const creator = versionMadeBy >>> 8
  if (creator === 3) {
    const mode = externalAttributes >>> 16
    const type = mode & 0xf000
    if (directory) return type === 0 || type === 0x4000
    return type === 0 || type === 0x8000
  }
  if (directory) return true
  return (externalAttributes & 0x10) === 0
}

function findZipEnd(bytes) {
  const minimum = 22
  const maximum = Math.min(bytes.length, minimum + 0xffff)
  for (let offset = bytes.length - minimum; offset >= bytes.length - maximum; offset -= 1) {
    if (offset < 0 || bytes.readUInt32LE(offset) !== ZIP_END_SIGNATURE) continue
    const commentLength = bytes.readUInt16LE(offset + 20)
    if (offset + minimum + commentLength === bytes.length) return offset
  }
  throw new SkillInstallError('GitHub 压缩包缺少有效 ZIP 目录', { code: 'archive-invalid' })
}

function parseZipArchive(bytes) {
  if (bytes.length < 22) throw new SkillInstallError('GitHub 压缩包过小或格式无效', { code: 'archive-invalid' })
  const end = findZipEnd(bytes)
  const disk = bytes.readUInt16LE(end + 4)
  const centralDisk = bytes.readUInt16LE(end + 6)
  const entriesOnDisk = bytes.readUInt16LE(end + 8)
  const entryCount = bytes.readUInt16LE(end + 10)
  const centralSize = bytes.readUInt32LE(end + 12)
  const centralOffset = bytes.readUInt32LE(end + 16)
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount || entryCount === 0 || entryCount > MAX_ARCHIVE_ENTRIES
    || entriesOnDisk === 0xffff || entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff
    || centralOffset + centralSize > end) {
    throw new SkillInstallError('GitHub 压缩包 ZIP 目录无效或使用了不支持的 ZIP64 格式', { code: 'archive-invalid' })
  }
  const entries = []
  const paths = new Map()
  let cursor = centralOffset
  let expandedBytes = 0
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== ZIP_CENTRAL_FILE_SIGNATURE) {
      throw new SkillInstallError('GitHub 压缩包目录项无效', { code: 'archive-invalid' })
    }
    const versionMadeBy = bytes.readUInt16LE(cursor + 4)
    const flags = bytes.readUInt16LE(cursor + 8)
    const compression = bytes.readUInt16LE(cursor + 10)
    const crc = bytes.readUInt32LE(cursor + 16)
    const compressedSize = bytes.readUInt32LE(cursor + 20)
    const uncompressedSize = bytes.readUInt32LE(cursor + 24)
    const nameLength = bytes.readUInt16LE(cursor + 28)
    const extraLength = bytes.readUInt16LE(cursor + 30)
    const commentLength = bytes.readUInt16LE(cursor + 32)
    const externalAttributes = bytes.readUInt32LE(cursor + 38)
    const localOffset = bytes.readUInt32LE(cursor + 42)
    const nameStart = cursor + 46
    const nextCursor = nameStart + nameLength + extraLength + commentLength
    if (nextCursor > end || compressedSize > MAX_ARCHIVE_FILE_BYTES || uncompressedSize > MAX_ARCHIVE_FILE_BYTES) {
      throw new SkillInstallError('GitHub 压缩包单个文件超过 128 MB或目录项越界', { code: 'archive-limit' })
    }
    const rawName = bytes.subarray(nameStart, nameStart + nameLength)
    const name = zipName(rawName, flags)
    const directory = name.endsWith('/')
    // Only ordinary UTF-8 entries are accepted. In particular, do not trust
    // data-descriptor, encryption, patched-data, or reserved flag variants
    // whose local sizes/metadata can change the byte range we later extract.
    if ((flags & ~0x800) !== 0 || !archiveEntryIsSafe(name) || (compression !== 0 && compression !== 8) || !zipEntryIsSupported({ versionMadeBy, externalAttributes, directory })) {
      throw new SkillInstallError('GitHub 压缩包包含不支持的路径、链接或压缩类型', { code: 'archive-invalid' })
    }
    const path = archiveEntryPath(name)
    const canonicalPath = zipCanonicalPath(path)
    if (paths.has(canonicalPath)) throw new SkillInstallError('GitHub 压缩包包含重复或冲突的目录项', { code: 'archive-invalid' })
    // Reject both orderings of file/directory collisions. A central directory
    // is not required to list parents before children, so checking only already
    // seen parents would miss `root/file` followed by a file named `root`.
    for (const existingPath of paths.keys()) {
      if (existingPath.startsWith(`${canonicalPath}/`) && !directory) {
        throw new SkillInstallError('GitHub 压缩包包含冲突的文件路径', { code: 'archive-invalid' })
      }
    }
    const localHeaderSize = localOffset + 30
    if (localHeaderSize > centralOffset || bytes.readUInt32LE(localOffset) !== ZIP_LOCAL_FILE_SIGNATURE) {
      throw new SkillInstallError('GitHub 压缩包本地目录项无效', { code: 'archive-invalid' })
    }
    const localNameLength = bytes.readUInt16LE(localOffset + 26)
    const localExtraLength = bytes.readUInt16LE(localOffset + 28)
    const dataStart = localHeaderSize + localNameLength + localExtraLength
    const dataEnd = dataStart + compressedSize
    if (dataStart > centralOffset || dataEnd > centralOffset || dataEnd < dataStart) {
      throw new SkillInstallError('GitHub 压缩包数据范围无效', { code: 'archive-invalid' })
    }
    const localFlags = bytes.readUInt16LE(localOffset + 6)
    const localCompression = bytes.readUInt16LE(localOffset + 8)
    const localName = bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength)
    if (localFlags !== flags || localCompression !== compression || !localName.equals(rawName)) {
      throw new SkillInstallError('GitHub 压缩包本地目录与中央目录不一致', { code: 'archive-invalid' })
    }
    paths.set(canonicalPath, directory)
    const parts = path.split('/')
    for (let partIndex = 1; partIndex < parts.length; partIndex += 1) {
      const parent = zipCanonicalPath(parts.slice(0, partIndex).join('/'))
      if (paths.get(parent) === false) throw new SkillInstallError('GitHub 压缩包包含冲突的文件路径', { code: 'archive-invalid' })
    }
    expandedBytes += uncompressedSize
    if (!Number.isSafeInteger(expandedBytes) || expandedBytes > MAX_EXPANDED_ARCHIVE_BYTES) {
      throw new SkillInstallError('GitHub Skill 解压后超过 512 MB', { code: 'archive-limit' })
    }
    entries.push({ name, path, directory, compression, crc, compressedSize, uncompressedSize, dataStart, versionMadeBy, externalAttributes })
    cursor = nextCursor
  }
  if (cursor !== centralOffset + centralSize) throw new SkillInstallError('GitHub 压缩包中央目录长度无效', { code: 'archive-invalid' })
  const roots = [...new Set(entries.map(entry => entry.path.split('/')[0]).filter(Boolean))]
  if (roots.length !== 1) throw new SkillInstallError('GitHub 压缩包目录结构异常', { code: 'archive-invalid' })
  return { entries, root: roots[0] }
}

async function extractZipArchive(bytes, tempRoot, signal) {
  const archive = parseZipArchive(bytes)
  const directories = archive.entries.filter(entry => entry.directory).sort((left, right) => left.path.length - right.path.length)
  for (const entry of directories) {
    abortIfNeeded(signal)
    const target = resolve(tempRoot, ...entry.path.split('/'))
    ensureContained(tempRoot, target, '压缩包目录')
    await mkdir(target, { recursive: true })
  }
  for (const entry of archive.entries.filter(item => !item.directory)) {
    abortIfNeeded(signal)
    const target = resolve(tempRoot, ...entry.path.split('/'))
    ensureContained(tempRoot, target, '压缩包文件')
    await mkdir(dirname(target), { recursive: true })
    const compressed = bytes.subarray(entry.dataStart, entry.dataStart + entry.compressedSize)
    let content
    try {
      content = entry.compression === 0
        ? compressed
        : inflateRawSync(compressed, { maxOutputLength: MAX_ARCHIVE_FILE_BYTES })
    } catch (error) {
      throw new SkillInstallError(`GitHub 压缩包解压失败：${error instanceof Error ? error.message : String(error)}`, { code: 'archive-invalid' })
    }
    if (content.byteLength !== entry.uncompressedSize || zipCrc32(content) !== entry.crc) {
      throw new SkillInstallError('GitHub 压缩包文件校验失败', { code: 'archive-invalid' })
    }
    const handle = await open(target, 'wx', 0o600)
    try {
      await handle.writeFile(content)
    } finally {
      await handle.close()
    }
  }
  return join(tempRoot, archive.root)
}

async function readResponseBytes(response, maxBytes, signal) {
  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.byteLength > maxBytes) throw new SkillInstallError('GitHub 仓库压缩包超过 100 MB', { code: 'archive-limit' })
    return bytes
  }
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    for (;;) {
      abortIfNeeded(signal)
      const next = await reader.read()
      if (next.done) break
      const chunk = Buffer.from(next.value)
      total += chunk.byteLength
      if (total > maxBytes) throw new SkillInstallError('GitHub 仓库压缩包超过 100 MB', { code: 'archive-limit' })
      chunks.push(chunk)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  return Buffer.concat(chunks, total)
}

async function assertSafeDirectoryAncestors(path, label) {
  let current = resolve(path)
  for (;;) {
    const info = await lstat(current).catch(error => {
      if (error?.code === 'ENOENT') return undefined
      throw error
    })
    if (info?.isSymbolicLink()) throw new SkillInstallError(`${label} 及其父级不能是符号链接或 junction`)
    if (info !== undefined && !info.isDirectory()) throw new SkillInstallError(`${label} 必须是目录`)
    const parent = resolve(current, '..')
    if (parent === current) break
    current = parent
  }
}

async function ensureSafeDirectory(path, label) {
  await assertSafeDirectoryAncestors(path, label)
  await mkdir(path, { recursive: true })
  await assertSafeDirectoryAncestors(path, label)
}

async function downloadRepoArchive(source, tempRoot, signal) {
  const url = `https://codeload.github.com/${source.owner}/${source.repo}/zip/${encodeURIComponent(source.ref)}`
  let response
  try {
    response = await fetch(url, { headers: githubHeaders('application/zip'), signal })
  } catch (error) {
    if (error?.name === 'AbortError') throw new SkillInstallError('Skill 安装已取消', { code: 'cancelled' })
    throw new SkillInstallError(`下载 GitHub 仓库失败：${error instanceof Error ? error.message : String(error)}`, { code: 'network-error' })
  }
  if (!response.ok) throw new SkillInstallError(`下载 GitHub 仓库失败：HTTP ${response.status}`, { status: response.status, code: 'http-error' })
  const length = Number(response.headers.get('content-length') || 0)
  if (Number.isFinite(length) && length > MAX_ARCHIVE_BYTES) throw new SkillInstallError('GitHub 仓库压缩包超过 100 MB', { code: 'archive-limit' })
  let bytes
  try {
    bytes = await readResponseBytes(response, MAX_ARCHIVE_BYTES, signal)
  } catch (error) {
    if (error instanceof SkillInstallError) throw error
    if (isAbortError(error, signal)) throw new SkillInstallError('Skill 安装已取消', { code: 'cancelled' })
    throw new SkillInstallError(`读取 GitHub 仓库失败：${error instanceof Error ? error.message : String(error)}`, { code: 'network-error' })
  }
  try {
    return await extractZipArchive(bytes, tempRoot, signal)
  } catch (error) {
    if (error instanceof SkillInstallError) throw error
    throw new SkillInstallError(`GitHub 压缩包解析失败：${error instanceof Error ? error.message : String(error)}`, { code: 'archive-invalid' })
  }
}

function canonicalGitHubRemote(value) {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || url.username || url.password || url.search || url.hash) return undefined
    return `https://github.com${url.pathname.replace(/\.git$/i, '').replace(/\/+$/, '')}`.toLowerCase()
  } catch {
    return undefined
  }
}

async function gitClone(source, tempRoot, repoUrl, signal) {
  const repoDir = join(tempRoot, 'repo')
  const common = ['-c', 'protocol.file.allow=never', 'clone', '--filter=blob:none', '--depth', '1', '--sparse', '--single-branch', '--no-checkout']
  abortIfNeeded(signal)
  try {
    // Clone without checking out the remote default branch, then fetch the
    // requested branch, tag, or commit explicitly. A second clone without
    // --branch would silently lose the requested ref in a shallow repository.
    await runCommand('git', [...common, '--', repoUrl, repoDir], signal)
    const origin = await runCommand('git', ['-C', repoDir, 'remote', 'get-url', 'origin'], signal)
    if (canonicalGitHubRemote(origin.stdout) !== canonicalGitHubRemote(repoUrl)) {
      throw new SkillInstallError('Git 远端与请求的 GitHub 仓库不一致', { code: 'source-mismatch' })
    }
    await runCommand('git', ['-C', repoDir, 'fetch', '--depth', '1', 'origin', source.ref], signal)
  } catch (error) {
    await rm(repoDir, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
  return repoDir
}

async function sparseCheckout(source, tempRoot, signal) {
  const repoDir = await gitClone(source, tempRoot, `https://github.com/${source.owner}/${source.repo}.git`, signal)
  await runCommand('git', ['-C', repoDir, 'sparse-checkout', 'set', '--cone', '--', source.path], signal)
  await runCommand('git', ['-C', repoDir, 'checkout', '--detach', 'FETCH_HEAD'], signal)
  return repoDir
}

function canFallbackFromArchive(error) {
  if (!(error instanceof SkillInstallError)) return false
  if (error.code === 'network-error') return true
  if (error.code !== 'http-error') return false
  return error.status === 401 || error.status === 403 || error.status === 404 || error.status === 408 || error.status === 429 || (error.status >= 500 && error.status <= 599)
}

async function prepareRepo(source, method, tempRoot, signal) {
  if (method !== 'auto' && method !== 'download' && method !== 'git') throw new SkillInstallError('method 必须是 auto、download 或 git')
  if (method === 'download' || method === 'auto') {
    try {
      return { root: await downloadRepoArchive(source, tempRoot, signal), method: 'download' }
    } catch (error) {
      if (method === 'download' || !canFallbackFromArchive(error)) throw error
      await rm(join(tempRoot, source.repo), { recursive: true, force: true }).catch(() => undefined)
    }
  }
  return { root: await sparseCheckout(source, tempRoot, signal), method: 'git' }
}

async function copySkillTree(source, destination, signal) {
  abortIfNeeded(signal)
  const info = await lstat(source)
  if (info.isSymbolicLink()) throw new SkillInstallError(`Skill 包含不支持的符号链接：${source}`, { code: 'invalid-skill' })
  if (info.isDirectory()) {
    await mkdir(destination, { recursive: true })
    const entries = await readdir(source, { withFileTypes: true })
    for (const entry of entries) {
      abortIfNeeded(signal)
      // A Git worktree carries repository metadata that is not part of the
      // Skill bundle and may contain unrelated refs/configuration.
      if (entry.name === '.git') continue
      await copySkillTree(join(source, entry.name), join(destination, entry.name), signal)
    }
    return
  }
  if (!info.isFile()) throw new SkillInstallError(`Skill 包含非普通文件：${source}`, { code: 'invalid-skill' })
  await copyFile(source, destination)
}

async function assertNoSymlinks(root, signal, budget = { files: 0, bytes: 0 }) {
  abortIfNeeded(signal)
  const rootInfo = await lstat(root)
  if (rootInfo.isSymbolicLink()) throw new SkillInstallError(`Skill 包含不支持的符号链接：${root}`)
  if (!rootInfo.isDirectory()) throw new SkillInstallError(`Skill 根必须是目录：${root}`)
  const entries = await readdir(root, { withFileTypes: true })
  if (entries.length > MAX_SKILL_FILES) throw new SkillInstallError('Skill 文件数量超过限制', { code: 'skill-limit' })
  for (const entry of entries) {
    abortIfNeeded(signal)
    if (entry.name === '.git') continue
    const path = join(root, entry.name)
    const info = await lstat(path)
    if (info.isSymbolicLink()) throw new SkillInstallError(`Skill 包含不支持的符号链接：${entry.name}`)
    if (info.isDirectory()) {
      await assertNoSymlinks(path, signal, budget)
      continue
    }
    if (!info.isFile()) throw new SkillInstallError(`Skill 包含非普通文件：${entry.name}`, { code: 'invalid-skill' })
    budget.files += 1
    budget.bytes += info.size
    if (budget.files > MAX_SKILL_FILES || budget.bytes > MAX_SKILL_BYTES) {
      throw new SkillInstallError('Skill 文件数量或总大小超过限制', { code: 'skill-limit' })
    }
    if (info.size > MAX_SKILL_FILE_BYTES) {
      throw new SkillInstallError(`Skill 文件超过 ${MAX_SKILL_FILE_BYTES} 字节限制`, { code: 'skill-limit' })
    }
  }
}

async function inspectSkillDirectory(path, signal) {
  const info = await lstat(path).catch(() => undefined)
  if (!info?.isDirectory()) throw new SkillInstallError(`Skill 目录不存在：${path}`)
  if (info.isSymbolicLink()) throw new SkillInstallError(`Skill 源目录不能是符号链接：${path}`)
  const skillFile = join(path, 'SKILL.md')
  const skillInfo = await lstat(skillFile).catch(() => undefined)
  if (skillInfo === undefined) throw new SkillInstallError('选定目录中没有 SKILL.md')
  if (skillInfo.isSymbolicLink() || !skillInfo.isFile()) {
    throw new SkillInstallError('SKILL.md 必须是普通文件', { code: 'invalid-skill' })
  }
  if (skillInfo.size > MAX_SKILL_FILE_BYTES) {
    throw new SkillInstallError(`SKILL.md 超过 ${MAX_SKILL_FILE_BYTES} 字节限制`, { code: 'skill-limit' })
  }
  await assertNoSymlinks(path, signal)
  const content = await readFile(skillFile, 'utf8').catch(() => undefined)
  if (content === undefined) throw new SkillInstallError('选定目录中没有 SKILL.md')
  if (Buffer.byteLength(content, 'utf8') > MAX_SKILL_FILE_BYTES) {
    throw new SkillInstallError(`SKILL.md 超过 ${MAX_SKILL_FILE_BYTES} 字节限制`, { code: 'skill-limit' })
  }
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)?.[1]
  if (!frontmatter) throw new SkillInstallError('SKILL.md 缺少 YAML frontmatter')
  const nameLine = frontmatter.split(/\r?\n/).find(line => /^\s*name\s*:/i.test(line))
  const declaredName = nameLine?.replace(/^\s*name\s*:\s*/i, '').trim().replace(/^['"]|['"]$/g, '')
  if (!declaredName) throw new SkillInstallError('SKILL.md frontmatter 缺少 name')
  validateSkillName(declaredName)
  const descriptionLine = frontmatter.split(/\r?\n/).find(line => /^\s*description\s*:/i.test(line))
  const description = descriptionLine?.replace(/^\s*description\s*:\s*/i, '').trim().replace(/^['"]|['"]$/g, '')
  if (!description) throw new SkillInstallError('SKILL.md frontmatter 缺少 description')
  return { declaredName }
}

function defaultDshHome() {
  return process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
}

function ensureContained(root, child, label, { allowSame = false } = {}) {
  const relativePath = relative(resolve(root), resolve(child))
  if ((!allowSame && relativePath === '') || relativePath === '..' || relativePath.startsWith(`..${requireSeparator()}`) || isAbsolute(relativePath)) {
    throw new SkillInstallError(`${label} 必须位于目标目录内`)
  }
}

function ensureDirectChild(root, child, label) {
  ensureContained(root, child, label)
  const relativePath = relative(resolve(root), resolve(child))
  if (relativePath.includes(requireSeparator())) throw new SkillInstallError(`${label} 必须是目标目录中的一级子目录`)
}

async function assertRealpathContained(root, child, label) {
  const rootResolved = resolve(root)
  const childResolved = resolve(child)
  ensureContained(rootResolved, childResolved, label, { allowSame: true })
  let current = rootResolved
  const childRelative = relative(rootResolved, childResolved)
  for (const part of childRelative ? childRelative.split(requireSeparator()) : []) {
    current = join(current, part)
    const info = await lstat(current)
    if (info.isSymbolicLink()) throw new SkillInstallError(`${label} 及其父级不能是符号链接或 junction`)
    if (!info.isDirectory() && current !== childResolved) throw new SkillInstallError(`${label} 的父级必须是目录`)
  }
  const rootReal = await realpath(rootResolved)
  const childReal = await realpath(childResolved)
  ensureContained(rootReal, childReal, label, { allowSame: true })
}

function requireSeparator() {
  return process.platform === 'win32' ? '\\' : '/'
}

export async function installSkillFromSource(input, options = {}) {
  const source = parseGitHubSource(input)
  if (!source.path) source.path = await discoverSkillPath(source, options.signal)
  const tempRoot = await mkdtemp(join(resolve(options.tempRoot || tmpdir()), 'dsh-skill-install-'))
  let committed = false
  try {
    const prepared = await prepareRepo(source, input.method || 'auto', tempRoot, options.signal)
    const preparedInfo = await lstat(prepared.root).catch(() => undefined)
    if (!preparedInfo?.isDirectory() || preparedInfo.isSymbolicLink()) {
      throw new SkillInstallError('Skill 源仓库必须是普通目录')
    }
    const skillSource = resolve(prepared.root, ...source.path.split('/'))
    ensureContained(prepared.root, skillSource, 'Skill 源目录', { allowSame: true })
    await assertRealpathContained(prepared.root, skillSource, 'Skill 源目录')
    const metadata = await inspectSkillDirectory(skillSource, options.signal)
    const skillName = metadata.declaredName
    const destinationName = validateSkillName(input.name || skillName)
    const destinationRoot = resolve(options.destRoot || join(options.dshHome || defaultDshHome(), 'skills'))
    await ensureSafeDirectory(destinationRoot, '用户 Skills 目录')
    const destination = resolve(destinationRoot, destinationName)
    ensureDirectChild(destinationRoot, destination, '安装目标')
    const sourceDirectoryName = source.path.split('/').at(-1) || source.repo
    const warnings = []
    if (sourceDirectoryName !== skillName) warnings.push(`源目录名 ${sourceDirectoryName} 与 SKILL.md name ${skillName} 不同`)
    if (destinationName !== skillName) warnings.push(`安装目录名 ${destinationName} 与 SKILL.md name ${skillName} 不同，registry 使用 ${skillName}`)
    const installationId = randomUUID()
    const result = {
      skillName,
      source: canonicalSource(source),
      ref: source.ref,
      path: source.path,
      installPath: destination,
      method: prepared.method,
      registered: true,
      warnings,
    }
    const registration = {
      directoryName: destinationName,
      skillName,
      source: result.source,
      ref: result.ref,
      path: result.path,
      installationId,
    }
    return await withProfilePatchLock(join(destinationRoot, SKILL_MUTATION_LOCK_KEY), async () => {
      abortIfNeeded(options.signal)
      await assertSafeDirectoryAncestors(destinationRoot, '用户 Skills 目录')
      const existing = await lstat(destination).catch(error => {
        if (error?.code === 'ENOENT') return undefined
        throw error
      })
      if (existing !== undefined) throw new SkillInstallError(`目标 Skill 已存在：${destination}`)
      const stagingRoot = await mkdtemp(join(destinationRoot, `.install-${destinationName}-`))
      const stagedSkill = join(stagingRoot, destinationName)
      try {
        abortIfNeeded(options.signal)
        await copySkillTree(skillSource, stagedSkill, options.signal)
        await writeFile(join(stagedSkill, MANAGED_SKILL_MARKER), `${JSON.stringify({
          version: 1,
          owner: 'deeptop',
          directoryName: destinationName,
          skillName,
          source: result.source,
          ref: result.ref,
          path: result.path,
          installationId,
        }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
        await assertNoSymlinks(stagedSkill, options.signal)
        abortIfNeeded(options.signal)
        const destinationAfterCopy = await lstat(destination).catch(error => {
          if (error?.code === 'ENOENT') return undefined
          throw error
        })
        if (destinationAfterCopy !== undefined) throw new SkillInstallError(`目标 Skill 已存在：${destination}`)
        // Record the opaque installation identity before the atomic publish. A
        // crash can at worst leave a stale registry row; it can never turn a
        // handwritten marker alone into a deletion authorization.
        await registerManagedSkill(destinationRoot, registration)
        try {
          await rename(stagedSkill, destination)
        } catch (error) {
          await removeManagedSkillRegistration(destinationRoot, destinationName, installationId).catch(() => undefined)
          throw error
        }
        committed = true
        // The destination rename is the irreversible commit point. A caller may
        // use this notification to stop treating a subsequent cleanup/refresh
        // issue as a failed or cancelled installation.
        try {
          const notification = options.onCommit?.(result)
          if (notification && typeof notification.then === 'function') {
            void notification.catch(() => undefined)
          }
        } catch {
          // Commit notifications are advisory and must never undo a committed
          // filesystem mutation or turn it into a false failure.
        }
      } finally {
        try {
          await rm(stagingRoot, { recursive: true, force: true })
        } catch (error) {
          if (!committed) throw error
        }
      }
      return result
    }, options.signal)
  } finally {
    try {
      await rm(tempRoot, { recursive: true, force: true })
    } catch (error) {
      if (!committed) throw error
    }
  }
}
