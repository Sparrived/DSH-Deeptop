import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { installFrontendLogCapture } from "./lib/frontend-log";
import { isWithinSelector, OWNED_CONTEXT_MENU_SELECTOR } from "./app/context-menu";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import "./styles/terminal-dock.css";

installFrontendLogCapture();

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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
