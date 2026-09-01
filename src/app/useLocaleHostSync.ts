import { useEffect, useRef } from "react";
import { desktopRequest } from "../lib/desktop-api";
import { desktopClientRuntime } from "../lib/desktop-client-runtime";
import { trackAsyncCleanup } from "../lib/async-cleanup";
import {
  isLocaleDocumentUpdated,
  localePreferenceFromSettings,
  localePreferenceOps,
  storedLocalePreference,
  writeStoredLocale,
  type UiLocale,
} from "./i18n.ts";

/**
 * 语言选择与 Host `locale` 设置命名空间的双向同步。
 *
 * - 本地：`locale` 状态持久化到 localStorage（deeptop.locale），设置面板
 *   选择即调用 `onUserChange`。
 * - Host：deeptop-bridge 注册了与官方一致的 `locale.preference`（zh/en），
 *   启动时若 Host 已配置则采纳 Host 值（本地未显式设置时），用户修改时
 *   写回 `settings.mutate`，外部修改（settings/document-updated）重新
 *   describe 后采纳，避免回写循环。
 */
export function useLocaleHostSync(options: {
  desktop: boolean;
  locale: UiLocale;
  onUserChange: (locale: UiLocale) => void;
}): { pushToHost: (preference?: UiLocale) => Promise<void> } {
  const { desktop, locale, onUserChange } = options;
  const applyingRef = useRef(false);
  const initialAdoptedRef = useRef(false);

  useEffect(() => {
    if (!desktop || initialAdoptedRef.current) return;
    initialAdoptedRef.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const settings = await desktopRequest("settings.describe");
        if (cancelled) return;
        const preference = localePreferenceFromSettings(settings);
        if (preference === undefined) return;
        const saved = storedLocalePreference();
        if (saved !== undefined) {
          // 本地已有显式选择（包括中文）：写回 Host（若不同），不回读。
          if (saved !== preference) {
            applyingRef.current = true;
            try {
              await desktopRequest("settings.mutate", {
                ns: "locale",
                ops: localePreferenceOps(saved),
              });
            } finally {
              applyingRef.current = false;
            }
          }
        } else {
          // 本地无显式选择：以桌面 Host 设置为跨重启权威值。
          applyingRef.current = true;
          try {
            onUserChange(preference);
            writeStoredLocale(preference);
          } finally {
            applyingRef.current = false;
          }
        }
      } catch {
        // settings.describe 失败（桥未就绪等）时保持现状。
      }
    })();
    return () => { cancelled = true; };
  }, [desktop, onUserChange]);

  useEffect(() => {
    if (!desktop) return;
    const cleanups: Array<() => void> = [];
    let cancelled = false;
    trackAsyncCleanup(cleanups, desktopClientRuntime.remote.on("settings/document-updated", (event) => {
      if (cancelled || !isLocaleDocumentUpdated(event.args)) return;
      void (async () => {
        try {
          const settings = await desktopRequest("settings.describe");
          if (cancelled) return;
          const preference = localePreferenceFromSettings(settings);
          if (preference === undefined || preference === locale) return;
          applyingRef.current = true;
          try {
            onUserChange(preference);
            writeStoredLocale(preference);
          } finally {
            applyingRef.current = false;
          }
        } catch {
          // describe 失败保持现状。
        }
      })();
    }), () => cancelled);
    return () => {
      cancelled = true;
      cleanups.splice(0).forEach((cleanup) => cleanup());
    };
  }, [desktop, onUserChange, locale]);

  async function pushToHost(preference = locale) {
    if (!desktop || applyingRef.current) return;
    try {
      applyingRef.current = true;
      await desktopRequest("settings.mutate", {
        ns: "locale",
        ops: localePreferenceOps(preference),
      });
    } catch {
      // Host 未注册/写失败：本地语言仍生效。
    } finally {
      applyingRef.current = false;
    }
  }

  return { pushToHost };
}