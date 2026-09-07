import { AppWindow, ChevronLeft, ChevronRight, Plus, Power } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  dismissTrayPopup,
  getTrayPopupSnapshot,
  listenToTrayPopupUpdates,
  openTrayPopupSession,
  readThemeCss,
  runTrayPopupAction,
  type TrayPopupAction,
  type TraySessionMenuItem,
  type TraySessionMenuSnapshot,
  type TraySessionStatus,
} from "../lib/desktop";
import {
  nextTrayMenuIndex,
  readTrayThemePreferences,
  resolveTrayTheme,
  trayPopupSnapshotsEqual,
} from "../app/tray-popup-model";
import { t, type UiLocale } from "../app/i18n";
import { trackAsyncCleanup } from "../lib/async-cleanup";

const emptySnapshot: TraySessionMenuSnapshot = { unread: [], recent: [], more: [] };

function statusLabel(status: TraySessionStatus, locale: UiLocale): string {
  if (status === "idle") return t("tray.status.idle", locale);
  if (status === "running") return t("tray.status.running", locale);
  if (status === "unread") return t("tray.status.unread", locale);
  return t("tray.status.error", locale);
}

function replaceStyle(id: string, css: string) {
  const existing = document.getElementById(id);
  if (!css) {
    existing?.remove();
    return;
  }
  const style = existing instanceof HTMLStyleElement ? existing : document.createElement("style");
  style.id = id;
  style.textContent = css;
  if (!style.isConnected) document.head.appendChild(style);
}

function applyTrayTheme(systemPrefersDark: boolean) {
  const preferences = readTrayThemePreferences(localStorage);
  const resolvedTheme = resolveTrayTheme(preferences.mode, systemPrefersDark);
  if (document.documentElement.dataset.theme !== resolvedTheme) {
    document.documentElement.dataset.theme = resolvedTheme;
  }
  if (document.documentElement.style.getPropertyValue("--app-font-family") !== preferences.fontFamily) {
    document.documentElement.style.setProperty("--app-font-family", preferences.fontFamily);
  }
  return preferences;
}

function useTrayPopupTheme() {
  useLayoutEffect(() => {
    document.documentElement.classList.add("tray-popup-document");
    applyTrayTheme(window.matchMedia("(prefers-color-scheme: dark)").matches);
    return () => document.documentElement.classList.remove("tray-popup-document");
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    let currentThemePath: string | null = null;
    let currentCustomCss: string | null = null;
    let themeLoadGeneration = 0;
    let disposed = false;
    const synchronize = () => {
      const next = applyTrayTheme(media.matches);
      if (next.customCss !== currentCustomCss) {
        currentCustomCss = next.customCss;
        replaceStyle("deeptop-tray-custom-theme", next.customCss);
      }
      if (next.themeCssPath === currentThemePath) return;
      currentThemePath = next.themeCssPath;
      const generation = ++themeLoadGeneration;
      if (!next.themeCssPath) {
        replaceStyle("deeptop-tray-theme-path", "");
        return;
      }
      void readThemeCss(next.themeCssPath)
        .then((result) => {
          if (!disposed && generation === themeLoadGeneration) {
            replaceStyle("deeptop-tray-theme-path", result.content);
          }
        })
        .catch(() => {
          if (!disposed && generation === themeLoadGeneration) {
            replaceStyle("deeptop-tray-theme-path", "");
          }
        });
    };
    const handleStorage = (event: StorageEvent) => {
      if (!event.key || ["deeptop.theme", "deeptop.appearance", "deeptop.dark-theme"].includes(event.key)) {
        synchronize();
      }
    };
    synchronize();
    media.addEventListener("change", synchronize);
    window.addEventListener("focus", synchronize);
    window.addEventListener("storage", handleStorage);
    return () => {
      disposed = true;
      themeLoadGeneration += 1;
      media.removeEventListener("change", synchronize);
      window.removeEventListener("focus", synchronize);
      window.removeEventListener("storage", handleStorage);
      replaceStyle("deeptop-tray-theme-path", "");
      replaceStyle("deeptop-tray-custom-theme", "");
    };
  }, []);
}

function SessionButton({ item, onOpen, locale }: {
  item: TraySessionMenuItem;
  onOpen: (sessionId: string) => void;
  locale: UiLocale;
}) {
  return (
    <button
      className="tray-popup-session"
      role="menuitem"
      title={item.context ? `${item.title} · ${item.context}` : item.title}
      onClick={() => onOpen(item.sessionId)}
    >
      <span
        className={`tray-popup-status ${item.status}`}
        aria-label={statusLabel(item.status, locale)}
      />
      <span className="tray-popup-session-copy">
        <strong>{item.title || t("tray.unnamedSession", locale)}</strong>
        {item.context && <small>{item.context}</small>}
      </span>
    </button>
  );
}

