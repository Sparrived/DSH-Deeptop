# Deeptop Cordis plugins

This directory is the source of the embedded `deeptop-bridge` runtime package. The package name remains stable so existing desktop Profiles continue to resolve it, while every built-in Cordis plugin owns an independent folder and `index.mjs` entry.

| Directory | Responsibility |
| --- | --- |
| `desktop-bridge/` | `deeptop/1` JSONL transport, desktop API allowlist, native boundary adapters and repair helpers |
| `message-annotations/` | Durable message-annotation Cordis service |
| `message-annotations-ui/` | Host registration for the built-in message-annotation Client Plugin |
| `session-pins/` | Durable workspace session-pin service and its pure model |
| `skill-installer/` | Approval-gated Skill installer plugin and shared installer implementation |
| `theme-settings/` | Host registration for desktop theme and locale settings |
| `ui-registry/` | UI Plugin registry, manifest validation, scoped routes and storage |

`cordis.patch.yml`, `desktop-profile.json`, `profile.patch.yml` and `presets/` describe the containing desktop Profile rather than one plugin, so they stay at this directory root.

Tauri embeds these sources and materializes the same nested layout under `$DSH_HOME/profiles/node_modules/deeptop-bridge`. Do not edit that generated directory. When adding a plugin, create a new folder with an `index.mjs`, add an explicit package export and Profile entry, update `bundled_bridge_files()` in `src-tauri/src/main.rs`, and extend `structure.test.mjs`.
