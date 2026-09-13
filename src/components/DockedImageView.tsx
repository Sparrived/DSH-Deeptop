import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, RefreshCw, Rows3, ZoomIn, ZoomOut } from "lucide-react";
import { errorText } from "../app/model";
import { fileTabDetail, pathBasename, sessionPath } from "../app/ui-model";
import { t, type UiLocale } from "../app/i18n";
import {
  IMAGE_PREVIEW_MAX_BYTES,
  IMAGE_ZOOM_BUTTON_FACTOR,
  IMAGE_ZOOM_MAX,
  IMAGE_ZOOM_MIN,
  IMAGE_ZOOM_WHEEL_FACTOR,
  clampImagePan,
  imageDataUrl,
  imageDisplaySize,
  imageGallery,
  imageGalleryIndex,
  imagePanAfterZoom,
  imageZoomPercent,
  neighbourImageIndex,
  zoomImageBy,
} from "../app/image-preview-model";
import { listWorkspaceFiles, openInVscode, readWorkspaceImage } from "../lib/desktop";

type DockedImageViewProps = {
  /** 停靠标签里的路径：会话相对或绝对路径。 */
  path: string;
  /** 活动会话的工作目录，用于解析相对路径。 */
  cwd: string;
  locale?: UiLocale;
  onError?: (message: string) => void;
  /** 翻到同目录的兄弟图片；缺省时只显示打开的那一张。 */
  onNavigatePath?: (path: string) => void;
};

type LoadState =
  | { status: "loading" }
  | { status: "ready"; src: string }
  | { status: "error"; message: string };

type Point = { x: number; y: number };
type Size = { width: number; height: number };
/** 面板内的查看状态：缩放比例（1 = 适应面板）与相对居中位置的平移量。 */
type ImageView = { zoom: number; pan: Point };

const FIT_VIEW: ImageView = { zoom: 1, pan: { x: 0, y: 0 } };

type PanSession = { pointerId: number; x: number; y: number };

/**
 * 停靠标签里的图片预览：按「适应面板」显示，并支持缩放与同目录翻页。
 *
 * - 读取走原生桥接（按魔数确认格式、限制字节数），不自己读文件、也不交给外部程序；
 * - 缩放比例 1 表示适应该面板。滚轮以光标为锚点缩放；放大后用指针拖拽平移，
 *   平移只改 transform，不改布局，因此舞台量到的尺寸始终稳定（用滚动容器时，
 *   滚动条会改变可测尺寸，而尺寸又决定显示尺寸，两者会来回震荡）；
 * - 翻页交给 `onNavigatePath`，由右栏把标签改指到兄弟图片——标签身份是路径，
 *   面板内换图必须让标签跟着换，否则标签会顶着另一个文件的名字。
 */
