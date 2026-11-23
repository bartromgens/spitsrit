import { DestroyRef, Injectable, Signal, inject, signal } from '@angular/core';
import { Trip } from '../../api/models';

/** The details breakpoint of `styles/_layout.scss` ($sp-bp-details): at or below it, details cover the results. */
const NARROW_QUERY = '(max-width: 52rem)';

/** Whether the screen is wide enough for the trip details beside the results. */
@Injectable({ providedIn: 'root' })
export class Desktop {
  private readonly wideState = signal(false);
  readonly wide: Signal<boolean> = this.wideState.asReadonly();

  constructor() {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const query = window.matchMedia(NARROW_QUERY);
    this.wideState.set(!query.matches);
    const listener = (event: MediaQueryListEvent): void => this.wideState.set(!event.matches);
    query.addEventListener('change', listener);
    inject(DestroyRef).onDestroy(() => query.removeEventListener('change', listener));
  }
}

/** The trip to open without a click: the recommended one, else the first, else none. */
export function defaultTrip(trips: Trip[], recommendedUid: string | null): Trip | null {
  return trips.find((t) => t.uid === recommendedUid) ?? trips[0] ?? null;
}
