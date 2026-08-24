import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  beginPetWindowDrag,
  dispatchPetAction,
  getPetCareState,
  getPetPointerContext,
  getPetWindowContext,
  listenToPetActivityChanges,
  listenToPetCareChanges,
  listenToPetSettingsChanges,
  performPetCareAction,
  readPetBundle,
  setPetWindowExpanded,
  showPetWindow,
  type PetActivity,
  type PetAction,
  type PetAnimationState,
  type PetBundle,
  type PetCareActionKind,
  type PetCareState,
  type PetSettings,
} from "../lib/desktop";
import {
  defaultPetSettings,
  normalizePetSettings,
  petLookDirection,
  petSpritesheetAssetSource,
} from "../app/pet-model";
import { readTrayThemePreferences, resolveTrayTheme } from "../app/tray-popup-model";
import { readStoredLocale, t } from "../app/i18n";
import { PetHost } from "./PetHost";
import { PetCareCard } from "./PetCareCard";
import { PetNoticeCard } from "./PetNoticeCard";

const idleActivity: PetActivity = { state: "idle", activities: [], revision: 0 };
const POINTER_SAMPLE_MS = 80;
const CARE_REFRESH_MS = 60_000;

type PetPanelMode = "task" | "care" | null;

function applyPetWindowTheme(systemPrefersDark: boolean) {
  const preferences = readTrayThemePreferences(localStorage);
  document.documentElement.dataset.theme = resolveTrayTheme(preferences.mode, systemPrefersDark);
  document.documentElement.style.setProperty("--app-font-family", preferences.fontFamily);
}

