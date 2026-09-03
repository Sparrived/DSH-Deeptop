import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DshManagedSkillInstallOperation,
  DshMcpServerConfig,
  DshSkillInstallResult,
  DshToolSettingsDescription,
} from "../lib/desktop";
import { desktopRequest } from "../lib/desktop-api";
import { t, type UiLocale } from "./i18n";
import { errorText } from "./settings-model";
import { mcpDraftDirty } from "./tool-settings-model";

export interface ManagedSkillInstallDraft {
  source: string;
  path?: string;
  ref?: string;
  name?: string;
  method?: "auto" | "download" | "git";
}

type InstallUiOperation = {
  id: string;
  cancelling: boolean;
  uncertain: boolean;
};

type InstallMonitorOutcome = "completed" | "failed" | "cancelled" | "not-found" | "unknown" | "aborted";

type UseToolSettingsOptions = {
  desktop: boolean;
  runtimeAvailable: boolean;
  visible?: boolean;
  locale: UiLocale;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
  onSkillsChanged?: () => void | Promise<void>;
};

type LoadOptions = {
  /** Force the current draft to survive this load even when it is clean. */
  preserveDraft?: boolean;
};

type CancelPendingOptions = { preserveSkillInstall?: boolean };

function abortError(signal: AbortSignal) {
  return signal.reason instanceof Error ? signal.reason : new Error("请求已取消");
}

function timeoutError(message: string) {
  return Object.assign(new Error(message), { code: "request-timeout" });
}

function cloneMcpServers(servers: readonly DshMcpServerConfig[]): DshMcpServerConfig[] {
  return servers.map((server) => ({
    ...server,
    reconnect: { ...server.reconnect },
    ...(server.args ? { args: [...server.args] } : {}),
    ...(server.env ? { env: server.env.map((binding) => ({ ...binding })) } : {}),
    ...(server.headers ? { headers: server.headers.map((binding) => ({ ...binding })) } : {}),
  }));
}

function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError(signal));
      return;
    }
    const timer = window.setTimeout(resolve, ms);
    const abort = () => {
      window.clearTimeout(timer);
      reject(abortError(signal));
    };
    signal.addEventListener("abort", abort, { once: true });
    window.setTimeout(() => signal.removeEventListener("abort", abort), ms + 1);
  });
}

async function requestWithTimeout<T>(
  request: (signal: AbortSignal) => Promise<T>,
  parentSignal: AbortSignal,
  timeoutMs: number,
): Promise<T> {
  const timeoutController = new AbortController();
  const signal = AbortSignal.any([parentSignal, timeoutController.signal]);
  const timer = window.setTimeout(() => timeoutController.abort(timeoutError("工具设置请求超时")), timeoutMs);
  try {
    return await request(signal);
  } finally {
    window.clearTimeout(timer);
  }
}

function operationFailure(operation: Extract<DshManagedSkillInstallOperation, { status: "failed" }>) {
  return Object.assign(new Error(operation.error.message), {
    code: operation.error.code,
    details: operation.error.details,
  });
}

