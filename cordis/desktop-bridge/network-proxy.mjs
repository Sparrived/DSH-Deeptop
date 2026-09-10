import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

// Deeptop owns the desktop setting and Windows system-proxy discovery. DSH owns
// the process-wide transport policy, including fetch, dedicated egress clients,
// and the proxy environment passed to child processes.
//
// Priority: explicit setting > Windows system proxy > direct.

export const DEFAULT_PROXY = Object.freeze({ enabled: false, url: '' })
export const SYSTEM_PROXY_POLL_MS = 3000

const execFileAsync = promisify(execFile)

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const HTTP_PROXY_URL = Symbol('httpProxyUrl')
const HTTPS_PROXY_URL = Symbol('httpsProxyUrl')
const PROTOCOL_PROXY_ENDPOINTS = Symbol('protocolProxyEndpoints')

function withProxyEndpoints(proxy, httpUrl, httpsUrl, protocolSpecific = false) {
  if (httpUrl !== undefined) Object.defineProperty(proxy, HTTP_PROXY_URL, { value: httpUrl })
  if (httpsUrl !== undefined) Object.defineProperty(proxy, HTTPS_PROXY_URL, { value: httpsUrl })
  if (protocolSpecific) Object.defineProperty(proxy, PROTOCOL_PROXY_ENDPOINTS, { value: true })
  return proxy
}

function normalizeProxy(proxy) {
  const value = isRecord(proxy) ? proxy : {}
  const url = typeof value.url === 'string' ? value.url.trim() : ''
  const noProxy = typeof value.noProxy === 'string' ? value.noProxy.trim() : ''
  return withProxyEndpoints(
    { enabled: value.enabled === true && url.length > 0, url, ...(noProxy.length > 0 ? { noProxy } : {}) },
    value[HTTP_PROXY_URL],
    value[HTTPS_PROXY_URL],
    value[PROTOCOL_PROXY_ENDPOINTS] === true,
  )
}

function validateProxyUrl(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('代理地址必须是完整的 HTTP 或 HTTPS URL，例如 http://127.0.0.1:7890。')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('当前运行时只支持 HTTP/HTTPS 正向代理；请为 SOCKS 代理启用其 HTTP 监听端口。')
  }
  if (parsed.hostname.length === 0) throw new Error('代理地址必须包含主机名。')
  return parsed.toString()
}

export function validateProxy(proxy) {
  if (!proxy.enabled) return proxy
  return withProxyEndpoints(
    { ...proxy, url: validateProxyUrl(proxy.url) },
    proxy[HTTP_PROXY_URL] === undefined ? undefined : validateProxyUrl(proxy[HTTP_PROXY_URL]),
    proxy[HTTPS_PROXY_URL] === undefined ? undefined : validateProxyUrl(proxy[HTTPS_PROXY_URL]),
    proxy[PROTOCOL_PROXY_ENDPOINTS] === true,
  )
}

function proxyFile() {
  const root = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(root, 'network-proxy.json')
}

/** Read the persisted explicit proxy selection (what the user entered in-app). */
export async function loadProxySetting() {
  try {
    const raw = await readFile(proxyFile(), 'utf8')
    return normalizeProxy(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_PROXY }
  }
}

export async function saveProxySetting(proxy) {
  const normalized = validateProxy(normalizeProxy(proxy))
  const file = proxyFile()
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
  return normalized
}

const REGISTRY_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'

/** Query one Windows registry value; returns undefined when the key/value is absent. */
async function registryValue(name) {
  try {
    const { stdout } = await execFileAsync('reg.exe', ['query', REGISTRY_KEY, '/v', name], {
      windowsHide: true,
      encoding: 'utf8',
    })
    // reg.exe output lines look like "    ProxyServer    REG_SZ    127.0.0.1:7890".
    for (const line of stdout.split(/\r?\n/)) {
      const match = line.match(/^\s+(\S+)\s+(\S+)\s+(\S.*?)\s*$/)
      if (match && match[2] !== 'REG_SZ' && match[2] !== 'REG_DWORD') continue
      if (match && (match[2] === 'REG_SZ' || match[2] === 'REG_DWORD')) {
        return match[3].trim()
      }
    }
    return undefined
  } catch {
    return undefined
  }
}

function normalizeWindowsProxyUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const url = value.trim()
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `http://${url}`
}

function parseWindowsProxyEndpoints(value) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (raw.length === 0) return undefined
  const routes = new Map()
  let fallback
  for (const segment of raw.split(';').map(part => part.trim()).filter(Boolean)) {
    const separator = segment.indexOf('=')
    if (separator < 0) {
      fallback ??= normalizeWindowsProxyUrl(segment)
      continue
    }
    const scheme = segment.slice(0, separator).trim().toLowerCase()
    const url = normalizeWindowsProxyUrl(segment.slice(separator + 1))
    if (url !== undefined && (scheme === 'http' || scheme === 'https')) routes.set(scheme, url)
  }
  const protocolSpecific = routes.size > 0
  const httpUrl = protocolSpecific ? routes.get('http') : fallback
  const httpsUrl = protocolSpecific ? routes.get('https') : fallback
  const url = httpsUrl ?? httpUrl
  return url === undefined ? undefined : { url, httpUrl, httpsUrl, protocolSpecific }
}

