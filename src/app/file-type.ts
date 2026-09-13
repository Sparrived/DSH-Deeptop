/**
 * 共享文件类型分类表。
 *
 * 交付卡片徽标、工作区文件树图标、附件与消息链接字形共用同一份判定，
 * 不再各自维护扩展名 switch（上游对应 `ui-primitives/src/FileTypeIcon.tsx`
 * 的 `FileType` 联合与 `classifyFileType`）。
 *
 * 只借分类，不借上游的 28px 图形：桌面端对磁盘文件用系统图标或现有
 * lucide 图标更合适。判定顺序与上游一致——文件名规则（readme 等）先于
 * 扩展名规则，扩展名大小写不敏感，无法识别时落到 `other`。
 */

/** 路径最后一段；与 `ui-model.ts` 的 `pathBasename` 同义，这里自带一份以免
 *  分类表依赖整个 ui-model 运行图（断言它的测试直接跑源码）。 */
function basename(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const separator = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return separator >= 0 ? normalized.slice(separator + 1) : normalized;
}

/** 有独立显示含义的文件类别。 */
export type FileType =
  | "code"
  | "excel"
  | "html"
  | "image"
  | "markdown"
  | "other"
  | "pdf"
  | "ppt"
  | "video"
  | "word";

const EXTENSION_TYPES: Readonly<Record<string, FileType>> = {
  ts: "code",
  tsx: "code",
  mts: "code",
  cts: "code",
  js: "code",
  jsx: "code",
  mjs: "code",
  cjs: "code",
  py: "code",
  rs: "code",
  go: "code",
  java: "code",
  kt: "code",
  rb: "code",
  php: "code",
  c: "code",
  h: "code",
  cc: "code",
  cpp: "code",
  hpp: "code",
  cs: "code",
  swift: "code",
  sh: "code",
  bash: "code",
  zsh: "code",
  ps1: "code",
  bat: "code",
  cmd: "code",
  sql: "code",
  xml: "code",
  json: "code",
  jsonc: "code",
  yml: "code",
  yaml: "code",
  toml: "code",
  ini: "code",
  conf: "code",
  scss: "code",
  sass: "code",
  less: "code",
  css: "code",
  vue: "code",
  svelte: "code",
  astro: "code",
  csv: "code",
  tsv: "code",
  html: "html",
  htm: "html",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  svg: "image",
  webp: "image",
  avif: "image",
  bmp: "image",
  ico: "image",
  tif: "image",
  tiff: "image",
  heic: "image",
  heif: "image",
  md: "markdown",
  mdx: "markdown",
  markdown: "markdown",
  pdf: "pdf",
  ppt: "ppt",
  pptx: "ppt",
  key: "ppt",
  mp4: "video",
  mov: "video",
  m4v: "video",
  webm: "video",
  mkv: "video",
  avi: "video",
  mpg: "video",
  mpeg: "video",
  doc: "word",
  docx: "word",
  rtf: "word",
  odt: "word",
  pages: "word",
  xls: "excel",
  xlsx: "excel",
  xlsm: "excel",
  numbers: "excel",
};

/** 无扩展名但按约定归属某类的文件名。 */
const NAME_TYPES: Readonly<Record<string, FileType>> = {
  changelog: "markdown",
  contributing: "markdown",
  readme: "markdown",
};

/** 各类别的徽标短标签（语言无关的技术标记，与文件树图标同源）。 */
const FILE_TYPE_LABELS: Readonly<Record<FileType, string>> = {
  code: "CODE",
  excel: "XLS",
  html: "HTML",
  image: "IMG",
  markdown: "MD",
  other: "FILE",
  pdf: "PDF",
  ppt: "PPT",
  video: "VID",
  word: "DOC",
};

/** 提取路径最后一段的扩展名（不含点，保留原大小写）；无扩展名时返回空串。 */
export function fileExtension(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1);
}

/** 按文件名规则、再按扩展名规则分类；无法识别时返回 `other`。 */
export function classifyFileType(path: string): FileType {
  const name = basename(path).toLowerCase();
  return NAME_TYPES[name] ?? EXTENSION_TYPES[fileExtension(name).toLowerCase()] ?? "other";
}

/** 交付卡片等处的类别徽标文案。 */
export function fileTypeLabel(path: string): string {
  return FILE_TYPE_LABELS[classifyFileType(path)];
}