/** App-scoped orchestration for semantic Skills and MCP desktop Bridge actions. */
export function useToolSettings({
  desktop,
  runtimeAvailable,
  visible = true,
  locale,
  onNotice,
  onError,
  onSkillsChanged,
}: UseToolSettingsOptions) {
  const [description, setDescription] = useState<DshToolSettingsDescription | null>(null);
  const [mcpDraft, setMcpDraftState] = useState<DshMcpServerConfig[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadAttempted, setLoadAttempted] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mcpSaving, setMcpSaving] = useState(false);
  const [skillRemoving, setSkillRemoving] = useState<string | null>(null);
  const [skillInstallOperation, setSkillInstallOperation] = useState<InstallUiOperation | null>(null);
  const [lastSkillInstall, setLastSkillInstall] = useState<DshSkillInstallResult | null>(null);

  const descriptionRef = useRef<DshToolSettingsDescription | null>(null);
  /** Last accepted MCP projection, independent of the renderer's mutable draft. */
  const loadedMcpBaselineRef = useRef<DshMcpServerConfig[] | null>(null);
  const mcpDraftRef = useRef<DshMcpServerConfig[]>([]);
  /** Recomputed whenever either the baseline or the draft changes. */
  const mcpDraftDirtyRef = useRef(false);
  /** Used only to decide whether a save response may replace the current draft. */
  const draftGenerationRef = useRef(0);
  const loadRequestRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const savePromiseRef = useRef<Promise<boolean> | null>(null);
  const savingRef = useRef(false);
  const saveAbortRef = useRef<AbortController | null>(null);
  const removePromiseRef = useRef<Promise<boolean> | null>(null);
  const removeAbortRef = useRef<AbortController | null>(null);
  const directoryAbortRef = useRef<AbortController | null>(null);
  const installMonitorAbortRef = useRef<AbortController | null>(null);
  const cancelRequestAbortRef = useRef<AbortController | null>(null);
  const activeOperationRef = useRef<string | null>(null);
  /** Invalidates an older monitor when retry, close, or unmount aborts it. */
  const monitorGenerationRef = useRef(0);
  /** Prevents a late cancel response from changing a newer retry state. */
  const cancelGenerationRef = useRef(0);
  const skillInstallOperationRef = useRef<InstallUiOperation | null>(null);
  const cancelRequestedRef = useRef(new Set<string>());
  const operationCounter = useRef(0);
  /** Any tool mutation invalidates descriptions that were already in flight. */
  const toolMutationEpochRef = useRef(0);
  /** Prevents late state/error commits after close/unmount. */
  const lifecycleEpochRef = useRef(0);
  const mountedRef = useRef(true);
  const previousRuntimeAvailableRef = useRef(runtimeAvailable);
  const desktopRef = useRef(desktop);
  const runtimeAvailableRef = useRef(runtimeAvailable);
  desktopRef.current = desktop;
  runtimeAvailableRef.current = runtimeAvailable;

  const setInstallUiOperation = useCallback((
    nextOrUpdate: InstallUiOperation | null | ((current: InstallUiOperation | null) => InstallUiOperation | null),
  ) => {
    if (!mountedRef.current) return;
    const next = typeof nextOrUpdate === "function"
      ? nextOrUpdate(skillInstallOperationRef.current)
      : nextOrUpdate;
    skillInstallOperationRef.current = next;
    setSkillInstallOperation(next);
  }, []);

  const commitDescription = useCallback((next: DshToolSettingsDescription, replaceDraft: boolean) => {
    if (!mountedRef.current) return;
    const baseline = cloneMcpServers(next.mcp.servers);
    loadedMcpBaselineRef.current = baseline;
    descriptionRef.current = next;
    if (replaceDraft) {
      const servers = cloneMcpServers(baseline);
      mcpDraftRef.current = servers;
      mcpDraftDirtyRef.current = false;
      setMcpDraftState(servers);
      draftGenerationRef.current += 1;
    } else {
      // Keep the user's draft, but compare it with the newly accepted baseline.
      mcpDraftDirtyRef.current = mcpDraftDirty(baseline, mcpDraftRef.current);
    }
    setDescription(next);
  }, []);

  const setMcpDraft = useCallback((servers: DshMcpServerConfig[]) => {
    if (!mountedRef.current) return;
    const next = cloneMcpServers(servers);
    mcpDraftRef.current = next;
    mcpDraftDirtyRef.current = loadedMcpBaselineRef.current === null
      ? next.length > 0
      : mcpDraftDirty(loadedMcpBaselineRef.current, next);
    draftGenerationRef.current += 1;
    setMcpDraftState(next);
  }, []);

  const commitDescriptionAtEpoch = useCallback((
    next: DshToolSettingsDescription,
    replaceDraft: boolean,
    startedAt: number,
  ) => {
    if (startedAt !== toolMutationEpochRef.current || !mountedRef.current) return false;
    commitDescription(next, replaceDraft);
    return true;
  }, [commitDescription]);

  const abortPendingLoad = useCallback((reason = new Error("工具设置请求已取消")) => {
    loadRequestRef.current += 1;
    loadAbortRef.current?.abort(reason);
    loadAbortRef.current = null;
    if (mountedRef.current) setLoading(false);
  }, []);

  const load = useCallback(async ({ preserveDraft = false }: LoadOptions = {}): Promise<boolean> => {
    if (!desktop || !runtimeAvailable) {
      const message = t("tools.unavailable", locale);
      if (mountedRef.current) {
        setLoadError(message);
        setLoaded(false);
      }
      return false;
    }
    const requestId = ++loadRequestRef.current;
    const lifecycleEpoch = lifecycleEpochRef.current;
    const mutationEpoch = toolMutationEpochRef.current;
    loadAbortRef.current?.abort(new Error("新的工具设置请求已开始"));
    const controller = new AbortController();
    setLoadAttempted(true);
    loadAbortRef.current = controller;
    setLoading(true);
    setLoadError(null);
    try {
      const next = await requestWithTimeout(
        (signal) => desktopRequest("tool.settings.describe", undefined, signal, { waitForReconnect: true }),
        controller.signal,
        20_000,
      );
      if (!mountedRef.current
        || lifecycleEpoch !== lifecycleEpochRef.current
        || controller.signal.aborted
        || requestId !== loadRequestRef.current
        || mutationEpoch !== toolMutationEpochRef.current) return false;
      // Decide at response time. A draft can become dirty while describe is in flight.
      const replaceDraft = !preserveDraft && !mcpDraftDirtyRef.current;
      if (!commitDescriptionAtEpoch(next, replaceDraft, mutationEpoch)) return false;
      setLoaded(true);
      return true;
    } catch (error) {
      if (!mountedRef.current
        || lifecycleEpoch !== lifecycleEpochRef.current
        || controller.signal.aborted
        || requestId !== loadRequestRef.current
        || mutationEpoch !== toolMutationEpochRef.current) return false;
      const message = errorText(error, locale);
      setLoadError(message);
      setLoaded(false);
      onError(message);
      return false;
    } finally {
      if (mountedRef.current
        && lifecycleEpoch === lifecycleEpochRef.current
        && requestId === loadRequestRef.current) {
        setLoading(false);
        if (loadAbortRef.current === controller) loadAbortRef.current = null;
      }
    }
  }, [commitDescriptionAtEpoch, desktop, locale, onError, runtimeAvailable]);

  /**
   * Abort renderer-side pending work and invalidate all of its late callbacks.
   * A save/remove may already have reached the Host, so aborting only stops the
   * renderer wait; the next load after reopening reconciles the authoritative state.
   */
  const cancelPending = useCallback((
    reason = new Error("工具设置页面已关闭"),
    options: CancelPendingOptions = {},
  ) => {
    const preserveSkillInstall = options.preserveSkillInstall === true;
    lifecycleEpochRef.current += 1;
    toolMutationEpochRef.current += 1;
    monitorGenerationRef.current += 1;
    cancelGenerationRef.current += 1;
    abortPendingLoad(reason);
    installMonitorAbortRef.current?.abort(reason);
    installMonitorAbortRef.current = null;
    if (!preserveSkillInstall) {
      cancelRequestAbortRef.current?.abort(reason);
      cancelRequestAbortRef.current = null;
    }
    directoryAbortRef.current?.abort(reason);
    directoryAbortRef.current = null;
    saveAbortRef.current?.abort(reason);
    removeAbortRef.current?.abort(reason);
    const operationId = skillInstallOperationRef.current?.id;
    if (preserveSkillInstall && operationId) {
      activeOperationRef.current = operationId;
      setInstallUiOperation((current) => current?.id === operationId
        ? { ...current, uncertain: true, cancelling: current.cancelling || cancelRequestedRef.current.has(operationId) }
        : current);
    } else {
      activeOperationRef.current = null;
      if (operationId) cancelRequestedRef.current.delete(operationId);
      setInstallUiOperation(null);
    }
    if (mountedRef.current) {
      // Do not leave the closed settings surface showing a stale busy flag while
      // an already-issued Host write finishes in the background.
      savingRef.current = false;
      setMcpSaving(false);
      setSkillRemoving(null);
      // Reopening Tools must perform a fresh describe, even when no request was
      // in flight at close time. The draft itself remains in refs and is rechecked
      // for dirtiness by load when the fresh projection arrives.
      setLoaded(false);
      setLoadAttempted(false);
      setLoadError(null);
    }
  }, [abortPendingLoad, setInstallUiOperation]);

  useEffect(() => {
    const wasAvailable = previousRuntimeAvailableRef.current;
    previousRuntimeAvailableRef.current = runtimeAvailable;
    if (!runtimeAvailable) {
      const reason = new Error("DSH 运行时不可用");
      abortPendingLoad(reason);
      installMonitorAbortRef.current?.abort(reason);
      installMonitorAbortRef.current = null;
      cancelGenerationRef.current += 1;
      cancelRequestAbortRef.current?.abort(reason);
      cancelRequestAbortRef.current = null;
      if (skillInstallOperationRef.current && mountedRef.current) {
        setInstallUiOperation((current) => current
          ? { ...current, uncertain: true, cancelling: false }
          : current);
      }
      if (mountedRef.current) setLoaded(false);
      return;
    }
    if (!wasAvailable && runtimeAvailable && visible) {
      if (mountedRef.current) {
        setLoaded(false);
        setLoadAttempted(false);
      }
      // `load` evaluates mcpDraftDirtyRef at response time, preserving only a dirty draft.
      void load();
    }
  }, [abortPendingLoad, load, runtimeAvailable, visible]);

  const resetMcpDraft = useCallback(() => {
    const next = descriptionRef.current?.mcp.servers ?? [];
    setMcpDraft(next);
  }, [setMcpDraft]);

  const saveMcp = useCallback(async (): Promise<boolean> => {
    if (!desktop
      || !runtimeAvailable
      || savingRef.current
      || savePromiseRef.current
      || activeOperationRef.current
      || removePromiseRef.current) return false;
    const baseline = descriptionRef.current;
    if (!baseline || !mcpDraftDirtyRef.current) return false;
    const draft = cloneMcpServers(mcpDraftRef.current);
    const draftGeneration = draftGenerationRef.current;
    const lifecycleEpoch = lifecycleEpochRef.current;
    // Advance before issuing the write so every older load becomes stale.
    const mutationEpoch = ++toolMutationEpochRef.current;
    abortPendingLoad(new Error("MCP 保存已开始"));
    const controller = new AbortController();
    saveAbortRef.current = controller;
    savingRef.current = true;
    setMcpSaving(true);
    const promise = (async () => {
      try {
        const next = await requestWithTimeout(
          (signal) => desktopRequest("mcp.settings.mutate", {
            expectedRevision: baseline.mcp.revision,
            servers: draft,
          }, signal),
          controller.signal,
          30_000,
        );
        if (!mountedRef.current
          || lifecycleEpoch !== lifecycleEpochRef.current
          || controller.signal.aborted
          || mutationEpoch !== toolMutationEpochRef.current) return false;
        // No describe started before this authoritative response may commit afterward.
        abortPendingLoad(new Error("MCP 保存结果已提交"));
        const replaceDraft = draftGenerationRef.current === draftGeneration;
        if (!commitDescriptionAtEpoch(next, replaceDraft, mutationEpoch)) return false;
        // A later load must start from the saved projection, not the pre-save epoch.
        toolMutationEpochRef.current += 1;
        onNotice(t("tools.mcp.saved", locale));
        return true;
      } catch (error) {
        if (!mountedRef.current
          || lifecycleEpoch !== lifecycleEpochRef.current
          || controller.signal.aborted) return false;
        if (error instanceof Error && (error as Error & { code?: unknown }).code === "revision-conflict") {
          // The save was made from a dirty draft; preserve that draft while refreshing its baseline.
          const reloaded = await load({ preserveDraft: true });
          if (mountedRef.current && lifecycleEpoch === lifecycleEpochRef.current) {
            onError(t(reloaded ? "tools.mcp.revisionConflict" : "tools.mcp.revisionConflictRefreshFailed", locale));
          }
        } else {
          onError(errorText(error, locale));
        }
        return false;
      } finally {
        if (saveAbortRef.current === controller) saveAbortRef.current = null;
        savingRef.current = false;
        if (mountedRef.current && lifecycleEpoch === lifecycleEpochRef.current) setMcpSaving(false);
        savePromiseRef.current = null;
      }
    })();
    savePromiseRef.current = promise;
    return promise;
  }, [abortPendingLoad, commitDescriptionAtEpoch, desktop, load, locale, onError, onNotice, runtimeAvailable]);

  const updateSkillDescription = useCallback((skills: DshToolSettingsDescription["skills"]) => {
    if (!mountedRef.current) return;
    const current = descriptionRef.current;
    if (!current) return;
    const next = { ...current, skills };
    descriptionRef.current = next;
    setDescription(next);
  }, []);

  const monitorSkillInstall = useCallback(async (
    operationId: string,
    monitorSignal: AbortSignal,
    requestMayHaveBeenAccepted = true,
  ): Promise<InstallMonitorOutcome> => {
    const generation = monitorGenerationRef.current;
    const isCurrent = () => mountedRef.current
      && !monitorSignal.aborted
      && activeOperationRef.current === operationId
      && monitorGenerationRef.current === generation;
    const finish = () => {
      if (!isCurrent()) return false;
      // Invalidate describes that may have started while the Host mutation ran.
      abortPendingLoad(new Error("Skill 安装状态已确定"));
      toolMutationEpochRef.current += 1;
      activeOperationRef.current = null;
      cancelRequestedRef.current.delete(operationId);
      monitorGenerationRef.current += 1;
      setInstallUiOperation((current) => current?.id === operationId ? null : current);
      return true;
    };
    const deadline = Date.now() + 10 * 60_000;
    let transientFailures = 0;
    let delayMs = 250;
    for (;;) {
      if (!isCurrent()) return "aborted";
      if (Date.now() >= deadline) {
        setInstallUiOperation((current) => current?.id === operationId
          ? { ...current, uncertain: true, cancelling: cancelRequestedRef.current.has(operationId) }
          : current);
        if (requestMayHaveBeenAccepted) onError(t("tools.skills.installUnknown", locale));
        return "unknown";
      }
      try {
        const operation = await requestWithTimeout(
          (signal) => desktopRequest("skill.settings.installStatus", { operationId }, signal, { waitForReconnect: true }),
          monitorSignal,
          20_000,
        );
        if (!isCurrent()) return "aborted";
        transientFailures = 0;
        delayMs = 250;
        if (operation.status === "running") {
          setInstallUiOperation((current) => current?.id === operationId ? {
            ...current,
            uncertain: false,
            cancelling: cancelRequestedRef.current.has(operationId),
          } : current);
          await waitFor(delayMs, monitorSignal);
          continue;
        }
        if (operation.status === "not-found") {
          if (!finish()) return "aborted";
          void load();
          if (requestMayHaveBeenAccepted) onError(t("tools.skills.installLost", locale));
          return "not-found";
        }
        if (operation.status === "cancelled") {
          if (!finish()) return "aborted";
          onNotice(t("tools.skills.installCancelled", locale));
          return "cancelled";
        }
        if (operation.status === "failed") {
          if (!finish()) return "aborted";
          // A Host-reported terminal failure is not a transient monitor error.
          onError(errorText(operationFailure(operation), locale));
          return "failed";
        }
        const committedAfterCancel = cancelRequestedRef.current.has(operationId);
        if (!finish()) return "aborted";
        if (operation.skills) updateSkillDescription(operation.skills);
         else if (operation.refreshError) void load({ preserveDraft: true });
         if (operation.refreshError) onError(`${t("tools.skills.installRefreshFailed", locale)} ${operation.refreshError.message}`);
        setLastSkillInstall(operation.result);
        if (committedAfterCancel) {
          onNotice(t("tools.skills.installCommittedAfterCancel", locale));
        } else {
          onNotice(t("tools.skills.installed", locale, { name: operation.result.skillName }));
        }
        // Refreshing session-local suggestions is best effort and cannot turn a
        // completed install into a failed install or re-enter monitor polling.
        try {
          const refresh = onSkillsChanged?.();
          if (refresh && typeof refresh.then === "function") {
            void refresh.catch((error) => {
              if (mountedRef.current) onError(errorText(error, locale));
            });
          }
        } catch (error) {
          if (mountedRef.current) onError(errorText(error, locale));
        }
        return "completed";
      } catch (error) {
        if (!isCurrent()) return "aborted";
        transientFailures += 1;
        if (transientFailures > 8) {
          // Polling timeout means the outcome is unknown, never confirmed failed.
          setInstallUiOperation((current) => current?.id === operationId
            ? { ...current, uncertain: true, cancelling: cancelRequestedRef.current.has(operationId) }
            : current);
          if (requestMayHaveBeenAccepted) onError(t("tools.skills.installUnknown", locale));
          return "unknown";
        }
        try {
          await waitFor(delayMs, monitorSignal);
        } catch {
          return "aborted";
        }
        delayMs = Math.min(5_000, delayMs * 2);
      }
    }
  }, [abortPendingLoad, errorText, load, locale, onError, onNotice, onSkillsChanged, setInstallUiOperation, updateSkillDescription]);

  const installSkill = useCallback(async (draft: ManagedSkillInstallDraft): Promise<boolean> => {
    if (!desktop || !runtimeAvailable || activeOperationRef.current || removePromiseRef.current || savingRef.current) return false;
    toolMutationEpochRef.current += 1;
    monitorGenerationRef.current += 1;
    operationCounter.current += 1;
    const operationId = `settings-${Date.now()}-${operationCounter.current}`;
    activeOperationRef.current = operationId;
    cancelRequestedRef.current.delete(operationId);
    installMonitorAbortRef.current?.abort(new Error("新的 Skill 安装已开始"));
    const monitorController = new AbortController();
    installMonitorAbortRef.current = monitorController;
    setInstallUiOperation({ id: operationId, cancelling: false, uncertain: false });
    setLastSkillInstall(null);
    try {
      try {
        await requestWithTimeout(
          (signal) => desktopRequest("skill.settings.install", { operationId, ...draft }, signal),
          monitorController.signal,
          30_000,
        );
      } catch (error) {
        // The response can be lost after acceptance; status probing decides first.
        const outcome = await monitorSkillInstall(operationId, monitorController.signal, false);
        if (outcome === "completed") return true;
        if (outcome === "aborted" || outcome === "cancelled" || outcome === "failed" || outcome === "unknown") return false;
        // If the operation was never accepted, retain the original request error.
        // An unknown status remains a retryable/uncertain outcome and must not be
        // downgraded to a confirmed install failure by the initial timeout.
        onError(errorText(error, locale));
        return false;
      }
      return (await monitorSkillInstall(operationId, monitorController.signal)) === "completed";
    } finally {
      if (installMonitorAbortRef.current === monitorController) installMonitorAbortRef.current = null;
    }
  }, [desktop, errorText, locale, monitorSkillInstall, onError, runtimeAvailable, setInstallUiOperation]);

  const retrySkillInstall = useCallback(async (): Promise<boolean> => {
    const operation = skillInstallOperationRef.current;
    if (!desktop || !runtimeAvailable || !operation?.uncertain || !activeOperationRef.current
      || activeOperationRef.current !== operation.id) return false;
    // A cancel response from the previous lifecycle must not be allowed to
    // overwrite this retry's monitor state.
    cancelRequestAbortRef.current?.abort(new Error("重试安装状态查询"));
    cancelRequestAbortRef.current = null;
    cancelGenerationRef.current += 1;
    installMonitorAbortRef.current?.abort(new Error("重试安装状态监控"));
    monitorGenerationRef.current += 1;
    const controller = new AbortController();
    installMonitorAbortRef.current = controller;
    setInstallUiOperation((current) => current?.id === operation.id ? { ...current, uncertain: false, cancelling: false } : current);
    try {
      return (await monitorSkillInstall(operation.id, controller.signal)) === "completed";
    } finally {
      if (installMonitorAbortRef.current === controller) installMonitorAbortRef.current = null;
    }
  }, [monitorSkillInstall, setInstallUiOperation]);

  const dismissSkillInstall = useCallback(() => {
    if (!skillInstallOperationRef.current?.uncertain) return;
    cancelPending(new Error("稍后重新确认 Skill 安装状态"));
  }, [cancelPending]);

  const cancelSkillInstall = useCallback(async () => {
    const operation = skillInstallOperationRef.current;
    if (!desktop || !runtimeAvailable || !operation || operation.cancelling || operation.uncertain) return;
    cancelRequestedRef.current.add(operation.id);
    setInstallUiOperation({ ...operation, cancelling: true, uncertain: false });
    const lifecycleEpoch = lifecycleEpochRef.current;
    const cancelGeneration = ++cancelGenerationRef.current;
    const controller = new AbortController();
    cancelRequestAbortRef.current?.abort(new Error("新的取消请求已开始"));
    cancelRequestAbortRef.current = controller;
    try {
      const result = await requestWithTimeout(
        (signal) => desktopRequest("skill.settings.cancelInstall", { operationId: operation.id }, signal),
        controller.signal,
        20_000,
      );
      // The monitor may have completed while cancel was in flight. In that case
      // the operation id no longer matches and this result must be ignored.
      if (!mountedRef.current
        || lifecycleEpoch !== lifecycleEpochRef.current
        || controller.signal.aborted
        || cancelGeneration !== cancelGenerationRef.current
        || activeOperationRef.current !== operation.id
        || skillInstallOperationRef.current?.id !== operation.id) return;
      if (!result.cancelled) {
        installMonitorAbortRef.current?.abort(new Error("Skill 取消结果不确定"));
        installMonitorAbortRef.current = null;
        monitorGenerationRef.current += 1;
        setInstallUiOperation((current) => current?.id === operation.id
          ? { ...current, cancelling: false, uncertain: true }
          : current);
      }
    } catch (error) {
      if (!mountedRef.current
        || lifecycleEpoch !== lifecycleEpochRef.current
        || controller.signal.aborted
        || cancelGeneration !== cancelGenerationRef.current
        || activeOperationRef.current !== operation.id
        || skillInstallOperationRef.current?.id !== operation.id) return;
      setInstallUiOperation((current) => current?.id === operation.id
        ? { ...current, cancelling: false, uncertain: true }
        : current);
      // This is an uncertain cancellation, not an installation failure.
      onError(errorText(error, locale));
    } finally {
      if (cancelRequestAbortRef.current === controller) cancelRequestAbortRef.current = null;
    }
  }, [desktop, errorText, locale, onError, runtimeAvailable, setInstallUiOperation]);

  const close = useCallback((reason = new Error("工具设置页面已关闭")) => {
    const operation = skillInstallOperationRef.current;
    if (operation && !operation.uncertain && !operation.cancelling) {
      void cancelSkillInstall().catch(() => undefined);
    }
    cancelPending(reason, { preserveSkillInstall: operation !== null });
  }, [cancelPending, cancelSkillInstall]);

  const removeSkill = useCallback(async (directoryName: string): Promise<boolean> => {
    if (!desktop || !runtimeAvailable || removePromiseRef.current || activeOperationRef.current || savingRef.current) return false;
    const mutationEpoch = ++toolMutationEpochRef.current;
    const lifecycleEpoch = lifecycleEpochRef.current;
    abortPendingLoad(new Error("Skill 删除已开始"));
    const controller = new AbortController();
    removeAbortRef.current = controller;
    setSkillRemoving(directoryName);
    const promise = (async () => {
      try {
        const result = await requestWithTimeout(
          (signal) => desktopRequest("skill.settings.remove", { directoryName }, signal),
          controller.signal,
          30_000,
        );
        if (!mountedRef.current
          || lifecycleEpoch !== lifecycleEpochRef.current
          || controller.signal.aborted
          || removeAbortRef.current !== controller
          || mutationEpoch !== toolMutationEpochRef.current) return false;
        abortPendingLoad(new Error("Skill 删除结果已提交"));
        toolMutationEpochRef.current += 1;
        if (result.skills) updateSkillDescription(result.skills);
        else void load({ preserveDraft: true });
        onNotice(t("tools.skills.removed", locale, { name: directoryName }));
        try {
          const refresh = onSkillsChanged?.();
          if (refresh && typeof refresh.then === "function") {
            void refresh.catch((error) => {
              if (mountedRef.current) onError(errorText(error, locale));
            });
          }
        } catch (error) {
          if (mountedRef.current) onError(errorText(error, locale));
        }
        return true;
      } catch (error) {
        if (!mountedRef.current || lifecycleEpoch !== lifecycleEpochRef.current || controller.signal.aborted) return false;
        onError(errorText(error, locale));
        return false;
      } finally {
        if (removeAbortRef.current === controller) removeAbortRef.current = null;
        removePromiseRef.current = null;
        if (mountedRef.current && lifecycleEpoch === lifecycleEpochRef.current) setSkillRemoving(null);
      }
    })();
    removePromiseRef.current = promise;
    return promise;
  }, [abortPendingLoad, desktop, errorText, locale, onError, onNotice, onSkillsChanged, runtimeAvailable, updateSkillDescription]);

  const openSkillDirectory = useCallback(async () => {
    if (!desktop || !runtimeAvailable) {
      onError(t("tools.unavailable", locale));
      return;
    }
    const lifecycleEpoch = lifecycleEpochRef.current;
    directoryAbortRef.current?.abort(new Error("新的 Skills 目录请求已开始"));
    const controller = new AbortController();
    directoryAbortRef.current = controller;
    try {
      await requestWithTimeout(
        (signal) => desktopRequest("skill.settings.openDirectory", undefined, signal, { waitForReconnect: true }),
        controller.signal,
        20_000,
      );
    } catch (error) {
      if (mountedRef.current && lifecycleEpoch === lifecycleEpochRef.current && !controller.signal.aborted) {
        onError(errorText(error, locale));
      }
    } finally {
      if (directoryAbortRef.current === controller) directoryAbortRef.current = null;
    }
  }, [desktop, errorText, locale, onError, runtimeAvailable]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      const operationId = activeOperationRef.current;
      if (desktopRef.current && operationId) {
        // A renderer unmount cannot abort a Host bridge frame. Best-effort cancel
        // before dropping local state so an accepted install does not continue
        // invisibly after the settings surface disappears.
        void desktopRequest("skill.settings.cancelInstall", { operationId }).catch(() => undefined);
      }
      mountedRef.current = false;
      lifecycleEpochRef.current += 1;
      toolMutationEpochRef.current += 1;
      loadRequestRef.current += 1;
      monitorGenerationRef.current += 1;
      cancelGenerationRef.current += 1;
      loadAbortRef.current?.abort(new Error("工具设置已卸载"));
      installMonitorAbortRef.current?.abort(new Error("Skill 安装监控已卸载"));
      cancelRequestAbortRef.current?.abort(new Error("Skill 取消请求已卸载"));
      directoryAbortRef.current?.abort(new Error("Skills 目录请求已卸载"));
      saveAbortRef.current?.abort(new Error("MCP 保存已卸载"));
      removeAbortRef.current?.abort(new Error("Skill 删除已卸载"));
      loadAbortRef.current = null;
      installMonitorAbortRef.current = null;
      cancelRequestAbortRef.current = null;
      directoryAbortRef.current = null;
      saveAbortRef.current = null;
      removeAbortRef.current = null;
      activeOperationRef.current = null;
      skillInstallOperationRef.current = null;
      cancelRequestedRef.current.clear();
    };
  }, []);

  return {
    description,
    mcpDraft,
    loaded,
    loadError,
    loadAttempted,
    loading,
    mcpSaving,
    skillRemoving,
    skillInstallOperation,
    lastSkillInstall,
    load,
    setMcpDraft,
    resetMcpDraft,
    saveMcp,
    installSkill,
    retrySkillInstall,
    dismissSkillInstall,
    cancelSkillInstall,
    cancelPending,
    close,
    removeSkill,
    openSkillDirectory,
  };
}