function usePetWindowTheme() {
  useLayoutEffect(() => {
    document.documentElement.classList.add("pet-window-document");
    return () => document.documentElement.classList.remove("pet-window-document");
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const synchronize = () => applyPetWindowTheme(media.matches);
    const handleStorage = (event: StorageEvent) => {
      if (!event.key || ["deeptop.theme", "deeptop.appearance"].includes(event.key)) synchronize();
    };
    synchronize();
    media.addEventListener("change", synchronize);
    window.addEventListener("focus", synchronize);
    window.addEventListener("storage", handleStorage);
    return () => {
      media.removeEventListener("change", synchronize);
      window.removeEventListener("focus", synchronize);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);
}

/** 独立于主界面的全局 Deeptop Pet 桌宠渲染器。 */
export default function PetWindow() {
  usePetWindowTheme();
  const locale = readStoredLocale();
  const [settings, setSettings] = useState<PetSettings>({ ...defaultPetSettings });
  const [bundle, setBundle] = useState<PetBundle | null>(null);
  const [petName, setPetName] = useState(t("pet.defaultName", locale));
  const [activity, setActivity] = useState<PetActivity>(idleActivity);
  const [careState, setCareState] = useState<PetCareState | null>(null);
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
  const [lookDirection, setLookDirection] = useState<number | null>(null);
  const [panelMode, setPanelMode] = useState<PetPanelMode>(null);
  const [draft, setDraft] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [careBusy, setCareBusy] = useState(false);
  const [careFeedback, setCareFeedback] = useState<string | null>(null);
  const [careError, setCareError] = useState<string | null>(null);
  const [careReaction, setCareReaction] = useState<{ state: PetAnimationState; revision: number } | null>(null);
  const [ready, setReady] = useState(false);
  const loadGenerationRef = useRef(0);
  const attentionIdRef = useRef<string | null>(null);
  const careReactionRevisionRef = useRef(0);
  const careActionPendingRef = useRef(false);

  const loadSettings = useCallback(async (rawSettings: PetSettings) => {
    const generation = ++loadGenerationRef.current;
    const nextSettings = normalizePetSettings(rawSettings);
    let nextBundle: PetBundle | null = null;
    let nextName = t("pet.defaultName", locale);
    if (nextSettings.selectedPetId) {
      try {
        nextBundle = await readPetBundle(nextSettings.selectedPetId);
        nextName = nextBundle.manifest.name;
      } catch (error) {
        console.error(`读取桌宠 ${nextSettings.selectedPetId} 失败`, error);
      }
    }
    if (generation !== loadGenerationRef.current) return;
    setSettings(nextSettings);
    setBundle(nextBundle);
    setPetName(nextName);
    if (!nextSettings.careEnabled) {
      setPanelMode((current) => current === "care" ? null : current);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    let active = true;
    const unlisteners: Array<() => void> = [];
    async function initialize() {
      const unlistenSettings = await listenToPetSettingsChanges((nextSettings) => {
        if (active) void loadSettings(nextSettings);
      });
      if (!active) {
        unlistenSettings();
        return;
      }
      unlisteners.push(unlistenSettings);
      const unlistenActivity = await listenToPetActivityChanges((nextActivity) => {
        if (active) setActivity(nextActivity);
      });
      if (!active) {
        unlistenActivity();
        return;
      }
      unlisteners.push(unlistenActivity);
      const unlistenCare = await listenToPetCareChanges((nextState) => {
        if (active) {
          setCareState(nextState);
          setCareError(null);
        }
      });
      if (!active) {
        unlistenCare();
        return;
      }
      unlisteners.push(unlistenCare);
      const context = await getPetWindowContext();
      if (!active) return;
      setActivity(context.activity);
      await loadSettings(context.settings);
      try {
        const nextCareState = await getPetCareState();
        if (active) setCareState(nextCareState);
      } catch (error) {
        if (active) setCareError(error instanceof Error ? error.message : String(error));
      }
    }
    void initialize().catch((error) => {
      for (const unlisten of unlisteners.splice(0)) unlisten();
      console.error("初始化全局桌宠失败", error);
    });
    return () => {
      active = false;
      loadGenerationRef.current += 1;
      for (const unlisten of unlisteners) unlisten();
    };
  }, [loadSettings]);

  useEffect(() => {
    if (!ready || !settings.enabled || !settings.motionEnabled || !settings.interactionsEnabled) {
      setLookDirection(null);
      return;
    }
    let active = true;
    let reading = false;
    async function samplePointer() {
      if (reading) return;
      reading = true;
      try {
        const pointer = await getPetPointerContext();
        if (!active) return;
        const direction = petLookDirection(
          pointer.deltaX,
          pointer.deltaY,
          pointer.distance,
          settings.size * 0.32,
          Math.max(320, settings.size * 4.5),
        );
        setLookDirection((current) => current === direction ? current : direction);
      } catch (error) {
        if (active) console.error("读取桌宠指针方向失败", error);
      } finally {
        reading = false;
      }
    }
    void samplePointer();
    const timer = window.setInterval(() => void samplePointer(), POINTER_SAMPLE_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [ready, settings.enabled, settings.interactionsEnabled, settings.motionEnabled, settings.size]);

  useEffect(() => {
    if (!ready || !settings.enabled || !settings.careEnabled) return;
    let active = true;
    let reading = false;
    async function refreshCare() {
      if (reading) return;
      reading = true;
      try {
        const nextState = await getPetCareState();
        if (!active) return;
        setCareState(nextState);
        setCareError(null);
      } catch (error) {
        if (active) setCareError(error instanceof Error ? error.message : String(error));
      } finally {
        reading = false;
      }
    }
    const timer = window.setInterval(() => void refreshCare(), CARE_REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [ready, settings.careEnabled, settings.enabled]);

  useEffect(() => {
    if (!ready || !settings.enabled) return;
    void showPetWindow().catch((error) => console.error("显示全局桌宠失败", error));
  }, [ready, settings.enabled]);

  useEffect(() => {
    const attentionId = activity.attention?.id ?? null;
    if (!attentionId) {
      if (attentionIdRef.current) {
        attentionIdRef.current = null;
        setPanelMode((current) => current === "task" ? null : current);
      }
      return;
    }
    if (attentionId === attentionIdRef.current) return;
    attentionIdRef.current = attentionId;
    setSelectedActivityId(attentionId);
    setDraft("");
    setActionError(null);
    setPanelMode("task");
  }, [activity.attention]);

  useEffect(() => {
    setSelectedActivityId((current) => current && activity.activities.some((item) => item.id === current)
      ? current
      : activity.attention?.id ?? activity.activities[0]?.id ?? null);
  }, [activity.activities, activity.attention?.id]);

  const handleStartDrag = useCallback(async () => {
    try {
      await beginPetWindowDrag();
    } catch (error) {
      console.error("拖动全局桌宠失败", error);
    }
  }, []);

  const selectedAttention = useMemo(() => activity.activities.find((item) => item.id === selectedActivityId)
    ?? activity.attention
    ?? activity.activities[0], [activity.activities, activity.attention, selectedActivityId]);
  const selectedTarget = useMemo(() => selectedAttention
    ? { sessionId: selectedAttention.sessionId, title: selectedAttention.title }
    : activity.target, [activity.target, selectedAttention]);

  useEffect(() => {
    if (!ready || !settings.enabled) return;
    const hasTaskPanel = panelMode === "task" && Boolean(selectedTarget);
    const hasCarePanel = panelMode === "care" && settings.careEnabled && Boolean(careState);
    const nextExpanded = hasTaskPanel || hasCarePanel;
    void setPetWindowExpanded(nextExpanded).catch((error) => {
      console.error("调整桌宠快捷卡片失败", error);
      if (panelMode === "task") setActionError(error instanceof Error ? error.message : String(error));
      else setCareError(error instanceof Error ? error.message : String(error));
      setPanelMode(null);
    });
  }, [careState, panelMode, ready, selectedTarget, settings.careEnabled, settings.enabled]);

  const handleActivate = useCallback(() => {
    if (selectedTarget) {
      setActionError(null);
      if (!selectedActivityId && activity.activities[0]) setSelectedActivityId(activity.activities[0].id);
      setPanelMode("task");
      return;
    }
    if (!settings.careEnabled || !careState) return;
    setCareError(null);
    setPanelMode((current) => current === "care" ? null : "care");
  }, [activity.activities, careState, selectedActivityId, selectedTarget, settings.careEnabled]);

  const runAction = useCallback(async (action: PetAction) => {
    setActionBusy(true);
    setActionError(null);
    try {
      await dispatchPetAction(action);
      if (action.kind !== "open") setDraft("");
      if (action.kind === "open" || action.kind === "reply") setPanelMode(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setActionBusy(false);
    }
  }, []);

  const runCareAction = useCallback(async (action: PetCareActionKind) => {
    if (careActionPendingRef.current) return;
    careActionPendingRef.current = true;
    setCareBusy(true);
    setCareError(null);
    try {
      const result = await performPetCareAction(action);
      setCareState(result.state);
      setCareFeedback(result.message);
      if (result.accepted && result.reaction) {
        careReactionRevisionRef.current += 1;
        setCareReaction({ state: result.reaction, revision: careReactionRevisionRef.current });
      }
    } catch (error) {
      setCareError(error instanceof Error ? error.message : String(error));
    } finally {
      careActionPendingRef.current = false;
      setCareBusy(false);
    }
  }, []);

  const source = useMemo(() => bundle ? petSpritesheetAssetSource(bundle) : null, [bundle]);
  if (!ready || !settings.enabled || !source) return null;

  const target = selectedTarget;
  const activityId = selectedAttention?.id;
  const showsTaskPanel = panelMode === "task" && Boolean(target);
  const showsCarePanel = panelMode === "care" && settings.careEnabled && Boolean(careState);
  const isExpanded = showsTaskPanel || showsCarePanel;
  const windowStyle = { "--pet-window-side": `${settings.size + 32}px` } as CSSProperties;

  return (
    <main
      className="pet-window-root"
      style={windowStyle}
      data-anchor={settings.anchor}
      data-expanded={isExpanded ? "true" : "false"}
    >
      <div className="pet-window-layout">
        {showsTaskPanel && target && (
          <PetNoticeCard
            activities={activity.activities}
            attention={selectedAttention}
            target={target}
            draft={draft}
            busy={actionBusy}
            error={actionError}
            locale={locale}
            onDraftChange={setDraft}
            onClose={() => setPanelMode(null)}
            onSelect={(nextActivityId) => {
              setSelectedActivityId(nextActivityId);
              setDraft("");
              setActionError(null);
            }}
            onOpen={() => void runAction({ kind: "open", sessionId: target.sessionId, activityId })}
            onReply={(text) => void runAction({ kind: "reply", sessionId: target.sessionId, activityId, text })}
            onAnswer={(text, selectedOption) => void runAction({
              kind: "answer",
              sessionId: target.sessionId,
              activityId,
              text,
              selectedOption,
            })}
            onApproval={(allowed) => void runAction({
              kind: allowed ? "approval-allow" : "approval-reject",
              sessionId: target.sessionId,
              activityId,
            })}
            onCare={settings.careEnabled && careState ? () => setPanelMode("care") : undefined}
          />
        )}
        {showsCarePanel && careState && (
          <PetCareCard
            petName={petName}
            state={careState}
            busy={careBusy}
            feedback={careFeedback}
            error={careError}
            locale={locale}
            onAction={(action) => void runCareAction(action)}
            onClose={() => setPanelMode(null)}
            onTasks={target ? () => setPanelMode("task") : undefined}
          />
        )}
        <div className="pet-window-pet-slot">
          <PetHost
            petId={settings.selectedPetId}
            petName={petName}
            bundle={bundle}
            source={source}
            activity={activity}
            lookDirection={lookDirection}
            size={settings.size}
            motionEnabled={settings.motionEnabled}
            interactionsEnabled={settings.interactionsEnabled}
            careReaction={careReaction}
            locale={locale}
            onStartDrag={handleStartDrag}
            onActivate={handleActivate}
            onCareGesture={settings.careEnabled ? (action) => void runCareAction(action) : undefined}
          />
        </div>
      </div>
    </main>
  );
}
