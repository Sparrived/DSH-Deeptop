// 停靠标签图片预览的纯模型：可预览判定、缩放换算、显示尺寸与同目录导航序列。
// 组件只负责把这些结果接到滚轮/指针/键盘上，因此这些判定必须在这里被钉住。

import assert from "node:assert/strict";
import test from "node:test";
import {
  IMAGE_ZOOM_MAX,
  IMAGE_ZOOM_MIN,
  anchoredImagePan,
  clampImagePan,
  clampImageZoom,
  imageDataUrl,
  imageDisplaySize,
  imageGallery,
  imageGalleryIndex,
  imagePanAfterZoom,
  imageZoomPercent,
  neighbourImageIndex,
  previewableImage,
  zoomImageBy,
} from "./image-preview-model.ts";

test("previews only the formats the native sniffer accepts", () => {
  assert.equal(previewableImage("D:\\shots\\card.PNG"), true);
  assert.equal(previewableImage("shots/screen.jpeg"), true);
  assert.equal(previewableImage("shots/anim.gif"), true);
  assert.equal(previewableImage("shots/photo.webp"), true);
  // 文本类图片不走图片预览（仍按文本显示源码）；其余类别不在这里判定。
  assert.equal(previewableImage("shots/logo.svg"), false);
  assert.equal(previewableImage("shots/scan.avif"), false);
  assert.equal(previewableImage("shots/note.txt"), false);
  assert.equal(previewableImage("shots/no-extension"), false);
});

test("builds the data URL the image element consumes", () => {
  assert.equal(imageDataUrl("image/png", "AAAA"), "data:image/png;base64,AAAA");
  // 已经是 data URL 的内容不再套一层前缀。
  assert.equal(imageDataUrl("image/png", "data:image/jpeg;base64,BBBB"), "data:image/jpeg;base64,BBBB");
});

test("clamps zoom into the supported range and recovers from bad values", () => {
  assert.equal(clampImageZoom(1), 1);
  assert.equal(clampImageZoom(IMAGE_ZOOM_MIN / 2), IMAGE_ZOOM_MIN);
  assert.equal(clampImageZoom(IMAGE_ZOOM_MAX * 10), IMAGE_ZOOM_MAX);
  assert.equal(clampImageZoom(Number.NaN), 1);
  assert.equal(clampImageZoom(Number.POSITIVE_INFINITY), 1);
});

test("zooms by a factor without leaving the range", () => {
  assert.equal(zoomImageBy(1, 2), 2);
  assert.equal(zoomImageBy(1, 0.5), 0.5);
  assert.equal(zoomImageBy(IMAGE_ZOOM_MAX, 2), IMAGE_ZOOM_MAX);
  assert.equal(zoomImageBy(IMAGE_ZOOM_MIN, 0.5), IMAGE_ZOOM_MIN);
  // 坏倍率保持原比例，而不是把画面缩成 0。
  assert.equal(zoomImageBy(2, 0), 2);
  assert.equal(zoomImageBy(2, Number.NaN), 2);
});

test("reports the zoom percent relative to fit", () => {
  assert.equal(imageZoomPercent(1), 100);
  assert.equal(imageZoomPercent(1.5), 150);
  assert.equal(imageZoomPercent(IMAGE_ZOOM_MIN), 25);
  assert.equal(imageZoomPercent(0.333), 33);
});

test("fits the image into the panel before applying zoom", () => {
  const stage = { width: 400, height: 300 };
  // 宽图按宽度受限：400x200 恰好铺满宽度。
  assert.deepEqual(imageDisplaySize({ width: 800, height: 400 }, stage, 1), { width: 400, height: 200 });
  // 高图按高度受限。
  assert.deepEqual(imageDisplaySize({ width: 400, height: 800 }, stage, 1), { width: 150, height: 300 });
  // 放缩在适应尺寸之上相乘。
  assert.deepEqual(imageDisplaySize({ width: 800, height: 400 }, stage, 2), { width: 800, height: 400 });
  assert.deepEqual(imageDisplaySize({ width: 800, height: 400 }, stage, 0.5), { width: 200, height: 100 });
  // 适应面板时取整只许向下：多出 1px 就会平白长出滚动条。
  const odd = imageDisplaySize({ width: 1000, height: 333 }, { width: 301, height: 301 }, 1);
  assert.ok(odd.width <= 301 && odd.height <= 301, `${odd.width}x${odd.height} 超出面板`);
});

