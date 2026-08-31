// deeptop-ui-registry: the Cordis host side of the Deeptop desktop UI plugin
// protocol. Host plugins register their UI declarations here (client module
// descriptors plus declarative slot contributions); the desktop bridge reads
// this service through `ctx.get('deeptopUiRegistry')` and exposes it over the
// restricted ui.plugin.* routes.
//
// This service never touches React, DOM, or the WebView realm: everything it
// stores and returns is JSON-serializable protocol data validated by
// ./manifest.mjs.

import { Service } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import {
  STORAGE_LIMITS,
  encodeStorageValue,
  normalizeUiPluginRegistration,
  toListDescriptor,
  uiPluginError,
  validateScopedStorageKey,
  UI_PLUGIN_ERROR_CODES,
} from './manifest.mjs'

const storageRecordSchema = z.object({ json: z.string() })

const uiPluginStorageSpec = defineDomain({
  name: 'deeptop_ui_plugins',
  version: 0,
  tables: { entries: domainTable(storageRecordSchema) },
})

function normalizeRemoteHandlers(input, record) {
  if (input === undefined) return undefined
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw uiPluginError(UI_PLUGIN_ERROR_CODES.manifestInvalid, 'remoteHandlers must be an object')
  }
  const handlers = {}
  for (const [namespace, methods] of Object.entries(input)) {
    const declared = record.capabilities.remotes.find(remote => remote.namespace === namespace)
    if (!declared) {
      throw uiPluginError(UI_PLUGIN_ERROR_CODES.manifestInvalid, `remoteHandlers namespace "${namespace}" is not declared`)
    }
    if (typeof methods !== 'object' || methods === null || Array.isArray(methods)) {
      throw uiPluginError(UI_PLUGIN_ERROR_CODES.manifestInvalid, `remoteHandlers namespace "${namespace}" must be an object`)
    }
    const normalizedMethods = {}
    for (const [method, handler] of Object.entries(methods)) {
      if (!declared.methods.includes(method) || typeof handler !== 'function') {
        throw uiPluginError(UI_PLUGIN_ERROR_CODES.manifestInvalid, `remoteHandlers method "${namespace}.${method}" must be a declared function`)
      }
      normalizedMethods[method] = handler
    }
    handlers[namespace] = normalizedMethods
  }
  return handlers
}

/**
 * Durable, namespace-scoped JSON KV for UI plugins. One table row per
 * `<storage namespace>/<key>`; values are stored as serialized JSON strings so
 * the durable schema stays closed while plugin payloads stay arbitrary JSON.
 */
export class DeeptopUiRegistryService extends Service {
  static inject = ['storageDomain']

  records = new Map()
  domain

  constructor(ctx) {
    super(ctx, 'deeptopUiRegistry')
  }

  async [Service.init]() {
    const domain = await this.ctx.storageDomain.open(uiPluginStorageSpec)
    this.domain = domain
    const entries = domain.table('entries')
    this.storageTable = entries
    this.ctx.effect(() => async () => {
      await domain.close()
      this.records.clear()
    }, 'deeptop-ui-registry.domainClose')
  }

  /**
   * Register one UI plugin declaration (client module descriptor and/or
   * declarative contributions). Re-registering an id replaces the previous
   * declaration, matching a plugin hot reload. Returns the disposer.
   */
  registerUiPlugin(input) {
    const record = normalizeUiPluginRegistration(input)
    const remoteHandlers = normalizeRemoteHandlers(input.remoteHandlers, record)
    const ownedRecord = remoteHandlers === undefined ? record : { ...record, remoteHandlers }
    if (this.records.has(ownedRecord.pluginId)) {
      throw uiPluginError(
        UI_PLUGIN_ERROR_CODES.manifestInvalid,
        `ui plugin ${ownedRecord.pluginId} is already registered by another host plugin`,
      )
    }
    this.records.set(ownedRecord.pluginId, ownedRecord)
    return () => {
      if (this.records.get(ownedRecord.pluginId) === ownedRecord) this.records.delete(ownedRecord.pluginId)
    }
  }