/** Parse the Windows ProxyServer value into a usable proxy URL for the existing UI contract. */
export function parseWindowsProxyServer(value) {
  return parseWindowsProxyEndpoints(value)?.url
}

/** Read the current Windows system proxy (WinINet) setting. */
export async function readSystemProxy() {
  if (process.platform !== 'win32') return { ...DEFAULT_PROXY, noProxy: '' }
  const enabledValue = await registryValue('ProxyEnable')
  if (enabledValue === undefined) return { ...DEFAULT_PROXY, noProxy: '' }
  const enabled = enabledValue.toLowerCase() === '0x1' || enabledValue === '1'
  if (!enabled) return { ...DEFAULT_PROXY, noProxy: '' }
  const server = await registryValue('ProxyServer')
  if (server === undefined) return { ...DEFAULT_PROXY, noProxy: '' }
  const endpoints = parseWindowsProxyEndpoints(server)
  if (endpoints === undefined) return { ...DEFAULT_PROXY, noProxy: '' }
  const noProxy = (await registryValue('ProxyOverride')) ?? ''
  return withProxyEndpoints(
    { enabled: true, url: endpoints.url, noProxy, source: 'system' },
    endpoints.httpUrl,
    endpoints.httpsUrl,
    endpoints.protocolSpecific,
  )
}

/** Normalize Windows ProxyOverride entries into DSH NO_PROXY entries. */
export function normalizeProxyOverride(value) {
  const raw = typeof value === 'string' ? value : ''
  return raw
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .flatMap(part => part.toLowerCase() === '<local>' ? ['localhost', '<local>'] : [part])
}

function proxyBypassList(value) {
  return normalizeProxyOverride(value).join(',')
}

async function loadDshHttpProxy() {
  if (dshHttpProxy !== undefined) return dshHttpProxy
  try {
    dshHttpProxy = await import('@deepseek-ai/dsh-http-proxy')
    return dshHttpProxy
  } catch (packageError) {
    const runtimeRoot = process.env.DEEPTOP_DSH_RUNTIME_ROOT
    const runtimeEntry = typeof runtimeRoot === 'string' && runtimeRoot.trim() !== ''
      ? pathToFileURL(join(runtimeRoot, 'node_modules', '@deepseek-ai', 'dsh-http-proxy', 'lib', 'index.js')).href
      : undefined
    const developmentEntry = new URL('../../vendor/dsh/packages/util/http-proxy/lib/index.js', import.meta.url).href
    for (const entry of [runtimeEntry, developmentEntry]) {
      if (entry === undefined) continue
      try {
        dshHttpProxy = await import(entry)
        return dshHttpProxy
      } catch {
        // Try the next supported runtime location before reporting the original package failure.
      }
    }
    throw new Error('当前 DSH 运行时未加载官方网络代理组件；请重新安装或更新 Deeptop。', { cause: packageError })
  }
}

function proxyEnvironment(proxy) {
  const values = proxy.enabled
    ? {
        HTTP_PROXY: proxy[PROTOCOL_PROXY_ENDPOINTS] ? proxy[HTTP_PROXY_URL] : proxy[HTTP_PROXY_URL] ?? proxy.url,
        HTTPS_PROXY: proxy[PROTOCOL_PROXY_ENDPOINTS] ? proxy[HTTPS_PROXY_URL] : proxy[HTTPS_PROXY_URL] ?? proxy.url,
        NO_PROXY: proxy.noProxy ?? '',
      }
    : {}
  return {
    get(name) {
      const value = values[name.toUpperCase()]
      return typeof value === 'string' && value !== '' ? { value } : undefined
    },
  }
}

let dshHttpProxy
let desktopProxyDispose
let appliedDesktopProxy
let proxyOperationTail = Promise.resolve()
let settingOperationTail = Promise.resolve()
let watching = false
let pollTimer
let lastEffectiveSnapshot
let proxyEpoch = 0

function enqueueProxyOperation(operation) {
  const result = proxyOperationTail.then(operation, operation)
  proxyOperationTail = result.then(() => undefined, () => undefined)
  return result
}

function enqueueSettingOperation(operation) {
  const result = settingOperationTail.then(operation, operation)
  settingOperationTail = result.then(() => undefined, () => undefined)
  return result
}

