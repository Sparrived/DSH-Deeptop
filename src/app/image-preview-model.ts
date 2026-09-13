/**
 * 停靠标签内图片预览的纯模型：可预览判定、缩放换算与同目录导航序列。
 *
 * 这里只有「面板怎么显示」的算术，不碰 DOM、不碰桥接；组件负责把这些结果
 * 接到滚轮、指针和键盘上。缩放比例 1 表示「适应面板」，所以百分比是相对
 * 适应该面板的尺寸，而不是图片的原始像素。
 */

import { droppedImageMediaType } from "./ui-model.ts";

/** 缩放下限；1 是适应面板，小于 1 才有缩小的余地。 */
export const IMAGE_ZOOM_MIN = 0.25;
/** 缩放上限：再大的图也不该把面板撑成无法导航的尺寸。 */
export const IMAGE_ZOOM_MAX = 8;
/** 一格滚轮的倍率（细），一次按钮点击用 `IMAGE_ZOOM_BUTTON_FACTOR`（粗）。 */
export const IMAGE_ZOOM_WHEEL_FACTOR = 1.12;
export const IMAGE_ZOOM_BUTTON_FACTOR = 1.6;

/**
 * 单张图片的预览读取上限。
 *
 * 内容以 base64 越过 IPC，字符串体积约为字节数的 4/3；预览一次只持有一张，
 * 因此给到 16 MiB（约 21 MiB 字符串）已经覆盖截图与相机原图，同时避免一次
 * 读取就把 WebView 内存推高。原生侧另有 64 MiB 硬上限。
 */
export const IMAGE_PREVIEW_MAX_BYTES = 16 * 1024 * 1024;

/**
 * 该路径是否是面板能预览的图片。
 *
 * 判定沿用 `droppedImageMediaType`：它与原生 `read_image_attachment` 的魔数
 * 白名单是同一组格式，前端按扩展名分流、原生按内容确认。SVG 这类文本图片
 * 不在其列，仍走文本预览显示源码。
 */
export function previewableImage(path: string): boolean {
  return droppedImageMediaType(path) !== null;
}

/** 夹到可缩放区间；缺省或坏值（NaN/Infinity）退回适应面板。 */
export function clampImageZoom(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(IMAGE_ZOOM_MAX, Math.max(IMAGE_ZOOM_MIN, scale));
}

/** 原生读取结果（base64 + 媒体类型）转成 `<img>` 能直接用的 data URL。 */
export function imageDataUrl(mediaType: string, data: string): string {
  return data.startsWith("data:") ? data : `data:${mediaType};base64,${data}`;
}

/** 按倍率缩放后的比例，已夹到区间。 */
export function zoomImageBy(scale: number, factor: number): number {
  if (!Number.isFinite(factor) || factor <= 0) return clampImageZoom(scale);
  return clampImageZoom(scale * factor);
}

/** 缩放百分比的整数显示值（适应面板为 100）。 */
export function imageZoomPercent(scale: number): number {
  return Math.round(clampImageZoom(scale) * 100);
}

/**
 * 面板内图片的显示尺寸：先按「contain」适应面板，再乘以缩放比例。
 *
 * 任何一侧尺寸未知（图片还没加载完、面板还没量到）时返回 null，让 `<img>`
 * 回落到 CSS 的 `max-width/max-height: 100%`，也就是同一套适应面板的结果。
 * 取整用 `floor`：适应面板时不能因为进位而多出滚动条。
 */
export function imageDisplaySize(
  natural: { width: number; height: number },
  stage: { width: number; height: number },
  zoom: number,
): { width: number; height: number } | null {
  if (natural.width <= 0 || natural.height <= 0 || stage.width <= 0 || stage.height <= 0) return null;
  const fit = Math.min(stage.width / natural.width, stage.height / natural.height);
  const scale = fit * clampImageZoom(zoom);
  return {
    width: Math.max(1, Math.floor(natural.width * scale)),
    height: Math.max(1, Math.floor(natural.height * scale)),
  };
}

