import { useEffect, useRef } from "react";
import { desktopRequest } from "../lib/desktop-api";
import { desktopClientRuntime } from "../lib/desktop-client-runtime";
import {
  isUiThemeDocumentUpdated,
  isUiThemePreference,
  uiThemePreferenceFromSettings,
  uiThemePreferenceOps,
  type UiThemePreference,
} from "./theme-sync";
import type { ThemeMode } from "./model-types";

/**
 * 本地主题与 Host `ui-theme` 设置命名空间的双向同步。
 *
 * - 本地：App 以 `themeMode`（light/dark/system）为唯一本地主题状态，并
 *   持久化到 localStorage；设置面板选择即调用 `onUserChange` 更新状态。
 * - Host：deeptop-bridge 注册了与官方一致的 `ui-theme.preference`，启动
 *   时优先采纳 Host 值（本地未显式设置时），用户修改时写回
 *   `settings.mutate`，外部修改（settings/document-updated）重新 describe
 *   后采纳，避免回写循环（同步期间不回写 Host）。
 */
export function useThemeHostSync(options: {
  desktop: boolean;
  themeMode: ThemeMode;
  onUserChange: (mode: ThemeMode) => void;
}): { pushToHost: () => Promise<void> } {
  const { desktop, themeMode, onUserChange } = options;
  const applyingRef = useRef(false);
  const initialAdoptedRef = useRef(false);

  // 启动时若 Host 已配置 ui-theme（桌面端本地还没有显式选择），采纳 Host
  // 值；本地已有选择时以本地为准并回写 Host 一次。
  useEffect(() => {
    if (!desktop || initialAdoptedRef.current) return;
    initialAdoptedRef.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const settings = await desktopRequest("settings.describe");
        if (cancelled) return;
        const preference = uiThemePreferenceFromSettings(settings);
        if (preference === undefined) return;
        try {
          const saved = window.localStorage.getItem("deeptop.theme");
          if (saved === "light" || saved === "dark" || saved === "system") {
            // 本地已有显式选择：写回 Host（若不同），不回读。
            if (saved !== preference) {
              applyingRef.current = true;
              await desktopRequest("settings.mutate", {
                ns: "ui-theme",
                ops: uiThemePreferenceOps(saved as UiThemePreference),
              });
              applyingRef.current = false;
            }
          } else {
            // 本地无显式选择：采纳 Host 值。
            applyingRef.current = true;
            onUserChange(preference as ThemeMode);
            applyingRef.current = false;
          }
        } catch {
          // 存储不可用或写回失败时保持现状。
        }
      } catch {
        // settings.describe 失败（桥未就绪等）时保持现状，等待后续事件。
      }
    })();
    return () => { cancelled = true; };
  }, [desktop, onUserChange]);

  // 外部修改：settings/document-updated（ui-theme）→ 重新 describe 并采纳。
  useEffect(() => {
    if (!desktop) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void desktopClientRuntime.remote.on("settings/document-updated", (event) => {
      if (cancelled || !isUiThemeDocumentUpdated(event.args)) return;
      void (async () => {
        try {
          const settings = await desktopRequest("settings.describe");
          if (cancelled) return;
          const preference = uiThemePreferenceFromSettings(settings);
          if (preference === undefined || preference === themeMode) return;
          applyingRef.current = true;
          onUserChange(preference as ThemeMode);
          applyingRef.current = false;
        } catch {
          // describe 失败保持现状。
        }
      })();
    }).then((stop) => { unlisten = stop; }).catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [desktop, onUserChange, themeMode]);

  // 用户修改（设置面板选择）：写回 Host，正向推送。
  async function pushToHost() {
    if (!desktop || applyingRef.current) return;
    if (!isUiThemePreference(themeMode)) return;
    try {
      applyingRef.current = true;
      await desktopRequest("settings.mutate", {
        ns: "ui-theme",
        ops: uiThemePreferenceOps(themeMode as UiThemePreference),
      });
    } catch {
      // Host 未注册/写失败：本地主题仍生效，下次 describe 前不同步。
    } finally {
      applyingRef.current = false;
    }
  }

  return { pushToHost };
}