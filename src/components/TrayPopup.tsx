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

const emptySnapshot: TraySessionMenuSnapshot = { unread: [], recent: [], more: [] };
const statusLabels: Record<TraySessionStatus, string> = {
  idle: "空闲",
  running: "运行中",
  unread: "未读",
  error: "出错",
};

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

function SessionButton({ item, onOpen }: {
  item: TraySessionMenuItem;
  onOpen: (sessionId: string) => void;
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
        aria-label={statusLabels[item.status]}
      />
      <span className="tray-popup-session-copy">
        <strong>{item.title || "未命名会话"}</strong>
        {item.context && <small>{item.context}</small>}
      </span>
    </button>
  );
}

function SessionSection({ title, items, onOpen }: {
  title: string;
  items: TraySessionMenuItem[];
  onOpen: (sessionId: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section className="tray-popup-section" aria-label={title}>
      <div className="tray-popup-heading">{title}</div>
      {items.map((item) => (
        <SessionButton key={item.sessionId} item={item} onOpen={onOpen} />
      ))}
    </section>
  );
}

/** Fixed-width, theme-aware Windows tray surface. */
export default function TrayPopup() {
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
    let unlisten: () => void = () => undefined;
    void getTrayPopupSnapshot()
      .then((next) => {
        if (!cancelled) setSnapshot((current) => (
          trayPopupSnapshotsEqual(current, next) ? current : next
        ));
      })
      .catch((reason) => {
        if (!cancelled) setError(String(reason));
      });
    void listenToTrayPopupUpdates((next) => {
      setSnapshot((current) => (
        trayPopupSnapshotsEqual(current, next) ? current : next
      ));
    }).then((dispose) => {
      if (cancelled) dispose();
      else unlisten = dispose;
    });
    const handleFocus = () => {
      setView("root");
      setError("");
      focusFirstItem();
    };
    window.addEventListener("focus", handleFocus);
    return () => {
      cancelled = true;
      unlisten();
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
      aria-label="Deeptop 会话托盘"
      onKeyDown={handleKeyDown}
    >
      {view === "root" ? (
        <>
          <SessionSection title="未读" items={snapshot.unread} onOpen={openSession} />
          <SessionSection title="最近" items={snapshot.recent} onOpen={openSession} />
          {snapshot.more.length > 0 && (
            <button
              className="tray-popup-more"
              role="menuitem"
              onClick={() => {
                setView("more");
                focusFirstItem();
              }}
            >
              <span>更多</span>
              <span aria-hidden="true">›</span>
            </button>
          )}
          <div className="tray-popup-actions">
            <button role="menuitem" onClick={() => invokeAction("newChat")}>
              <span aria-hidden="true">＋</span><span>新会话</span>
            </button>
            <button role="menuitem" onClick={() => invokeAction("showMain")}>
              <span aria-hidden="true">▣</span><span>打开 Deeptop</span>
            </button>
            <button className="danger" role="menuitem" onClick={() => invokeAction("quit")}>
              <span aria-hidden="true">⏻</span><span>退出 Deeptop</span>
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
            <span aria-hidden="true">‹</span><span>更多会话</span>
          </button>
          <div className="tray-popup-more-list">
            {snapshot.more.map((item) => (
              <SessionButton key={item.sessionId} item={item} onOpen={openSession} />
            ))}
          </div>
        </div>
      )}
      {error && <div className="tray-popup-error" role="alert">{error}</div>}
    </div>
  );
}
