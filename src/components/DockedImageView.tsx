import { useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, RefreshCw, Rows3, ZoomIn, ZoomOut } from "lucide-react";
import { errorText } from "../app/model";
import { fileTabDetail, pathBasename, sessionPath } from "../app/ui-model";
import { t, type UiLocale } from "../app/i18n";
import {
  IMAGE_PREVIEW_MAX_BYTES,
  IMAGE_ZOOM_BUTTON_FACTOR,
  IMAGE_ZOOM_MAX,
  IMAGE_ZOOM_MIN,
  imageDataUrl,
  imageGallery,
  imageGalleryIndex,
  neighbourImageIndex,
} from "../app/image-preview-model";
import { useImagePanZoom } from "../app/useImagePanZoom";
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

type Size = { width: number; height: number };

/**
 * 停靠标签里的图片预览：按「适应面板」显示，并支持缩放与同目录翻页。
 *
 * - 读取走原生桥接（按魔数确认格式、限制字节数），不自己读文件、也不交给外部程序；
 * - 缩放与拖拽由 `useImagePanZoom` 提供（会话图片画廊共用同一套手势）；
 * - 翻页交给 `onNavigatePath`，由右栏把标签改指到兄弟图片——标签身份是路径，
 *   面板内换图必须让标签跟着换，否则标签会顶着另一个文件的名字。
 */
export function DockedImageView({ path, cwd, locale = "zh", onError, onNavigatePath }: DockedImageViewProps) {
  const absolutePath = useMemo(() => sessionPath(cwd, path), [cwd, path]);
  const directory = useMemo(() => fileTabDetail(absolutePath), [absolutePath]);

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [natural, setNatural] = useState<Size | null>(null);
  const [directoryImages, setDirectoryImages] = useState<readonly string[] | null>(null);
  const [attempt, setAttempt] = useState(0);

  // 换图或重试都回到适应面板：上一张的缩放和平移不该留给下一张。
  const {
    stageRef,
    view,
    display,
    pannable,
    panning,
    zoomPercent,
    zoomStep,
    resetView,
    stageHandlers,
  } = useImagePanZoom(natural, `${absolutePath}#${attempt}`);

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
  }, [absolutePath, attempt, locale, onError]);

  const gallery = useMemo(() => imageGallery(directoryImages ?? [], absolutePath), [directoryImages, absolutePath]);
  const index = imageGalleryIndex(gallery, absolutePath);
  const total = gallery.length;

  const navigate = (offset: number) => {
    if (!onNavigatePath || gallery.length <= 1) return;
    const next = neighbourImageIndex(index, gallery.length, offset);
    if (next === index) return;
    onNavigatePath(gallery[next]);
  };

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
        {...stageHandlers}
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
