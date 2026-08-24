import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { isWithinSelector, OWNED_CONTEXT_MENU_SELECTOR } from "./app/context-menu";

const isTrayPopup = new URLSearchParams(window.location.search).get("tray-popup") === "1";
// @deeptop-pets:start renderer-route-flag
const isDesktopPet = new URLSearchParams(window.location.search).get("desktop-pet") === "1";
// @deeptop-pets:end renderer-route-flag

document.addEventListener("contextmenu", (event) => {
  // 各交互区域自行渲染桌面端右键菜单，其他区域不显示 WebView 原生菜单。
  if (isWithinSelector(event.target, OWNED_CONTEXT_MENU_SELECTOR)) return;
  event.preventDefault();
}, true);

document.addEventListener("keydown", (event) => {
  const key = event.key.toUpperCase();
  const opensDevtools = event.key === "F12"
    || (event.ctrlKey && event.shiftKey && ["I", "J", "C"].includes(key));
  if (opensDevtools) {
    event.preventDefault();
    event.stopPropagation();
  }
}, true);

async function renderApplication() {
  const root = createRoot(document.getElementById("root")!);
  if (isTrayPopup) {
    const [trayPopupModule] = await Promise.all([
      import("./components/TrayPopup"),
      import("./tray-styles.css"),
    ]);
    const TrayPopup = trayPopupModule.default;
    root.render(
      <StrictMode>
        <TrayPopup />
      </StrictMode>,
    );
    return;
  }

  // @deeptop-pets:start renderer-route
  if (isDesktopPet) {
    const [petWindowModule, frontendLogModule] = await Promise.all([
      import("./components/PetWindow"),
      import("./lib/frontend-log"),
      import("./pet-styles.css"),
    ]);
    frontendLogModule.installFrontendLogCapture();
    const PetWindow = petWindowModule.default;
    root.render(
      <StrictMode>
        <PetWindow />
      </StrictMode>,
    );
    return;
  }
  // @deeptop-pets:end renderer-route

  const [appModule, frontendLogModule] = await Promise.all([
    import("./App"),
    import("./lib/frontend-log"),
    import("@xterm/xterm/css/xterm.css"),
    import("./styles.css"),
    import("./styles/terminal-dock.css"),
    import("./styles/git-dock.css"),
  ]);
  frontendLogModule.installFrontendLogCapture();
  const App = appModule.default;
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void renderApplication();
