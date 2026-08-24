# Deeptop Interactive Pet Pack Authoring

English | [中文](PET_PACKS.zh.md)

Deeptop Pet uses a fixed sprite format and runs in a separate transparent, always-on-top WebView. A pet can watch the global pointer, move across applications and monitors, remember its last visible position, and react to taps, double taps, long presses, petting, idle time and the current task state. A shared care layer stores satiety, mood and affection and supports meals, treats, petting and play; changing a pet pack replaces only the appearance and animation while retaining care state. Third-party pet packs contain only declarations and an atlas, so they cannot execute code. The separate window receives a bounded activity list containing task state, a session identifier and title, the minimum card fields for a confirmation reason, tool name, question or options, and a bounded excerpt of the final assistant reply for a completed session. It cannot read complete message history, reasoning, file contents, model configuration, tool results, the network or the DSH Bridge. Turning off the master switch under Settings → Pets destroys the complete pet window and its animation work.

A `.deeptop-pet` is a ZIP-based single-file artifact. It uses the same two or three root-level files as the source directory and rejects scripts, CSS, HTML, network locations, subdirectories, links and undeclared entries. Direct sharing, local imports and a future pet marketplace all use this one format.

## Optional source module

The entire pet system is described by `desktop-pets.feature.json`. Run `npm run pets:remove:check` to validate every owned path, shared-source marker and dependency without changing the worktree. Run `npm run pets:remove` to remove the renderer, native plugin, settings entry, examples, authoring tools, npm and Cargo dependencies, documentation and generated frontend/Tauri caches in one operation. The command refreshes `Cargo.lock` in a temporary staging crate before it writes anything; a missing marker, dependency or path aborts the operation instead of guessing. The removal tool and manifest delete themselves last. Installed packs and care data under the user's application-data directory are intentionally preserved. Restore the feature from version control if it is needed again.

## Create one with a single AI request

With the `hatch-pet` workflow available in an AI coding environment, one request is enough: `Make a Deeptop Pet described as “a round cloud cat in a yellow raincoat that waves”, authored by suakitsu; complete every action and look-direction check, then output a shareable .deeptop-pet without committing code.` The AI should choose an appropriate name and id, use `$imagegen` for the character and every animation row, complete transparency, direction, continuity and visual QA for the 8×11 atlas, add `pet.json` and `deeptop.json`, and invoke this repository's packer. “Make a pet” means a complete installable artifact, not a single character image or an unchecked atlas. An AI environment without that workflow can produce the same three files by following the source-directory and atlas requirements below.

## From creation to a marketplace

A creator first uses the pet-generation workflow or another tool to produce a valid Deeptop Pet animation atlas, then copies any `examples/pets` sample and replaces its pet name, description and `spritesheet.webp`. Running `npm run pet:pack -- <pet-directory>` produces one `.deeptop-pet` file that can be installed or sent directly. Installing it once under Settings → Pets completes the local acceptance check.

A future pet marketplace does not introduce a second installation format. Listing data such as the name, preview, tags, download URL, byte size and SHA-256 stays in the marketplace catalog. A downloader only needs to save the `.deeptop-pet` temporarily and pass the catalog SHA-256 as `expectedSha256` to the existing native installer; the installer recomputes it and rejects a mismatch before writing to the pet library. The marketplace entry point can therefore be enabled or removed independently without affecting local imports, exports or installed pets.

## Care state and the skin boundary

Tauri stores care data separately in `pet-care-state.json`; it is not written into a `.deeptop-pet` archive or included when a pack is exported. Satiety and mood decay gently according to elapsed time, with at most 24 offline hours applied in one update. Affection does not decay, and there is no death or permanent punishment. Turning off Care interactions pauses time changes without disabling the pet window, Deeptop task notices or saved care data.

A normal tap opens the current session card, whose Care control switches to the care panel. A long press pets the character and a double tap plays with it. The native layer rejects excess feeding, play while hungry or already cheerful, and persists separate cooldowns for meals, treats, petting and play. A short shared interval also spaces different actions, so repeated clicks or reopening the window cannot quickly maximize the scores; buttons show the remaining wait. Feeding and interactions update and atomically save the shared native state before asking the current skin to play an existing waving or jumping response. A skin pack cannot alter score rules, read the save file or inject food logic, so the same pack remains suitable for a marketplace and still works as a plain Deeptop pet when the care layer is disabled.

## Source directory

A minimal Deeptop Pet needs two files. The optional `deeptop.json` adds version, author, license and declarative interactions:

```text
cloud-cat/
  pet.json
  deeptop.json        # optional
  spritesheet.webp
```

`pet.json` is the Deeptop Pet manifest:

```json
{
  "id": "io.github.your-name.cloud-cat",
  "displayName": "Cloud Cat",
  "description": "A cloud cat that reacts to taps and task activity.",
  "spriteVersionNumber": 2,
  "spritesheetPath": "spritesheet.webp"
}
```

`deeptop.json` is the optional safe extension manifest:

```json
{
  "kind": "deeptop-pet",
  "schemaVersion": 2,
  "runtimeProfile": "deeptop",
  "version": "1.0.0",
  "author": "Your Name",
  "license": "CC-BY-4.0",
  "interactions": [
    { "on": "tap", "play": "waving", "then": "idle", "cooldownMs": 350 },
    { "on": "doubleTap", "play": "jumping", "then": "idle", "cooldownMs": 500 }
  ]
}
```

