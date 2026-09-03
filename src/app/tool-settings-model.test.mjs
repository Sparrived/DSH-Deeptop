import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_MCP_RECONNECT,
  createMcpBinding,
  createMcpServerDraft,
  formatMcpArgs,
  mcpDraftDirty,
  mcpDraftIssue,
  parseMcpArgs,
  withMcpTransport,
} from "./tool-settings-model.ts";

function stdioServer(overrides = {}) {
  return {
    id: "github",
    serverName: "github",
    transport: "stdio",
    enabled: false,
    command: "node",
    args: ["server.mjs"],
    cwd: "",
    env: [],
    toolCallTimeoutMs: 60_000,
    reconnect: { ...DEFAULT_MCP_RECONNECT },
    ...overrides,
  };
}

function httpServer(overrides = {}) {
  return {
    id: "remote",
    serverName: "remote",
    transport: "streamable-http",
    enabled: true,
    url: "https://example.test/mcp",
    headers: [],
    toolCallTimeoutMs: 30_000,
    reconnect: { ...DEFAULT_MCP_RECONNECT },
    ...overrides,
  };
}

test("creates a disabled server draft with stable defaults and collision-free names", () => {
  assert.deepEqual(DEFAULT_MCP_RECONNECT, {
    enabled: true,
    initialDelayMs: 500,
    maxDelayMs: 30_000,
    maxAttempts: 10,
  });
  assert.deepEqual(createMcpBinding(), { name: "", source: "env", value: "", prefix: "" });

  const existing = [
    stdioServer({ id: "existing", serverName: "server-2" }),
  ];
  const draft = createMcpServerDraft(existing);

  assert.deepEqual(draft, {
    id: "server-3",
    serverName: "server-3",
    transport: "stdio",
    enabled: false,
    command: "npx",
    args: [],
    cwd: "",
    env: [],
    toolCallTimeoutMs: 60_000,
    reconnect: { ...DEFAULT_MCP_RECONNECT },
  });
  assert.deepEqual(existing, [stdioServer({ id: "existing", serverName: "server-2" })]);
});

test("preserves both MCP transport drafts and applies missing-field defaults", () => {
  const stdio = stdioServer({
    enabled: true,
    command: "uvx",
    args: ["server"],
    cwd: "C:/servers",
    env: [{ name: "TOKEN", source: "env", value: "TOKEN", prefix: "Bearer " }],
    url: "https://should-be-dropped.test/mcp",
    headers: [{ name: "Authorization", source: "literal", value: "secret" }],
  });
  const http = withMcpTransport(stdio, "streamable-http");
  assert.deepEqual(http, {
    ...stdio,
    transport: "streamable-http",
    reconnect: { ...DEFAULT_MCP_RECONNECT },
  });
  assert.notStrictEqual(http.reconnect, stdio.reconnect);

  const blankHttp = httpServer({ url: "", headers: undefined });
  const convertedStdio = withMcpTransport(blankHttp, "stdio");
  assert.deepEqual(convertedStdio, {
    ...blankHttp,
    transport: "stdio",
    command: "npx",
    args: [],
    cwd: "",
    env: [],
    reconnect: { ...DEFAULT_MCP_RECONNECT },
  });
});

test("parses and formats line-oriented argv without shell expansion", () => {
  const args = parseMcpArgs("--name\r\nvalue with spaces\n\n leading-space \n");
  assert.deepEqual(args, ["--name", "value with spaces", "", " leading-space "]);
  assert.equal(formatMcpArgs(args), "--name\nvalue with spaces\n\n leading-space ");
  assert.deepEqual(parseMcpArgs(""), []);
  assert.deepEqual(parseMcpArgs("first\n\nsecond"), ["first", "", "second"]);
  assert.deepEqual(parseMcpArgs(formatMcpArgs(["first", "", ""])), ["first", "", ""]);
  assert.equal(formatMcpArgs(undefined), "");
});

test("accepts a normalized MCP server and reports the first validation issue", () => {
  assert.equal(mcpDraftIssue([stdioServer()]), null);
  assert.equal(mcpDraftIssue([stdioServer({ id: "bad id" })]), "id");
  assert.equal(mcpDraftIssue([stdioServer(), stdioServer({ serverName: "other" })]), "duplicate-id");
  assert.equal(mcpDraftIssue([stdioServer({ serverName: "bad name" })]), "server-name");
  assert.equal(mcpDraftIssue([stdioServer(), stdioServer({ id: "other" })]), "duplicate-server-name");
  assert.equal(mcpDraftIssue([stdioServer({ command: "   " })]), "command");
  assert.equal(mcpDraftIssue([httpServer({ url: "file:///tmp/mcp" })]), "url");
  assert.equal(mcpDraftIssue([stdioServer({ toolCallTimeoutMs: 99 })]), "timeout");
  assert.equal(mcpDraftIssue([stdioServer({ reconnect: { ...DEFAULT_MCP_RECONNECT, maxDelayMs: 100 } })]), "reconnect");
  assert.equal(mcpDraftIssue([stdioServer({ env: [{ name: "bad-name", source: "env", value: "TOKEN" }] })]), "binding-name");
  assert.equal(mcpDraftIssue([stdioServer({ env: [{ name: "TOKEN", source: "env", value: "bad-name" }] })]), "binding-value");
  assert.equal(mcpDraftIssue([stdioServer({ env: [
    { name: "TOKEN", source: "env", value: "TOKEN" },
    { name: "TOKEN", source: "env", value: "OTHER_TOKEN" },
  ] })]), "duplicate-binding");
  assert.equal(mcpDraftIssue([httpServer({ headers: [
    { name: "Authorization", source: "env", value: "TOKEN" },
    { name: "authorization", source: "env", value: "OTHER_TOKEN" },
  ] })]), "duplicate-binding");
});

test("preserves redacted literal placeholders and does not mark an unchanged draft dirty", () => {
  const saved = stdioServer({
    env: [{ name: "TOKEN", source: "literal", value: "", redacted: true }],
  });
  const draft = structuredClone(saved);

  assert.equal(mcpDraftIssue([draft]), null);
  assert.equal(mcpDraftDirty(saved, draft), false);
  assert.equal(draft.env[0].value, "");
  assert.equal(draft.env[0].redacted, true);

  const edited = structuredClone(draft);
  edited.command = "bun";
  assert.equal(mcpDraftDirty(saved, edited), true);
  assert.equal(mcpDraftIssue([stdioServer({
    env: [{ name: "TOKEN", source: "literal", value: "" }],
  })]), "binding-value");
  assert.equal(mcpDraftIssue([stdioServer({
    env: [{ name: "TOKEN", source: "literal", value: "", redacted: true, clearSecret: true }],
  })]), null);
});

test("compares MCP drafts structurally and detects meaningful changes", () => {
  const saved = [stdioServer()];
  assert.equal(mcpDraftDirty(saved, [structuredClone(saved[0])]), false);
  assert.equal(mcpDraftDirty(saved, [stdioServer({ enabled: true })]), true);
  assert.equal(mcpDraftDirty(saved, [stdioServer({ args: ["other.mjs"] })]), true);
  assert.equal(mcpDraftDirty(saved, []), true);
});
