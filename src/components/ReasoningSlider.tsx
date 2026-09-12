import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { t, type UiLocale } from "../app/i18n";
import {
  effortSliderFillRatio,
  effortSliderIndex,
  effortSliderIndexAtRatio,
  effortSliderLabelAnchor,
  effortSliderPointerRatio,
  effortSliderRatio,
  effortSliderStepIndex,
  effortSliderValueAt,
  type ReasoningSliderChoice,
} from "../app/reasoning-slider";

export type { ReasoningSliderChoice };

type ReasoningSliderProps = {
  /** 界面语言：无障碍名称按语言渲染。 */
  locale?: UiLocale;
  choices: readonly ReasoningSliderChoice[];
  /** 当前档位；缺省表示跟随模型默认。 */
  value?: string;
  onChange: (value?: string) => void | Promise<unknown>;
};

/** 提交后等待外部值追上的最长时长；桥接失败时滑块据此回到真实档位。 */
const SLIDER_SETTLE_MS = 1200;

/**
 * 思考程度横向滑动条。
 *
 * 档位位置、标签锚点全部按选项数量换算成百分比，因此 1–6 档都均匀铺满轨道，
 * 无需为不同模型写不同样式。按住拖动时滑块连续跟随指针，松手后吸附到最近
 * 档位并提交；方向键、Home/End 同样可以调整档位。
 */
export function ReasoningSlider({ locale = "zh", choices, value, onChange }: ReasoningSliderProps) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const dragIndexRef = useRef<number | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  // 拖动期间滑块连续跟随指针，刻度与填充则保持档位吸附。
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  // 提交后桥接往返期间保持落点，避免滑块先弹回旧档位再跳到新档位。
  const [settlingIndex, setSettlingIndex] = useState<number | null>(null);

  const count = choices.length;
  const committedIndex = effortSliderIndex(choices, value);
  const activeIndex = dragIndex ?? settlingIndex ?? committedIndex;
  const active = choices[activeIndex] ?? choices[0];
  const dragging = dragIndex !== null;
  const ratio = effortSliderRatio(activeIndex, count);
  const fill = effortSliderFillRatio(activeIndex, count);
  const settlingValue = settlingIndex === null ? undefined : effortSliderValueAt(choices, settlingIndex);
  // 档位越多标签越挤：5–6 档缩排淡化，7 档以上只保留当前档位文案。
  const density = count >= 7 ? "dense" : count > 4 ? "compact" : undefined;
  const hasDescriptions = choices.some((choice) => !!choice.description);

  useEffect(() => {
    if (settlingIndex === null) return;
    if (settlingValue === value) {
      setSettlingIndex(null);
      return;
    }
    const timer = window.setTimeout(() => setSettlingIndex(null), SLIDER_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [settlingIndex, settlingValue, value]);

  /** 指针位置的连续比例与命中的档位；轨道尚未布局时返回 null。 */
  function samplePointer(clientX: number): { index: number; ratio: number } | null {
    const rect = railRef.current?.getBoundingClientRect();
    if (!rect || !(rect.width > 0)) return null;
    const pointerRatio = effortSliderPointerRatio(clientX, rect.left, rect.width);
    return { index: effortSliderIndexAtRatio(pointerRatio, count), ratio: pointerRatio };
  }

  function dragTo(sample: { index: number; ratio: number } | null) {
    if (!sample) return;
    dragIndexRef.current = sample.index;
    setDragIndex(sample.index);
    setDragRatio(sample.ratio);
  }

  function commitAt(index: number) {
    if (index === committedIndex) return;
    setSettlingIndex(index);
    void onChange(effortSliderValueAt(choices, index));
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || count === 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
    dragTo(samplePointer(event.clientX));
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (dragIndexRef.current === null) return;
    const sample = samplePointer(event.clientX);
    if (!sample || sample.index === dragIndexRef.current) return;
    dragTo(sample);
  }

  function endDrag(event: PointerEvent<HTMLDivElement>, shouldCommit: boolean) {
    const index = dragIndexRef.current;
    dragIndexRef.current = null;
    setDragIndex(null);
    setDragRatio(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    // 主动取消（如系统手势抢占）时保留外部值，不把中间落点写回会话。
    if (shouldCommit && index !== null) commitAt(index);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const delta = event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1
      : event.key === "ArrowRight" || event.key === "ArrowUp" ? 1
        : event.key === "Home" ? -Infinity
          : event.key === "End" ? Infinity
            : 0;
    if (delta === 0) return;
    event.preventDefault();
    const next = effortSliderStepIndex(activeIndex, delta, count);
    if (next === activeIndex || next < 0) return;
    commitAt(next);
  }

  const style = {
    "--effort-ratio": String(ratio),
    "--effort-fill": String(fill),
    ...(dragRatio === null ? {} : { "--effort-thumb-ratio": String(dragRatio) }),
  } as CSSProperties;

  return <div className="effort-slider" data-dragging={dragging || undefined} data-density={density} data-hint={hasDescriptions || undefined} style={style}>
    <div
      className="effort-slider-rail"
      ref={railRef}
      role="slider"
      tabIndex={0}
      aria-label={t("modelPicker.reasoningEffort", locale)}
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={Math.max(count - 1, 0)}
      aria-valuenow={Math.max(activeIndex, 0)}
      aria-valuetext={active?.name}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(event) => endDrag(event, true)}
      onPointerCancel={(event) => endDrag(event, false)}
      onKeyDown={handleKeyDown}
    >
      <span className="effort-slider-track" aria-hidden="true" />
      <span className="effort-slider-fill" aria-hidden="true" />
      <span className="effort-slider-glow" aria-hidden="true" />
      {choices.map((choice, index) => <span
        className="effort-slider-tick"
        key={choice.key}
        aria-hidden="true"
        data-passed={index <= activeIndex || undefined}
        data-current={index === activeIndex || undefined}
        style={{ left: `${effortSliderRatio(index, count) * 100}%` }}
      />)}
      <span className="effort-slider-thumb" aria-hidden="true" />
    </div>
    <div className="effort-slider-labels" aria-hidden="true">
      {choices.map((choice, index) => <span
        className="effort-slider-label"
        key={choice.key}
        data-passed={index <= activeIndex || undefined}
        data-current={index === activeIndex || undefined}
        style={{
          left: `${effortSliderRatio(index, count) * 100}%`,
          transform: `translateX(-${effortSliderLabelAnchor(index, count)}%) scale(${index === activeIndex ? 1.06 : 1})`,
        }}
      >{choice.name}</span>)}
    </div>
    <p className="effort-slider-hint">
      <span className="effort-slider-hint-text" key={active?.key}>{active?.description ?? ""}</span>
    </p>
  </div>;
}