function SessionSection({ title, items, onOpen, locale }: {
  title: string;
  items: TraySessionMenuItem[];
  onOpen: (sessionId: string) => void;
  locale: UiLocale;
}) {
  if (items.length === 0) return null;
  return (
    <section className="tray-popup-section" aria-label={title}>
      <div className="tray-popup-heading">{title}</div>
      {items.map((item) => (
        <SessionButton key={item.sessionId} item={item} onOpen={onOpen} locale={locale} />
      ))}
    </section>
  );
}

/** Fixed-width, theme-aware Windows tray surface. */
export default function TrayPopup({ locale = "zh" }: { locale?: UiLocale }) {
  useTrayPopupTheme();
  const menuRef = useRef<HTMLDivElement>(null);
  const [snapshot, setSnapshot] = useState<TraySessionMenuSnapshot>(emptySnapshot);
  const [view, setView] = useState<"root" | "more">("root");
  const [error, setError] = useState("");

  const focusFirstItem = () => {
    window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    });
  };

  useEffect(() => {
    let cancelled = false;
    const cleanups: Array<() => void> = [];
    void getTrayPopupSnapshot()
      .then((next) => {
        if (!cancelled) setSnapshot((current) => (
          trayPopupSnapshotsEqual(current, next) ? current : next
        ));
      })
      .catch((reason) => {
        if (!cancelled) setError(String(reason));
      });
    trackAsyncCleanup(cleanups, listenToTrayPopupUpdates((next) => {
      if (cancelled) return;
      setSnapshot((current) => (
        trayPopupSnapshotsEqual(current, next) ? current : next
      ));
    }), () => cancelled);
    const handleFocus = () => {
      setView("root");
      setError("");
      focusFirstItem();
    };
    window.addEventListener("focus", handleFocus);
    return () => {
      cancelled = true;
      cleanups.splice(0).forEach((cleanup) => cleanup());
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  const invokeAction = (action: TrayPopupAction) => {
    setError("");
    void runTrayPopupAction(action).catch((reason) => setError(String(reason)));
  };

  const openSession = (sessionId: string) => {
    setError("");
    void openTrayPopupSession(sessionId).catch((reason) => setError(String(reason)));
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (view === "more") {
        setView("root");
        focusFirstItem();
      } else {
        void dismissTrayPopup();
      }
      return;
    }
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'),
    );
    const nextIndex = nextTrayMenuIndex(event.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length);
    if (nextIndex === null) return;
    event.preventDefault();
    items[nextIndex]?.focus();
  };

  return (
    <div
      ref={menuRef}
      className="tray-popup"
      role="menu"
      aria-label={t("tray.popupAria", locale)}
      onKeyDown={handleKeyDown}
    >
      {view === "root" ? (
        <>
          <SessionSection title={t("tray.status.unread", locale)} items={snapshot.unread} onOpen={openSession} locale={locale} />
          <SessionSection title={t("tray.recent", locale)} items={snapshot.recent} onOpen={openSession} locale={locale} />
          {snapshot.more.length > 0 && (
            <button
              className="tray-popup-more"
              role="menuitem"
              onClick={() => {
                setView("more");
                focusFirstItem();
              }}
            >
              <span>{t("tray.more", locale)}</span>
              <span aria-hidden="true"><ChevronRight /></span>
            </button>
          )}
          <div className="tray-popup-actions">
            <button role="menuitem" onClick={() => invokeAction("newChat")}>
              <span aria-hidden="true"><Plus /></span><span>{t("tray.newChat", locale)}</span>
            </button>
            <button role="menuitem" onClick={() => invokeAction("showMain")}>
              <span aria-hidden="true"><AppWindow /></span><span>{t("tray.openDeeptop", locale)}</span>
            </button>
            <button className="danger" role="menuitem" onClick={() => invokeAction("quit")}>
              <span aria-hidden="true"><Power /></span><span>{t("tray.quit", locale)}</span>
            </button>
          </div>
        </>
      ) : (
        <div className="tray-popup-more-view">
          <button
            className="tray-popup-back"
            role="menuitem"
            onClick={() => {
              setView("root");
              focusFirstItem();
            }}
          >
            <span aria-hidden="true"><ChevronLeft /></span><span>{t("tray.moreSessions", locale)}</span>
          </button>
          <div className="tray-popup-more-list">
            {snapshot.more.map((item) => (
              <SessionButton key={item.sessionId} item={item} onOpen={openSession} locale={locale} />
            ))}
          </div>
        </div>
      )}
      {error && <div className="tray-popup-error" role="alert">{error}</div>}
    </div>
  );
}
