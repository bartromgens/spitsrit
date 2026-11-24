import { DestroyRef, inject } from '@angular/core';

/**
 * Calls `callback` every `ms` milliseconds while the page is visible, until the calling
 * injection context is destroyed. Nothing runs while the page is hidden. When the page
 * becomes visible again, `callback` runs once at once if the last run is more than `ms` ago
 * (the creation counts as a run, as callers load their data when they are created), and the
 * interval starts over. Call it in an injection context, or pass the `destroyRef` to use.
 */
export function visibleInterval(
  callback: () => void,
  ms: number,
  destroyRef: DestroyRef = inject(DestroyRef),
): void {
  let timer: ReturnType<typeof setInterval> | undefined;
  let lastRun = Date.now();

  const run = (): void => {
    lastRun = Date.now();
    callback();
  };
  const stop = (): void => {
    clearInterval(timer);
    timer = undefined;
  };
  const start = (): void => {
    stop();
    timer = setInterval(run, ms);
  };
  const onVisibilityChange = (): void => {
    if (document.visibilityState !== 'visible') {
      stop();
      return;
    }
    if (Date.now() - lastRun >= ms) {
      run();
    }
    start();
  };

  if (document.visibilityState === 'visible') {
    start();
  }
  document.addEventListener('visibilitychange', onVisibilityChange);
  destroyRef.onDestroy(() => {
    stop();
    document.removeEventListener('visibilitychange', onVisibilityChange);
  });
}
