import { Component, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import { Commute, CommuteTrips, Station, Trip } from '../api/models';
import { Auth } from '../auth';
import { Desktop } from '../shared/desktop/desktop';
import { StationAutocomplete } from '../shared/station-autocomplete/station-autocomplete';
import { TripDetails } from '../shared/trip-details/trip-details';
import { TripListSkeleton } from '../shared/trip-list-skeleton/trip-list-skeleton';
import { TripSelection } from '../shared/trip-selection/trip-selection';
import { CommuteBoard } from './commute-board';
import { CommuteStore } from './commute-store';

/** How long after its usual time a commute still counts as today, so it stays on top. */
const GRACE_MINUTES = 3 * 60;
const DAY_MINUTES = 24 * 60;

/** Minutes from `now` until the next usual departure; a time up to GRACE_MINUTES ago still counts as today. */
function minutesUntilNext(usualTime: string, now: Date): number {
  const [hours, minutes] = usualTime.split(':').map(Number);
  const nowMinutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const diff = hours * 60 + minutes - nowMinutes;
  // Wrap into [-GRACE_MINUTES, DAY_MINUTES - GRACE_MINUTES) so yesterday's late-night time counts after midnight.
  return ((((diff + GRACE_MINUTES) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES) - GRACE_MINUTES;
}

/** Commutes ordered by their next usual departure; those without a usual time come last, by name. */
export function sortCommutes(commutes: Commute[], now: Date): Commute[] {
  const next = (c: Commute): number | null =>
    c.usual_departure_time ? minutesUntilNext(c.usual_departure_time, now) : null;
  return [...commutes].sort((a, b) => {
    const [na, nb] = [next(a), next(b)];
    if (na !== nb) {
      if (na === null) return 1;
      if (nb === null) return -1;
      return na - nb;
    }
    return a.name.localeCompare(b.name);
  });
}

@Component({
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    RouterLink,
    CommuteBoard,
    StationAutocomplete,
    TripDetails,
    TripListSkeleton,
  ],
  selector: 'app-commutes',
  styleUrl: './commutes.scss',
  templateUrl: './commutes.html',
  providers: [TripSelection],
  host: { '[class.with-details]': 'selection.withDetails()' },
})
export class Commutes {
  protected readonly commutes = signal<Commute[]>([]);
  protected readonly loaded = signal(false);
  protected readonly error = signal('');
  /** The one open trip across all boards; the same train can show on several, so the board counts. */
  protected readonly selection = inject(TripSelection);
  /** The destination of the selected trip's commute, for the details' OV-fiets count. */
  protected readonly selectedDestination = computed<Station | null>(() => {
    const id = this.selection.selected()?.owner;
    const commute = this.commutes().find((c) => c.id === id);
    return commute ? { code: commute.destination_code, name: commute.destination_name } : null;
  });

  protected readonly form = inject(NonNullableFormBuilder).group({
    name: ['', Validators.required],
    origin: ['', Validators.required],
    destination: ['', Validators.required],
    usualTime: [''],
  });

  private readonly store = inject(CommuteStore);
  protected readonly loggedIn = inject(Auth).loggedIn;
  protected readonly storageUnavailable = this.store.storageUnavailable;
  protected readonly moveNotice = this.store.moveNotice;
  protected readonly wide = inject(Desktop).wide;
  private origin: Station | null = null;
  private destination: Station | null = null;

  constructor() {
    void this.load();
  }

  protected pick(side: 'origin' | 'destination', event: MatAutocompleteSelectedEvent): void {
    const station = event.option.value as Station;
    if (side === 'origin') {
      this.origin = station;
    } else {
      this.destination = station;
    }
    this.form.controls[side].setValue(station.name, { emitEvent: false });
  }

  protected async add(): Promise<void> {
    const { name, origin, destination, usualTime } = this.form.getRawValue();
    if (
      this.form.invalid ||
      this.origin?.name !== origin ||
      this.destination?.name !== destination
    ) {
      this.error.set('Pick both stations from the suggestions.');
      return;
    }
    if (this.origin.code === this.destination.code) {
      this.error.set('Origin and destination must differ.');
      return;
    }
    try {
      const created = await this.store.add({
        name,
        origin_code: this.origin.code,
        origin_name: this.origin.name,
        destination_code: this.destination.code,
        destination_name: this.destination.name,
        usual_departure_time: usualTime ? `${usualTime}:00` : null,
      });
      this.commutes.update((all) => sortCommutes([...all, created], new Date()));
      this.form.reset();
      this.origin = null;
      this.destination = null;
      this.error.set('');
    } catch {
      this.error.set('The commute could not be saved.');
    }
  }

  protected selectedUid(commute: Commute): string | null {
    return this.selection.uidFor(commute.id);
  }

  protected select(commute: Commute, trip: Trip): void {
    this.selection.toggle(commute.id, trip);
  }

  /**
   * Keeps the open details current after a board refresh. Beside the boards the details are never
   * empty: the first board's first load opens its recommended trip, and a trip that left falls
   * back to its board's recommended one.
   */
  protected tripsLoaded(commute: Commute, data: CommuteTrips): void {
    this.selection.refresh(commute.id, data.trips, data.recommended_uid);
    if (commute.id === this.commutes()[0]?.id) {
      this.selection.openFirst(commute.id, data.trips, data.recommended_uid);
    }
  }

  protected async remove(commute: Commute): Promise<void> {
    try {
      await this.store.remove(commute.id);
      this.selection.closeFor(commute.id);
      this.commutes.update((all) =>
        sortCommutes(
          all.filter((c) => c.id !== commute.id),
          new Date(),
        ),
      );
    } catch {
      this.error.set('The commute could not be deleted.');
    }
  }

  private async load(): Promise<void> {
    try {
      this.commutes.set(sortCommutes(await this.store.list(), new Date()));
    } catch {
      this.error.set('Your commutes could not be loaded.');
    }
    this.loaded.set(true);
  }
}
