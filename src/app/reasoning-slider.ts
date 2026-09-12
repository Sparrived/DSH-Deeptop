/**
 * 思考程度滑动条的纯几何与取值计算。
 *
 * 滑动条本身只负责渲染与指针事件，档位位置、指针命中、标签锚点和键盘步进
 * 都在这里以纯函数表达，因此选项数量（1–6 档及以上）变化时行为一致，
 * 也可以在 Node 中直接测试。
 */

export type ReasoningSliderChoice = {
  key: string;
  /** 提交给 DSH 的档位标识；缺省表示「跟随模型默认」。 */
  id?: string;
  name: string;
  description?: string;
};

/** 档位在轨道上的位置（0–1）；单档时居中，多档时首尾贴住轨道两端。 */
export function effortSliderRatio(index: number, count: number): number {
  if (count <= 1) return 0.5;
  const clamped = Math.min(Math.max(index, 0), count - 1);
  return clamped / (count - 1);
}

/** 已选中区域的填充比例；单档时整条轨道视为已选中。 */
export function effortSliderFillRatio(index: number, count: number): number {
  return count <= 1 ? 1 : effortSliderRatio(index, count);
}

/** 当前值对应的档位下标；值缺失或已失效时回落到第一档。 */
export function effortSliderIndex(choices: readonly ReasoningSliderChoice[], value?: string): number {
  if (choices.length === 0) return -1;
  const index = choices.findIndex((choice) => choice.id === value);
  return index < 0 ? 0 : index;
}

/** 指针横坐标在轨道内的连续位置（0–1）；宽度未知时返回 0。 */
export function effortSliderPointerRatio(clientX: number, left: number, width: number): number {
  if (!(width > 0)) return 0;
  return Math.min(Math.max((clientX - left) / width, 0), 1);
}

/** 连续位置命中的最近档位下标；单档或空轨道保持第一档。 */
export function effortSliderIndexAtRatio(ratio: number, count: number): number {
  if (count <= 1) return 0;
  const clamped = Math.min(Math.max(ratio, 0), 1);
  return Math.round(clamped * (count - 1));
}

/** 档位下标对应要提交的值；越界下标返回 undefined（即模型默认档）。 */
export function effortSliderValueAt(choices: readonly ReasoningSliderChoice[], index: number): string | undefined {
  return choices[index]?.id;
}

/** 档位标签相对刻度点的对齐百分比：首档左对齐、末档右对齐，其余居中。 */
export function effortSliderLabelAnchor(index: number, count: number): 0 | 50 | 100 {
  if (count <= 1) return 50;
  if (index <= 0) return 0;
  return index >= count - 1 ? 100 : 50;
}

/** 键盘步进：方向键按 ±1 移动，Home/End 用 ±Infinity 直达两端。 */
export function effortSliderStepIndex(index: number, delta: number, count: number): number {
  if (count <= 0) return -1;
  if (!Number.isFinite(delta)) return delta < 0 ? 0 : count - 1;
  return Math.min(Math.max(index + delta, 0), count - 1);
}
