import { cp, lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const DEFAULT_REF = 'main'
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export class SkillInstallError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'SkillInstallError'
    this.status = options.status
  }
}

function abortIfNeeded(signal) {
  signal?.throwIfAborted?.()
  if (signal?.aborted) throw new SkillInstallError('Skill 安装已取消')
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

export function validateRelativeRepoPath(value, label = 'Skill path') {
  const raw = String(value ?? '').replaceAll('\\', '/')
  if (isAbsolute(raw) || raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) throw new SkillInstallError(`${label} 必须是仓库内的相对路径`)
  const normalized = raw.replace(/^\/+|\/+$/g, '')
  const parts = normalized.split('/')
  if (!normalized || parts.some(part => part === '' || part === '.' || part === '..')) {
    throw new SkillInstallError(`${label} 必须是仓库内的相对路径`)
  }
  return parts.join('/')
}

export function validateSkillName(value) {
  const name = String(value ?? '').trim()
  if (!SKILL_NAME.test(name)) throw new SkillInstallError(`Skill name 无效：${name || '(empty)'}`)
  return name
}

export function parseGitHubSource(input) {
  if (!input || typeof input.source !== 'string' || input.source.trim() === '') {
    throw new SkillInstallError('skill.install 需要 source')
  }

  const raw = input.source.trim()
  const url = raw.includes('://') ? new URL(raw) : new URL(`https://github.com/${raw}`)
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') {
    throw new SkillInstallError('只支持 HTTPS GitHub 地址')
  }

  const parts = url.pathname.split('/').filter(Boolean).map(decodeSegment)
  if (parts.length < 2) throw new SkillInstallError('GitHub URL 缺少 owner/repo')
  const owner = validateRepositoryPart(parts[0], 'owner')
  const repo = validateRepositoryPart(parts[1].replace(/\.git$/i, ''), 'repo')
  let ref
  let urlPath
  if (parts[2] === 'tree' || parts[2] === 'blob') {
    if (parts.length < 4) throw new SkillInstallError('GitHub URL 缺少 ref 或路径')
    ref = parts[3]
    urlPath = parts.slice(4).join('/')
    if (parts[2] === 'blob') throw new SkillInstallError('GitHub Skill 地址必须指向目录，而不是单个文件')
  } else {
    urlPath = parts.slice(2).join('/')
  }
  const requestedRef = input.ref === undefined ? undefined : String(input.ref).trim()
  if (requestedRef !== undefined && requestedRef === '') throw new SkillInstallError('GitHub ref 不能为空')
  ref = ref || requestedRef || DEFAULT_REF
  if (/[\u0000-\u001f]/.test(ref)) throw new SkillInstallError('GitHub ref 无效')
  const path = input.path === undefined ? (urlPath ? validateRelativeRepoPath(urlPath) : undefined) : validateRelativeRepoPath(input.path)
  return {
    owner,
    repo,
    ref: ref || requestedRef || DEFAULT_REF,
    path,
  }
}

function canonicalSource(source) {
  const path = source.path ? `/${source.path}` : ''
  return `https://github.com/${source.owner}/${source.repo}/tree/${encodeURIComponent(source.ref)}${path}`
}

