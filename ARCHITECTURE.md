# Deeptop Architecture

Deeptop is a pure desktop runtime framework around DSH. The desktop UI owns
presentation state and user interaction; DSH owns sessions, agents, tools,
settings, plugin services and persistence. The bridge is the only protocol
boundary between them.

The compatibility target is official DSH Host/Cordis behavior, Remote
contracts, projections, events and data semantics. WebUI-only client machinery
is deliberately outside the target: `window.__ModuleLoader__`, the Cordis
client runner, client plugin lifecycle, slot injection and browser-specific UI
composition are not required by the desktop architecture. Official domain
capabilities should be reused through the DSH profile and adapted at the
native Bridge/React boundary when a desktop entry is needed. See
[PLUGIN_COMPATIBILITY.md](PLUGIN_COMPATIBILITY.md) for the plugin matrix and
remaining work.

## Layers

```text
Tauri window
  -> React application
     -> lib/desktop.ts       transport and DSH contracts
        desktop-client-runtime.ts  client-runtime-compatible loopback seam
     -> app/model.ts          compatibility barrel for pure projections and types
        app/transcript-model.ts compatibility barrel for transcript projections
        app/message-model.ts  content, tool, context and diff parsing
        app/workflow-model.ts Todo, Workflow and deliverables
        app/conversation-model.ts transcript assembly
        app/settings-model.ts
        app/ui-model.ts
        app/trajectory.ts     pure trajectory parser
        app/use*Settings.ts   feature-local settings state and persistence
        app/useProviderCredentials.ts Provider credential discovery and mutation
        app/useProviderModelCatalog.ts Provider/model discovery and custom providers
        app/bridge-event-handler.ts mux/host runtime event routing
        app/useWindowControls.ts
     -> components/           isolated UI pieces
        WorkspaceGroup.tsx and WorkspacePicker.tsx sidebar subdomains

Tauri runtime
  -> npx @deepseek-ai/dsh@latest --profile desktop
     -> desktop Profile + Cordis services
        -> deeptop-bridge plugin
           -> bridge.mjs       JSONL lifecycle and event forwarding
           -> routes.mjs       ApiProxy method mapping
```

The dependency direction is one-way:

```text
UI components -> App orchestration -> desktop transport -> DSH bridge
                         |
                         -> pure app model
```

`app/model.ts` is a compatibility barrel and must not gain orchestration. The
pure implementations live in domain modules below it: content, context, tool
and diff parsing in `message-model.ts`, Todo/Workflow/deliverables in
`workflow-model.ts`, transcript assembly in `conversation-model.ts`,
settings/provider data helpers in `settings-model.ts`, UI labels and small
interaction parsers in `ui-model.ts`, and trajectory parsing in
`trajectory.ts`. None of these modules call React, Tauri, or the bridge.

## DSH plugin boundary

`deeptop-bridge/index.mjs` follows the Harness plugin contract:

- `name` identifies the plugin;
- `inject` declares `apiProxy`, `pluginInventory`, `llm` and `typertGateway` dependencies;
- `apply(ctx)` starts the bridge and returns the disposer.

The entry module does not contain protocol details. `bridge.mjs` owns stdin,
stdout, JSONL validation, event streams and cancellation. `routes.mjs` owns the
allowlisted desktop method map, including `remote.invoke` and `skill.install`.
The separate `skill-installer` Cordis plugin registers the approval-gated model
tool `skill-install`. Both surfaces call the shared GitHub installer and leave
catalog refresh to the official skill filesystem watcher. Adding an exposed API
should therefore touch the route map and the TypeScript contract together,
instead of growing the plugin lifecycle code.

This is a loopback adapter, not a second WebUI module loader. Official `dsh.client`
bundles still require `window.__ModuleLoader__`, Cordis client contexts and the
WebUI slot assembly. They are intentionally not loaded by the desktop shell;
their Host/Remote contracts may still be reused through a native adapter. A
future full WebUI compatibility mode, if ever required, must be designed as a
separate runtime rather than mixed into this desktop boundary.

The disposer aborts event streams and closes stdin. This follows the Harness
plugin lifecycle: resources registered by a plugin must stop when the plugin is
unloaded.

## Pluginization decisions

Use a Cordis plugin when the code adds or composes a DSH capability:

- a new runtime service used by other plugins;
- a provider for an existing capability seam such as `llm`, `fs`, `shell` or
  `subagents`;
- a model-facing tool, command, event listener or session projection;
- a host-facing adapter that needs DSH services, such as `deeptop-bridge`.

Keep code outside Cordis when it is an operating-system or presentation concern:

- Tauri process/window management stays in Rust;
- JSONL transport stays in the bridge adapter;
- React state and rendering stay in the desktop UI;
- event-to-view formatting stays in the pure `app/*-model.ts` modules behind
  the `app/model.ts` compatibility barrel.

For a new DSH capability, follow the Harness seam only when the provider and
consumer need to evolve independently. Otherwise use one small plugin and
compose it from the Profile. The Profile is intentionally user-editable, so
additional bundles can be added without changing the Tauri process manager or
React application.

## Runtime ownership

The Tauri process owns only native concerns:

- materializing the desktop Profile and the embedded bridge files;
- starting, stopping and restarting the DSH child process;
- correlating JSONL requests and responses;
- forwarding runtime status and diagnostics to the window.

It must not implement session behavior, tool execution, model routing or
settings semantics. Those remain DSH services exposed through the bridge.

## Refactor rules

1. Keep DSH domain behavior in the DSH profile or bridge; keep rendering in React.
2. Keep pure projections outside React components.
3. Keep bridge methods explicitly allowlisted.
4. Keep new UI state in the feature that owns it; do not add another global store
   for a single screen.
5. When splitting a component, pass actions and view data as props. Introduce a
   context or reducer only when multiple features genuinely share the same
   state transition.

The current refactor establishes the pure model boundary, the startup, window
chrome and shared window controls, session-sidebar and session-row plus its
workspace group/picker primitives, todo, subagent, conversation-header,
conversation-transcript, interaction, queue, Composer shell/candidates/model
picker, Inspector runtime/Preset/Skills/Subagents/Goal surfaces, Settings
appearance/general/models/presets/plugins surfaces, Provider credential/model
hooks, and the bridge transport/route/event split. The remaining `App.tsx`
surface is intentionally the orchestration layer plus session lifecycle and
coupled business actions. Split those next by internal feature boundaries when
their behavior changes enough to justify their prop surface; do not introduce a
global store just to reduce the line count.
