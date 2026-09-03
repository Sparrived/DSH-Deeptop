import { createHash, randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { resolveDshHome } from './dsh-home.mjs'
import { DEEPTOP_PROFILE_ENTRY_IDS, locateManagedBlock, normalizeProfilePatchDocument, withProfilePatchLock } from './profile-patch.mjs'

const CONFIG_FILE = 'deeptop-plugins.json'
const PATCH_FILE = 'cordis.patch.yml'
const PATCH_START = '# BEGIN DEEPTOP MANAGED PLUGINS'
const PATCH_END = '# END DEEPTOP MANAGED PLUGINS'
const VERSION = 1
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/
const SYSTEM_PLUGIN_PREFIXES = [
  '@deepseek-ai/dsh-',
  'deeptop-bridge',
]
const REQUIRED_PLUGIN_IDS = new Set(['desktop-bridge', 'plugin-inventory'])
const MAX_REVISION = 2_147_483_647
const MAX_PLUGINS = 1024
const CONFIG_FIELDS = new Set(['version', 'revision', 'plugins'])
const PLUGIN_FIELDS = new Set(['id', 'name', 'enabled'])
const PACKAGE_NAME = /^(?:@[A-Za-z0-9][A-Za-z0-9._-]*\/)?[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/
const DESKTOP_UNSUPPORTED_PATTERNS = [
  /^dsh-client(?:-|$)/,
  /^@deepseek-ai\/dsh-client(?:-|$)/,
  /^dsh-cordis-client(?:-|$)/,
  /^@deepseek-ai\/dsh-cordis-client(?:-|$)/,
  /client-(?:runtime|modules|slots|layout|primitives|locale)/,
  /client-ui-(?:layout|slots|primitives|locale)/,
]

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function configPath(ctx) {
  const home = resolveDshHome(ctx)
  if (home === undefined) {
    throw new Error('插件配置需要 DSH_HOME')
  }
  return join(home, 'profiles', 'desktop', CONFIG_FILE)
}

async function assertSafeDirectoryAncestors(path, label) {
  let current = path
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

async function ensureProfileDirectory(path) {
  await assertSafeDirectoryAncestors(path, 'desktop Profile 目录')
  await mkdir(path, { recursive: true })
  await assertSafeDirectoryAncestors(path, 'desktop Profile 目录')
}

function normalizeId(value) {
  if (typeof value !== 'string') throw new Error('插件 id 必须是字符串')
  const id = value.trim()
  if (!ID_PATTERN.test(id)) throw new Error('插件 id 只能包含字母、数字、点、下划线和连字符')
  return id
}

function normalizeName(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('插件模块路径不能为空')
  const name = value.trim()
  if (name.length > 2048 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('插件模块路径无效')
  // Local plugins must be explicit absolute paths; package plugins use a
  // package/subpath specifier. Refuse relative paths and URL-like loaders so
  // the Profile cannot resolve a renderer-controlled path unexpectedly.
  if (isAbsolute(name)) return name
  if (!PACKAGE_NAME.test(name)) throw new Error('插件模块必须是绝对路径或合法 npm 包名')
  return name
}

function assertAvailablePluginId(id) {
  if (DEEPTOP_PROFILE_ENTRY_IDS.has(id) || id.startsWith('deeptop-mcp-')) {
    throw new Error(`插件 id 被 desktop Profile 保留：${id}`)
  }
}

function assertKnownFields(value, allowed, label) {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) throw new Error(`${label} 包含未知字段：${field}`)
  }
}

function normalizePlugins(value) {
  if (!Array.isArray(value) || value.length > MAX_PLUGINS) throw new Error(`插件列表必须是至多 ${MAX_PLUGINS} 项的数组`)
  const seen = new Set()
  return value.map((item) => {
    if (!isRecord(item)) throw new Error('插件条目必须是对象')
    assertKnownFields(item, PLUGIN_FIELDS, '插件条目')
    const id = normalizeId(item.id)
    assertAvailablePluginId(id)
    const name = normalizeName(item.name)
    if (item.enabled !== undefined && typeof item.enabled !== 'boolean') throw new Error('插件 enabled 必须是 boolean')
    if (seen.has(id)) throw new Error(`插件 id 重复：${id}`)
    seen.add(id)
    return { id, name, enabled: item.enabled !== false }
  })
}

function isSystemPlugin(entry) {
  const name = String(entry?.name || '')
  const id = String(entry?.id || '')
  return SYSTEM_PLUGIN_PREFIXES.some((prefix) => id === prefix || name === prefix || name.startsWith(prefix))
}

export function desktopCompatibility(entry) {
  const id = String(entry?.id || '')
  const name = String(entry?.name || '')
  const probe = `${id} ${name}`
  const unsupported = DESKTOP_UNSUPPORTED_PATTERNS.find((pattern) => pattern.test(probe))
  if (unsupported) {
    return { supported: false, reason: '这是 WebUI 客户端插件，Deeptop 不加载客户端运行时。' }
  }
  return { supported: true }
}

function defaultConfig() {
  return { version: VERSION, revision: 0, plugins: [] }
}

function parsePatchPlugins(raw) {
  const block = locateManagedBlock(raw, PATCH_START, PATCH_END, 'desktop Profile 中的插件受管配置')
  if (block === null) return []
  const lines = String(raw).slice(block.start, block.end).split(/\r?\n/)
  const body = lines.slice(1, -1)
  const meaningful = body.filter(line => line.trim() !== '')
  if (meaningful.length === 0 || (meaningful.length === 1 && meaningful[0] === '# No user plugins are enabled in Deeptop.')) return []
  if (meaningful[0] !== '- insert:') throw new Error('插件受管配置必须是 Deeptop 生成的 insert 列表')
  const plugins = []
  let index = 1
  while (index < meaningful.length) {
    const idMatch = meaningful[index].match(/^    - id: ([A-Za-z0-9][A-Za-z0-9._-]{0,95})$/)
    const nameMatch = meaningful[index + 1]?.match(/^      name: ('(?:''|[^'])*')$/)
    if (!idMatch || !nameMatch) throw new Error('插件受管配置条目格式无效')
    const quoted = nameMatch[1]
    plugins.push({
      id: idMatch[1],
      name: quoted.slice(1, -1).replaceAll("''", "'"),
      enabled: true,
    })
    index += 2
  }
  return normalizePlugins(plugins)
}

async function readOptionalText(path) {
  const info = await lstat(path).catch(error => {
    if (error?.code === 'ENOENT') return undefined
    throw error
  })
  if (info?.isSymbolicLink()) throw new Error(`配置文件不能是符号链接：${path}`)
  if (info !== undefined && !info.isFile()) throw new Error(`配置路径必须是普通文件：${path}`)
  if (info === undefined) return { exists: false, content: '' }
  return { exists: true, content: await readFile(path, 'utf8') }
}

async function readConfig(ctx) {
  const path = configPath(ctx)
  await assertSafeDirectoryAncestors(dirname(path), 'desktop Profile 目录')
  const file = await readOptionalText(path).catch(error => {
    throw new Error(`无法读取 Deeptop 插件配置：${error.message}`)
  })
  if (file.exists) {
    try {
      const parsed = JSON.parse(file.content)
      if (!isRecord(parsed)) throw new Error('插件配置必须是对象')
      assertKnownFields(parsed, CONFIG_FIELDS, '插件配置')
      if (parsed.version !== VERSION) throw new Error('插件配置 version 无效')
      if (!Number.isSafeInteger(parsed.revision) || parsed.revision < 0 || parsed.revision > MAX_REVISION) {
        throw new Error('插件配置 revision 无效')
      }
      if (!Array.isArray(parsed.plugins)) throw new Error('插件配置 plugins 必须是数组')
      return {
        version: VERSION,
        revision: parsed.revision,
        plugins: normalizePlugins(parsed.plugins),
      }
    } catch (error) {
      throw new Error(`无法读取 Deeptop 插件配置：${error.message}`)
    }
  }
  const patch = await readOptionalText(join(dirname(path), PATCH_FILE))
  return { ...defaultConfig(), plugins: parsePatchPlugins(patch.content) }
}

async function writeTemp(path, content) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const tempPath = `${path}.tmp-${process.pid}-${randomUUID()}`
    let handle
    try {
      handle = await open(tempPath, 'wx', 0o600)
      await handle.writeFile(content, 'utf8')
      await handle.close()
      return tempPath
    } catch (error) {
      await handle?.close().catch(() => undefined)
      await rm(tempPath, { force: true }).catch(() => undefined)
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

function toProfilePatch(config) {
  const enabled = config.plugins.filter((plugin) => plugin.enabled)
  if (enabled.length === 0) return []
  return [{ insert: enabled.map((plugin) => ({ id: plugin.id, name: plugin.name })) }]
}

function quoteYaml(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

async function buildProfilePatch(ctx, config) {
  const path = join(dirname(configPath(ctx)), PATCH_FILE)
  const current = (await readOptionalText(path)).content
  const enabled = config.plugins.filter((plugin) => plugin.enabled)
  const block = [PATCH_START]
  if (enabled.length > 0) {
    block.push('- insert:')
    for (const plugin of enabled) {
      block.push(`    - id: ${plugin.id}`)
      block.push(`      name: ${quoteYaml(plugin.name)}`)
    }
  } else {
    block.push('# No user plugins are enabled in Deeptop.')
  }
  block.push(PATCH_END)
  const managed = block.join('\n')
  const located = locateManagedBlock(current, PATCH_START, PATCH_END, 'desktop Profile 中的插件受管配置')
  const merged = located === null
    ? `${current.trimEnd()}${current.trim() ? '\n\n' : ''}${managed}\n`
    : `${current.slice(0, located.start)}${managed}${current.slice(located.end)}`
  return normalizeProfilePatchDocument(merged)
}

async function writePluginTransaction(ctx, config, patchContent) {
  const configFilePath = configPath(ctx)
  const patchPath = join(dirname(configFilePath), PATCH_FILE)
  await ensureProfileDirectory(dirname(configFilePath))
  const previousConfig = await readOptionalText(configFilePath)
  const previousPatch = await readOptionalText(patchPath)
  let configTemp
  let patchTemp
  try {
    configTemp = await writeTemp(configFilePath, `${JSON.stringify(config, null, 2)}\n`)
    patchTemp = await writeTemp(patchPath, patchContent)
  } catch (error) {
    await rm(configTemp, { force: true }).catch(() => undefined)
    await rm(patchTemp, { force: true }).catch(() => undefined)
    throw error
  }
  let configPublished = false
  let patchPublished = false
  try {
    await rename(configTemp, configFilePath)
    configPublished = true
    await chmod(configFilePath, 0o600).catch(error => {
      if (process.platform !== 'win32') throw error
    })
    await rename(patchTemp, patchPath)
    patchPublished = true
  } catch (error) {
    await rm(configTemp, { force: true }).catch(() => undefined)
    await rm(patchTemp, { force: true }).catch(() => undefined)
    try {
      if (patchPublished) await restoreText(patchPath, previousPatch)
      if (configPublished) await restoreText(configFilePath, previousConfig)
    } catch (rollbackError) {
      throw new Error(`插件配置写入失败且回滚失败：${error.message}；${rollbackError.message}`)
    }
    throw error
  }
}

function inventoryCompatibility(entry) {
  const id = entry?.entryId ?? entry?.id
  const name = entry?.moduleName ?? entry?.name
  return desktopCompatibility({ id, name })
}

export function filterInventory(snapshot) {
  const entries = Array.isArray(snapshot?.entries) ? snapshot.entries : []
  const compatible = []
  const excluded = []
  for (const entry of entries) {
    const compatibility = inventoryCompatibility(entry)
    const decorated = { ...entry, compatibility }
    if (compatibility.supported) compatible.push(decorated)
    else excluded.push(decorated)
  }
  return { ...snapshot, entries: compatible, excluded }
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)
}

export async function describePluginConfig(ctx) {
  const config = await readConfig(ctx)
  return {
    revision: config.revision,
    path: configPath(ctx),
    plugins: config.plugins.map((plugin) => ({
      ...plugin,
      system: isSystemPlugin(plugin),
      compatibility: desktopCompatibility(plugin),
    })),
    patch: toProfilePatch(config),
    fingerprint: hash(config),
  }
}

export async function mutatePluginConfig(ctx, payload, signal) {
  if (!isRecord(payload) || !Array.isArray(payload.plugins)) {
    throw new Error('plugin.config.mutate requires plugins')
  }
  const patchPath = join(dirname(configPath(ctx)), PATCH_FILE)
  return withProfilePatchLock(patchPath, async () => {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('插件配置操作已取消')
    const current = await readConfig(ctx)
    if (payload.expectedRevision !== undefined && (!Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision < 0 || payload.expectedRevision > MAX_REVISION || payload.expectedRevision !== current.revision)) {
      const conflict = new Error(`插件列表已被其他操作更新，请刷新后重试（当前 revision ${current.revision}）`)
      conflict.code = 'revision-conflict'
      conflict.details = { revision: current.revision }
      throw conflict
    }
    const plugins = normalizePlugins(payload.plugins)
    for (const plugin of plugins) {
      if (isSystemPlugin(plugin)) throw new Error(`不能编辑 Deeptop 内置插件：${plugin.id}`)
      const compatibility = desktopCompatibility(plugin)
      if (!compatibility.supported) throw new Error(`${plugin.id} 不兼容 Deeptop：${compatibility.reason}`)
    }
    for (const plugin of plugins) {
      if (REQUIRED_PLUGIN_IDS.has(plugin.id)) throw new Error(`不能覆盖 Deeptop 内置插件：${plugin.id}`)
    }
    if (current.revision >= MAX_REVISION) throw new Error('插件配置 revision 已达到上限')
    const next = { version: VERSION, revision: current.revision + 1, plugins }
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('插件配置操作已取消')
    await writePluginTransaction(ctx, next, await buildProfilePatch(ctx, next))
    return {
      ...(await describePluginConfig(ctx)),
      changed: true,
      restartRequired: true,
    }
  }, signal)
}

export function readConfiguredPluginIds(config) {
  return new Set((config?.plugins || []).filter((plugin) => plugin.enabled !== false).map((plugin) => plugin.id))
}
