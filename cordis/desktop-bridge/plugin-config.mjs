import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

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
  const home = ctx?.get?.('dshHome') || process.env.DSH_HOME
  if (typeof home !== 'string' || !home.trim()) {
    throw new Error('插件配置需要 DSH_HOME')
  }
  return join(home, 'profiles', 'desktop', CONFIG_FILE)
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
  if (name.length > 2048 || name.includes('\0')) throw new Error('插件模块路径无效')
  return name
}

function normalizePlugins(value) {
  if (!Array.isArray(value)) throw new Error('插件列表必须是数组')
  const seen = new Set()
  return value.map((item) => {
    if (!isRecord(item)) throw new Error('插件条目必须是对象')
    const id = normalizeId(item.id)
    const name = normalizeName(item.name)
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
  const plugins = []
  let pendingId = null
  for (const line of String(raw).split(/\r?\n/)) {
    const idMatch = line.match(/^\s+-\s+id:\s*([A-Za-z0-9][A-Za-z0-9._-]{0,95})\s*$/)
    if (idMatch) {
      pendingId = idMatch[1]
      continue
    }
    const nameMatch = line.match(/^\s+name:\s*['\"](.*)['\"]\s*$/)
    if (pendingId && nameMatch) {
      plugins.push({ id: pendingId, name: nameMatch[1].replaceAll("''", "'"), enabled: true })
      pendingId = null
    }
  }
  return normalizePlugins(plugins)
}

async function readConfig(ctx) {
  const path = configPath(ctx)
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw)
    if (!isRecord(parsed)) throw new Error('插件配置格式无效')
    return {
      version: VERSION,
      revision: Number.isInteger(parsed.revision) && parsed.revision >= 0 ? parsed.revision : 0,
      plugins: normalizePlugins(parsed.plugins || []),
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw new Error(`无法读取 Deeptop 插件配置：${error.message}`)
    const patch = await readFile(join(dirname(path), PATCH_FILE), 'utf8').catch((patchError) => {
      if (patchError?.code === 'ENOENT') return ''
      throw patchError
    })
    return { ...defaultConfig(), plugins: parsePatchPlugins(patch) }
  }
}

async function writeConfig(ctx, config) {
  const path = configPath(ctx)
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`
  const content = `${JSON.stringify(config, null, 2)}\n`
  await mkdir(dirname(path), { recursive: true })
  await writeFile(tempPath, content, 'utf8')
  await rename(tempPath, path)
}

function toProfilePatch(config) {
  const enabled = config.plugins.filter((plugin) => plugin.enabled)
  if (enabled.length === 0) return []
  return [{ insert: enabled.map((plugin) => ({ id: plugin.id, name: plugin.name })) }]
}

function quoteYaml(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

async function syncProfilePatch(ctx, config) {
  const path = join(dirname(configPath(ctx)), PATCH_FILE)
  const current = await readFile(path, 'utf8').catch((error) => {
    if (error?.code === 'ENOENT') return ''
    throw error
  })
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
  const start = current.indexOf(PATCH_START)
  const end = current.indexOf(PATCH_END)
  let next
  if (start >= 0 && end >= start) {
    next = `${current.slice(0, start).trimEnd()}\n${managed}${current.slice(end + PATCH_END.length)}`
  } else {
    next = `${current.trimEnd()}\n\n${managed}\n`
  }
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`
  await mkdir(dirname(path), { recursive: true })
  await writeFile(tempPath, next, 'utf8')
  await rename(tempPath, path)
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

export async function mutatePluginConfig(ctx, payload) {
  if (!isRecord(payload) || !Array.isArray(payload.plugins)) {
    throw new Error('plugin.config.mutate requires plugins')
  }
  const current = await readConfig(ctx)
  if (payload.expectedRevision !== undefined && payload.expectedRevision !== current.revision) {
    throw new Error(`插件列表已被其他操作更新，请刷新后重试（当前 revision ${current.revision}）`)
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
  const next = { version: VERSION, revision: current.revision + 1, plugins }
  await writeConfig(ctx, next)
  await syncProfilePatch(ctx, next)
  return {
    ...(await describePluginConfig(ctx)),
    changed: true,
    restartRequired: true,
  }
}

export function readConfiguredPluginIds(config) {
  return new Set((config?.plugins || []).filter((plugin) => plugin.enabled !== false).map((plugin) => plugin.id))
}
