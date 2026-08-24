import { memo, useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import type { PetActivity, PetAnimationState, PetBundle, PetCareActionKind, PetInteractionEvent } from "../lib/desktop";
import {
  petAnimationDurationMs,
  petAnimationSpecs,
  petInteractionRules,
  petStableAnimationForActivity,
  petTransientAnimationForActivity,
} from "../app/pet-model";
import { t, type UiLocale } from "../app/i18n";
import { PetCanvas } from "./PetCanvas";

interface PetHostProps {
  petId: string;
  petName: string;
  bundle: PetBundle | null;
  source: string;
  activity: PetActivity;
  lookDirection: number | null;
  size: number;
  motionEnabled: boolean;
  interactionsEnabled: boolean;
  careReaction: { state: PetAnimationState; revision: number } | null;
  locale?: UiLocale;
  onStartDrag: () => Promise<void>;
  onActivate: () => void;
  onCareGesture?: (action: PetCareActionKind) => void;
}

interface PointerSession {
  pointerId: number;
  startX: number;
  startY: number;
  dragging: boolean;
  dragFinished: boolean;
  longPressed: boolean;
}

const DRAG_THRESHOLD = 6;
const DOUBLE_TAP_MS = 280;
const LONG_PRESS_MS = 560;

function activityLabel(activity: PetActivity["state"], locale: UiLocale): string {
  if (activity === "running") return t("pet.activity.working", locale);
  if (activity === "waiting") return t("pet.activity.waitingInput", locale);
  if (activity === "failed") return t("pet.activity.error", locale);
  if (activity === "review") return t("pet.activity.reviewResult", locale);
  return t("pet.activity.idle", locale);
}

/** 与业务树隔离的 Deeptop Pet 桌宠宿主；持续帧与注视绘制只发生在独立 Canvas。 */
export const PetHost = memo(function PetHost({
  petId,
  petName,
  bundle,
  source,
  activity,
  lookDirection,
  size,
  motionEnabled,
  interactionsEnabled,
  careReaction,
  locale = "zh",
  onStartDrag,
  onActivate,
  onCareGesture,
}: PetHostProps) {
  const stableActivityAnimation = petStableAnimationForActivity(activity.state);
  const [animationState, setAnimationState] = useState<PetAnimationState>(stableActivityAnimation);
  const [assetReady, setAssetReady] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const pointerSessionRef = useRef<PointerSession | null>(null);
  const actionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapAtRef = useRef(0);
  const playedCareRevisionRef = useRef(0);
  const cooldownsRef = useRef(new Map<string, number>());

  const clearTimer = useCallback((timer: { current: ReturnType<typeof setTimeout> | null }) => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const playAnimation = useCallback((state: PetAnimationState, then?: PetAnimationState) => {
    clearTimer(actionTimerRef);
    setAnimationState(state);
    if (petAnimationSpecs[state].loop) return;
    actionTimerRef.current = setTimeout(() => {
      setAnimationState(then ?? petStableAnimationForActivity(activity.state));
      actionTimerRef.current = null;
    }, petAnimationDurationMs(state));
  }, [activity.state, clearTimer]);

  const dispatchInteraction = useCallback((event: PetInteractionEvent) => {
    if (!interactionsEnabled) return false;
    const now = performance.now();
    const eligible = petInteractionRules(bundle, event).filter((rule) => {
      const key = `${event}:${rule.play}`;
      return now - (cooldownsRef.current.get(key) ?? Number.NEGATIVE_INFINITY) >= rule.cooldownMs;
    });
    if (eligible.length === 0) return false;
    const rule = eligible[Math.floor(Math.random() * eligible.length)];
    cooldownsRef.current.set(`${event}:${rule.play}`, now);
    const next = rule.then === "idle" ? petStableAnimationForActivity(activity.state) : rule.then;
    playAnimation(rule.play, next);
    return true;
  }, [activity.state, bundle, interactionsEnabled, playAnimation]);

  useEffect(() => {
    clearTimer(actionTimerRef);
    const transient = petTransientAnimationForActivity(activity.state);
    if (transient) {
      playAnimation(transient, "idle");
      return;
    }
    setAnimationState(stableActivityAnimation);
  }, [activity.revision, activity.state, clearTimer, playAnimation, stableActivityAnimation]);

  useEffect(() => {
    if (!careReaction || careReaction.revision === playedCareRevisionRef.current) return;
    playedCareRevisionRef.current = careReaction.revision;
    playAnimation(careReaction.state, petStableAnimationForActivity(activity.state));
  }, [activity.state, careReaction, playAnimation]);

  useEffect(() => {
    clearTimer(idleTimerRef);
    if (!interactionsEnabled || stableActivityAnimation !== "idle" || animationState !== "idle") return;
    const delay = 6_500 + Math.floor(Math.random() * 3_500);
    idleTimerRef.current = setTimeout(() => {
      dispatchInteraction("idleTimeout");
      idleTimerRef.current = null;
    }, delay);
    return () => clearTimer(idleTimerRef);
  }, [animationState, clearTimer, dispatchInteraction, interactionsEnabled, stableActivityAnimation]);

  useEffect(() => () => {
    clearTimer(actionTimerRef);
    clearTimer(idleTimerRef);
    clearTimer(tapTimerRef);
    clearTimer(longPressTimerRef);
  }, [clearTimer]);

  const style = { "--pet-size": `${size}px` } as CSSProperties;
  const handleAssetReadyChange = useCallback((ready: boolean) => setAssetReady(ready), []);

  const handlePointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!interactionsEnabled || event.button !== 0) return;
    event.preventDefault();
    pointerSessionRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
      dragFinished: false,
      longPressed: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    clearTimer(longPressTimerRef);
    longPressTimerRef.current = setTimeout(() => {
      const session = pointerSessionRef.current;
      if (!session || session.dragging) return;
      session.longPressed = true;
      hostRef.current?.classList.add("pet-being-petted");
      dispatchInteraction("longPress");
      onCareGesture?.("pet");
      longPressTimerRef.current = null;
    }, LONG_PRESS_MS);
  }, [clearTimer, dispatchInteraction, interactionsEnabled, onCareGesture]);

  const completeDrag = useCallback((session: PointerSession) => {
    if (session.dragFinished) return;
    session.dragFinished = true;
    if (pointerSessionRef.current === session) pointerSessionRef.current = null;
    clearTimer(longPressTimerRef);
    hostRef.current?.classList.remove("pet-dragging", "pet-being-petted");
    if (!dispatchInteraction("dragEnd")) playAnimation("jumping", petStableAnimationForActivity(activity.state));
  }, [activity.state, clearTimer, dispatchInteraction, playAnimation]);

  const handlePointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const session = pointerSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const rawX = event.clientX - session.startX;
    const rawY = event.clientY - session.startY;
    if (!session.dragging && Math.hypot(rawX, rawY) < DRAG_THRESHOLD) return;
    if (session.dragging) return;
    session.dragging = true;
    clearTimer(longPressTimerRef);
    hostRef.current?.classList.remove("pet-being-petted");
    hostRef.current?.classList.add("pet-dragging");
    if (!dispatchInteraction("dragStart")) setAnimationState(rawX < 0 ? "running-left" : "running-right");
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    void onStartDrag().finally(() => completeDrag(session));
  }, [clearTimer, completeDrag, dispatchInteraction, onStartDrag]);

  const finishPointer = useCallback((event: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const session = pointerSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    pointerSessionRef.current = null;
    clearTimer(longPressTimerRef);
    hostRef.current?.classList.remove("pet-being-petted");
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (session.dragging) {
      completeDrag(session);
      return;
    }
    if (cancelled || session.longPressed) return;
    const now = performance.now();
    if (now - lastTapAtRef.current <= DOUBLE_TAP_MS) {
      clearTimer(tapTimerRef);
      lastTapAtRef.current = 0;
      dispatchInteraction("doubleTap");
      onCareGesture?.("play");
      return;
    }
    lastTapAtRef.current = now;
    tapTimerRef.current = setTimeout(() => {
      dispatchInteraction("tap");
      onActivate();
      tapTimerRef.current = null;
    }, DOUBLE_TAP_MS);
  }, [clearTimer, completeDrag, dispatchInteraction, onActivate, onCareGesture]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (!interactionsEnabled || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    dispatchInteraction("tap");
    onActivate();
  }, [dispatchInteraction, interactionsEnabled, onActivate]);

  const activeLookDirection = animationState === "idle" && motionEnabled ? lookDirection : null;

  return (
    <div
      ref={hostRef}
      className="pet-host"
      style={style}
      data-pet-id={petId}
      data-activity={activity.state}
      data-animation={animationState}
      data-motion={motionEnabled ? "true" : "false"}
      data-interactive={interactionsEnabled ? "true" : "false"}
    >
      <div className="pet-stage">
        <div
          className="pet-hit-target"
          role={interactionsEnabled ? "button" : "img"}
          tabIndex={interactionsEnabled ? 0 : -1}
          aria-label={`${petName} · ${activityLabel(activity.state, locale)}${interactionsEnabled ? ` · ${t("pet.interactionsHint", locale)}` : ""}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={(event) => finishPointer(event, false)}
          onPointerCancel={(event) => finishPointer(event, true)}
          onPointerEnter={() => dispatchInteraction("pointerEnter")}
          onPointerLeave={() => dispatchInteraction("pointerLeave")}
          onKeyDown={handleKeyDown}
        >
          <span className={`pet-visual${assetReady ? " asset-ready" : ""}`} aria-hidden="true">
            <PetCanvas
              state={animationState}
              source={source}
              lookDirection={activeLookDirection}
              motionEnabled={motionEnabled}
              onReadyChange={handleAssetReadyChange}
            />
          </span>
        </div>
      </div>
    </div>
  );
});
