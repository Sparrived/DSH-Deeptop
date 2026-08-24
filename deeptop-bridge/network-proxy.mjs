import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

// 网络代理设置由 deeptop-bridge 独立持久化。Node 的 fetch 不会默认读取
// Windows 系统代理（WinINet）；要跟随 Clash 的「系统代理」开关，必须读取
// 注册表并为当前 DSH 进程安装 Undici 的全局 dispatcher。
//
// 优先级：显式设置的代理 > Windows 系统代理 > 直连。

export const DEFAULT_PROXY = Object.freeze({ enabled: false, url: '' })
export const SYSTEM_PROXY_POLL_MS = 3000

const execFileAsync = promisify(execFile)

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeProxy(proxy) {
  const value = isRecord(proxy) ? proxy : {}
  const url = typeof value.url === 'string' ? value.url.trim() : ''
  const noProxy = typeof value.noProxy === 'string' ? value.noProxy : ''
  return { enabled: value.enabled === true && url.length > 0, url, ...(noProxy.length > 0 ? { noProxy } : {}) }
}

export function validateProxy(proxy) {
  if (!proxy.enabled) return proxy
  let parsed
  try {
    parsed = new URL(proxy.url)
  } catch {
    throw new Error('代理地址必须是完整的 HTTP 或 HTTPS URL，例如 http://127.0.0.1:7890。')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('当前运行时只支持 HTTP/HTTPS 正向代理；请为 SOCKS 代理启用其 HTTP 监听端口。')
  }
  if (parsed.hostname.length === 0) {
    throw new Error('代理地址必须包含主机名。')
  }
  return { ...proxy, url: parsed.toString() }
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

/** Parse the Windows ProxyServer value into a normalized proxy URL. */
export function parseWindowsProxyServer(value) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (raw.length === 0) return undefined
  // Windows supports "host:port" (single) or "http=host:port;https=host:port".
  const segments = raw.split(';').map(part => part.trim()).filter(Boolean)
  let url
  for (const segment of segments) {
    const [scheme, rest] = segment.split('=')
    if (rest !== undefined && scheme.trim().toLowerCase() === 'https') {
      url = rest.trim()
      break
    }
  }
  if (url === undefined) {
    // Prefer http= for an http-only proxy; otherwise use the single form or first segment.
    for (const segment of segments) {
      const [scheme, rest] = segment.split('=')
      if (rest !== undefined && scheme.trim().toLowerCase() === 'http') { url = rest.trim(); break }
    }
    if (url === undefined) {
      const plain = segments.find(part => !part.includes('='))
      if (plain !== undefined) url = plain
      else url = segments[0]?.split('=')[1]?.trim() ?? segments[0]
    }
  }
  if (typeof url !== 'string' || url.length === 0) return undefined
  // A bare host:port needs an http:// scheme for ProxyAgent.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = `http://${url}`
  return url
}

/**
 * Read the current Windows system proxy (WinINet) setting.
 * @returns {{ enabled: boolean, url: string, noProxy: string }}
 */
export async function readSystemProxy() {
  if (process.platform !== 'win32') return { ...DEFAULT_PROXY, noProxy: '' }
  const enabledValue = await registryValue('ProxyEnable')
  if (enabledValue === undefined) return { ...DEFAULT_PROXY, noProxy: '' }
  const enabled = enabledValue.toLowerCase() === '0x1' || enabledValue === '1'
  if (!enabled) return { ...DEFAULT_PROXY, noProxy: '' }
  const server = await registryValue('ProxyServer')
  if (server === undefined) return { ...DEFAULT_PROXY, noProxy: '' }
  const url = parseWindowsProxyServer(server)
  if (url === undefined) return { ...DEFAULT_PROXY, noProxy: '' }
  const noProxy = (await registryValue('ProxyOverride')) ?? ''
  return { enabled: true, url, noProxy, source: 'system' }
}