/**
 * 缩放锚点换算：让光标下的那一点在缩放前后留在原处（单轴）。
 *
 * 图片在舞台上居中并带 `pan` 平移，因此屏幕上的图片中心是 `center + pan`，
 * 光标相对它的偏移是 `pointer - center - pan`。缩放后这个偏移乘以 `ratio`，
 * 于是新的平移量是 `pan + (pointer - center - pan) * (1 - ratio)`。
 *
 * 这里刻意不用滚动容器实现平移：容器一旦出现滚动条，可测的尺寸就会跟着变，
 * 而尺寸又决定显示尺寸——两者互相牵动会来回震荡。平移只改 transform，不影响
 * 布局，因此量到的舞台尺寸始终稳定。
 */
export function anchoredImagePan(pan: number, pointer: number, center: number, ratio: number): number {
  if (![pan, pointer, center, ratio].every(Number.isFinite)) return pan;
  return pan + (pointer - center - pan) * (1 - ratio);
}

/** 把单轴平移夹在「放大出来的余量」里，避免把图片拖出舞台之外。 */
export function clampImagePan(pan: number, displayed: number, stage: number): number {
  if (![pan, displayed, stage].every(Number.isFinite)) return 0;
  const limit = Math.max(0, (displayed - stage) / 2);
  const clamped = Math.min(limit, Math.max(-limit, pan));
  // 夹取余量时会出现 -0；它与 0 等价，但会在 transform 里写成 "-0px"。
  return clamped === 0 ? 0 : clamped;
}

/** 缩放后的新平移量：先按光标锚点换算，再按新显示尺寸夹取（缩回适应面板即归零）。 */
export function imagePanAfterZoom(
  pan: { x: number; y: number },
  pointer: { x: number; y: number },
  center: { x: number; y: number },
  ratio: number,
  displayed: { width: number; height: number },
  stage: { width: number; height: number },
): { x: number; y: number } {
  return {
    x: clampImagePan(anchoredImagePan(pan.x, pointer.x, center.x, ratio), displayed.width, stage.width),
    y: clampImagePan(anchoredImagePan(pan.y, pointer.y, center.y, ratio), displayed.height, stage.height),
  };
}

/** 两个路径是否指向同一张图：统一分隔符与大小写（Windows 路径不敏感）。 */
function sameImagePath(left: string, right: string): boolean {
  const normalize = (value: string) => value.replace(/\\/gu, "/").replace(/\/+$/u, "").toLowerCase();
  return normalize(left) === normalize(right);
}

/**
 * 面板里的导航序列：同目录下可预览的图片，沿用目录列表的名称顺序。
 *
 * 当前文件不在序列里（目录读取失败、文件刚被删掉、或它本来就在目录之外）
 * 时只交出它自己，让面板仍能显示这一张，而不是给出一个空洞的导航条。
 */
export function imageGallery(paths: readonly string[], currentPath: string): string[] {
  const images = paths.filter(previewableImage);
  if (images.some((path) => sameImagePath(path, currentPath))) return images;
  return currentPath ? [currentPath] : [];
}

/** 当前文件在导航序列里的下标；不在序列里时取 0（序列至少含它自己）。 */
export function imageGalleryIndex(gallery: readonly string[], currentPath: string): number {
  const index = gallery.findIndex((path) => sameImagePath(path, currentPath));
  return index < 0 ? 0 : index;
}

/**
 * 相对当前下标偏移若干张。两端夹住而不是绕回：翻到第一张/最后一张后按钮
 * 就禁用，和画廊按钮的禁用状态一致。
 */
export function neighbourImageIndex(index: number, length: number, offset: number): number {
  if (!Number.isFinite(index) || !Number.isFinite(offset) || length <= 0) return 0;
  const next = Math.trunc(index) + Math.trunc(offset);
  return Math.min(length - 1, Math.max(0, next));
}