export function DockedImageView({ path, cwd, locale = "zh", onError, onNavigatePath }: DockedImageViewProps) {
  const absolutePath = useMemo(() => sessionPath(cwd, path), [cwd, path]);
  const directory = useMemo(() => fileTabDetail(absolutePath), [absolutePath]);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const panSessionRef = useRef<PanSession | null>(null);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [natural, setNatural] = useState<Size | null>(null);
  const [stageSize, setStageSize] = useState<Size>({ width: 0, height: 0 });
  const [view, setView] = useState<ImageView>(FIT_VIEW);
  const [directoryImages, setDirectoryImages] = useState<readonly string[] | null>(null);
  const [panning, setPanning] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // 事件回调要读最新值，但不必因为它们重新挂监听：因此用 ref 镜像状态。
  const viewRef = useRef<ImageView>(FIT_VIEW);
  const naturalRef = useRef<Size | null>(null);
  const applyView = useCallback((next: ImageView) => {
    viewRef.current = next;
    setView(next);
  }, []);

  const liveDisplay = useCallback((): { display: Size | null; stage: Size } => {
    const stage = stageRef.current;
    const size = { width: stage?.clientWidth ?? 0, height: stage?.clientHeight ?? 0 };
    const current = naturalRef.current;
    return { display: current ? imageDisplaySize(current, size, viewRef.current.zoom) : null, stage: size };
  }, []);

  /** 按倍率缩放；给出光标位置时以它为锚点，否则把当前平移夹回新尺寸允许的范围。 */
  const zoomStep = useCallback((factor: number, pointer: Point | null) => {
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

  // 目录里的兄弟图片：只在目录变化时列一次，翻页本身不重复扫目录。
  useEffect(() => {
    let active = true;
    setDirectoryImages(null);
    void listWorkspaceFiles(directory)
      .then((entries) => {
        if (active) setDirectoryImages(entries.filter((entry) => !entry.isDir).map((entry) => entry.path));
      })
      .catch(() => {
        // 列目录失败只影响翻页：当前这一张照常显示。
        if (active) setDirectoryImages([]);
      });
    return () => {
      active = false;
    };
  }, [directory]);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    setNatural(null);
    naturalRef.current = null;
    applyView(FIT_VIEW);
    void readWorkspaceImage(absolutePath, IMAGE_PREVIEW_MAX_BYTES)
      .then((payload) => {
        if (!active) return;
        setState({ status: "ready", src: imageDataUrl(payload.mediaType, payload.data) });
      })
      .catch((error) => {
        if (!active) return;
        const message = t("dockImage.loadFailed", locale, { detail: errorText(error, locale) });
        setState({ status: "error", message });
        onError?.(message);
      });
    return () => {
      active = false;
    };
  }, [absolutePath, attempt, locale, onError, applyView]);

  // 舞台尺寸：显示尺寸要先适应面板再乘以缩放，所以面板一变就要重算。
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

  const gallery = useMemo(() => imageGallery(directoryImages ?? [], absolutePath), [directoryImages, absolutePath]);
  const index = imageGalleryIndex(gallery, absolutePath);
  const total = gallery.length;

  const navigate = useCallback((offset: number) => {
    if (!onNavigatePath || gallery.length <= 1) return;
    const next = neighbourImageIndex(index, gallery.length, offset);
    if (next === index) return;
    onNavigatePath(gallery[next]);
  }, [gallery, index, onNavigatePath]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    // 带修饰键的组合留给应用级快捷键（Ctrl+0 等），这里只处理裸键。
    if (event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
    switch (event.key) {
      case "+":
      case "=":
        zoomStep(IMAGE_ZOOM_BUTTON_FACTOR, null);
        break;
      case "-":
      case "_":
        zoomStep(1 / IMAGE_ZOOM_BUTTON_FACTOR, null);
        break;
      case "0":
        resetView();
        break;
      // 方向键在面板里翻图片，而不是挪动画布：翻页是这里的主要动作，平移靠拖拽。
      case "ArrowLeft":
        navigate(-1);
        break;
      case "ArrowRight":
        navigate(1);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const handleOpenExternal = () => {
    void openInVscode(absolutePath).catch((error) => {
      onError?.(t("files.errOpenVscode", locale, { detail: errorText(error, locale) }));
    });
  };

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
    // 适应面板时没有可平移的余量，不开手势，避免把点击误读成拖拽。
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
  const zoomPercent = imageZoomPercent(view.zoom);
  const subtitle = [
    total > 1 ? t("dockImage.position", locale, { index: index + 1, total }) : null,
    natural ? `${natural.width}×${natural.height}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <section
      className="dock-file-view dock-image-view"
      aria-label={t("dockImage.aria", locale, { path: absolutePath })}
      onKeyDown={handleKeyDown}
    >
      <header className="dock-file-head">
        <div className="dock-file-copy">
          <strong title={absolutePath}>{pathBasename(path)}</strong>
          <small>{subtitle || t("dockImage.loading", locale)}</small>
        </div>
        <div className="dock-file-actions">
          <button type="button" onClick={() => setAttempt((value) => value + 1)} title={t("files.refresh", locale)} aria-label={t("files.refresh", locale)}>
            <RefreshCw aria-hidden="true" />
          </button>
          <button type="button" onClick={handleOpenExternal} title={t("files.openWithVscode", locale)} aria-label={t("files.openWithVscode", locale)}>
            <Rows3 aria-hidden="true" />
          </button>
        </div>
      </header>

      <div
        className={`dock-image-stage${pannable ? " is-pannable" : ""}${panning ? " is-panning" : ""}`}
        ref={stageRef}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPan}
        onPointerCancel={finishPan}
        onLostPointerCapture={finishPan}
      >
        {state.status === "loading" && <p className="dock-image-note" role="status">{t("dockImage.loading", locale)}</p>}
        {state.status === "error" && (
          <div className="dock-image-note is-error" role="alert">
            <AlertTriangle aria-hidden="true" />
            <span>{state.message}</span>
            <button type="button" onClick={() => setAttempt((value) => value + 1)}>{t("markdown.retry", locale)}</button>
          </div>
        )}
        {state.status === "ready" && (
          <img
            className={`dock-image${display ? " is-sized" : ""}`}
            src={state.src}
            alt={t("dockImage.alt", locale, { index: index + 1 })}
            style={display ? {
              width: `${display.width}px`,
              height: `${display.height}px`,
              transform: `translate(${view.pan.x}px, ${view.pan.y}px)`,
            } : undefined}
            draggable={false}
            onLoad={(event) => {
              const size = { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight };
              naturalRef.current = size;
              setNatural(size);
            }}
          />
        )}
        {total > 1 && <>
          <button
            className="dock-image-step is-previous"
            type="button"
            disabled={index <= 0}
            onClick={() => navigate(-1)}
            title={t("dockImage.previous", locale)}
            aria-label={t("dockImage.previous", locale)}
          ><ChevronLeft aria-hidden="true" /></button>
          <button
            className="dock-image-step is-next"
            type="button"
            disabled={index >= total - 1}
            onClick={() => navigate(1)}
            title={t("dockImage.next", locale)}
            aria-label={t("dockImage.next", locale)}
          ><ChevronRight aria-hidden="true" /></button>
        </>}
      </div>

      <div className="dock-image-bar" role="group" aria-label={t("dockImage.zoomGroup", locale)}>
        <button
          type="button"
          className="dock-image-zoom"
          disabled={view.zoom <= IMAGE_ZOOM_MIN}
          onClick={() => zoomStep(1 / IMAGE_ZOOM_BUTTON_FACTOR, null)}
          title={t("dockImage.zoomOut", locale)}
          aria-label={t("dockImage.zoomOut", locale)}
        ><ZoomOut aria-hidden="true" /></button>
        <button
          type="button"
          className="dock-image-zoom-value"
          onClick={resetView}
          title={t("dockImage.zoomResetTo", locale, { percent: zoomPercent })}
          aria-label={t("dockImage.zoomResetTo", locale, { percent: zoomPercent })}
        >{zoomPercent}%</button>
        <button
          type="button"
          className="dock-image-zoom"
          disabled={view.zoom >= IMAGE_ZOOM_MAX}
          onClick={() => zoomStep(IMAGE_ZOOM_BUTTON_FACTOR, null)}
          title={t("dockImage.zoomIn", locale)}
          aria-label={t("dockImage.zoomIn", locale)}
        ><ZoomIn aria-hidden="true" /></button>
      </div>
    </section>
  );
}