  /** Return whether a validated manifest call has a host-owned handler. */
  hasRemoteHandler(pluginId, namespace, method) {
    return typeof this.records.get(pluginId)?.remoteHandlers?.[namespace]?.[method] === 'function'
  }

  /** Invoke one host-owned handler after the UI route has validated its manifest call. */
  async invokeRemote(call, signal) {
    const handler = this.records.get(call.pluginId)?.remoteHandlers?.[call.namespace]?.[call.method]
    if (typeof handler !== 'function') {
      throw uiPluginError(
        UI_PLUGIN_ERROR_CODES.hostUnavailable,
        `ui plugin ${call.pluginId} has no host handler for ${call.namespace}.${call.method}`,
      )
    }
    return handler(call.args, signal)
  }

  /** Snapshot of every registration in list-response shape. */
  list() {
    return [...this.records.values()].map(toListDescriptor)
  }

  /** Module metadata for one plugin, or undefined when absent / host-only. */
  getModule(pluginId) {
    const record = this.records.get(pluginId)
    if (!record?.client) return undefined
    return {
      pluginId,
      entryId: record.client.entryId,
      format: record.client.format,
      sdkVersion: record.client.sdkVersion,
      ...(record.client.integrity ? { integrity: record.client.integrity } : {}),
    }
  }

  require(pluginId) {
    return this.records.get(pluginId)
  }

  /**
   * Host-private bundle descriptor for the Tauri controlled resource protocol
   * (ui.plugin.bundle). This is the only accessor that reveals a local path,
   * and it is consumed exclusively by the desktop process: it must never be
   * serialized into a webview-facing route response.
   */
  bundle(pluginId) {
    const record = this.records.get(pluginId)
    if (record === undefined) {
      throw uiPluginError(UI_PLUGIN_ERROR_CODES.pluginNotFound, `ui plugin ${pluginId} is not registered`)
    }
    if (typeof record.clientPath !== 'string' || record.clientPath === '') {
      throw uiPluginError(
        UI_PLUGIN_ERROR_CODES.moduleUnavailable,
        `ui plugin ${pluginId} has no registered client bundle path`,
      )
    }
    return {
      pluginId,
      entryPath: record.clientPath,
      format: record.client?.format ?? 'esm',
      ...(record.client?.integrity ? { integrity: record.client.integrity } : {}),
    }
  }

  async storageGet(namespace, key) {
    const composedKey = validateScopedStorageKey(namespace, key)
    const row = this.requireStorageTable().get(composedKey)
    if (row === undefined) return undefined
    try {
      return JSON.parse(row.json).v
    } catch {
      return undefined
    }
  }

  async storageSet(namespace, key, value) {
    const composedKey = validateScopedStorageKey(namespace, key)
    const json = encodeStorageValue(value)
    const table = this.requireStorageTable()
    if (table.get(composedKey) === undefined) {
      const prefix = `${namespace}/`
      let namespaceEntries = 0
      for (const existingKey of table.keys()) {
        if (existingKey.startsWith(prefix)) namespaceEntries += 1
      }
      if (namespaceEntries >= STORAGE_LIMITS.maxEntriesPerNamespace) {
        throw uiPluginError(
          UI_PLUGIN_ERROR_CODES.storageLimitExceeded,
          `ui storage namespaces are limited to ${STORAGE_LIMITS.maxEntriesPerNamespace} entries`,
        )
      }
    }
    await table.put(composedKey, { json })
  }

  async storageDelete(namespace, key) {
    const composedKey = validateScopedStorageKey(namespace, key)
    await this.requireStorageTable().delete(composedKey)
  }

  requireStorageTable() {
    if (this.storageTable === undefined) {
      throw uiPluginError(UI_PLUGIN_ERROR_CODES.hostUnavailable, 'the ui registry storage domain is not open yet')
    }
    return this.storageTable
  }
}

export default DeeptopUiRegistryService
