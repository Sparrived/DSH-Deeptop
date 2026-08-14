import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

document.addEventListener("contextmenu", (event) => {
  // Session rows own a contextual action menu; keep the native menu disabled elsewhere.
  if (event.target instanceof Element && event.target.closest(".session-row")) return;
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
