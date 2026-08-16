import { isTauri, logFrontendEvent } from "./desktop";

/**
 * Global frontend error capture for the log viewer. Uncaught exceptions,
 * unhandled promise rejections and console.error calls are forwarded (with
 * their stack traces) into the desktop log store so developers can reproduce
 * and troubleshoot issues from the Settings -> 日志 panel or the exported log.
 *
 * Capture is best-effort and throttled per signature so a repeating error
 * cannot flood the log store or the persistent log file.
 */

const THROTTLE_MS = 1500;
const MAX_SIGNATURES = 64;
const lastSentAt = new Map<string, number>();
let installed = false;

function signatureOf(text: string) {
  return text.split("\n", 3).join("\n").slice(0, 240);
}

function throttled(signature: string): boolean {
  const now = Date.now();
  const last = lastSentAt.get(signature);
  if (last !== undefined && now - last < THROTTLE_MS) return true;
  lastSentAt.set(signature, now);
  if (lastSentAt.size > MAX_SIGNATURES) {
    let oldestKey: string | undefined;
    let oldestAt = Number.POSITIVE_INFINITY;
    for (const [key, time] of lastSentAt) {
      if (time < oldestAt) {
        oldestAt = time;
        oldestKey = key;
      }
    }
    if (oldestKey) lastSentAt.delete(oldestKey);
  }
  return false;
}

function send(stream: "error" | "console", text: string) {
  if (!isTauri()) return;
  if (throttled(signatureOf(text))) return;
  void logFrontendEvent(stream, text);
}

export function reportFrontendError(message: string, stack?: string) {
  const detail = stack && stack.trim() ? stack.trim() : message;
  send("error", `[window error] ${message}\n${detail}`);
}

export function reportUnhandledRejection(reason: unknown) {
  const message = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);
  const stack = reason instanceof Error && reason.stack ? reason.stack.trim() : "";
  send("error", `[unhandled rejection] ${message}${stack ? `\n${stack}` : ""}`);
}

function stringifyArg(value: unknown): string {
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function reportConsoleError(args: unknown[]) {
  send("console", `[console.error] ${args.map(stringifyArg).join(" ")}`);
}

/** Install the window-level error, unhandled-rejection and console.error capture once. */
export function installFrontendLogCapture() {
  if (installed) return;
  installed = true;
  window.addEventListener("error", (event) => {
    reportFrontendError(
      event.message,
      event.error?.stack || `${event.filename}:${event.lineno}:${event.colno}`,
    );
  });
  window.addEventListener("unhandledrejection", (event) => {
    reportUnhandledRejection(event.reason);
  });
  const originalError = console.error;
  console.error = (...args) => {
    originalError(...args);
    reportConsoleError(args);
  };
}
