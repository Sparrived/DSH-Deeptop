import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  IMAGE_ZOOM_WHEEL_FACTOR,
  clampImagePan,
  imageDisplaySize,
  imagePanAfterZoom,
  imageZoomPercent,
  zoomImageBy,
} from "./image-preview-model";

export type ImageSize = { width: number; height: number };
export type ImagePoint = { x: number; y: number };

/** 舞台内的查看状态：缩放比例（1 = 适应舞台）与相对居中位置的平移量。 */
export type ImageView = { zoom: number; pan: ImagePoint };

const FIT_VIEW: ImageView = { zoom: 1, pan: { x: 0, y: 0 } };

type PanSession = { pointerId: number; x: number; y: number };

export type ImageStageHandlers = {
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onLostPointerCapture: (event: ReactPointerEvent<HTMLDivElement>) => void;
};

/**
 * 图片查看的缩放与拖拽手势：停靠标签预览（DockedImageView）与会话图片画廊
 * （MessageLightbox）共用同一套行为。
 *
 * 缩放比例 1 表示「适应舞台」。缩放只改图片的尺寸与 transform，不改布局，
 * 因此舞台量到的尺寸始终稳定（用滚动容器时，滚动条会改变可测尺寸，而尺寸
 * 又决定显示尺寸，两者会来回震荡）。滚轮以光标为锚点缩放；只有放大出余量后
 * 才允许指针拖拽平移，避免把适应舞台时的点击误读成拖拽。
 *
 * @param natural 图片的原始像素尺寸；未知（还没加载完）时显示尺寸交给 CSS。
 * @param resetKey 换图信号：变化时回到适应舞台并清空平移量。
 * @returns 舞台 ref、查看状态、缩放动作与要挂到舞台上的指针处理函数。
 */
export function useImagePanZoom(natural: ImageSize | null, resetKey?: unknown) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const panSessionRef = useRef<PanSession | null>(null);
  const [view, setView] = useState<ImageView>(FIT_VIEW);
  const [stageSize, setStageSize] = useState<ImageSize>({ width: 0, height: 0 });
  const [panning, setPanning] = useState(false);

  // 事件回调要读最新值，但不必因为它们重新挂监听：因此用 ref 镜像状态。
  const viewRef = useRef<ImageView>(FIT_VIEW);
  const naturalRef = useRef<ImageSize | null>(natural);
  useEffect(() => {
    naturalRef.current = natural;
  }, [natural]);

  const applyView = useCallback((next: ImageView) => {
    viewRef.current = next;
    setView(next);
  }, []);

  const liveDisplay = useCallback((): { display: ImageSize | null; stage: ImageSize } => {
    const stage = stageRef.current;
    const size = { width: stage?.clientWidth ?? 0, height: stage?.clientHeight ?? 0 };
    const current = naturalRef.current;
    return { display: current ? imageDisplaySize(current, size, viewRef.current.zoom) : null, stage: size };
  }, []);

  /** 按倍率缩放；给出光标位置时以它为锚点，否则把当前平移夹回新尺寸允许的范围。 */
  const zoomStep = useCallback((factor: number, pointer: ImagePoint | null) => {
    const current = viewRef.current;
    const zoom = zoomImageBy(current.zoom, factor);
    if (zoom === current.zoom) return;
    const { display, stage } = liveDisplay();
    if (!display) {
      applyView({ zoom, pan: current.pan });
      return;
    }
    applyView({
      zoom,
      pan: pointer
        ? imagePanAfterZoom(current.pan, pointer, { x: stage.width / 2, y: stage.height / 2 }, zoom / current.zoom, display, stage)
        : { x: clampImagePan(current.pan.x, display.width, stage.width), y: clampImagePan(current.pan.y, display.height, stage.height) },
    });
  }, [applyView, liveDisplay]);

  const resetView = useCallback(() => applyView(FIT_VIEW), [applyView]);

  // 换图（含首次挂载）回到适应舞台：上一张的缩放和平移不该留给下一张。
  useEffect(() => {
    applyView(FIT_VIEW);
  }, [resetKey, applyView]);

  // 舞台尺寸：显示尺寸要先适应舞台再乘以缩放，所以面板一变就要重算。
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => setStageSize({ width: stage.clientWidth, height: stage.clientHeight });
    measure();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  // 滚轮缩放：React 的 onWheel 是被动监听，改不了默认行为，因此挂原生非被动监听。
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const handleWheel = (event: WheelEvent) => {
      const rect = stage.getBoundingClientRect();
      // 触控板捏合也是「Ctrl+滚轮」，方向一致，因此不区分两者。
      zoomStep(event.deltaY < 0 ? IMAGE_ZOOM_WHEEL_FACTOR : 1 / IMAGE_ZOOM_WHEEL_FACTOR, {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
      event.preventDefault();
    };
    stage.addEventListener("wheel", handleWheel, { passive: false });
    return () => stage.removeEventListener("wheel", handleWheel);
  }, [zoomStep]);

  const finishPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = panSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    panSessionRef.current = null;
    setPanning(false);
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // 窗口失焦时 WebView 可能已经收回指针捕获。
    }
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // 拖拽会话以 ref 为准：pointerup 之后紧接着的 pointerdown 不该被上一帧的状态挡掉。
    if (event.button !== 0 || panSessionRef.current) return;
    if (event.target instanceof Element && event.target.closest("button")) return;
    // 适应舞台时没有可平移的余量，不开手势，避免把点击误读成拖拽。
    const { display, stage } = liveDisplay();
    if (!display || (display.width <= stage.width && display.height <= stage.height)) return;
    panSessionRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // 捕获不可用时仍按指针位置平移。
    }
    setPanning(true);
    event.preventDefault();
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = panSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const delta = { x: event.clientX - session.x, y: event.clientY - session.y };
    session.x = event.clientX;
    session.y = event.clientY;
    const { display, stage } = liveDisplay();
    if (!display) return;
    const current = viewRef.current;
    applyView({
      zoom: current.zoom,
      pan: {
        x: clampImagePan(current.pan.x + delta.x, display.width, stage.width),
        y: clampImagePan(current.pan.y + delta.y, display.height, stage.height),
      },
    });
  };

  const display = natural ? imageDisplaySize(natural, stageSize, view.zoom) : null;
  const pannable = display !== null && (display.width > stageSize.width || display.height > stageSize.height);

  return {
    stageRef,
    view,
    display,
    pannable,
    panning,
    zoomPercent: imageZoomPercent(view.zoom),
    zoomStep,
    resetView,
    stageHandlers: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: finishPan,
      onPointerCancel: finishPan,
      onLostPointerCapture: finishPan,
    } satisfies ImageStageHandlers,
  };
}