async function githubJson(url, signal) {
  abortIfNeeded(signal)
  let response
  try {
    response = await fetch(url, { headers: githubHeaders(), signal })
  } catch (error) {
    throw new SkillInstallError(`访问 GitHub API 失败：${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) {
    throw new SkillInstallError(`GitHub API 返回 HTTP ${response.status}`, { status: response.status })
  }
  try {
    return await response.json()
  } catch (error) {
    throw new SkillInstallError(`GitHub API 响应无效：${error instanceof Error ? error.message : String(error)}`)
  }
}

async function discoverSkillPath(source, signal) {
  const tree = await githubJson(`https://api.github.com/repos/${source.owner}/${source.repo}/git/trees/${encodeURIComponent(source.ref)}?recursive=1`, signal)
  const candidates = Array.isArray(tree?.tree)
    ? tree.tree
      .filter(entry => entry?.type === 'blob' && typeof entry.path === 'string' && /(?:^|\/)SKILL\.md$/i.test(entry.path))
      .map(entry => entry.path.replace(/\/SKILL\.md$/i, ''))
      .filter(Boolean)
    : []
  const preferred = candidates.filter(path => path.split('/').at(-1)?.toLowerCase() === source.repo.toLowerCase())
  const selected = preferred.length === 1 ? preferred[0] : candidates.length === 1 ? candidates[0] : undefined
  if (selected) return selected
  if (candidates.length === 0) throw new SkillInstallError(`仓库中没有找到 SKILL.md：${source.owner}/${source.repo}`)
  const shown = candidates.slice(0, 12).join(', ')
  throw new SkillInstallError(`GitHub 仓库包含多个 Skill，请指定 path；候选路径：${shown}`)
}

async function runCommand(command, args, signal) {
  abortIfNeeded(signal)
  try {
    return await execFileAsync(command, args, {
      signal,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    })
  } catch (error) {
    const detail = error?.stderr?.trim() || error?.message || `${command} 执行失败`
    throw new SkillInstallError(detail)
  }
}

function archiveEntryIsSafe(entry) {
  const normalized = entry.replaceAll('\\', '/')
  return normalized !== ''
    && !normalized.startsWith('/')
    && !/^[A-Za-z]:/.test(normalized)
    && !normalized.split('/').includes('..')
}

async function downloadRepoArchive(source, tempRoot, signal) {
  const url = `https://codeload.github.com/${source.owner}/${source.repo}/zip/${encodeURIComponent(source.ref)}`
  let response
  try {
    response = await fetch(url, { headers: githubHeaders('application/zip'), signal })
  } catch (error) {
    throw new SkillInstallError(`下载 GitHub 仓库失败：${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) throw new SkillInstallError(`下载 GitHub 仓库失败：HTTP ${response.status}`, { status: response.status })
  const length = Number(response.headers.get('content-length') || 0)
  if (length > MAX_ARCHIVE_BYTES) throw new SkillInstallError('GitHub 仓库压缩包超过 100 MB')
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) throw new SkillInstallError('GitHub 仓库压缩包超过 100 MB')

  const archive = join(tempRoot, 'repo.zip')
  await writeFile(archive, bytes)
  const tar = process.platform === 'win32' ? 'tar.exe' : 'tar'
  const listing = await runCommand(tar, ['-tf', archive], signal)
  const entries = String(listing.stdout).split(/\r?\n/).map(value => value.trim()).filter(Boolean)
  if (entries.length === 0 || entries.some(entry => !archiveEntryIsSafe(entry))) {
    throw new SkillInstallError('GitHub 压缩包包含无效路径')
  }
  const roots = [...new Set(entries.map(entry => entry.split('/')[0]).filter(Boolean))]
  if (roots.length !== 1) throw new SkillInstallError('GitHub 压缩包目录结构异常')
  await runCommand(tar, ['-xf', archive, '-C', tempRoot], signal)
  return join(tempRoot, roots[0])
}

async function gitClone(source, tempRoot, repoUrl, signal) {
  const repoDir = join(tempRoot, 'repo')
  const common = ['clone', '--filter=blob:none', '--depth', '1', '--sparse', '--single-branch']
  try {
    await runCommand('git', [...common, '--branch', source.ref, repoUrl, repoDir], signal)
  } catch (firstError) {
    await rm(repoDir, { recursive: true, force: true })
    try {
      await runCommand('git', [...common, repoUrl, repoDir], signal)
    } catch (secondError) {
      throw new SkillInstallError(`Git checkout 失败：${firstError.message}；${secondError.message}`)
    }
  }
  return repoDir
}

async function sparseCheckout(source, tempRoot, signal) {
  let repoDir
  try {
    repoDir = await gitClone(source, tempRoot, `https://github.com/${source.owner}/${source.repo}.git`, signal)
  } catch (httpsError) {
    await rm(join(tempRoot, 'repo'), { recursive: true, force: true })
    repoDir = await gitClone(source, tempRoot, `git@github.com:${source.owner}/${source.repo}.git`, signal)
      .catch(sshError => {
        throw new SkillInstallError(`GitHub HTTPS/SSH checkout 均失败：${httpsError.message}；${sshError.message}`)
      })
  }
  await runCommand('git', ['-C', repoDir, 'sparse-checkout', 'set', source.path], signal)
  await runCommand('git', ['-C', repoDir, 'checkout', source.ref], signal)
  return repoDir
}

async function prepareRepo(source, method, tempRoot, signal) {
  if (method !== 'auto' && method !== 'download' && method !== 'git') throw new SkillInstallError('method 必须是 auto、download 或 git')
  if (method === 'download' || method === 'auto') {
    try {
      return { root: await downloadRepoArchive(source, tempRoot, signal), method: 'download' }
    } catch (error) {
      if (method === 'download') throw error
      if (error?.status !== 401 && error?.status !== 403 && error?.status !== 404 && !(error instanceof SkillInstallError)) throw error
    }
  }
  return { root: await sparseCheckout(source, tempRoot, signal), method: 'git' }
}

async function assertNoSymlinks(root) {
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isSymbolicLink()) throw new SkillInstallError(`Skill 包含不支持的符号链接：${entry.name}`)
    if (entry.isDirectory()) await assertNoSymlinks(path)
  }
}

async function inspectSkillDirectory(path) {
  const info = await lstat(path).catch(() => undefined)
  if (!info?.isDirectory()) throw new SkillInstallError(`Skill 目录不存在：${path}`)
  if (info.isSymbolicLink()) throw new SkillInstallError(`Skill 源目录不能是符号链接：${path}`)
  await assertNoSymlinks(path)
  const skillFile = join(path, 'SKILL.md')
  const content = await readFile(skillFile, 'utf8').catch(() => undefined)
  if (content === undefined) throw new SkillInstallError('选定目录中没有 SKILL.md')
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)?.[1]
  if (!frontmatter) throw new SkillInstallError('SKILL.md 缺少 YAML frontmatter')
  const nameLine = frontmatter.split(/\r?\n/).find(line => /^\s*name\s*:/i.test(line))
  const declaredName = nameLine?.replace(/^\s*name\s*:\s*/i, '').trim().replace(/^['"]|['"]$/g, '')
  if (!declaredName) throw new SkillInstallError('SKILL.md frontmatter 缺少 name')
  validateSkillName(declaredName)
  if (!frontmatter.split(/\r?\n/).some(line => /^\s*description\s*:/i.test(line))) throw new SkillInstallError('SKILL.md frontmatter 缺少 description')
  return { declaredName }
}

function defaultDshHome() {
  return process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
}

function ensureContained(root, child, label) {
  const relativePath = relative(resolve(root), resolve(child))
  if (relativePath === '' || relativePath === '..' || relativePath.startsWith(`..${requireSeparator()}`) || isAbsolute(relativePath)) {
    throw new SkillInstallError(`${label} 必须位于目标目录内`)
  }
}

function requireSeparator() {
  return process.platform === 'win32' ? '\\' : '/'
}

export async function installSkillFromSource(input, options = {}) {
  const source = parseGitHubSource(input)
  if (!source.path) source.path = await discoverSkillPath(source, options.signal)
  const tempRoot = await mkdtemp(join(resolve(options.tempRoot || tmpdir()), 'dsh-skill-install-'))
  try {
    const prepared = await prepareRepo(source, input.method || 'auto', tempRoot, options.signal)
    const skillSource = resolve(prepared.root, ...source.path.split('/'))
    ensureContained(prepared.root, skillSource, 'Skill 源目录')
    const metadata = await inspectSkillDirectory(skillSource)
    const skillName = metadata.declaredName
    const destinationName = validateSkillName(input.name || skillName)
    const destinationRoot = resolve(options.destRoot || join(options.dshHome || defaultDshHome(), 'skills'))
    const destination = resolve(destinationRoot, destinationName)
    ensureContained(destinationRoot, destination, '安装目标')
    if (await stat(destination).catch(() => undefined)) throw new SkillInstallError(`目标 Skill 已存在：${destination}`)
    await mkdir(destinationRoot, { recursive: true })
    const stagingRoot = await mkdtemp(join(destinationRoot, `.install-${destinationName}-`))
    const stagedSkill = join(stagingRoot, destinationName)
    try {
      await cp(skillSource, stagedSkill, { recursive: true, errorOnExist: true, dereference: false })
      if (await stat(destination).catch(() => undefined)) throw new SkillInstallError(`目标 Skill 已存在：${destination}`)
      await rename(stagedSkill, destination)
    } finally {
      await rm(stagingRoot, { recursive: true, force: true })
    }
    const sourceDirectoryName = source.path.split('/').at(-1) || source.repo
    const warnings = []
    if (sourceDirectoryName !== skillName) warnings.push(`源目录名 ${sourceDirectoryName} 与 SKILL.md name ${skillName} 不同`)
    if (destinationName !== skillName) warnings.push(`安装目录名 ${destinationName} 与 SKILL.md name ${skillName} 不同，registry 使用 ${skillName}`)
    return {
      skillName,
      source: canonicalSource(source),
      ref: source.ref,
      path: source.path,
      installPath: destination,
      method: prepared.method,
      registered: true,
      warnings,
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}
