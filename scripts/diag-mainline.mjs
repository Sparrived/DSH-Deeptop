// 诊断：主线（HEAD 第一双亲链）在布局中的泳道是否稳定
import { execFileSync } from "node:child_process";
import { gitGraphLayout } from "../src/app/git-graph-layout.ts";

const fmt = "%H%x1f%h%x1f%at%x1f%D%x1f%P%x1f%s%x1e";
const raw = execFileSync("git", ["--no-pager", "log", "--graph", "--no-color", "--all", "-n", "120", `--format=${fmt}`], { encoding: "utf8" });
const sep1 = String.fromCharCode(0x1f);
const sep2 = String.fromCharCode(0x1e);

const lines = [];
for (let rawLine of raw.split("\n")) {
  const line = rawLine.replace(new RegExp(`[${sep2}\r]`, "g"), "");
  if (!line) continue;
  let hs = -1;
  for (let i = 0; i < line.length; i++) if (/[0-9a-f]/.test(line[i])) { hs = i; break; }
  if (hs < 0 || line.indexOf(sep1) < 0) continue;
  const f = line.slice(hs).split(sep1);
  if (f[0].length !== 40 || f.length < 6) continue;
  lines.push({
    graph: line.slice(0, hs).trimEnd(),
    hash: f[0],
    shortHash: f[1],
    refs: f[3].split(",").map((s) => s.trim()).filter(Boolean),
    parents: f[4].split(" ").map((s) => s.trim()).filter(Boolean),
    subject: f[5],
  });
}

const layout = gitGraphLayout(lines);
const byHash = new Map(lines.map((l) => [l.hash, l]));
const pos = new Map(layout.commits.map((c) => [c.hash, c]));

console.log(`parsed ${lines.length} commits, columnCount=${layout.columnCount}`);
console.log("--- 所有分支尖端（前 6 条）---");
for (const c of layout.commits.slice(0, 6)) {
  console.log(`  r${c.row} lane${c.lane} ${c.shortHash} ${byHash.get(c.hash).refs.join(",") || "-"} ${c.subject.slice(0, 30)}`);
}

let cur = lines[0].hash;
const seen = new Set();
const chain = [];
while (cur && !seen.has(cur)) {
  seen.add(cur);
  const p = pos.get(cur);
  const src = byHash.get(cur);
  if (!p || !src) break;
  chain.push(p);
  if (src.parents.length === 0) break;
  cur = src.parents[0];
}
console.log("--- 主线链（HEAD 第一双亲）---");
for (const c of chain) {
  console.log(`  r${String(c.row).padStart(3)} lane${c.lane} ${c.shortHash} ${byHash.get(c.hash).subject.slice(0, 36)}`);
}
console.log("主线使用的泳道:", [...new Set(chain.map((c) => c.lane))].join(","));