/** Apply one desktop policy through DSH's official global dispatcher and child-environment policy. */
export function applyProxy(proxy, expectedEpoch) {
  const normalized = validateProxy(normalizeProxy(proxy))
  return enqueueProxyOperation(async () => {
    if (expectedEpoch !== undefined && expectedEpoch !== proxyEpoch) return { ok: true, proxy: normalized, applied: false }
    const client = await loadDshHttpProxy()
    const previousDispose = desktopProxyDispose
    const previousProxy = appliedDesktopProxy
    desktopProxyDispose = undefined
    appliedDesktopProxy = undefined
    await previousDispose?.()
    try {
      desktopProxyDispose = await client.installProxyFromEnvironment(
        proxyEnvironment(normalized),
        message => { console.warn(`[deeptop-bridge] ${message}`) },
        { childEnvironment: 'resolved' },
      )
      appliedDesktopProxy = normalized
      return { ok: true, proxy: normalized, applied: true }
    } catch (error) {
      if (previousProxy !== undefined) {
        try {
          desktopProxyDispose = await client.installProxyFromEnvironment(
            proxyEnvironment(previousProxy),
            message => { console.warn(`[deeptop-bridge] ${message}`) },
            { childEnvironment: 'resolved' },
          )
          appliedDesktopProxy = previousProxy
        } catch {
          // The caller receives the original failure; a later refresh can retry the previous policy.
        }
      }
      throw error
    }
  })
}

/** Release the desktop overlay and restore the DSH launch policy. */
export function disposeNetworkProxy() {
  stopSystemProxyWatch()
  return enqueueProxyOperation(async () => {
    const dispose = desktopProxyDispose
    desktopProxyDispose = undefined
    appliedDesktopProxy = undefined
    await dispose?.()
  })
}

/** A full resolver: returns the effective proxy that should be installed now. */
export async function resolveEffectiveProxy() {
  const explicit = await loadProxySetting()
  if (explicit.enabled) {
    return { ...explicit, source: 'explicit', noProxy: 'localhost,127.0.0.1,::1' }
  }
  const system = await readSystemProxy()
  if (system.enabled) {
    return withProxyEndpoints(
      { ...system, source: 'system', noProxy: proxyBypassList(system.noProxy) },
      system[HTTP_PROXY_URL],
      system[HTTPS_PROXY_URL],
      system[PROTOCOL_PROXY_ENDPOINTS] === true,
    )
  }
  return { ...DEFAULT_PROXY, source: 'none', noProxy: '' }
}

/** Apply and persist an explicit proxy selection, restoring prior state on write failure. */
export async function setProxySetting(proxy) {
  const next = validateProxy(normalizeProxy(proxy))
  return enqueueSettingOperation(async () => {
    proxyEpoch += 1
    const previous = await loadProxySetting()
    try {
      const saved = await saveProxySetting(next)
      const effective = next.enabled
        ? { ...next, source: 'explicit', noProxy: 'localhost,127.0.0.1,::1' }
        : await resolveEffectiveProxy()
      const applied = await applyProxy(effective)
      lastEffectiveSnapshot = effectiveSnapshot(effective)
      return { proxy: saved, applied: applied.applied, effective }
    } catch (error) {
      try {
        await saveProxySetting(previous)
        const effective = previous.enabled
          ? { ...previous, source: 'explicit', noProxy: 'localhost,127.0.0.1,::1' }
          : await resolveEffectiveProxy()
        await applyProxy(effective)
        lastEffectiveSnapshot = effectiveSnapshot(effective)
      } catch {
        throw new Error(`代理设置未保存，且无法恢复此前的网络设置：${error instanceof Error ? error.message : String(error)}`)
      }
      throw error
    }
  })
}

function effectiveSnapshot(proxy) {
  return `${proxy.source}:${proxy.url}:${proxy[HTTP_PROXY_URL] ?? ''}:${proxy[HTTPS_PROXY_URL] ?? ''}:${proxy.noProxy}`
}

/** Apply the current effective proxy and remember the snapshot for change detection. */
async function refreshEffectiveProxy(epoch = proxyEpoch) {
  const effective = await resolveEffectiveProxy()
  if (!watching || epoch !== proxyEpoch) return { effective, changed: false, applied: false }
  const key = effectiveSnapshot(effective)
  if (key === lastEffectiveSnapshot) return { effective, changed: false, applied: true }
  const result = await applyProxy(effective, epoch)
  if (result.applied && watching && epoch === proxyEpoch) lastEffectiveSnapshot = key
  return { effective, changed: result.applied, applied: result.applied }
}

/** Start polling the system proxy (Windows registry) so Clash toggles take effect. */
export function startSystemProxyWatch(intervalMs = SYSTEM_PROXY_POLL_MS) {
  if (watching) return { started: true }
  watching = true
  pollTimer = setInterval(() => {
    void refreshEffectiveProxy().catch(() => {
      // Poll failures must never crash the bridge; a transient reg.exe error keeps the last policy.
    })
  }, intervalMs)
  if (typeof pollTimer.unref === 'function') pollTimer.unref()
  return { started: true }
}

export function stopSystemProxyWatch() {
  if (pollTimer !== undefined) clearInterval(pollTimer)
  pollTimer = undefined
  watching = false
  proxyEpoch += 1
  lastEffectiveSnapshot = undefined
}

/** Load the effective proxy before the bridge accepts requests, then start watching. */
export async function initNetworkProxy() {
  startSystemProxyWatch()
  try {
    const result = await refreshEffectiveProxy()
    return { ok: true, applied: result.applied, effective: result.effective }
  } catch (error) {
    return {
      ok: false,
      applied: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
