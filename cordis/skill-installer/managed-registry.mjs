import { lstat, mkdir, open, rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'

export const MANAGED_SKILL_REGISTRY_FILE = 'deeptop-managed-skills.json'
const REGISTRY_VERSION = 1
const MAX_REGISTRY_BYTES = 128 * 1024
const MAX_RECORDS = 1024
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const INSTALLATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function registryError(message) {
  const error = new Error(message)
  error.code = 'managed-skill-registry-invalid'
  return error
}

function validateName(value, label) {
  if (typeof value !== 'string' || !SKILL_NAME.test(value)) throw registryError(`${label} 无效`)
  return value
}

function validatePath(value) {
  if (typeof value !== 'string' || value.length > 4096) throw registryError('Skill registry path 无效')
  if (value === '.') return value
  if (value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:/.test(value)) throw registryError('Skill registry path 无效')
  const parts = value.split('/')
  if (parts.length === 0 || parts.some(part => !part || part === '.' || part === '..' || /[\\\u0000-\u001f\u007f]/.test(part))) {
    throw registryError('Skill registry path 无效')
  }
  return value
}

function normalizeRecord(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw registryError('Skill registry 条目必须是对象')
  const fields = Object.keys(value)
  const expected = ['directoryName', 'skillName', 'source', 'ref', 'path', 'installationId']
  if (fields.length !== expected.length || fields.some(field => !expected.includes(field))) throw registryError('Skill registry 条目包含未知字段')
  const directoryName = validateName(value.directoryName, 'Skill registry directoryName')
  const skillName = validateName(value.skillName, 'Skill registry skillName')
  if (typeof value.source !== 'string' || !value.source || value.source.length > 4096) throw registryError('Skill registry source 无效')
  if (typeof value.ref !== 'string' || !value.ref || value.ref.length > 512) throw registryError('Skill registry ref 无效')
  const path = validatePath(value.path)
  if (typeof value.installationId !== 'string' || !INSTALLATION_ID.test(value.installationId)) throw registryError('Skill registry installationId 无效')
  return {
    directoryName,
    skillName,
    source: value.source,
    ref: value.ref,
    path,
    installationId: value.installationId.toLowerCase(),
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

async function ensureSafeDirectory(path, label) {
  await assertSafeDirectoryAncestors(path, label)
  await mkdir(path, { recursive: true })
  await assertSafeDirectoryAncestors(path, label)
}

async function readBoundedUtf8File(path, maxBytes) {
  const handle = await open(path, 'r')
  try {
    const info = await handle.stat()
    if (!Number.isSafeInteger(info.size) || info.size > maxBytes) throw registryError('Skill registry 超过大小限制')
    const buffer = Buffer.alloc(maxBytes + 1)
    const result = await handle.read(buffer, 0, maxBytes + 1, 0)
    if (result.bytesRead > maxBytes) throw registryError('Skill registry 超过大小限制')
    return buffer.subarray(0, result.bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }
}

async function writeTemp(path, content) {
  const temp = `${path}.tmp-${process.pid}-${randomUUID()}`
  let handle
  try {
    handle = await open(temp, 'wx', 0o600)
    await handle.writeFile(content, 'utf8')
    await handle.close()
    handle = undefined
    return temp
  } catch (error) {
    await handle?.close().catch(() => undefined)
    await rm(temp, { force: true }).catch(() => undefined)
    throw error
  }
}

export function managedSkillRegistryPath(skillsRoot) {
  return join(dirname(resolve(skillsRoot)), 'profiles', 'desktop', MANAGED_SKILL_REGISTRY_FILE)
}

export async function readManagedSkillRegistry(skillsRoot) {
  const path = managedSkillRegistryPath(skillsRoot)
  await assertSafeDirectoryAncestors(dirname(path), 'desktop Profile 目录')
  const info = await lstat(path).catch(error => {
    if (error?.code === 'ENOENT') return undefined
    throw error
  })
  if (info === undefined) return { version: REGISTRY_VERSION, entries: [] }
  if (info.isSymbolicLink() || !info.isFile()) throw registryError('Skill registry 必须是普通文件')
  if (info.size > MAX_REGISTRY_BYTES) throw registryError('Skill registry 超过大小限制')
  let parsed
  try {
    parsed = JSON.parse(await readBoundedUtf8File(path, MAX_REGISTRY_BYTES))
  } catch (error) {
    if (error?.code === 'managed-skill-registry-invalid') throw error
    throw registryError(`Skill registry 损坏：${error instanceof Error ? error.message : String(error)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)
    || parsed.version !== REGISTRY_VERSION || !Array.isArray(parsed.entries) || parsed.entries.length > MAX_RECORDS
    || Object.keys(parsed).some(field => field !== 'version' && field !== 'entries')) {
    throw registryError('Skill registry 格式无效')
  }
  const entries = parsed.entries.map(normalizeRecord)
  const names = new Set()
  const installationIds = new Set()
  for (const entry of entries) {
    if (names.has(entry.directoryName) || installationIds.has(entry.installationId)) throw registryError('Skill registry 包含重复条目')
    names.add(entry.directoryName)
    installationIds.add(entry.installationId)
  }
  return { version: REGISTRY_VERSION, entries }
}

async function writeManagedSkillRegistry(skillsRoot, entries) {
  if (!Array.isArray(entries) || entries.length > MAX_RECORDS) throw registryError('Skill registry 条目数量无效')
  const normalized = entries.map(normalizeRecord)
  const path = managedSkillRegistryPath(skillsRoot)
  await ensureSafeDirectory(dirname(path), 'desktop Profile 目录')
  const temp = await writeTemp(path, `${JSON.stringify({ version: REGISTRY_VERSION, entries: normalized }, null, 2)}\n`)
  let published = false
  try {
    await rename(temp, path)
    published = true
  } finally {
    if (!published) await rm(temp, { force: true }).catch(() => undefined)
  }
}

export async function registerManagedSkill(skillsRoot, record) {
  const next = normalizeRecord(record)
  const registry = await readManagedSkillRegistry(skillsRoot)
  const entries = registry.entries.filter(entry => entry.directoryName !== next.directoryName)
  entries.push(next)
  await writeManagedSkillRegistry(skillsRoot, entries)
  return next
}

export async function removeManagedSkillRegistration(skillsRoot, directoryName, installationId) {
  const registry = await readManagedSkillRegistry(skillsRoot)
  const entries = registry.entries.filter(entry => entry.directoryName !== directoryName || entry.installationId !== installationId)
  if (entries.length !== registry.entries.length) await writeManagedSkillRegistry(skillsRoot, entries)
}

export function managedSkillRecordMatches(record, marker) {
  return record !== undefined
    && marker !== undefined
    && record.directoryName === marker.directoryName
    && record.skillName === marker.skillName
    && record.source === marker.source
    && record.ref === marker.ref
    && record.path === marker.path
    && record.installationId === marker.installationId
}
