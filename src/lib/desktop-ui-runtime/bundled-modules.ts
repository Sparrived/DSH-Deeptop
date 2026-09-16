import type { BundledClientModuleFactory } from "./module-loader";
import { activate as activateMessageAnnotations } from "./message-annotations-client";
import { activate as activatePromptInjection } from "./prompt-injection-client";

// Phase 1 static client module table (docs/DEEPTOP_UI_RUNTIME.md §9.2). Host
// plugins reach the UI through the deeptop-ui-registry service; entries appear
// here only when a plugin ships a client bundle that is built into Deeptop
// itself. Dynamic loading arrives in Phase 2 behind the controlled resource
// protocol and never bypasses this table.
export const bundledUiClientModules: Record<string, BundledClientModuleFactory> = {
  "deeptop.message-annotations/client": async () => ({ activate: activateMessageAnnotations }),
  "deeptop.prompt-injection/client": async () => ({ activate: activatePromptInjection }),
};
