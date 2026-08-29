/**
 * Register an asynchronously-created cleanup callback without losing it when
 * the owner is disposed before registration finishes (common with Tauri listen).
 */
export function trackAsyncCleanup<T extends () => void>(
  cleanups: T[],
  registration: Promise<T>,
  isDisposed: () => boolean,
  onRegistered?: (cleanup: T) => void,
  onError?: (error: unknown) => void,
): void {
  void registration
    .then((cleanup) => {
      if (isDisposed()) {
        cleanup();
        return;
      }
      cleanups.push(cleanup);
      onRegistered?.(cleanup);
    })
    .catch((error) => onError?.(error));
}
