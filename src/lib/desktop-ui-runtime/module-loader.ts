// Client module loader (docs/DEEPTOP_UI_RUNTIME.md §9.2/§9.3).
// Two resolution paths, in priority order:
// 1. Bundled table — build-time static modules keyed by entryId (trusted).
// 2. Controlled resource protocol — `resolveBundle` asks the desktop process
//    for a verified `deeptop-plugin://` URL (path fence + SHA-256 + size limit
//    enforced Rust-side), then the WebView imports it dynamically.
// Every failure surfaces as a PluginLoadError so the runner can classify it.

import { sdkVersionCompatible } from "../../app/ui-plugin-model.ts";
import type { DeeptopClientModule } from "./types.ts";
import { PluginLoadError, errorMessageOf } from "./plugin-error.ts";

export type BundledClientModuleFactory = () => Promise<unknown>;

export interface ClientModuleSource {
  entryId: string;
  sdkVersion: string;
  runtimeSdkVersion: string;
}

export interface ProtocolModuleSource extends ClientModuleSource {
  pluginId: string;
}

/** Result of the Tauri `resolve_ui_plugin_bundle` command. */
export interface ResolvedUiPluginBundle {
  url: string;
  sizeBytes?: number;
}

/** Ask the desktop process to verify and preload one plugin bundle. */
export type UiBundleResolver = (pluginId: string) => Promise<ResolvedUiPluginBundle>;

/** Dynamic import seam so tests can stub module resolution without URLs. */
export type ModuleImporter = (url: string) => Promise<unknown>;

/** Hard ceiling on how long a dynamic import may take before we give up (§9.3). */
export const PROTOCOL_IMPORT_TIMEOUT_MS = 30_000;

function defaultImportModule(url: string): Promise<unknown> {
  return import(/* @vite-ignore */ url);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new PluginLoadError("load-failed", message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function requireActivateExport(exports: unknown, label: string): DeeptopClientModule {
  const candidate = exports as Partial<DeeptopClientModule> | undefined;
  if (!candidate || typeof candidate.activate !== "function") {
    throw new PluginLoadError("load-failed", `module "${label}" does not export activate(context)`);
  }
  return candidate as DeeptopClientModule;
}

function checkSdkCompatibility(source: ClientModuleSource): void {
  if (!sdkVersionCompatible(source.sdkVersion, source.runtimeSdkVersion)) {
    throw new PluginLoadError(
      "check-failed",
      `plugin requires SDK ${source.sdkVersion} but this runtime provides ${source.runtimeSdkVersion}`,
    );
  }
}

/** Resolve one descriptor's entryId through the bundled table with SDK compatibility checks. */
export async function loadBundledClientModule(
  source: ClientModuleSource,
  table: Record<string, BundledClientModuleFactory>,
): Promise<DeeptopClientModule> {
  checkSdkCompatibility(source);
  const factory = table[source.entryId];
  if (!factory) {
    throw new PluginLoadError(
      "load-failed",
      `client module "${source.entryId}" is not bundled in this build of Deeptop`,
    );
  }
  let exports: unknown;
  try {
    exports = await factory();
  } catch (error) {
    throw new PluginLoadError("load-failed", `loading "${source.entryId}" threw: ${errorMessageOf(error)}`);
  }
  return requireActivateExport(exports, source.entryId);
}

/**
 * Load an external plugin bundle through the controlled resource protocol.
 * The desktop process answers with a URL only after path/integrity checks
 * passed; this side still enforces the SDK range and a loading deadline.
 */
export async function loadProtocolClientModule(
  source: ProtocolModuleSource,
  resolveBundle: UiBundleResolver,
  importModule: ModuleImporter = defaultImportModule,
  timeoutMs: number = PROTOCOL_IMPORT_TIMEOUT_MS,
): Promise<DeeptopClientModule> {
  checkSdkCompatibility(source);
  let url: string;
  try {
    const resolved = await resolveBundle(source.pluginId);
    url = resolved.url;
  } catch (error) {
    throw new PluginLoadError("load-failed", `受控资源解析失败：${errorMessageOf(error)}`);
  }
  let exports: unknown;
  try {
    exports = await withTimeout(
      importModule(url),
      timeoutMs,
      `加载 ${url} 超时（${timeoutMs}ms）`,
    );
  } catch (error) {
    if (error instanceof PluginLoadError) throw error;
    throw new PluginLoadError("load-failed", `import("${url}") 失败：${errorMessageOf(error)}`);
  }
  return requireActivateExport(exports, source.pluginId);
}
