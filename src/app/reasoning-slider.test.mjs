import assert from "node:assert/strict";
import test from "node:test";
import {
  effortSliderFillRatio,
  effortSliderIndex,
  effortSliderIndexAtRatio,
  effortSliderLabelAnchor,
  effortSliderPointerRatio,
  effortSliderRatio,
  effortSliderStepIndex,
  effortSliderValueAt,
} from "./reasoning-slider.ts";

/** DeepSeek 默认路由：跟随模型默认 + 三档思考程度。 */
const choices = [
  { key: "provider-default", name: "默认" },
  { key: "effort:off", id: "off", name: "关闭" },
  { key: "effort:low", id: "low", name: "低" },
  { key: "effort:high", id: "high", name: "高" },
];

test("位置随档位数量自适应并贴住轨道两端", () => {
  assert.equal(effortSliderRatio(0, 4), 0);
  assert.equal(effortSliderRatio(1, 4), 1 / 3);
  assert.equal(effortSliderRatio(3, 4), 1);
  assert.equal(effortSliderRatio(1, 3), 0.5);
  // 单档居中，多档越界被夹回端点。
  assert.equal(effortSliderRatio(0, 1), 0.5);
  assert.equal(effortSliderRatio(9, 2), 1);
  assert.equal(effortSliderRatio(-3, 2), 0);
});

test("单档时整条轨道视为已选中", () => {
  assert.equal(effortSliderFillRatio(0, 1), 1);
  assert.equal(effortSliderFillRatio(1, 4), 1 / 3);
  assert.equal(effortSliderFillRatio(0, 4), 0);
});

test("当前值定位到对应档位，缺省值定位到跟随默认档", () => {
  assert.equal(effortSliderIndex(choices, undefined), 0);
  assert.equal(effortSliderIndex(choices, "low"), 2);
  assert.equal(effortSliderIndex([{ key: "effort:high", id: "high", name: "高" }], "high"), 0);
  // 值已失效时回落到第一档，而不是留下没有选中项的滑条。
  assert.equal(effortSliderIndex(choices, "stale"), 0);
  assert.equal(effortSliderIndex([], "low"), -1);
});

test("指针位置换算成连续比例并在轨道外夹回端点", () => {
  assert.equal(effortSliderPointerRatio(100, 100, 300), 0);
  assert.equal(effortSliderPointerRatio(250, 100, 300), 0.5);
  assert.equal(effortSliderPointerRatio(400, 100, 300), 1);
  assert.equal(effortSliderPointerRatio(-80, 100, 300), 0);
  // 宽度未知时不会算出 NaN 比例。
  assert.equal(effortSliderPointerRatio(120, 100, 0), 0);
});

test("连续比例命中最接近的档位", () => {
  assert.equal(effortSliderIndexAtRatio(0, 4), 0);
  assert.equal(effortSliderIndexAtRatio(0.5, 4), 2);
  assert.equal(effortSliderIndexAtRatio(1, 4), 3);
  // 越过中点才换档，拖动时档位稳定不抖动。
  assert.equal(effortSliderIndexAtRatio(0.16, 4), 0);
  assert.equal(effortSliderIndexAtRatio(0.84, 4), 3);
  assert.equal(effortSliderIndexAtRatio(-2, 4), 0);
  assert.equal(effortSliderIndexAtRatio(9, 4), 3);
  assert.equal(effortSliderIndexAtRatio(0.5, 1), 0);
});

test("提交值来自档位标识，跟随默认档提交 undefined", () => {
  assert.equal(effortSliderValueAt(choices, 0), undefined);
  assert.equal(effortSliderValueAt(choices, 3), "high");
  assert.equal(effortSliderValueAt(choices, 9), undefined);
});

test("标签在首末档贴边、其余居中", () => {
  assert.equal(effortSliderLabelAnchor(0, 4), 0);
  assert.equal(effortSliderLabelAnchor(1, 4), 50);
  assert.equal(effortSliderLabelAnchor(3, 4), 100);
  assert.equal(effortSliderLabelAnchor(0, 1), 50);
});

test("键盘步进限制在档位区间内", () => {
  assert.equal(effortSliderStepIndex(1, 1, 4), 2);
  assert.equal(effortSliderStepIndex(1, -1, 4), 0);
  assert.equal(effortSliderStepIndex(0, -1, 4), 0);
  assert.equal(effortSliderStepIndex(3, 1, 4), 3);
  assert.equal(effortSliderStepIndex(2, -Infinity, 4), 0);
  assert.equal(effortSliderStepIndex(2, Infinity, 4), 3);
  assert.equal(effortSliderStepIndex(0, 1, 0), -1);
});
