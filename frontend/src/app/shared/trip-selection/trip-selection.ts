import { Injectable, computed, inject, signal } from '@angular/core';
import { Trip } from '../../api/models';
import { Desktop, defaultTrip } from '../desktop/desktop';

/** The open trip and the list it belongs to: a commute's id, or any constant for a single list. */
export interface OpenTrip {
  owner: number;
  trip: Trip;
}

/**
 * The master-detail selection of a page: the one trip whose details are open, beside the lists
 * on wide screens and over them on phones. Provide it in the page component.
 */
@Injectable()
export class TripSelection {
  private readonly wide = inject(Desktop).wide;
  private readonly state = signal<OpenTrip | null>(null);
  /** Whether the first list's trip was opened (or skipped on a phone); a later close stays closed. */
  private autoOpened = false;

  readonly selected = this.state.asReadonly();
  /** For the page's `with-details` host class. */
  readonly withDetails = computed(() => this.state() !== null);

  /** The uid of the open trip if it belongs to this list. */
  uidFor(owner: number): string | null {
    const current = this.state();
    return current?.owner === owner ? current.trip.uid : null;
  }

  /** Opens the details of a trip, or closes them when the same trip is picked again. */
  toggle(owner: number, trip: Trip): void {
    this.state.update((current) =>
      current?.owner === owner && current.trip.uid === trip.uid ? null : { owner, trip },
    );
  }

  close(): void {
    this.state.set(null);
  }

  /** Closes the details when they belong to this list. */
  closeFor(owner: number): void {
    if (this.state()?.owner === owner) this.close();
  }

  /** Beside the results the details pane is never empty: opens the default trip on wide screens. */
  openDefault(owner: number, trips: Trip[], recommendedUid: string | null): void {
    const trip = this.wide() ? defaultTrip(trips, recommendedUid) : null;
    this.state.set(trip ? { owner, trip } : null);
  }

  /**
   * Keeps the open details current after a list refresh: the open trip is replaced by its fresh
   * copy, and one that left falls back to the list's default beside the lists, or closes on a phone.
   */
  refresh(owner: number, trips: Trip[], recommendedUid: string | null): void {
    const current = this.state();
    if (current?.owner !== owner) return;
    const fresh = trips.find((t) => t.uid === current.trip.uid);
    if (fresh) this.state.set({ owner, trip: fresh });
    else this.openDefault(owner, trips, recommendedUid);
  }

  /** The first load of the first list opens its default trip, once and only if nothing is open. */
  openFirst(owner: number, trips: Trip[], recommendedUid: string | null): void {
    if (this.autoOpened) return;
    this.autoOpened = true;
    const first = this.wide() ? defaultTrip(trips, recommendedUid) : null;
    if (first && this.state() === null) this.state.set({ owner, trip: first });
  }
}
