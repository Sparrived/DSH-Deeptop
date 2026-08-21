// 临时诊断：用真实 DSH 数据重建前端工作区/会话投影，模拟 chooseWorkspace(B) 状态机
import { readFileSync, readdirSync, existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const dshHome = join(homedir(), ".dsh");

function sameWorkspacePath(left, right) {
  if (!left || !right) return false;
  const norm = (v) => v.replace(/[\\/]+$/, "").toLocaleLowerCase();
  return norm(left) === norm(right);
}

const registry = JSON.parse(readFileSync(join(dshHome, "storages", "workspace.json"), "utf8"));
const rawWorkspaces = registry.tables.workspaces;
const archived = new Set(registry.global.archivedSessionIds ?? []);
const workspaceIds = registry.global.workspaceIds ?? [];

// 与运行时一致：sessionPath(id) = realpath(header.cwd)（数据库路径为原样存储，比较前需 realpath）
const workspaces = workspaceIds
  .map((id) => rawWorkspaces[id])
  .filter(Boolean)
  .map((item) => ({ ...item }));

// 会话列表：投影缓存提供了 identity.cwd；按运行时规则计算 sessionPath = realpath(cwd)
const projcache = JSON.parse(readFileSync(join(dshHome, "storages", "session_projcache.json"), "utf8"));
const cwdBySessionId = new Map();
for (const [sessionId, entry] of Object.entries(projcache.tables.sessions)) {
  if (entry.identity?.cwd) cwdBySessionId.set(sessionId, entry.identity.cwd);
}
const sessionPathById = new Map();
for (const [sessionId, cwd] of cwdBySessionId) {
  if (!existsSync(cwd)) continue;
  try {
    sessionPathById.set(sessionId, realpathSync(cwd));
  } catch {
    // 目录不存在时与运行时一致：无 sessionPath
  }
}
// 运行时 workspace.list 投影：sessionIds 只保留 sessionPath(id) === workspace.path 的会话
for (const item of workspaces) {
  item.sessionIds = item.sessionIds.filter((sid) => sessionPathById.get(sid) === item.path);
}

const sessions = Object.entries(projcache.tables.sessions).map(([sessionId, entry]) => ({
  sessionId,
  cwd: entry.identity?.cwd,
  blank: false,
  origin: undefined,
  parentSessionId: undefined,
}));

const workspaceBySessionId = new Map();
for (const item of workspaces) for (const sid of item.sessionIds) workspaceBySessionId.set(sid, item);

const visibleSessions = sessions.filter((s) => !archived.has(s.sessionId));
const visibleById = new Map(visibleSessions.map((s) => [s.sessionId, s]));

function firstConversationForWorkspace(workspacePath, workspaceItem) {
  if (workspaceItem) {
    for (const sessionId of workspaceItem.sessionIds) {
      const session = visibleById.get(sessionId);
      if (session) return session;
    }
    return null;
  }
  if (!workspacePath) return visibleSessions.find((s) => !workspaceBySessionId.has(s.sessionId)) ?? null;
  return null;
}

console.log("== 工作区投影 ==");
for (const item of workspaces) {
  console.log(`${item.title ?? item.path}: sessionIds=${item.sessionIds.length}, 会话目录存在=${item.sessionIds.filter((id) => visibleById.has(id)).length}`);
}

// 模拟：当前在 A（数据迁移），点击 B（DSH-Desktop）
const workspaceA = workspaces.find((w) => w.path.includes("数据迁移")) ?? workspaces[0];
const workspaceB = workspaces.find((w) => w.path.endsWith("DSH-Desktop")) ?? workspaces[1];
if (!workspaceA || !workspaceB) {
  console.log("未找到目标工作区");
  process.exit(0);
}
console.log(`\n模拟：从 ${workspaceA.path} （会话数 ${workspaceA.sessionIds.length}）点击 ${workspaceB.path}（会话数 ${workspaceB.sessionIds.length}）`);

// attachUnregisteredSessions：cwd 与 B 相同但未登记到任何工作区的会话
const registered = new Set(workspaces.flatMap((w) => w.sessionIds));
const candidates = sessions.filter((s) => Boolean(s.cwd) && sameWorkspacePath(s.cwd, workspaceB.path) && !registered.has(s.sessionId));
console.log(`attachUnregisteredSessions 候选：${candidates.length} 个`);
const attachedSessionIds = candidates.map((s) => s.sessionId);
const freshB = {
  ...workspaceB,
  sessionIds: [...attachedSessionIds, ...workspaceB.sessionIds],
};

const first = firstConversationForWorkspace(workspaceB.path, freshB);
console.log(`\nfirstConversationForWorkspace → ${first ? `${first.sessionId} (cwd=${JSON.stringify(first.cwd)})` : "null"}`);

if (first) {
  // openSession 内部的 setWorkspace 计算（点击时闭包里的 workspaces 状态）
  const found = workspaces.find((item) => item.sessionIds.includes(first.sessionId));
  const workspaceForSession = found?.path ?? first.cwd ?? "";
  console.log(`openSession setWorkspace: workspaces.find=${found ? found.title ?? found.path : "未找到"} ?: ${JSON.stringify(first.cwd)} ?? ""`);
  console.log(`→ setWorkspace(${JSON.stringify(workspaceForSession)})`);
  const synced = sameWorkspacePath(workspaceForSession, workspaceB.path);
  console.log(`侧栏最终工作区 ${synced ? "==" : "≠≠"} 选中工作区 B（sameWorkspacePath：${synced}）`);
  if (workspaceForSession && !synced) {
    console.log(`  注意：workspace 状态被改成 ${JSON.stringify(workspaceForSession)}，侧栏不会跟随 B`);
  }
  if (attachedSessionIds.includes(first.sessionId)) {
    console.log("  first 是刚附着的会话：它在点击时闭包的 workspaces 中不存在 → 依赖 cwd 兜底");
  }
} else {
  console.log("→ startNewSession()：对话显示空白新会话页");
}

// 对照：B 的第一个会话在侧栏会话区是否可见
const groupSessions = freshB.sessionIds.map((id) => visibleById.get(id)).filter(Boolean);
console.log(`\n侧栏会话区将显示 B 的 ${groupSessions.length} 个会话；其中第一个：${groupSessions[0]?.sessionId ?? "无"}`);
const cwdFormats = new Set(workspaces.map((w) => w.path));
console.log(`\n工作区路径格式样例：${[...cwdFormats].slice(0, 3).join(" | ")}`);
const sessionCwdMismatch = sessions.filter((s) => s.cwd && workspaces.some((w) => w.sessionIds.includes(s.sessionId) && !sameWorkspacePath(s.cwd, w.path))).length;
console.log(`已登记会话中 cwd 与所属工作区路径不一致（sameWorkspacePath）：${sessionCwdMismatch} 个`);
const slashes = sessions.filter((s) => s.cwd && s.cwd.includes("/")).length;
console.log(`会话 cwd 含正斜杠的：${slashes} 个`);