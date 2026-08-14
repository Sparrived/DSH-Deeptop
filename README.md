# Deeptop

English | [中文](README.zh.md)

Deeptop is a lightweight native desktop client for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It is not a wrapper around `dsh web`: the Deeptop bridge is itself a Cordis profile bundle, and the Agent, session store, model routes, tools, presets, skills and workspace services stay inside the same DSH tree.

Project: [Sparrived/DSH-Deeptop](https://github.com/Sparrived/DSH-Deeptop)

## Current surface

The desktop workbench currently provides the core WebUI conversation surface:

- persistent session list, history recovery and event-driven live updates;
- lazy new-session creation, session rename, fork, search and queue removal;
- model catalog and per-session model selection;
- optional native workspace selection and workspace registration;
- queue/steer prompt modes, stop current turn, tool-call/result rows and the turn-aware trajectory ledger;
- native approval and question response paths;
- native DSH workbench with a Profile roster, Skill catalog, Subagent history/follow-up/interruption, Goal lifecycle, Host settings, and Provider/model catalogs;
- runtime inspector for DSH host, Cordis profile, workspaces and active routes.

The bridge forwards the same DSH `ApiProxy` domains used by the WebUI: sessions, subagents, skills, goals, settings, credentials, provider discovery, directory browsing, workspaces and preset authoring. The native UI consumes those domains directly; it does not duplicate plugin logic in the desktop process. If an optional domain is absent from a profile, its panel stays unavailable while the Agent conversation remains usable.

## Runtime model

The desktop process starts one hidden, long-lived DSH process:

```text
Tauri native window + JSONL stdio
  -> npx @deepseek-ai/dsh@latest --profile desktop
  -> dsh-base + deeptop-bridge + user desktop profile bundles
      -> Cordis services, Agent presets, sessions, tools and ApiProxy
```

The application materializes `$DSH_HOME/profiles/desktop` on first start and preserves user-added profile bundles. The bridge package is written to `$DSH_HOME/profiles/node_modules/deeptop-bridge`, so the current `npx @deepseek-ai/dsh@latest` package can resolve it without a separate global installation.

The DSH process uses `$DSH_HOME/desktop-runtime` as its default current directory. A selected workspace is passed to `session.create({ cwd })`, so each session can own its own working directory without making DSH depend on the desktop application's project directory.

## Development

Requirements:

- Node.js 22.19+ or 24+;
- Rust/Cargo for Tauri;
- `npx` available on `PATH`;
- network access to the configured npm registry on first DSH use.

```powershell
npm install
npm run tauri:dev
```

For a frontend-only preview:

```powershell
npm run dev
```

The runtime intentionally follows the current `@deepseek-ai/dsh@latest` package. User DSH configuration and profile bundles remain under the configured `DSH_HOME`.

## Extending the Cordis profile

The desktop profile preserves user changes to `$DSH_HOME/profiles/desktop/cordis.patch.yml`. Add new DSH capabilities as Cordis plugins instead of modifying the Tauri process or React UI. A minimal local plugin is:

```ts
import type { Context } from "@deepseek-ai/cordis";

export const name = "my-plugin";

export function apply(ctx: Context) {
  ctx.on("session/event", (event) => {
    console.log("session event", event);
  });
}
```

Add it to the profile with an absolute path:

```yaml
- insert:
    - id: my-plugin
      name: "C:/absolute/path/to/my-plugin/src/index.ts"
```

Use the Service Definition / Provider / Consumer split only when the provider and consumer need to evolve independently. A small extension should remain one plugin.
