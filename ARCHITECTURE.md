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
  -> locate the fixed DSH source build in the compressed Tauri `dsh-runtime.tar.gz` resource
  -> safely extract and reuse an app-local cache keyed by source commit/platform/arch/tree digest
  -> run the cached `@deepseek-ai/dsh/lib/bin.js` through system Node.js
  -> keep Profile, sessions, logs and settings in `$DSH_HOME`; never write to resources
     -> desktop Profile + Cordis services
        -> cordis/             one directory per built-in plugin
           -> desktop-bridge/  JSONL lifecycle, events and ApiProxy mapping
           -> session-pins/    durable workspace pin service
           -> ui-registry/     scoped UI Plugin registry and routes
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

`cordis/desktop-bridge/index.mjs` follows the Harness plugin contract:

- `name` identifies the plugin;
- `inject` declares `apiProxy`, `pluginInventory`, `llm` and `typertGateway` dependencies;
- `apply(ctx)` starts the bridge and returns the disposer.

The entry module does not contain protocol details. `cordis/desktop-bridge/bridge.mjs` owns stdin,
stdout, JSONL validation, event streams and cancellation. `cordis/desktop-bridge/routes.mjs` owns the
allowlisted desktop method map, including `remote.invoke` and `skill.install`.
The separate `cordis/skill-installer/` plugin registers the approval-gated model
tool `skill-install` (the one-shot prompt is skipped when the user's own
approval policy is `never`, e.g. under the full-access preset, and rejected
deterministically when `never` was pinned by delegation). Both surfaces call its shared GitHub installer and leave
catalog refresh to the official skill filesystem watcher. Adding an exposed API
should therefore touch the route map and the TypeScript contract together,
instead of growing the plugin lifecycle code.

### Crash recovery for session logs

Session artifacts are per-session directories holding one or more immutable
generations plus a POSIX `session.lock`; DSH owns their layout and keeps the
paths private, so the desktop never reads or rewrites them directly.

Torn-tail recovery lives in the write path. When a force-killed process leaves
a torn final frame, the next writer recovers the committed records it contains,
truncates the torn bytes, and durably rewrites the recovered events; readers
never repair and never write back, so an unopenable log stays unopenable until
a writer touches it. Two states need that writer:

- The last structurally complete zstd frame ends in a torn JSONL record. DSH
  rejects the log with `corrupt Zstandard session log: complete frame contains
  a torn JSONL record`, and does not recover it on read.
- A crash-restart leaves a stale daemon appending to the same `DSH_HOME`, so
  two writers interleave overlapping seq branches. Contiguity is enforced per
  write handle and a cross-process kernel lock admits one writer per session, so
  this class cannot arise through the persistence seam.

The desktop UI only ever performs cold reads (`projectionMode: 'none'`) and
never resumes or activates a session, so nothing on the desktop side reaches a
write path that could repair these logs. Physical repair for the second class
would also require machinery DSH does not expose: every existing seq-gap check
refuses rather than reconstructs, and the committed region cannot be rewritten
through the persistence seam.

The `session.repairCorrupt` bridge route therefore refuses with
`session-repair-unavailable` instead of pretending to repair, and the repair
banner reports that refusal. A genuine fix has to either resume the session
through DSH's agent layer (which writes to disk, publishes an agent, and refuses
while another writer owns the session) or come from upstream. Run exactly one
DSH instance per `DSH_HOME`: the kernel lock makes a second writer fail rather
than corrupt a log.

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

<!-- @deeptop-pets:start architecture -->
Interactive pets follow this presentation boundary. `pet_feature/store.rs` owns native
file dialogs, atomic installation and independent validation of ZIP-based
`.deeptop-pet` manifests and sprite assets. The same installer accepts an
optional expected SHA-256 before any write, so a removable marketplace adapter
can reuse local import semantics without adding a second package format.
`usePetSystem.ts` owns feature-local persistence orchestration;
`pet_feature/window.rs` owns a separate, transparent, always-on-top Tauri
WebView whose bounds contain only the pet; and `pet_feature/care.rs` owns the
skin-independent care state, elapsed-time updates,
persisted action cooldowns, score gates and atomic action writes. Packs can
supply only visuals and declarative animation
responses; they cannot change care rules or carry saved care data.
The memoized `PetHost` interprets fixed pointer events plus coarse running,
waiting, failed and ready-for-review activity. Sprite frames render in an
isolated Canvas, the native layer supplies a position-only global pointer
vector for the 16 look directions, and the operating system performs window
dragging across application and monitor boundaries. Pet packs cannot register
code or call the Bridge. The main UI sends the pet WebView a bounded activity
list containing session identifiers, titles and action-specific fields; a ready
item may additionally contain a bounded excerpt of its final
`assistant/message`. The pet WebView receives no complete history, reasoning,
tool result, file content, model configuration or Bridge credential. Disabling
the feature destroys the pet WebView and all of its interaction and animation
work without changing the main window or DSH runtime.
All native pet state and restoration are registered by the local
`desktop-pets` plugin. One marked application command block preserves the
existing frontend invoke names. Shared source references use validated feature markers;
`npm run pets:remove` removes the plugin, renderer, assets, authoring tools,
dependencies and documentation as one operation, then refreshes both lockfiles.
<!-- @deeptop-pets:end architecture -->

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
- positioning the fixed-width Windows tray WebView and falling back to the native menu when it cannot be created;
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
