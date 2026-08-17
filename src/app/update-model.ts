export type UpdateCheckState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "up-to-date"; checkedAt: number }
  | { status: "available"; checkedAt: number; latestVersion: string; releaseTag: string; releaseUrl: string }
  | { status: "error"; message: string };

export type NativeUpdateResult = {
  currentVersion: string;
  latestVersion: string | null;
  releaseTag: string | null;
  releaseName: string | null;
  releaseUrl: string | null;
  updateAvailable: boolean;
};

export function updateCheckStateFromResult(result: NativeUpdateResult, checkedAt = Date.now()): UpdateCheckState {
  if (result.updateAvailable && result.latestVersion && result.releaseTag && result.releaseUrl) {
    return {
      status: "available",
      checkedAt,
      latestVersion: result.latestVersion,
      releaseTag: result.releaseTag,
      releaseUrl: result.releaseUrl,
    };
  }
  return { status: "up-to-date", checkedAt };
}

export function updateCheckErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return String(error || "更新检查失败");
}
