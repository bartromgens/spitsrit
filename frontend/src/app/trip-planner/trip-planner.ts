import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  MatAutocompleteModule,
  MatAutocompleteSelectedEvent,
} from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import { Api } from '../api/api';
import { stationsList, tripsRetrieve } from '../api/functions';
import { Commute, CommuteTrips, Station, Trip } from '../api/models';
import { CommuteStrip } from '../commutes/commute-strip/commute-strip';
import { TripDetails } from '../shared/trip-details/trip-details';
import { TripList } from '../shared/trip-list/trip-list';
import { TripListSkeleton } from '../shared/trip-list-skeleton/trip-list-skeleton';

const SEARCH_DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

const STORAGE_KEY = 'spitsrit.lastTrip';

const MINUTE_MS = 60_000;

/** The time of day as `HH:mm`, as a time input shows it. */
function clock(now: Date): string {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

/** Whether a `HH:MM` time of day has already passed today, to the minute. */
function isEarlierThanNow(time: string, now: Date): boolean {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes < now.getHours() * 60 + now.getMinutes();
}

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
    MatButtonToggleModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    CommuteStrip,
    TripDetails,
    TripList,
    TripListSkeleton,
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
  /** The destination of the shown trips; their details show its OV-fiets count. */
  protected readonly destination = signal<Station | null>(null);

  protected readonly form = inject(NonNullableFormBuilder).group({
    origin: ['', Validators.required],
    destination: ['', Validators.required],
    /** `HH:mm`. While `following` it shows the clock. Unlike the stations, it is not remembered. */
    time: [clock(new Date())],
  });

  /** Whether the time field follows the clock; planning then sends no time, so it is "now". */
  protected readonly following = signal(true);

  private readonly timeValue = toSignal(this.form.controls.time.valueChanges, {
    initialValue: this.form.controls.time.value,
  });
  /** Whether the chosen time is earlier than now, so the plan is for tomorrow. */
  protected readonly tomorrow = computed(() => {
    const time = this.timeValue();
    return !this.following() && time !== '' && isEarlierThanNow(time, new Date());
  });
  /** Whether the time came from a commute chip, so the results are "around" it. */
  protected readonly around = signal(false);
  /** The time the shown results were planned around. */
  protected readonly resultTime = signal('');
  /** Whether the time is when to arrive instead of when to leave. Not remembered either. */
  protected readonly arrive = signal(false);
  /** Whether the shown results are for arriving by `resultTime`. */
  protected readonly resultArrive = signal(false);
  /** Arriving by needs a chosen time: while following the clock there is nothing to arrive by. */
  protected readonly needsTime = computed(
    () => this.arrive() && (this.following() || this.timeValue() === ''),
  );

  /** Set while the component itself writes the time, so that is not taken for an edit. */
  private writing = false;
  private readonly destroyRef = inject(DestroyRef);
  private readonly api = inject(Api);
  private readonly picked: Record<Side, Station | null> = { origin: null, destination: null };

  constructor() {
    this.restore();
    // An edit of the time field stops it following the clock and ends "around" planning.
    this.form.controls.time.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      if (this.writing) return;
      this.following.set(false);
      this.around.set(false);
    });
    this.tick();
    this.search('origin', this.originOptions);
    this.search('destination', this.destinationOptions);
  }

  protected pick(side: Side, event: MatAutocompleteSelectedEvent): void {
    const station = event.option.value as Station;
    this.picked[side] = station;
    this.form.controls[side].setValue(station.name, { emitEvent: false });
  }

  /** Fills in a commute's stations and plans it, as if both were picked and Plan pressed. */
  protected planCommute(commute: Commute): Promise<void> {
    const stations: Record<Side, Station> = {
      origin: { code: commute.origin_code, name: commute.origin_name },
      destination: { code: commute.destination_code, name: commute.destination_name },
    };
    for (const side of ['origin', 'destination'] as const) {
      this.picked[side] = stations[side];
      this.form.controls[side].setValue(stations[side].name, { emitEvent: false });
    }
    const usual = commute.usual_departure_time?.slice(0, 5) ?? '';
    const ahead = usual !== '' && !isEarlierThanNow(usual, new Date());
    if (ahead) this.write(usual, false);
    else this.followNow();
    this.around.set(ahead);
    this.arrive.set(false);
    return this.plan();
  }

  protected setArrive(arrive: boolean): void {
    this.arrive.set(arrive);
  }

  /** Puts the time field back to following the clock. */
  protected followNow(): void {
    this.write(clock(new Date()), true);
  }

  private write(time: string, following: boolean): void {
    this.writing = true;
    this.form.controls.time.setValue(time);
    this.writing = false;
    this.following.set(following);
    this.around.set(false);
  }

  /** Keeps the field on the clock: refreshes it at the start of every minute while following. */
  private tick(): void {
    const timer = setTimeout(
      () => {
        if (this.following()) this.followNow();
        this.tick();
      },
      MINUTE_MS - (Date.now() % MINUTE_MS),
    );
    this.destroyRef.onDestroy(() => clearTimeout(timer));
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
    if (this.needsTime()) {
      this.fail('Pick a time to arrive by.');
      return;
    }
    this.loading.set(true);
    this.error.set('');
    this.selected.set(null);
    try {
      this.result.set(
        await this.api.invoke(tripsRetrieve, {
          from: from.code,
          to: to.code,
          ...this.timeParams(),
        }),
      );
      this.resultTime.set(this.form.controls.time.value);
      this.resultArrive.set(this.arrive());
      this.destination.set(to);
      this.remember(from, to);
    } catch {
      this.fail('Train times are unavailable right now.');
    } finally {
      this.loading.set(false);
    }
  }

  private timeParams(): { time?: string; around?: boolean; arrive?: boolean } {
    const time = this.form.controls.time.value;
    if (this.following() || time === '') return {};
    if (this.arrive()) return { time, arrive: true };
    return this.around() ? { time, around: true } : { time };
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
