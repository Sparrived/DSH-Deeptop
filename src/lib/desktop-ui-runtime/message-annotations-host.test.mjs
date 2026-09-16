import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { constants, zstdCompressSync } from "node:zlib";
import test from "node:test";
import { build } from "esbuild";
import { renderToStaticMarkup } from "react-dom/server";
import { DesktopUiRuntime } from "./client-runtime.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const runtimeArchive = path.join(root, "src-tauri", "resources", "dsh-runtime.tar.gz");
const runtimeManifestPath = path.join(root, "src-tauri", "resources", "dsh-runtime-manifest.json");
const mainSourcePath = path.join(root, "src-tauri", "src", "main.rs");
const annotationPluginId = "deeptop.message-annotations";
const annotationEntryId = `${annotationPluginId}/client`;
const annotationNamespace = "messageAnnotations";
const hostTimeoutMs = 60_000;
const runtimeCacheMarker = ".deeptop-host-test-complete";

function errorFromFrame(value) {
  if (typeof value === "object" && value !== null) {
    const error = new Error(typeof value.message === "string" ? value.message : JSON.stringify(value));
    Object.assign(error, value);
    return error;
  }
  return new Error(String(value));
}

class DesktopHost {
  constructor(runtimeRoot, dshHome) {
    this.pending = new Map();
    this.stderr = "";
    this.closed = false;
    this.nextRequest = 1;
    const entry = path.join(runtimeRoot, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
    this.child = spawn(process.execPath, [entry, "--profile", "deeptop"], {
      cwd: dshHome,
      env: {
        ...process.env,
        DSH_HOME: dshHome,
        DEEPTOP_DSH_RUNTIME_ROOT: runtimeRoot,
        DSH_TELEMETRY_DISABLED: "1",
        NO_COLOR: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-32_000);
    });
    this.exit = new Promise((resolve) => {
      this.child.once("exit", (code, signal) => {
        this.closed = true;
        const error = new Error(`desktop Host exited: code=${code}, signal=${signal}\n${this.stderr}`);
        this.rejectReady(error);
        for (const request of this.pending.values()) {
          clearTimeout(request.timer);
          request.reject(error);
        }
        this.pending.clear();
        resolve({ code, signal });
      });
    });
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.child.once("error", (error) => {
      this.rejectReady(error);
    });
    let stdoutBuffer = "";
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk;
      for (;;) {
        const newline = stdoutBuffer.indexOf("\n");
        if (newline === -1) break;
        const line = stdoutBuffer.slice(0, newline).trim();
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        if (!line) continue;
        let frame;
        try {
          frame = JSON.parse(line);
        } catch {
          this.rejectReady(new Error(`desktop Host wrote non-JSON stdout: ${line}`));
          continue;
        }
        this.handleFrame(frame);
      }
    });
  }

  handleFrame(frame) {
    if (frame?.type === "ready") {
      this.resolveReady();
      return;
    }
    if (frame?.type === "fatal") {
      this.rejectReady(new Error(`${frame.message}\n${this.stderr}`));
      return;
    }
    if (frame?.type !== "response" || typeof frame.id !== "string") return;
    const pending = this.pending.get(frame.id);
    if (!pending) return;
    this.pending.delete(frame.id);
    clearTimeout(pending.timer);
    if (frame.error !== undefined) pending.reject(errorFromFrame(frame.error));
    else pending.resolve(frame.response);
  }

  async waitUntilReady() {
    let timer;
    try {
      await Promise.race([
        this.ready,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`desktop Host startup timed out\n${this.stderr}`)), hostTimeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  request(method, payload = {}) {
    if (this.closed) return Promise.reject(new Error("desktop Host is not running"));
    const id = `host-test-${this.nextRequest++}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`desktop Host request timed out: ${method}\n${this.stderr}`));
      }, hostTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ id, method, payload })}\n`, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  async stop() {
    if (this.closed) return;
    this.child.kill("SIGTERM");
    let timer;
    try {
      const graceful = await Promise.race([
        this.exit.then(() => true),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(false), 10_000);
        }),
      ]);
      if (!graceful) {
        this.child.kill("SIGKILL");
        await this.exit;
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

async function startHost(runtimeRoot, dshHome) {
  const host = new DesktopHost(runtimeRoot, dshHome);
  try {
    await host.waitUntilReady();
    return host;
  } catch (error) {
    await host.stop().catch(() => undefined);
    throw error;
  }
}

async function runtimeCacheIsCurrent(runtimeRoot, manifest) {
  try {
    const [cachedManifest, dshPackage, marker] = await Promise.all([
      readFile(path.join(runtimeRoot, "runtime-manifest.json"), "utf8").then(JSON.parse),
      readFile(path.join(runtimeRoot, "node_modules", "@deepseek-ai", "dsh", "package.json"), "utf8").then(JSON.parse),
      readFile(path.join(runtimeRoot, runtimeCacheMarker), "utf8"),
    ]);
    return marker === manifest.treeSha256
      && cachedManifest.treeSha256 === manifest.treeSha256
      && cachedManifest.sourceCommit === manifest.sourceCommit
      && dshPackage.version === manifest.packageVersion;
  } catch {
    return false;
  }
}

async function materializeRuntime() {
  const [manifestRaw, mainSource] = await Promise.all([
    readFile(runtimeManifestPath, "utf8").catch((error) => {
      throw new Error(`missing bundled DSH manifest; run npm run dsh:sync first: ${error.message}`);
    }),
    readFile(mainSourcePath, "utf8"),
  ]);
  await stat(runtimeArchive).catch((error) => {
    throw new Error(`missing bundled DSH archive; run npm run dsh:sync first: ${error.message}`);
  });
  const manifest = JSON.parse(manifestRaw);
  const pinnedVersion = mainSource.match(/const BUNDLED_DSH_VERSION:\s*&str\s*=\s*"([^"]+)"/)?.[1];
  const pinnedCommit = mainSource.match(/const BUNDLED_DSH_SOURCE_COMMIT:\s*&str\s*=\s*"([0-9a-f]{40})"/)?.[1];
  assert.equal(manifest.packageVersion, pinnedVersion, "test runtime must match the Tauri-compiled DSH version");
  assert.equal(manifest.sourceCommit, pinnedCommit, "test runtime must match the Tauri-compiled DSH commit");
  assert.equal(manifest.platform, process.platform);
  assert.equal(manifest.arch, process.arch);

  const cacheRoot = path.join(root, "work", "ui-runtime-host-cache");
  const runtimeRoot = path.join(cacheRoot, manifest.treeSha256);
  if (await runtimeCacheIsCurrent(runtimeRoot, manifest)) return runtimeRoot;
  await mkdir(cacheRoot, { recursive: true });
  await rm(runtimeRoot, { recursive: true, force: true });
  const temporary = `${runtimeRoot}.tmp-${process.pid}-${randomUUID()}`;
  await mkdir(temporary, { recursive: true });
  const extraction = spawnSync("tar", ["-xzf", runtimeArchive, "-C", temporary], {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
  });
  if (extraction.error || extraction.status !== 0) {
    await rm(temporary, { recursive: true, force: true });
    throw extraction.error ?? new Error(`tar extraction failed with status ${extraction.status}`);
  }
  await writeFile(path.join(temporary, runtimeCacheMarker), manifest.treeSha256, "utf8");
  try {
    await rename(temporary, runtimeRoot);
  } catch (error) {
    const winnerIsCurrent = await runtimeCacheIsCurrent(runtimeRoot, manifest);
    await rm(temporary, { recursive: true, force: true });
    if (!winnerIsCurrent) throw error;
  }
  assert.equal(await runtimeCacheIsCurrent(runtimeRoot, manifest), true, "extracted runtime is incomplete");
  return runtimeRoot;
}

function materializedBridgeFiles(mainSource) {
  const includes = new Map();
  for (const match of mainSource.matchAll(/const\s+([A-Z0-9_]+):\s*&str\s*=\s*include_str!\("\.\.\/\.\.\/(cordis\/[^"\r\n]+)"\);/gu)) {
    includes.set(match[1], match[2]);
  }
  const body = mainSource.match(/fn bundled_bridge_files\(\)[^{]*\{\s*\[([\s\S]*?)\]\s*\}/u)?.[1];
  assert.ok(body, "cannot read bundled_bridge_files() from main.rs");
  const files = [];
  for (const match of body.matchAll(/\(\s*"([^"]+)",\s*([A-Z0-9_]+),?\s*\)/gu)) {
    const source = includes.get(match[2]);
    assert.ok(source, `materialized Bridge constant ${match[2]} has no cordis include`);
    files.push({ destination: match[1], source });
  }
  assert.ok(files.length > 0, "bundled_bridge_files() did not expose any files");
  return files;
}

async function materializeProfile(dshHome) {
  const profileDir = path.join(dshHome, "profiles", "deeptop");
  const bridgeDir = path.join(dshHome, "profiles", "node_modules", "deeptop-bridge");
  await Promise.all([mkdir(profileDir, { recursive: true }), mkdir(bridgeDir, { recursive: true })]);
  await Promise.all([
    copyFile(path.join(root, "cordis", "desktop-profile.json"), path.join(profileDir, "package.json")),
    copyFile(path.join(root, "cordis", "profile.patch.yml"), path.join(profileDir, "cordis.patch.yml")),
    writeFile(
      path.join(profileDir, "pnpm-workspace.yaml"),
      "packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n",
      "utf8",
    ),
  ]);
  const mainSource = await readFile(mainSourcePath, "utf8");
  await Promise.all(materializedBridgeFiles(mainSource).map(async ({ destination, source }) => {
    const target = path.join(bridgeDir, destination);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(root, source), target);
  }));
  return profileDir;
}

function sessionEvents(messageId, createdAt) {
  // A format-v2 log the current Host migrates on open: the v2-to-v3 migration
  // promotes the system prompt into its own surface node, which it can only do
  // once an open step exists before the first surface event.
  return [
    { type: "turn/start", seq: 0, time: createdAt + 1, data: { turn: 1 } },
    { type: "step/start", seq: 1, time: createdAt + 2, data: { turn: 1, step: 1 } },
    {
      type: "user/message",
      seq: 2,
      time: createdAt + 3,
      data: {
        id: messageId,
        role: "user",
        content: [{ type: "text", text: `seed ${messageId}` }],
        source: { kind: "user" },
      },
      surfaceOp: "append",
    },
    { type: "step/end", seq: 3, time: createdAt + 4, data: { turn: 1, step: 1 } },
    { type: "turn/end", seq: 4, time: createdAt + 5, data: { turn: 1, reason: { kind: "completed" } } },
  ];
}

async function seedSession(dshHome, sessionId, messageId, createdAt) {
  const directory = path.join(dshHome, "sessions", "_no-cwd", sessionId);
  await mkdir(directory, { recursive: true });
  const header = {
    type: "session",
    version: 2,
    id: sessionId,
    createdAt,
    isSeeded: false,
    delegationDepth: 0,
    agentPreset: "standard",
  };
  const checksum = { params: { [constants.ZSTD_c_checksumFlag]: 1 } };
  const headerFrame = zstdCompressSync(`${JSON.stringify(header)}\n`, checksum);
  const eventsFrame = zstdCompressSync(`${sessionEvents(messageId, createdAt).map(JSON.stringify).join("\n")}\n`, checksum);
  await writeFile(path.join(directory, "session.v2.jsonl.zstd"), Buffer.concat([headerFrame, eventsFrame]));
}

async function loadClientModule(file) {
  const compiled = await build({
    entryPoints: [path.join(root, "src", "lib", "desktop-ui-runtime", file)],
    bundle: true,
    format: "cjs",
    platform: "node",
    write: false,
    external: ["react", "react/jsx-runtime"],
  });
  const module = { exports: {} };
  const requireFromTest = createRequire(import.meta.url);
  new Function("require", "module", "exports", compiled.outputFiles[0].text)(requireFromTest, module, module.exports);
  return module.exports;
}

function loadMessageAnnotationsClient() {
  return loadClientModule("message-annotations-client.tsx");
}

function loadPromptInjectionClient() {
  return loadClientModule("prompt-injection-client.tsx");
}

async function invokeAnnotation(host, method, args) {
  const response = await host.request("ui.plugin.invoke", {
    pluginId: annotationPluginId,
    namespace: annotationNamespace,
    method,
    args,
  });
  return response.value;
}

function renderBadge(runtime, session, messageId) {
  const badge = runtime.slots.snapshot("conversation.message.actions").find((entry) => entry.kind === "badge");
  assert.ok(badge, "message annotation Badge is not registered");
  const element = badge.render({
    session,
    activeSessionId: session?.sessionId ?? null,
    sessionGeneration: runtime.sessionGeneration,
    locale: "en",
    host: { prompt: async () => null, notify: () => undefined },
    message: {
      sessionId: session.sessionId,
      messageId,
      role: "user",
      seq: 0,
    },
  });
  return element ? renderToStaticMarkup(element) : "";
}

async function waitFor(assertion, message, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return assertion();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw new Error(`${message}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

test("current desktop Host preserves message annotations across Session switches, restart, empty Session and plugin removal", { timeout: 180_000 }, async () => {
  const runtimeRoot = await materializeRuntime();
  const dshHome = await mkdtemp(path.join(tmpdir(), "deeptop-ui-runtime-host-"));
  const hosts = [];
  let runtime;
  try {
    const profileDir = await materializeProfile(dshHome);
    const sessionA = { sessionId: `host-a-${randomUUID()}`, title: "Host A", running: false, blank: false };
    const sessionB = { sessionId: `host-b-${randomUUID()}`, title: "Host B", running: false, blank: false };
    const messageA = "message-a";
    const messageB = "message-b";
    const createdAt = Date.now() - 10_000;
    await Promise.all([
      seedSession(dshHome, sessionA.sessionId, messageA, createdAt),
      seedSession(dshHome, sessionB.sessionId, messageB, createdAt + 100),
    ]);

    const firstHost = await startHost(runtimeRoot, dshHome);
    hosts.push(firstHost);
    const catalog = await firstHost.request("ui.plugin.list", {});
    // 两个自带的客户端插件：消息标注（远程调用）与提示词注入（scoped settings）。
    // 顺序由注册顺序决定，二者都属于 Deeptop 内嵌的 bridge 包。
    assert.deepEqual(catalog.items.map((item) => item.pluginId), [annotationPluginId, "deeptop.prompt-injection"]);
    assert.deepEqual(catalog.items[0].capabilities.remotes, [{
      namespace: annotationNamespace,
      methods: ["list", "put", "delete"],
    }]);
    assert.deepEqual(catalog.items[1].capabilities.settings, ["deeptop-prompt-injection"]);

    const putA = await invokeAnnotation(firstHost, "put", {
      sessionId: sessionA.sessionId,
      messageId: messageA,
      note: "durable note A",
      ifVersion: null,
    });
    const putB = await invokeAnnotation(firstHost, "put", {
      sessionId: sessionB.sessionId,
      messageId: messageB,
      note: "durable note B",
      ifVersion: null,
    });
    assert.equal(putA.ok, true);
    assert.equal(putB.ok, true);

    let activeHost = firstHost;
    let delayedSessionId = null;
    let releaseDelayed;
    let resolveDelayedDelivery;
    const delayedDelivery = new Promise((resolve) => { resolveDelayedDelivery = resolve; });
    const calls = [];
    const clientModule = await loadMessageAnnotationsClient();
    const injectionModule = await loadPromptInjectionClient();
    runtime = new DesktopUiRuntime({
      request: async (method, payload) => {
        calls.push({ method, payload });
        const response = activeHost.request(method, payload);
        if (method === "ui.plugin.invoke" && payload.method === "list" && payload.args?.sessionId === delayedSessionId) {
          const gate = new Promise((resolve) => { releaseDelayed = resolve; });
          const value = await response;
          await gate;
          resolveDelayedDelivery();
          return value;
        }
        return response;
      },
      listen: () => () => undefined,
      bundledModules: { [annotationEntryId]: async () => clientModule, "deeptop.prompt-injection/client": async () => injectionModule },
      locale: "en",
      hostActions: { prompt: async () => null, notify: () => undefined },
    });
    await runtime.start();

    assert.equal(runtime.sessionContext, null);
    assert.equal(calls.some((call) => call.method === "ui.plugin.invoke"), false, "empty Session must not request annotations");
    const emptyContext = {
      session: null,
      activeSessionId: null,
      sessionGeneration: runtime.sessionGeneration,
      locale: "en",
      host: { prompt: async () => null, notify: () => undefined },
    };
    for (const entry of runtime.slots.snapshot("conversation.message.actions")) {
      const element = entry.render(emptyContext);
      assert.equal(
        element ? renderToStaticMarkup(element) : "",
        "",
        "empty Session/message context renders no annotation UI",
      );
    }

    delayedSessionId = sessionA.sessionId;
    runtime.updateSession(sessionA);
    runtime.updateSession(sessionB);
    assert.equal(typeof releaseDelayed, "function", "the first Session list must be held before its response reaches the client");
    await waitFor(
      () => assert.match(renderBadge(runtime, sessionB, messageB), /durable note B/),
      "the second Session annotation did not become visible",
    );
    // Return to A before its generation-one list resolves. The old response
    // must be rejected even though A is active again with a newer generation.
    delayedSessionId = null;
    runtime.updateSession(sessionA);
    await waitFor(
      () => assert.match(renderBadge(runtime, sessionA, messageA), /durable note A/),
      "the active Session annotation did not load for generation three",
    );
    releaseDelayed();
    await delayedDelivery;
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(renderBadge(runtime, sessionA, messageA), /durable note A/, "the stale generation-one response must not overwrite generation three");

    const generationBeforeRestart = runtime.sessionGeneration;
    await firstHost.stop();
    const secondHost = await startHost(runtimeRoot, dshHome);
    hosts.push(secondHost);
    activeHost = secondHost;
    await runtime.handleHostRestart();
    await runtime.refresh();
    assert.equal(runtime.sessionGeneration, generationBeforeRestart + 1);
    assert.equal(runtime.sessionContext?.sessionId, sessionA.sessionId, "Host restart must retain the latest App Session projection");
    await waitFor(
      () => assert.match(renderBadge(runtime, sessionA, messageA), /durable note A/),
      "the annotation did not reload from the restarted Host",
    );

    await secondHost.stop();
    await writeFile(
      path.join(profileDir, "cordis.patch.yml"),
      "- id: message-annotations-ui\n  disabled: true\n",
      "utf8",
    );
    const thirdHost = await startHost(runtimeRoot, dshHome);
    hosts.push(thirdHost);
    activeHost = thirdHost;
    await runtime.handleHostRestart();
    await runtime.refresh();
    assert.equal(runtime.status, "ready", "a missing optional UI plugin must not fail the core runtime");
    // 只有 message-annotations-ui 被禁用；提示词注入插件不受影响，仍在目录里。
    assert.deepEqual(runtime.pluginViews.map((view) => view.pluginId), ["deeptop.prompt-injection"]);
    assert.equal(runtime.slots.snapshot("conversation.message.actions").length, 0);
    assert.equal(runtime.slots.snapshot("settings.sections").length, 1, "the unrelated plugin keeps its settings panel");
    assert.equal(runtime.sessionContext?.sessionId, sessionA.sessionId);
    await assert.rejects(
      invokeAnnotation(thirdHost, "list", { sessionId: sessionA.sessionId }),
      (error) => error.code === "ui-plugin-not-found",
    );
  } finally {
    await runtime?.stop().catch(() => undefined);
    for (const host of hosts.reverse()) await host.stop().catch(() => undefined);
    await rm(dshHome, { recursive: true, force: true });
  }
});
