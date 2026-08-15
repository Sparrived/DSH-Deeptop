# Deeptop

English | [中文](README.zh.md)

Deeptop is a lightweight native desktop client for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness). It combines a Tauri + React workbench with the DSH runtime instead of reimplementing an Agent stack in the desktop process.

Deeptop is not a wrapper around `dsh web`. The `deeptop-bridge` package is a Cordis Profile Bundle: sessions, agents, tools, model routes, persistence, workspaces, skills, goals and provider services remain in the same DSH tree. Tauri owns process supervision and transport; React owns the native interaction surface; DSH remains the source of domain semantics.

Project: [Sparrived/DSH-Deeptop](https://github.com/Sparrived/DSH-Deeptop)

## Documentation

- [Project guide](docs/PROJECT_GUIDE.md) — installation, runtime layout, data flow, extension and troubleshooting.
- [CI/CD and releases](docs/CI_CD.md) — GitHub Actions checks, cross-platform bundles, versioning and automatic Releases.
- [Native DSH coordination](docs/DSH_NATIVE_COORDINATION.md) — the boundary between Tauri, the Bridge, Cordis Profile, ApiProxy/Remote and React.
- [Architecture notes](ARCHITECTURE.md) — dependency direction, pure app models and pluginization rules.
- [Deeptop UI Runtime design](docs/DEEPTOP_UI_RUNTIME.md) — the proposed Client Module, Slot, Bridge capability and desktop UI plugin architecture.
- [Official plugin compatibility](PLUGIN_COMPATIBILITY.md) — compatibility layers, current status and follow-up work.
- [WebUI parity checklist](WEBUI_PARITY.md) — supported areas, gaps and explicitly excluded WebUI infrastructure.

## Current surface

The desktop workbench currently provides the core conversation surface and a native DSH workbench. The status below distinguishes shipped behavior from partial surfaces and Profile-dependent capabilities.

| Area | Status | Details |
| --- | --- | --- |
| Sessions | Supported | Persistent list, history recovery, older-history paging, live events, rename, search, fork, archive, restore and deletion of archived sessions. |
| Conversation | Supported | Streaming assistant/reasoning, Markdown/GFM, image attachments, queued/steering prompts, queue editing/removal, stop and message retry. Retry forks a recoverable prefix; it does not roll back the original session. |
| Workspace | Supported | Directory picking, create/rename/delete, session membership, grouping and ordering. Selected paths are passed as session `cwd`. |
| Models and providers | Supported with boundaries | Provider/model catalogs, per-session model selection, reasoning effort, context-window and input-modality metadata, provider discovery and custom connection settings. Schema-driven provider forms are not complete. |
| Tools and interaction | Supported | Tool call/result rows, Workflow, Job, Todo, trajectory views, user questions with single/multi-select and custom answers, plus approval responses. |
| Feedback and export | Partial | Message Like/Dislike and versioned notes are available; session JSON/ZIP export is available, while ZIP currently crosses the JSONL Bridge as Base64 and is not yet a native streaming transfer. |
| DSH workbench | Supported where the Profile provides the domain | Profile/plugin inventory, runtime inspector, Host settings, Skill catalog, Agent Presets, Subagent history/follow-up/interruption and Goal lifecycle. Missing optional domains remain unavailable instead of being faked. |
| Skill installation | Supported | `/skill` input candidates and approval-gated GitHub installation with direct-download and sparse-git fallback. |
| Remote and events | Supported | Typert Remote loopback calls and forwarded official Host events; native UI adapts the contracts rather than loading WebUI Client bundles. |
| Partial areas | In progress | Permission presets/global controls, Plan chip/Review, complete Session Stats, recursive Subagent navigation, schema-driven settings, long-session virtualization, full media preview and localization remain incomplete. |

The native window is frameless, resizable and currently defaults to 1360×860 with a 920×620 minimum. Light, Dark and System themes plus appearance settings are available.

Optional DSH domains are capability-gated. If a profile does not provide a domain, its native panel remains unavailable instead of duplicating or faking the missing service, while the core Agent conversation can continue.

## First use

1. Run `npm run tauri:dev` and wait for the runtime indicator to show that DSH is ready. Startup first validates the DSH package in `$DSH_HOME/desktop-runtime`; if it is missing or incomplete, Deeptop installs `@deepseek-ai/dsh@latest` through the local npm.
2. Open the settings/workbench panels and configure a Provider and credential when the active Profile exposes those domains. Credentials are written through DSH APIs; do not put secrets in the repository or Profile patch.
3. Select or create a workspace. A selected directory becomes the `cwd` for newly created sessions; it is not automatically applied to every existing session.
4. Create a session, choose its model, and send a prompt. Use queue/steering mode when you need to add context while a turn is running.
5. Handle approval and question prompts in the native interaction panel. Questions can support single selection, multiple selection or custom text depending on the DSH event.
6. Use `/skill` for Skill candidates, the Subagent and Goal panels for their respective DSH workflows, and the runtime Inspector to inspect Profile/plugin availability.
7. Use session actions for retry, fork, archive, restore, export or deletion. Refreshing the runtime restarts the DSH child process and may fail pending requests.

The repository includes a GitHub Actions release pipeline. `src-tauri/tauri.conf.json` enables Tauri bundles, and pushing a SemVer tag such as `v0.2.0` builds Windows (NSIS/MSI), Linux (DEB/AppImage), and macOS (DMG) assets before publishing a GitHub Release. See [CI/CD and releases](docs/CI_CD.md) for the complete flow and signing setup.

## Native runtime model

```text
Tauri window + React UI
        │ Tauri invoke/events
        ▼
Rust Bridge Manager
  profile materialization, process supervision, JSONL stdin/stdout
        │ deeptop/1 JSONL
        ▼
node <installed @deepseek-ai/dsh bin> --profile desktop
        │
dsh-base + deeptop-bridge + user desktop Profile bundles
        │ one Cordis tree
        ▼
DSH Host/Cordis services
Session · Agent · Tool · Model · Storage · Workspace · Skill · Goal
Provider · ApiProxy · Remote · Projection · events
```

The desktop process starts one hidden, long-lived DSH child process. The Bridge emits a `ready` frame for protocol `deeptop/1`, accepts validated JSONL requests, and forwards `mux` and `host` event streams. Tauri turns responses/events into commands and application events consumed by the React runtime.

The Bridge is not a separate HTTP service and does not contain a second Agent implementation. It exposes an explicit desktop allowlist over DSH `ApiProxy` domains and forwards Typert Remote calls through the official gateway. Native-only boundaries such as directory picking, session ZIP transfer and approved Skill installation are adapted at the edge.

See [Native DSH coordination](docs/DSH_NATIVE_COORDINATION.md) for the request/event sequence and extension rules.

## Runtime and data locations

`DSH_HOME` controls the DSH home directory. If it is not set, Windows uses `%USERPROFILE%\.dsh` and Unix-like systems use `$HOME/.dsh`.

On startup Deeptop:

1. creates or completes `$DSH_HOME/profiles/desktop`;
2. preserves user desktop Profile bundles and `cordis.patch.yml` edits;
3. materializes the embedded Bridge at `$DSH_HOME/profiles/node_modules/deeptop-bridge`;
4. uses `$DSH_HOME/desktop-runtime` as DSH's default current directory and checks the installed `@deepseek-ai/dsh` entrypoint;
5. installs `@deepseek-ai/dsh@latest` into `$DSH_HOME/desktop-runtime` through the local npm when the package is missing or incomplete, with non-interactive install flags;
6. launches the validated DSH entrypoint through the local Node.js executable and waits for `deeptop/1` readiness.

A selected workspace is passed to DSH as `session.create({ cwd })`, so the desktop project directory is not silently used as every session's working directory. DSH owns storage, persistence and Profile data according to its own configuration.

## Requirements

- Node.js 22.19+ or 24+;
- Rust/Cargo and the Tauri desktop toolchain;
- Node.js and npm available on `PATH`;
- network access to the configured npm registry on first DSH startup;
- a working WebView2 environment on Windows.

## Development

```powershell
npm install
npm run tauri:dev
```

For a frontend-only preview:

```powershell
npm run dev
```

The Vite preview does not have the Tauri Bridge or DSH child process. Use it for layout/component work, not for validating sessions or native directory operations.

## Build and test

```powershell
# TypeScript check and Vite build
npm run build

# Tauri application build
npm run tauri:build

# Bridge route and Skill-source tests
npm run test:bridge

# All JavaScript tests
npm test

# Keep all application manifests on one version
npm run version:check
```

`npm run build` runs `tsc --noEmit && vite build`; `npm run tauri:dev` runs the Vite dev server through the Tauri configuration, and `npm run tauri:build` builds the native application and enabled bundles. Use `npm run version:set -- 0.2.0` when preparing a release; it updates the npm, Bridge, Tauri and Cargo manifests together. Run `npm run build` and `npm test` for every change, then use the focused test command when changing Bridge routing or retry behavior.

The runtime intentionally follows the moving `@deepseek-ai/dsh@latest` package. Deeptop documents the interfaces it consumes, not every internal DSH implementation detail; after a DSH upgrade, revalidate the Profile, ApiProxy methods, Remote contracts and event projections.

## Extending the desktop Profile

User DSH capabilities should be added to the desktop Profile before changing Rust or React domain logic. The persistent user patch is:

```text
$DSH_HOME/profiles/desktop/cordis.patch.yml
```

For example:

```yaml
- insert:
    - id: my-plugin
      name: 'C:/absolute/path/to/my-plugin/src/index.ts'
```

A minimal Cordis plugin can be:

```ts
import type { Context } from "@deepseek-ai/cordis";

export const name = "my-plugin";

export function apply(ctx: Context) {
  ctx.on("session/event", (event) => {
    console.log("session event", event);
  });
}
```

Integration order:

1. look for an official Host/Cordis service, ApiProxy method, Remote contract or Projection;
2. mount and validate Host capabilities in the Profile rather than copying domain logic;
3. declare the smallest desktop-side types in `src/lib/desktop.ts` and adapt Remote/Projection through `desktopClientRuntime`;
4. implement only a native React entry point when the official package is WebUI-only;
5. add new desktop methods to the explicit allowlist in `deeptop-bridge/routes.mjs` and test them.

Do not edit generated files under `$DSH_HOME/profiles/node_modules/deeptop-bridge`; they are materialized again on restart. Put persistent user changes in the desktop Profile patch.

## Compatibility boundary

Deeptop targets functional and contract compatibility with DSH, not an unmodified copy of the WebUI client. Host/Cordis services, ApiProxy, Remote contracts, Session Projections, events and data semantics should be reused. WebUI-only `window.__ModuleLoader__`, the Cordis client runner, slot registry, client lifecycle and browser-specific layout/download infrastructure are outside the pure desktop target.

Current follow-up work includes richer Plan and Permission surfaces, complete Session Stats and native ZIP streaming, schema-driven provider/plugin settings, recursive Subagent navigation, GoalBar, more domain-specific tool cards, long-session virtualization, media polish and localization.

Read [PLUGIN_COMPATIBILITY.md](PLUGIN_COMPATIBILITY.md) and [WEBUI_PARITY.md](WEBUI_PARITY.md) for the maintained status.

## Repository map

```text
src/                       React UI, state models and desktop runtime adapters
src/components/            conversation, settings, workbench and interaction UI
src/app/                   session/message/trajectory/event state models
src/lib/desktop.ts         Tauri Bridge types and request wrappers
src/lib/desktop-client-runtime.ts
                           Remote loopback and Host event subscription
src-tauri/src/main.rs      DSH process, Profile materialization and JSONL manager
src-tauri/                 Tauri and Rust configuration
deeptop-bridge/             Cordis Bundle, route allowlist and Bridge tests
docs/                      project guide and native coordination notes
ARCHITECTURE.md             dependency direction and pluginization rules
PLUGIN_COMPATIBILITY.md    plugin compatibility layers and engineering checklist
WEBUI_PARITY.md            WebUI alignment status and gaps
```

## Troubleshooting

- **Node.js or npm is missing:** verify the Node.js installation and the `PATH` inherited by the process launching Deeptop. The launcher resolves Node/npm directly from `PATH` and cannot install DSH without them.
- **DSH does not become ready:** inspect the runtime panel and diagnostics; check npm access, a writable `DSH_HOME`, and valid JSON/YAML in the desktop Profile. Refreshing the runtime restarts the child process.
- **No sessions in the browser preview:** expected; only `npm run tauri:dev` owns the Rust Bridge and DSH child.
- **A Profile change has no effect:** edit `$DSH_HOME/profiles/desktop/cordis.patch.yml`, not the generated Bridge package, then refresh DSH.

## Contribution checklist

- do not load WebUI Client bundles as desktop dependencies;
- do not duplicate DSH session, permission, Agent or plugin domain logic in React/Rust;
- keep new Bridge methods explicitly allowlisted and validate arguments, errors and cancellation;
- cover history recovery, live events, missing plugins, failures, cancellation and rapid Session switching;
- run `npm run build` and focused tests, then update the compatibility documentation.