test("leaves sizing to CSS until both sizes are known", () => {
  const natural = { width: 800, height: 400 };
  const stage = { width: 400, height: 300 };
  assert.equal(imageDisplaySize(natural, { width: 0, height: 0 }, 1), null);
  assert.equal(imageDisplaySize({ width: 0, height: 0 }, stage, 1), null);
  // 未知尺寸不影响缩放上下限仍然生效。
  assert.deepEqual(imageDisplaySize(natural, stage, 99), imageDisplaySize(natural, stage, IMAGE_ZOOM_MAX));
});

test("keeps the point under the cursor while zooming", () => {
  // 光标停在图片中心（center=0 处偏移为 0）时放大，平移量不该动。
  assert.equal(anchoredImagePan(0, 0, 0, 2), 0);
  // 光标偏离图片中心 50px，放大一倍后这个偏移翻倍，平移量补回一半的差值。
  assert.equal(anchoredImagePan(0, 50, 0, 2), -50);
  assert.equal(anchoredImagePan(0, -50, 0, 2), 50);
  // 缩小一半：偏移减半，平移量向图片中心收回。
  assert.equal(anchoredImagePan(0, 50, 0, 0.5), 25);
  // 已经有了平移量时按同一套换算继续累加。
  assert.equal(anchoredImagePan(30, 50, 20, 2), 30 + (50 - 20 - 30) * (1 - 2));
  // 坏值原样返回，避免把画面甩到未定义的位置。
  assert.equal(anchoredImagePan(30, 10, 0, Number.NaN), 30);
});

test("clamps panning to the room the zoomed image actually has", () => {
  // 适应面板（显示尺寸等于舞台）时没有可平移的余量。
  assert.equal(clampImagePan(40, 400, 400), 0);
  assert.equal(clampImagePan(-40, 300, 400), 0);
  // 放大一倍：单边余量是 (800 - 400) / 2。
  assert.equal(clampImagePan(500, 800, 400), 200);
  assert.equal(clampImagePan(-500, 800, 400), -200);
  assert.equal(clampImagePan(120, 800, 400), 120);
  assert.equal(clampImagePan(Number.NaN, 800, 400), 0);
});

test("combines the anchor and the clamp for one zoom step", () => {
  const stage = { width: 400, height: 300 };
  const center = { x: 200, y: 150 };
  const displayed = { width: 800, height: 600 };
  const next = imagePanAfterZoom({ x: 0, y: 0 }, { x: 300, y: 150 }, center, 2, displayed, stage);
  // 水平方向按锚点换算后被余量夹住，垂直方向没有偏移。
  assert.deepEqual(next, { x: -100, y: 0 });
  // 缩回适应面板：余量归零，平移量一并归零。
  assert.deepEqual(
    imagePanAfterZoom({ x: 200, y: 0 }, { x: 300, y: 150 }, center, 0.5, stage, stage),
    { x: 0, y: 0 },
  );
});

test("orders the gallery by the directory listing and keeps the current file", () => {
  const siblings = ["shots/a.png", "shots/b.txt", "shots/c.jpg", "shots/d.webp"];
  assert.deepEqual(imageGallery(siblings, "shots/c.jpg"), ["shots/a.png", "shots/c.jpg", "shots/d.webp"]);
  // 路径写法不同（分隔符、大小写、相对/绝对）仍认成同一张。
  assert.deepEqual(imageGallery(["shots/A.PNG"], "SHOTS\\a.png"), ["shots/A.PNG"]);
});

test("falls back to the current image alone when the directory is unknown", () => {
  assert.deepEqual(imageGallery([], "shots/solo.png"), ["shots/solo.png"]);
  assert.deepEqual(imageGallery(["shots/b.txt"], "shots/solo.png"), ["shots/solo.png"]);
  assert.deepEqual(imageGallery([], ""), []);
});

test("reads the current index and clamps navigation at both ends", () => {
  const gallery = ["a.png", "b.png", "c.png"];
  assert.equal(imageGalleryIndex(gallery, "b.png"), 1);
  // 不在序列里时落到第一张，而不是 -1 让调用方越界。
  assert.equal(imageGalleryIndex(gallery, "missing.png"), 0);
  assert.equal(imageGalleryIndex([], "missing.png"), 0);

  assert.equal(neighbourImageIndex(1, 3, 1), 2);
  assert.equal(neighbourImageIndex(1, 3, -1), 0);
  // 两端夹住：第一张再往前、最后一张再往后都停在原地。
  assert.equal(neighbourImageIndex(0, 3, -1), 0);
  assert.equal(neighbourImageIndex(2, 3, 1), 2);
  // 空序列与坏下标不产生越界值。
  assert.equal(neighbourImageIndex(0, 0, 1), 0);
  assert.equal(neighbourImageIndex(Number.NaN, 3, 1), 0);
});
