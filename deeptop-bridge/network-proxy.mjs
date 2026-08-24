import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

// 网络代理设置由 deeptop-bridge 独立持久化。Node 的 fetch 不会默认读取
// HTTPS_PROXY；对需要代理才能访问 opencode.ai 等服务的网络，必须为当前
// DSH 进程安装 Undici 的全局 dispatcher。

export const DEFAULT_PROXY = Object.freeze({ enabled: false, url: '' })

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeProxy(proxy) {
  const value = isRecord(proxy) ? proxy : {}
  const url = typeof value.url === 'string' ? value.url.trim() : ''
  return { enabled: value.enabled === true && url.length > 0, url }
}

function validateProxy(proxy) {
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

let undici
let initialDispatcher
let managedDispatcher

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

/** Apply one proxy selection to Node's process-wide fetch dispatcher. */
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
    const next = new client.ProxyAgent(normalized.url)
    client.setGlobalDispatcher(next)
    releaseManagedDispatcher()
    managedDispatcher = next
  } else {
    client.setGlobalDispatcher(initialDispatcher)
    releaseManagedDispatcher()
  }
  return { ok: true, proxy: normalized, applied: true }
}

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

/** Apply and persist a proxy selection, restoring the prior dispatcher on write failure. */
export async function setProxySetting(proxy) {
  const next = validateProxy(normalizeProxy(proxy))
  const previous = await loadProxySetting()
  const applied = await applyProxy(next)
  try {
    const saved = await saveProxySetting(next)
    return { proxy: saved, applied: applied.applied }
  } catch (error) {
    try {
      await applyProxy(previous)
    } catch {
      throw new Error(`代理设置未保存，且无法恢复此前的网络设置：${error instanceof Error ? error.message : String(error)}`)
    }
    throw error
  }
}

/** Load and apply the persisted selection before the bridge accepts requests. */
export async function initNetworkProxy() {
  const proxy = await loadProxySetting()
  try {
    return await applyProxy(proxy)
  } catch (error) {
    return {
      ok: false,
      proxy,
      applied: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
