// Bundled client module loader (docs/DEEPTOP_UI_RUNTIME.md §9.2, Phase 1).
// Client entries resolve through a static build-time table; dynamic file or
// protocol loading is intentionally out of scope for this phase.

import { sdkVersionCompatible } from "../../app/ui-plugin-model.ts";
import type { DeeptopClientModule } from "./types.ts";
import { PluginLoadError } from "./plugin-error.ts";

export type BundledClientModuleFactory = () => Promise<unknown>;

export interface ClientModuleSource {
  entryId: string;
  sdkVersion: string;
  runtimeSdkVersion: string;
}

/** Resolve one descriptor's entryId through the bundled table with SDK compatibility checks. */
export async function loadBundledClientModule(
  source: ClientModuleSource,
  table: Record<string, BundledClientModuleFactory>,
): Promise<DeeptopClientModule> {
  const factory = table[source.entryId];
  if (!factory) {
    throw new PluginLoadError(
      "load-failed",
      `client module "${source.entryId}" is not bundled in this build of Deeptop`,
    );
  }
  if (!sdkVersionCompatible(source.sdkVersion, source.runtimeSdkVersion)) {
    throw new PluginLoadError(
      "check-failed",
      `plugin requires SDK ${source.sdkVersion} but this runtime provides ${source.runtimeSdkVersion}`,
    );
  }
  let exports: unknown;
  try {
    exports = await factory();
  } catch (error) {
    throw new PluginLoadError("load-failed", `loading "${source.entryId}" threw: ${error instanceof Error ? error.message : String(error)}`);
  }
  const candidate = exports as Partial<DeeptopClientModule> | undefined;
  if (!candidate || typeof candidate.activate !== "function") {
    throw new PluginLoadError("load-failed", `module "${source.entryId}" does not export activate(context)`);
  }
  return candidate as DeeptopClientModule;
}
