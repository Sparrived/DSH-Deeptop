// 用真实 git log --graph 数据生成与 GitTreeGraph 组件同几何的 HTML 预览，供 headless 截图检查。
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "work");
mkdirSync(outDir, { recursive: true });

const CELL_W = 12;
const ROW_H = 22;
const LANES = ["#f5d99b", "#8ab4f8", "#ff7b72", "#79d8a8", "#d2a8ff", "#79d8d8"];
const laneColor = (col) => LANES[((col % LANES.length) + LANES.length) % LANES.length];

const fmt = "%H%x1f%h%x1f%at%x1f%D%x1f%s%x1e";
const raw = execFileSync("git", ["--no-pager", "log", "--graph", "--no-color", "--all", "-n", "140", `--format=${fmt}`], { encoding: "utf8" });
const sep1 = String.fromCharCode(0x1f);
const sep2 = String.fromCharCode(0x1e);

const rows = [];
for (let rawLine of raw.split("\n")) {
  const line = rawLine.replace(new RegExp(`[${sep2}\r]`, "g"), "");
  if (!line) continue;
  let hashStart = -1;
  for (let i = 0; i < line.length; i++) if (/[0-9a-f]/.test(line[i])) { hashStart = i; break; }
  if (hashStart < 0 || line.indexOf(sep1) < 0) { rows.push({ graph: line.trimEnd() }); continue; }
  const fields = line.slice(hashStart).split(sep1);
  if (fields[0].length !== 40 || fields.length < 5) { rows.push({ graph: line.trimEnd() }); continue; }
  rows.push({
    graph: line.slice(0, hashStart).trimEnd(),
    hash: fields[0],
    short: fields[1],
    refs: fields[3].split(",").map((s) => s.trim()).filter(Boolean),
    subject: fields[4],
  });
}

const maxColumns = rows.reduce((m, r) => Math.max(m, r.graph.length), 0);

const palette = (col) => laneColor(col);
function cellsHtml(row) {
  const my = ROW_H / 2;
  let s = "";
  for (let c = 0; c < maxColumns; c++) {
    const ch = c < row.graph.length ? row.graph[c] : " ";
    if (ch === " ") continue;
    const color = palette(c);
    const cx = (c + 0.5) * CELL_W;
    if (ch === "|" || ch === "*" || ch === "o") {
      s += `<line x1="${cx}" y1="0" x2="${cx}" y2="${ROW_H}" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`;
      if (ch !== "|") {
        const head = (row.refs || []).some((r) => r.startsWith("HEAD"));
        s += `<circle cx="${cx}" cy="${my}" r="5.5" fill="${color}"/>`;
        s += `<circle cx="${cx}" cy="${my}" r="2" fill="#11141c"/>`;
        if (head) s += `<circle cx="${cx}" cy="${my}" r="8" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.7"/>`;
      }
    } else if (ch === "\\") s += `<line x1="${c * CELL_W + 1}" y1="0" x2="${(c + 1) * CELL_W - 1}" y2="${ROW_H}" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`;
    else if (ch === "/") s += `<line x1="${(c + 1) * CELL_W - 1}" y1="0" x2="${c * CELL_W + 1}" y2="${ROW_H}" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`;
    else if (ch === "_") s += `<line x1="${c * CELL_W}" y1="${ROW_H * 0.8}" x2="${(c + 1) * CELL_W}" y2="${ROW_H * 0.8}" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`;
    else if (ch === ".") s += `<line x1="${c * CELL_W}" y1="${my}" x2="${(c + 1) * CELL_W}" y2="${my}" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`;
    else s += `<circle cx="${cx}" cy="${my}" r="1.4" fill="${color}" opacity="0.5"/>`;
  }
  return `<svg width="${maxColumns * CELL_W}" height="${ROW_H}">${s}</svg>`;
}

const body = rows.map((row) => {
  if (!row.hash) return `<div class="c">${cellsHtml(row)}</div>`;
  const refs = (row.refs || []).map((r) => `<span class="ref">${r}</span>`).join("");
  return `<button class="r">${cellsHtml(row)}<span class="h">${row.short}</span>${refs}<span class="s">${row.subject}</span></button>`;
}).join("\n");

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;padding:10px;background:#f7f8fa;font-family:Consolas,'Cascadia Mono',monospace;font-size:11px;color:#1f2633}
  .r,.c{display:flex;align-items:center;gap:6px;padding:0 10px;border:0;background:#fff;white-space:nowrap;width:100%;box-sizing:border-box}
  svg{flex:0 0 auto;display:block}
  .h{color:#2a6db5;font-weight:700}
  .s{overflow:hidden;text-overflow:ellipsis}
  .ref{padding:1px 5px;border:1px solid #c9d2dd;border-radius:4px;font-size:9px;color:#7a8798}
</style></head><body>${body}</body></html>`;
writeFileSync(path.join(outDir, "graph-preview.html"), html);
console.log(`wrote preview with ${rows.length} rows, maxColumns=${maxColumns}`);
