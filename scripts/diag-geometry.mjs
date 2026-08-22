// 诊断图谱几何：泳道区间 + 边路径（合并区域）
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
  lines.push({ hash: f[0], shortHash: f[1], refs: f[3].split(",").map((s) => s.trim()).filter(Boolean), parents: f[4].split(" ").map((s) => s.trim()).filter(Boolean), subject: f[5] });
}
const layout = gitGraphLayout(lines);
const byHash = new Map(lines.map((l) => [l.hash, l]));

console.log("== 泳道占用段 ==");
for (const seg of layout.laneSegments) {
  console.log(`lane${seg.lane}: rows [${seg.fromRow}..${seg.toRow}] (${seg.toRow - seg.fromRow + 1} 行)`);
}
console.log("\n== 边 ==");
for (const edge of layout.edges) {
  const src = byHash.get(layout.commits.find((c) => c.row === edge.fromRow)?.hash ?? "");
  const dst = byHash.get(layout.commits.find((c) => c.row === edge.toRow)?.hash ?? "");
  console.log(`lane${edge.fromLane} r${edge.fromRow} (${src?.shortHash}) → lane${edge.toLane} r${edge.toRow} (${dst?.shortHash})`);
}
console.log("\n== 各行摘要（row: lane short subject）合并附近 ==");
for (const c of layout.commits) {
  if (c.row < 42 || c.row > 72) continue;
  console.log(`r${String(c.row).padStart(3)} lane${c.lane} ${c.shortHash} ${byHash.get(c.hash).subject.slice(0, 30)}`);
}