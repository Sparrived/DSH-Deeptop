export type UpdateChannel = "stable" | "development";

export type UpdateCheckState =
  | { status: "idle"; channel: UpdateChannel }
  | { status: "checking"; channel: UpdateChannel }
  | { status: "up-to-date"; channel: UpdateChannel; checkedAt: number }
  | {
      status: "available";
      channel: UpdateChannel;
      checkedAt: number;
      latestVersion: string;
      releaseTag: string;
      releaseName: string | null;
      releaseUrl: string;
      assetName: string;
      assetSize: number;
      sha256: string;
      installSupported: boolean;
    }
  | { status: "error"; channel: UpdateChannel; message: string };

export type NativeUpdateResult = {
  currentVersion: string;
  channel: UpdateChannel;
  latestVersion: string | null;
  releaseTag: string | null;
  releaseName: string | null;
  releaseUrl: string | null;
  assetName: string | null;
  assetSize: number | null;
  sha256: string | null;
  installSupported: boolean;
  updateAvailable: boolean;
};

export type UpdateDownloadState =
  | { status: "idle" }
  | { status: "downloading"; releaseTag: string; assetName: string; downloadedBytes: number; totalBytes: number | null; percent: number | null }
  | { status: "verifying"; releaseTag: string; assetName: string }
  | { status: "ready"; releaseTag: string; assetName: string; path: string; sha256: string }
  | { status: "cancelled" }
  | { status: "launching" }
  | { status: "error"; message: string; canInstall?: boolean };

export type NativeUpdateDownloadProgress = {
  phase: UpdateDownloadState["status"] | "failed";
  releaseTag?: string;
  assetName?: string;
  downloadedBytes?: number;
  totalBytes?: number | null;
  percent?: number | null;
  path?: string;
  sha256?: string;
  message?: string;
};

export function updateCheckStateFromResult(result: NativeUpdateResult, checkedAt = Date.now()): UpdateCheckState {
  if (result.updateAvailable && result.latestVersion && result.releaseTag && result.releaseUrl && result.assetName && result.assetSize !== null && result.sha256) {
    return {
      status: "available",
      channel: result.channel,
      checkedAt,
      latestVersion: result.latestVersion,
      releaseTag: result.releaseTag,
      releaseName: result.releaseName,
      releaseUrl: result.releaseUrl,
      assetName: result.assetName,
      assetSize: result.assetSize,
      sha256: result.sha256,
      installSupported: result.installSupported,
    };
  }
  return { status: "up-to-date", channel: result.channel, checkedAt };
}

export function updateCheckErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return String(error || "更新检查失败");
}

export function updateDownloadStateFromEvent(event: NativeUpdateDownloadProgress): UpdateDownloadState {
  if (event.phase === "downloading" && event.releaseTag && event.assetName && typeof event.downloadedBytes === "number") {
    return { status: "downloading", releaseTag: event.releaseTag, assetName: event.assetName, downloadedBytes: event.downloadedBytes, totalBytes: event.totalBytes ?? null, percent: event.percent ?? null };
  }
  if (event.phase === "verifying" && event.releaseTag && event.assetName) return { status: "verifying", releaseTag: event.releaseTag, assetName: event.assetName };
  if (event.phase === "ready" && event.releaseTag && event.assetName && event.path && event.sha256) return { status: "ready", releaseTag: event.releaseTag, assetName: event.assetName, path: event.path, sha256: event.sha256 };
  if (event.phase === "cancelled") return { status: "cancelled" };
  if (event.phase === "launching") return { status: "launching" };
  if (event.phase === "failed" || event.phase === "error") return { status: "error", message: event.message || "更新下载失败" };
  return { status: "error", message: "更新进度事件格式无效" };
}