/** Normalize a Windows ProxyOverride list into a rule array for the custom dispatcher. */
export function normalizeProxyOverride(value) {
  const raw = typeof value === 'string' ? value : ''
  return raw
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => (part === '<local>' ? 'localhost' : part))
}

/**
 * A process-wide dispatcher that routes through an HTTP proxy while honoring
 * the Windows ProxyOverride semantics (including `127.*`-style suffix
 * wildcards that undici's own EnvHttpProxyAgent does not support).
 */
function createSystemProxyDispatcher(client, proxyUrl, noProxyRules) {
  const { Dispatcher, Agent, ProxyAgent } = client
  class SystemProxyDispatcher extends Dispatcher {
    constructor() {
      super()
      this.proxyAgent = new ProxyAgent(proxyUrl)
      this.directAgent = new Agent()
    }

    shouldProxy(hostname) {
      if (noProxyRules.length === 0) return true
      if (noProxyRules.includes('*')) return false
      const host = hostname.toLowerCase()
      for (const rawRule of noProxyRules) {
        const rule = rawRule.toLowerCase()
        if (rule === 'localhost' && (host === 'localhost' || host === '127.0.0.1' || host === '::1')) return false
        if (rule.endsWith('.*')) {
          const prefix = rule.slice(0, -2)
          if (host.startsWith(prefix)) return false
        } else if (rule.startsWith('*.')) {
          const suffix = rule.slice(1)
          if (host === suffix.slice(1) || host.endsWith(suffix)) return false
        } else if (host === rule || host.endsWith(`.${rule}`)) {
          return false
        }
      }
      return true
    }

    dispatch(opts, handler) {
      const url = new URL(opts.origin)
      const bareHost = url.hostname.replace(/:\d*$/, '').replace(/^\[(.+)\]$/, '$1')
      const agent = this.shouldProxy(bareHost) ? this.proxyAgent : this.directAgent
      return agent.dispatch(opts, handler)
    }

    close() {
      return Promise.all([this.proxyAgent.close(), this.directAgent.close()])
    }
  }
  return new SystemProxyDispatcher()
}

let undici
let initialDispatcher
let managedDispatcher
let watching = false
let pollTimer

async function loadUndici() {
  if (undici !== undefined) return undici
  try {
    undici = await import('undici')
    return undici
  } catch (packageError) {
    const runtimeRoot = process.env.DEEPTOP_DSH_RUNTIME_ROOT
    if (typeof runtimeRoot === 'string' && runtimeRoot.trim() !== '') {
      try {
        undici = await import(pathToFileURL(join(runtimeRoot, 'node_modules', 'undici', 'index.js')).href)
        return undici
      } catch (runtimeError) {
        throw new Error(`无法加载内嵌网络代理组件：${runtimeError instanceof Error ? runtimeError.message : String(runtimeError)}`, { cause: packageError })
      }
    }
    throw new Error('当前 DSH 运行时未加载网络代理组件；请重新安装或更新 Deeptop。', { cause: packageError })
  }
}

function releaseManagedDispatcher() {
  const previous = managedDispatcher
  managedDispatcher = undefined
  if (previous !== undefined && typeof previous.close === 'function') {
    void previous.close().catch(() => {
      // A completed or already-destroyed dispatcher has nothing left to release.
    })
  }
}

/**
 * A full resolver: returns the effective proxy that should be installed now.
 * explicit > system > none.
 */
export async function resolveEffectiveProxy() {
  const explicit = await loadProxySetting()
  if (explicit.enabled) {
    return { ...explicit, source: 'explicit', noProxy: normalizeProxyOverride('localhost;127.0.0.1;::1') }
  }
  const system = await readSystemProxy()
  if (system.enabled) {
    return { ...system, source: 'system', noProxy: normalizeProxyOverride(system.noProxy) }
  }
  return { ...DEFAULT_PROXY, source: 'none', noProxy: '' }
}

