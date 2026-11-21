import { Component, inject, signal } from '@angular/core';
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
import { stationsList, tripsRetrieve } from '../api/functions';
import { CommuteTrips, Station, Trip } from '../api/models';
import { OvFietsCount } from '../shared/ov-fiets-count/ov-fiets-count';
import { TripDetails } from '../shared/trip-details/trip-details';
import { TripListSkeleton } from '../shared/trip-list-skeleton/trip-list-skeleton';
import { TripRow } from '../shared/trip-row/trip-row';

const SEARCH_DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

const STORAGE_KEY = 'spitsrit.lastTrip';

type Side = 'origin' | 'destination';

function isStation(value: unknown): value is Station {
  const station = value as Partial<Station> | null;
  return typeof station?.code === 'string' && typeof station.name === 'string';
}

/** Proof of concept: pick two stations and show the NS trip advice for them. */
@Component({
  imports: [
    ReactiveFormsModule,
    MatAutocompleteModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    OvFietsCount,
    TripDetails,
    TripListSkeleton,
    TripRow,
  ],
  selector: 'app-trip-planner',
  styleUrl: './trip-planner.scss',
  templateUrl: './trip-planner.html',
  host: { '[class.with-details]': 'selected() !== null' },
})
export class TripPlanner {
  protected readonly originOptions = signal<Station[]>([]);
  protected readonly destinationOptions = signal<Station[]>([]);
  protected readonly result = signal<CommuteTrips | null>(null);
  protected readonly error = signal('');
  /** Whether a plan request is in flight; placeholder rows hold the results' place meanwhile. */
  protected readonly loading = signal(false);
  /** The trip whose details are open: beside the results on wide screens, over them on phones. */
  protected readonly selected = signal<Trip | null>(null);
  /** The destination of the shown trips, whose OV-fiets count is shown below them. */
  protected readonly destination = signal<Station | null>(null);

  protected readonly form = inject(NonNullableFormBuilder).group({
    origin: ['', Validators.required],
    destination: ['', Validators.required],
  });

  private readonly api = inject(Api);
  private readonly picked: Record<Side, Station | null> = { origin: null, destination: null };

  constructor() {
    this.restore();
    this.search('origin', this.originOptions);
    this.search('destination', this.destinationOptions);
  }

  protected pick(side: Side, event: MatAutocompleteSelectedEvent): void {
    const station = event.option.value as Station;
    this.picked[side] = station;
    this.form.controls[side].setValue(station.name, { emitEvent: false });
  }

  /** Opens the details of a trip, or closes them when its row is clicked again. */
  protected select(trip: Trip): void {
    this.selected.update((current) => (current?.uid === trip.uid ? null : trip));
  }

  protected close(): void {
    this.selected.set(null);
  }

  protected async plan(): Promise<void> {
    const { origin, destination } = this.form.getRawValue();
    const from = this.picked.origin;
    const to = this.picked.destination;
    if (from?.name !== origin || to?.name !== destination) {
      this.fail('Pick both stations from the suggestions.');
      return;
    }
    if (from.code === to.code) {
      this.fail('Origin and destination must differ.');
      return;
    }
    this.loading.set(true);
    this.error.set('');
    this.selected.set(null);
    try {
      this.result.set(await this.api.invoke(tripsRetrieve, { from: from.code, to: to.code }));
      this.destination.set(to);
      this.remember(from, to);
    } catch {
      this.fail('Train times are unavailable right now.');
    } finally {
      this.loading.set(false);
    }
  }

  private remember(origin: Station, destination: Station): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ origin, destination }));
    } catch {
      // Storage can be full or blocked; remembering is best effort.
    }
  }

  private restore(): void {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
      if (typeof saved !== 'object' || saved === null) return;
      const stations = saved as Record<Side, unknown>;
      if (!isStation(stations.origin) || !isStation(stations.destination)) return;
      for (const side of ['origin', 'destination'] as const) {
        const station = stations[side] as Station;
        this.picked[side] = station;
        this.form.controls[side].setValue(station.name, { emitEvent: false });
      }
    } catch {
      // Unreadable storage or invalid JSON: start with empty fields.
    }
  }

  private fail(message: string): void {
    this.result.set(null);
    this.destination.set(null);
    this.selected.set(null);
    this.error.set(message);
  }

  private search(side: Side, options: typeof this.originOptions): void {
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
