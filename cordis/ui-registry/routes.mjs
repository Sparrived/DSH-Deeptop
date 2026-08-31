// Restricted desktop routes for the UI plugin runtime. Every handler validates
// against the host ui registry before touching any official service, and all
// denials carry stable error codes (see ./manifest.mjs) so the
// WebView can branch on them instead of parsing messages.
//
// Handlers receive the cordis ctx and a duck-typed registry service, so route
// tests can substitute fakes without loading @deepseek-ai packages.

import {
  uiPluginError,
  validateScopedInvoke,
  validateScopedStorageKey,
  UI_PLUGIN_ERROR_CODES,
} from './manifest.mjs'

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalRegistry(ctx) {
  const registry = ctx.get?.('deeptopUiRegistry')
  if (!registry || typeof registry.list !== 'function') return undefined
  return registry
}

/** ui.plugin.list: capability probe. An absent registry means "no plugins", never a failure. */
export async function listUiPlugins(ctx) {
  const registry = optionalRegistry(ctx)
  if (!registry) return { items: [] }
  return { items: registry.list() }
}

/** ui.plugin.module: metadata only — bundle bytes are served by the client-side bundled table for now. */
export async function getUiPluginModule(ctx, payload) {
  if (!isRecord(payload) || typeof payload.pluginId !== 'string' || payload.pluginId.trim() === '') {
    throw uiPluginError(UI_PLUGIN_ERROR_CODES.invalidRequest, 'ui.plugin.module requires pluginId')
  }
  const registry = optionalRegistry(ctx)
  if (!registry) throw uiPluginError(UI_PLUGIN_ERROR_CODES.hostUnavailable, 'the desktop profile does not provide deeptop-ui-registry')
  const descriptor = typeof registry.getModule === 'function' ? registry.getModule(payload.pluginId) : undefined
  if (!descriptor) throw uiPluginError(UI_PLUGIN_ERROR_CODES.pluginNotFound, `ui plugin ${JSON.stringify(payload.pluginId)} has no registered client module`)
  return descriptor
}

/**
 * ui.plugin.bundle: host-only route consumed by the Tauri controlled resource
 * protocol (never by the WebView). Returns the registered local bundle path so
 * the desktop process can enforce the path fence and integrity before serving
 * `deeptop-plugin://` bytes. clientPath stays host-private: this response must
 * not be forwarded to any webview realm.
 */
export async function getUiPluginBundle(ctx, payload) {
  if (!isRecord(payload) || typeof payload.pluginId !== 'string' || payload.pluginId.trim() === '') {
    throw uiPluginError(UI_PLUGIN_ERROR_CODES.invalidRequest, 'ui.plugin.bundle requires pluginId')
  }
  const registry = optionalRegistry(ctx)
  if (!registry) throw uiPluginError(UI_PLUGIN_ERROR_CODES.hostUnavailable, 'the desktop profile does not provide deeptop-ui-registry')
  if (typeof registry.bundle !== 'function') throw uiPluginError(UI_PLUGIN_ERROR_CODES.hostUnavailable, 'the ui registry does not support bundle resolution')
  return registry.bundle(payload.pluginId)
}

/** ui.plugin.invoke: manifest-checked gateway forwarding with official cancel semantics. */
export async function invokeUiPluginRemote(ctx, payload, signal) {
  const registry = optionalRegistry(ctx)
  if (!registry) throw uiPluginError(UI_PLUGIN_ERROR_CODES.hostUnavailable, 'the desktop profile does not provide deeptop-ui-registry')
  const record = typeof registry.require === 'function'
    ? registry.require(isRecord(payload) ? payload.pluginId : undefined)
    : undefined
  const call = validateScopedInvoke(record ?? null, payload)
  if (typeof registry.hasRemoteHandler === 'function' && registry.hasRemoteHandler(call.pluginId, call.namespace, call.method)) {
    const value = await registry.invokeRemote(call, signal)
    return { value }
  }
  const gateway = ctx.get?.('typertGateway')
  if (!gateway || typeof gateway.invoke !== 'function') {
    throw uiPluginError(UI_PLUGIN_ERROR_CODES.hostUnavailable, 'ui.plugin.invoke requires @deepseek-ai/dsh-api-gateway')
  }
  const value = await gateway.invoke({
    namespace: call.namespace,
    method: call.method,
    args: call.args,
    signal,
  })
  return { value }
}

function storageNamespace(registry, payload) {
  if (!isRecord(payload) || typeof payload.pluginId !== 'string' || payload.pluginId.trim() === '') {
    throw uiPluginError(UI_PLUGIN_ERROR_CODES.invalidRequest, 'ui plugin storage routes require pluginId')
  }
  const record = typeof registry.require === 'function' ? registry.require(payload.pluginId) : undefined
  if (!record) throw uiPluginError(UI_PLUGIN_ERROR_CODES.pluginNotFound, `ui plugin ${JSON.stringify(payload.pluginId)} is not registered`)
  if (record.status !== 'available') throw uiPluginError(UI_PLUGIN_ERROR_CODES.pluginDisabled, `ui plugin ${payload.pluginId} is not enabled`)
  const namespace = record.capabilities?.storage
  if (typeof namespace !== 'string') {
    throw uiPluginError(UI_PLUGIN_ERROR_CODES.capabilityDenied, `ui plugin ${payload.pluginId} does not declare scoped storage`)
  }
  return namespace
}

export async function getUiPluginStorage(ctx, payload) {
  const registry = optionalRegistry(ctx)
  if (!registry || typeof registry.storageGet !== 'function') {
    throw uiPluginError(UI_PLUGIN_ERROR_CODES.hostUnavailable, 'the desktop profile does not provide deeptop-ui-registry')
  }
  const namespace = storageNamespace(registry, payload)
  if (!isRecord(payload) || typeof payload.key !== 'string') {
    throw uiPluginError(UI_PLUGIN_ERROR_CODES.storageInvalidKey, 'ui.plugin.storage.get requires a string key')
  }
  validateScopedStorageKey(namespace, payload.key)
  return { value: await registry.storageGet(namespace, payload.key) ?? null }
}

export async function setUiPluginStorage(ctx, payload) {
  const registry = optionalRegistry(ctx)
  if (!registry || typeof registry.storageSet !== 'function') {
    throw uiPluginError(UI_PLUGIN_ERROR_CODES.hostUnavailable, 'the desktop profile does not provide deeptop-ui-registry')
  }
  const namespace = storageNamespace(registry, payload)
  if (!isRecord(payload) || typeof payload.key !== 'string' || !('value' in payload)) {
    throw uiPluginError(UI_PLUGIN_ERROR_CODES.invalidRequest, 'ui.plugin.storage.set requires key and value')
  }
  validateScopedStorageKey(namespace, payload.key)
  await registry.storageSet(namespace, payload.key, payload.value)
  return { stored: true }
}

export async function deleteUiPluginStorage(ctx, payload) {
  const registry = optionalRegistry(ctx)
  if (!registry || typeof registry.storageDelete !== 'function') {
    throw uiPluginError(UI_PLUGIN_ERROR_CODES.hostUnavailable, 'the desktop profile does not provide deeptop-ui-registry')
  }
  const namespace = storageNamespace(registry, payload)
  if (!isRecord(payload) || typeof payload.key !== 'string') {
    throw uiPluginError(UI_PLUGIN_ERROR_CODES.storageInvalidKey, 'ui.plugin.storage.delete requires a string key')
  }
  validateScopedStorageKey(namespace, payload.key)
  await registry.storageDelete(namespace, payload.key)
  return { deleted: true }
}