/** Apply an effective proxy selection to Node's process-wide fetch dispatcher. */
export async function applyProxy(proxy) {
  const normalized = validateProxy(normalizeProxy(proxy))
  if (!normalized.enabled && undici === undefined && managedDispatcher === undefined) {
    return { ok: true, proxy: normalized, applied: true }
  }

  const client = await loadUndici()
  if (typeof client.setGlobalDispatcher !== 'function'
    || typeof client.getGlobalDispatcher !== 'function'
    || typeof client.ProxyAgent !== 'function') {
    throw new Error('当前 DSH 运行时的网络代理组件不完整；请重新安装或更新 Deeptop。')
  }

  initialDispatcher ??= client.getGlobalDispatcher()
  if (normalized.enabled) {
    const noProxyRules = normalizeProxyOverride(normalized.noProxy)
    const next = createSystemProxyDispatcher(client, normalized.url, noProxyRules)
    client.setGlobalDispatcher(next)
    releaseManagedDispatcher()
    managedDispatcher = next
  } else {
    client.setGlobalDispatcher(initialDispatcher)
    releaseManagedDispatcher()
  }
  return { ok: true, proxy: normalized, applied: true }
}

/** Apply and persist an explicit proxy selection, restoring prior state on write failure. */
export async function setProxySetting(proxy) {
  const next = validateProxy(normalizeProxy(proxy))
  const previous = await loadProxySetting()
  try {
    const saved = await saveProxySetting(next)
    const effective = next.enabled
      ? { ...next, source: 'explicit', noProxy: normalizeProxyOverride('localhost;127.0.0.1;::1') }
      : await resolveEffectiveProxy()
    const applied = await applyProxy(effective)
    return { proxy: saved, applied: applied.applied, effective }
  } catch (error) {
    try {
      await saveProxySetting(previous)
      await applyProxy(previous.enabled
        ? { ...previous, source: 'explicit', noProxy: normalizeProxyOverride('localhost;127.0.0.1;::1') }
        : await resolveEffectiveProxy())
    } catch {
      throw new Error(`代理设置未保存，且无法恢复此前的网络设置：${error instanceof Error ? error.message : String(error)}`)
    }
    throw error
  }
}

let lastEffectiveSnapshot

/** Apply the current effective proxy and remember the snapshot for change detection. */
async function refreshEffectiveProxy() {
  const effective = await resolveEffectiveProxy()
  const noProxyKey = Array.isArray(effective.noProxy) ? effective.noProxy.join('|') : String(effective.noProxy ?? '')
  const key = `${effective.source}:${effective.url}:${noProxyKey}`
  if (key === lastEffectiveSnapshot) return { effective, changed: false }
  lastEffectiveSnapshot = key
  const result = await applyProxy(effective)
  return { effective, changed: true, applied: result.applied }
}

/** Start polling the system proxy (Windows registry) so Clash toggles take effect. */
export function startSystemProxyWatch(intervalMs = SYSTEM_PROXY_POLL_MS) {
  if (watching) return { started: true }
  watching = true
  pollTimer = setInterval(() => {
    void refreshEffectiveProxy().catch(() => {
      // Poll failures must never crash the bridge; a transient reg.exe error keeps the last state.
    })
  }, intervalMs)
  if (typeof pollTimer.unref === 'function') pollTimer.unref()
  return { started: true }
}

export function stopSystemProxyWatch() {
  if (pollTimer !== undefined) clearInterval(pollTimer)
  pollTimer = undefined
  watching = false
  lastEffectiveSnapshot = undefined
}

/** Load the effective proxy before the bridge accepts requests, then start watching. */
export async function initNetworkProxy() {
  try {
    const result = await refreshEffectiveProxy()
    startSystemProxyWatch()
    return { ok: true, applied: result.applied, effective: result.effective }
  } catch (error) {
    startSystemProxyWatch()
    return {
      ok: false,
      applied: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
