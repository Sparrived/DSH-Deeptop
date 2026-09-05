// Turn rail: a fixed-pitch ladder of every known turn of the session, drawn
// over the transcript's right gutter. A loaded turn scrolls to its row; an
// unloaded one first pages history through its `turn/start` seq. Mirrors the
// official web chat rail interaction (hover/focus preview, busy pulse,
// active mark), sized for the desktop transcript.

import {
  memo,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type UIEvent,
} from "react";
import type { TurnRailItem } from "../app/turn-rail-model";
import { t, type UiLocale } from "../app/i18n";

/** Fixed pitch between neighbouring marks; overflow scrolls inside the frame. */
export const TURN_SPACING_PX = 10;
/** Rail padding above the first mark and below the last one, per end. */
export const RAIL_INSET_PX = 6;
/** Fade band the mask reserves at a scrollable end. */
export const FADE_PX = 24;

function naturalHeight(count: number): number {
  return (count - 1) * TURN_SPACING_PX + 2 * RAIL_INSET_PX;
}

type TurnFrameStyle = CSSProperties & {
  readonly "--turn-natural-height"?: string;
};

function frameStyle(count: number): TurnFrameStyle {
  return { "--turn-natural-height": `${naturalHeight(count)}px` };
}

/** Content-space Y of the mark nearest a pointer over the frame. */
function itemAtPointer(
  items: readonly TurnRailItem[],
  frame: HTMLElement,
  clientY: number,
): TurnRailItem | undefined {
  const rect = frame.getBoundingClientRect();
  const contentY = clientY - rect.top + frame.scrollTop;
  const index = Math.max(0, Math.min(items.length - 1, Math.round((contentY - RAIL_INSET_PX) / TURN_SPACING_PX)));
  return items[index];
}

export type TurnRailProps = {
  readonly items: readonly TurnRailItem[];
  /** Current (latest / navigated) turn whose mark is highlighted. */
  readonly activeTurn: number | null;
  /** Turn whose jump is still paging history in; its mark pulses. */
  readonly busyTurn: number | null;
  readonly onNavigate: (item: TurnRailItem) => void;
  readonly locale?: UiLocale;
};

function TurnRailView({
  items,
  activeTurn,
  busyTurn,
  onNavigate,
  locale = "zh",
}: TurnRailProps) {
  const [previewTurn, setPreviewTurn] = useState<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const previewId = useId();
  const label = t("chat.turnNavigation.label", locale);

  // Keep the active mark in view whenever the ladder or highlight changes.
  const activeIndex = activeTurn === null ? -1 : items.findIndex((item) => item.turn === activeTurn);
  useEffect(() => {
    const frame = frameRef.current;
    if (frame === null || activeIndex < 0) return;
    const top = RAIL_INSET_PX + activeIndex * TURN_SPACING_PX;
    const bottom = top + TURN_SPACING_PX;
    if (top < frame.scrollTop) frame.scrollTop = Math.max(0, top - FADE_PX);
    else if (bottom > frame.scrollTop + frame.clientHeight) {
      frame.scrollTop = Math.min(frame.scrollHeight - frame.clientHeight, bottom - frame.clientHeight + FADE_PX);
    }
  });

  if (items.length < 2) return null;

  const count = items.length;
  const contentTopOf = (index: number): number => RAIL_INSET_PX + index * TURN_SPACING_PX;
  const previewIndex = previewTurn === null ? -1 : items.findIndex((item) => item.turn === previewTurn);
  const preview = previewIndex < 0 ? undefined : items[previewIndex];
  const previewFrameTop = previewIndex < 0 ? undefined : contentTopOf(previewIndex) - scrollTop;

  const previewAtPointer = (event: PointerEvent<HTMLElement>): void => {
    const frame = frameRef.current;
    if (frame === null) return;
    setPreviewTurn(itemAtPointer(items, frame, event.clientY)?.turn ?? null);
  };
  const navigateAtPointer = (event: MouseEvent<HTMLElement>): void => {
    const frame = frameRef.current;
    if (frame === null) return;
    const item = itemAtPointer(items, frame, event.clientY);
    if (item !== undefined) onNavigate(item);
  };
  const syncScrollFades = (event: UIEvent<HTMLElement>): void => {
    const frame = event.currentTarget;
    setScrollTop(frame.scrollTop);
    frame.classList.toggle("turn-rail-fade-top", frame.scrollTop > 1);
    frame.classList.toggle(
      "turn-rail-fade-bottom",
      frame.scrollTop + frame.clientHeight < frame.scrollHeight - 1,
    );
  };

  return (
    <div className="turn-rail-slot">
      <nav
        ref={frameRef}
        className="turn-rail-frame"
        style={frameStyle(count)}
        aria-label={label}
        onClick={navigateAtPointer}
        onPointerMove={previewAtPointer}
        onPointerLeave={() => setPreviewTurn(null)}
        onScroll={syncScrollFades}
      >
        <div className="turn-rail-marks" style={{ height: naturalHeight(count) }}>
          {items.map((item, index) => {
            const active = item.turn === activeTurn;
            const showingPreview = item.turn === previewTurn;
            const classes = ["turn-rail-mark"];
            if (item.anchor.kind === "unloaded") classes.push("turn-rail-mark-unloaded");
            if (active) classes.push("turn-rail-mark-active");
            else if (showingPreview) classes.push("turn-rail-mark-preview");
            if (item.turn === busyTurn) classes.push("turn-rail-mark-busy");
            return (
              <div key={item.turn} className="turn-rail-mark-position" style={{ top: `${Math.round(contentTopOf(index))}px` }}>
                <button
                  type="button"
                  className={classes.join(" ")}
                  aria-label={t(
                    item.anchor.kind === "loaded" ? "chat.turnNavigation.jump" : "chat.turnNavigation.jumpLoad",
                    locale,
                    { turn: item.turn },
                  )}
                  aria-current={active ? "true" : undefined}
                  aria-busy={item.turn === busyTurn ? "true" : undefined}
                  aria-describedby={showingPreview ? previewId : undefined}
                  onClick={(event) => {
                    event.stopPropagation();
                    onNavigate(item);
                  }}
                  onFocus={() => setPreviewTurn(item.turn)}
                  onBlur={() => setPreviewTurn(null)}
                />
              </div>
            );
          })}
        </div>
      </nav>
      {preview !== undefined && previewFrameTop !== undefined && (
        <div
          id={previewId}
          role="tooltip"
          className="turn-rail-preview"
          style={{ top: `${Math.max(FADE_PX, Math.round(previewFrameTop))}px` }}
        >
          <div className="turn-rail-preview-prompt">
            {preview.prompt || t("chat.turnNavigation.turn", locale, { turn: preview.turn })}
          </div>
          {preview.response !== "" && <div className="turn-rail-preview-response">{preview.response}</div>}
        </div>
      )}
    </div>
  );
}

/** Rail re-renders only when the ladder or its busy/active marks change. */
export const TurnRail = memo(TurnRailView, (prev, next) => {
  if (prev.items !== next.items) return false;
  if (prev.activeTurn !== next.activeTurn || prev.busyTurn !== next.busyTurn) return false;
  return prev.locale === next.locale;
});
