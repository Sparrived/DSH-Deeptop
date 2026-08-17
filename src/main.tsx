import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { installFrontendLogCapture } from "./lib/frontend-log";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import "./styles/terminal-dock.css";

installFrontendLogCapture();

document.addEventListener("contextmenu", (event) => {
  // Session rows and workspace headers own contextual action menus.
  if (event.target instanceof Element && event.target.closest(".session-row, .workspace-group-header")) return;
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