When `deeptop.json` is absent, Deeptop can still import a plain Deeptop Pet and supplies the default interactions, version `1.0.0` and an undeclared-license marker. Include the extension manifest before public sharing or marketplace distribution.

## Deeptop Pet sprite sheet

`spritesheet.webp` must be a transparent `1536×2288` WebP arranged as 8 columns by 11 rows of `192×208` cells. Every used cell must contain visible pixels and every reserved cell must be fully transparent.

| Row | Content | Used columns |
| --- | --- | --- |
| 0 | Idle frames; column 6 is the neutral front pose | 0–6 |
| 1 | Running right | 0–7 |
| 2 | Running left | 0–7 |
| 3 | Waving | 0–3 |
| 4 | Jumping | 0–4 |
| 5 | Failed | 0–7 |
| 6 | Waiting for user input | 0–5 |
| 7 | Running a task | 0–5 |
| 8 | Completed and ready for review | 0–5 |
| 9 | Look directions 0–7 | 0–7 |
| 10 | Look directions 8–15 | 0–7 |

The 16 look directions start at up and advance clockwise in 22.5° increments. Deeptop uses them only while the pet is idle and the pointer is within the active distance range. Frame drawing and global-pointer polling stay outside the main React state tree.

## Interactions and task state

`interactions` accepts at most 32 rules using these events:

- `pointerEnter` and `pointerLeave`;
- `tap`, `doubleTap` and `longPress`;
- `dragStart` and `dragEnd`;
- `idleTimeout`.

`play` and `then` may reference only `idle`, `running-right`, `running-left`, `waving`, `jumping`, `failed`, `waiting`, `running` or `review`. Looping animations cannot declare `then`; cooldowns range from 0 to 60000 milliseconds. Multiple rules may use the same event, and the runtime chooses an eligible rule that is not cooling down.

Third-party manifests cannot forge task state. The Deeptop main window orders activities as needs input, blocked, ready and running. An unread completed or failed task remains in the activity list until its session is opened or continued, while a pending approval or Agent question stays visible until the main application handles it. A ready item shows a bounded excerpt of its final `assistant/message`; reasoning, tool results and earlier messages are not projected. A card can open its selected session, queue a quick reply, allow or reject one approval, or answer one question directly. Multiple questions require opening the main window. The native layer first checks that every action still matches the selected activity, then sends the semantic action back through the main window's existing DSH request path; the pet window never calls DSH itself.

Holding and dragging moves the native window with the system pointer, selects a directional running animation and plays the landing jump on release. Turning off Allow interactions makes the complete window, including a visible card, pointer-transparent while task-driven animation and passive notices remain available.

The saved position uses physical desktop coordinates and is restored only when it still overlaps an available monitor. Removing or rearranging monitors falls back to the selected primary-monitor corner, and changing Initial position intentionally resets the saved placement. Movement events are debounced before the position file is written, so dragging does not perform a disk write for every pointer update.

The transparent pet window works on Windows, Linux and the project's macOS DMG builds. Tauri's `app.macOSPrivateApi` setting is required for macOS transparency; applications using that private API cannot be distributed through the Mac App Store. Deeptop's current macOS distribution is an unsigned and unnotarized DMG rather than a Mac App Store package.

## Build a single-file pack

Run the packer from the Deeptop repository root:

```shell
npm run pet:pack -- /path/to/cloud-cat
```

It writes `io.github.your-name.cloud-cat-1.0.0.deeptop-pet` in the source directory. An explicit output path is also supported; an existing file is replaced only when `--force` is present:

```shell
npm run pet:pack -- /path/to/cloud-cat /path/to/share/cloud-cat.deeptop-pet --force
```

The packer fixes archive timestamps and entry order, so identical source produces identical bytes. It prints the lowercase SHA-256 and byte size when complete, allowing a marketplace to record them directly for integrity checks, caching and de-duplication. See `examples/pets/whale-maid` and `sawatari-shizuku` for complete samples.

## Import, export and remove

Choose Import pet under Settings → Pets. Deeptop uses a native picker and validates the complete ZIP before installation. Replacing the same id requires confirmation. A marketplace download can supply an expected SHA-256 to the same install command, and verification happens before any write. A local import candidate reports its actual SHA-256 and byte size for later creator or marketplace reuse. The settings page loads only the selected pet on demand and provides an animated tap-to-preview surface; closing the page releases that extra preview payload. Every installed pet can be exported byte-for-byte unchanged for sharing or removed. Removing the selected pet switches to a remaining pet; removing the last pet disables the desktop pet.

Installed packs live in the `pets` child directory of Tauri's application configuration directory. An invalid pack produces an isolated loading warning and cannot block startup, sessions or the DSH runtime.

## Format and security limits

- ids contain 3–64 lowercase letters, digits, dots, underscores or hyphens, and start and end with a letter or digit;
- names are at most 80 characters and descriptions at most 500; extension versions use SemVer, authors are at most 80 characters and licenses at most 120;
- the sprite sheet is at most 10 MB after extraction, each manifest is at most 64 KB and the complete archive is at most 12 MB;
- an archive contains only `pet.json`, optional `deeptop.json` and `spritesheet.webp`; one installation directory loads at most 64 packs;
- the packer rejects assets outside the source directory, and the native installer independently rejects absolute paths, traversal, duplicate entries, links and extra files;
- the runtime has no script, CSS, HTML, network, file-access or permission field.

Pet marketplaces and creator tools should generate, preview and install `deeptop-pet` artifacts. A future skeletal or vector renderer must use a different runtime profile instead of changing the existing format.
