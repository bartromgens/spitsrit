import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  MatAutocompleteModule,
  MatAutocompleteSelectedEvent,
} from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import { Api } from '../api/api';
import { commutesCreate, commutesDestroy, commutesList, stationsList } from '../api/functions';
import { Commute, CommuteTrips, Station, Trip } from '../api/models';
import { Desktop, defaultTrip } from '../shared/desktop/desktop';
import { TripDetails } from '../shared/trip-details/trip-details';
import { TripListSkeleton } from '../shared/trip-list-skeleton/trip-list-skeleton';
import { CommuteBoard } from './commute-board';

const SEARCH_DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;
const GRACE_MINUTES = 30;
const DAY_MINUTES = 24 * 60;

/** Minutes from `now` until the next usual departure; a time up to 30 minutes ago still counts as today. */
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
    MatAutocompleteModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    CommuteBoard,
    TripDetails,
    TripListSkeleton,
  ],
  selector: 'app-commutes',
  styleUrl: './commutes.scss',
  templateUrl: './commutes.html',
  host: { '[class.with-details]': 'selected() !== null' },
})
export class Commutes {
  protected readonly commutes = signal<Commute[]>([]);
  protected readonly loaded = signal(false);
  protected readonly error = signal('');
  protected readonly originOptions = signal<Station[]>([]);
  protected readonly destinationOptions = signal<Station[]>([]);
  /** The one open trip across all boards; the same train can show on several, so the board counts. */
  protected readonly selected = signal<{ commuteId: number; trip: Trip } | null>(null);
  /** The destination of the selected trip's commute, for the details' OV-fiets count. */
  protected readonly selectedDestination = computed<Station | null>(() => {
    const id = this.selected()?.commuteId;
    const commute = this.commutes().find((c) => c.id === id);
    return commute ? { code: commute.destination_code, name: commute.destination_name } : null;
  });

  protected readonly form = inject(NonNullableFormBuilder).group({
    name: ['', Validators.required],
    origin: ['', Validators.required],
    destination: ['', Validators.required],
    usualTime: [''],
  });

  private readonly api = inject(Api);
  protected readonly wide = inject(Desktop).wide;
  /** Whether the first board's trip was opened (or skipped on a phone); a later close stays closed. */
  private autoSelected = false;
  private origin: Station | null = null;
  private destination: Station | null = null;

  constructor() {
    void this.load();
    this.search('origin', this.originOptions);
    this.search('destination', this.destinationOptions);
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
      const created = await this.api.invoke(commutesCreate, {
        body: {
          name,
          origin_code: this.origin.code,
          origin_name: this.origin.name,
          destination_code: this.destination.code,
          destination_name: this.destination.name,
          usual_departure_time: usualTime ? `${usualTime}:00` : null,
        },
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
    const current = this.selected();
    return current?.commuteId === commute.id ? current.trip.uid : null;
  }

  /** Opens the details of a trip, or closes them when the same trip is picked again. */
  protected select(commute: Commute, trip: Trip): void {
    this.selected.update((current) =>
      current?.commuteId === commute.id && current.trip.uid === trip.uid
        ? null
        : { commuteId: commute.id, trip },
    );
  }

  protected close(): void {
    this.selected.set(null);
  }

  /**
   * Keeps the open details current after a board refresh. Beside the boards the details are never
   * empty: the first board's first load opens its recommended trip, and a trip that left falls
   * back to its board's recommended one. On a phone a trip that left just closes the details.
   */
  protected tripsLoaded(commute: Commute, data: CommuteTrips): void {
    const current = this.selected();
    if (current?.commuteId === commute.id) {
      const fresh = data.trips.find((t) => t.uid === current.trip.uid);
      const next = fresh ?? (this.wide() ? defaultTrip(data.trips, data.recommended_uid) : null);
      this.selected.set(next ? { commuteId: commute.id, trip: next } : null);
    }
    if (!this.autoSelected && commute.id === this.commutes()[0]?.id) {
      this.autoSelected = true;
      const first = this.wide() ? defaultTrip(data.trips, data.recommended_uid) : null;
      if (first && this.selected() === null) {
        this.selected.set({ commuteId: commute.id, trip: first });
      }
    }
  }

  protected async remove(commute: Commute): Promise<void> {
    try {
      await this.api.invoke(commutesDestroy, { id: String(commute.id) });
      if (this.selected()?.commuteId === commute.id) {
        this.close();
      }
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
      this.commutes.set(sortCommutes((await this.api.invoke(commutesList)).results, new Date()));
    } catch {
      this.error.set('Your commutes could not be loaded.');
    }
    this.loaded.set(true);
  }

  private search(side: 'origin' | 'destination', options: typeof this.originOptions): void {
    this.form.controls[side].valueChanges
      .pipe(
        debounceTime(SEARCH_DEBOUNCE_MS),
        distinctUntilChanged(),
        switchMap((q) =>
          q.length < MIN_QUERY_LENGTH
            ? of<Station[]>([])
            : this.api.invoke(stationsList, { q }).catch(() => [] as Station[]),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((found) => options.set(found));
  }
}
