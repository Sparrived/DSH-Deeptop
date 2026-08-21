// 用真实 git log --graph 数据渲染与 GitTreeGraph 组件相同的向量树（泳道+贝塞尔边+节点），
// 输出 HTML 供 headless 截图检查。几何常量与组件保持一致。
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gitGraphLayout } from "../src/app/git-graph-layout.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "work");
mkdirSync(outDir, { recursive: true });

const LANE_W = 20;
const ROW_H = 26;
const NODE_R = 6;
const LANES = ["#f5d99b", "#8ab4f8", "#ff7b72", "#79d8a8", "#d2a8ff", "#79d8d8"];
const laneColor = (lane) => LANES[((lane % LANES.length) + LANES.length) % LANES.length];

const fmt = "%H%x1f%h%x1f%at%x1f%D%x1f%P%x1f%s%x1e";
const raw = execFileSync("git", ["--no-pager", "log", "--graph", "--no-color", "--all", "-n", "120", `--format=${fmt}`], { encoding: "utf8" });
const sep1 = String.fromCharCode(0x1f);
const sep2 = String.fromCharCode(0x1e);

const lines = [];
for (let rawLine of raw.split("\n")) {
  const line = rawLine.replace(new RegExp(`[${sep2}\r]`, "g"), "");
  if (!line) continue;
  let hashStart = -1;
  for (let i = 0; i < line.length; i++) if (/[0-9a-f]/.test(line[i])) { hashStart = i; break; }
  const graph = hashStart < 0 ? line.trimEnd() : line.slice(0, hashStart).trimEnd();
  if (hashStart < 0 || line.indexOf(sep1) < 0) { lines.push({ graph, hash: null, parents: [] }); continue; }
  const fields = line.slice(hashStart).split(sep1);
  if (fields[0].length !== 40 || fields.length < 6) { lines.push({ graph, hash: null, parents: [] }); continue; }
  lines.push({
    graph,
    hash: fields[0],
    shortHash: fields[1],
    refs: fields[3].split(",").map((s) => s.trim()).filter(Boolean),
    parents: fields[4].split(" ").map((s) => s.trim()).filter(Boolean),
    subject: fields[5],
  });
}

const layout = gitGraphLayout(lines);
const graphW = layout.columnCount * LANE_W;
const graphH = layout.commits.length * ROW_H;
const laneX = (lane) => (lane + 0.5) * LANE_W;
const nodeY = (row) => row * ROW_H + ROW_H / 2;

const svg = [];
for (const lane of layout.lanes) {
  const x = laneX(lane.lane);
  svg.push(`<line x1="${x}" y1="${nodeY(lane.fromRow)}" x2="${x}" y2="${nodeY(lane.toRow)}" stroke="${laneColor(lane.lane)}" stroke-width="2" stroke-linecap="round" opacity="0.9"/>`);
}
for (const edge of layout.edges) {
  const xs = laneX(edge.fromLane), ys = nodeY(edge.fromRow);
  const xt = laneX(edge.toLane), yt = nodeY(edge.toRow);
  const cornerR = 7;
  const joinY = 5;
  const elbowY = Math.max(ys + cornerR + 2, yt - cornerR - joinY);
  const dir = xt >= xs ? 1 : -1;
  const path = `M ${xs} ${ys} L ${xs} ${elbowY - cornerR} A ${cornerR} ${cornerR} 0 0 ${dir === 1 ? 1 : 0} ${xs + dir * cornerR} ${elbowY} L ${xt - dir * cornerR} ${elbowY} A ${cornerR} ${cornerR} 0 0 ${dir === 1 ? 0 : 1} ${xt} ${elbowY + cornerR} L ${xt} ${yt}`;
  svg.push(`<path d="${path}" fill="none" stroke="${laneColor(edge.fromLane)}" stroke-width="2" stroke-linecap="round"/>`);
}
for (const c of layout.commits) {
  const x = laneX(c.lane), y = nodeY(c.row);
  const color = laneColor(c.lane);
  svg.push(`<circle cx="${x}" cy="${y}" r="${NODE_R + (c.isHead ? 1.5 : 0)}" fill="${color}"/>`);
  svg.push(`<circle cx="${x}" cy="${y}" r="2.2" fill="#11141c"/>`);
  if (c.isHead) svg.push(`<circle cx="${x}" cy="${y}" r="${NODE_R + 4.5}" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.75"/>`);
}

const rows = layout.commits.map((c) => {
  const refs = (c.refs || []).map((r) => `<span class="ref">${r}</span>`).join("");
  return `<button class="r" style="top:${c.row * ROW_H}px;left:${graphW + 10}px;height:${ROW_H}px">${refs}<span>${c.subject}</span></button>`;
}).join("\n");

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;padding:0;background:#f7f8fa;font-family:Consolas,'Cascadia Mono',monospace;font-size:11px;color:#1f2633}
  .wrap{position:relative;width:100%;height:${graphH}px}
  svg{position:absolute;left:0;top:0}
  .r{position:absolute;display:flex;align-items:center;gap:6px;padding:0 8px;border:0;background:transparent;color:#1f2633;white-space:nowrap;font-family:inherit;font-size:11px;width:auto;min-width:140px;overflow:hidden;text-overflow:ellipsis}
  .ref{padding:1px 5px;border:1px solid #c9d2dd;border-radius:4px;font-size:9px;color:#7a8798}
</style></head><body><div class="wrap"><svg width="${graphW}" height="${graphH}">${svg.join("")}</svg>${rows}</div></body></html>`;
writeFileSync(path.join(outDir, "graph-preview.html"), html);
console.log(`wrote vector preview: commits=${layout.commits.length} lanes=${layout.columnCount} edges=${layout.edges.length}`);
