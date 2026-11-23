import {
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Api } from '../api/api';
import { commutesPartialUpdate, commutesTripsRetrieve } from '../api/functions';
import { Commute, CommuteTrips, Trip } from '../api/models';
import { DepartureTime } from '../shared/departure-time/departure-time';
import { TripList } from '../shared/trip-list/trip-list';
import { TripListSkeleton } from '../shared/trip-list-skeleton/trip-list-skeleton';

const REFRESH_MS = 60_000;

/** Live upcoming trips for one commute, with the trip to take highlighted. */
@Component({
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    DepartureTime,
    TripList,
    TripListSkeleton,
  ],
  selector: 'app-commute-board',
  styleUrl: './commute-board.scss',
  templateUrl: './commute-board.html',
})
export class CommuteBoard implements OnInit {
  readonly commute = input.required<Commute>();
  /** The uid of this board's trip whose details are open, if any. */
  readonly selectedUid = input<string | null>(null);
  readonly removed = output<Commute>();
  readonly tripSelected = output<Trip>();
  /** Emits the trips after every successful load, so the page can drop a selection that left. */
  readonly tripsLoaded = output<Trip[]>();

  protected readonly data = signal<CommuteTrips | null>(null);
  protected readonly error = signal('');
  protected readonly filterError = signal('');
  protected readonly filtersOpen = signal(false);
  private readonly savedDuration = signal<number | null>(null);
  private readonly savedTransfers = signal<number | null>(null);

  /** Chip labels for the saved filters, shown while the fields are collapsed. */
  protected readonly chips = computed(() => {
    const chips: string[] = [];
    const duration = this.savedDuration();
    const transfers = this.savedTransfers();
    if (duration !== null) {
      chips.push(`Max ${duration} min`);
    }
    if (transfers !== null) {
      chips.push(
        transfers === 0
          ? 'Direct only'
          : `Max ${transfers} ${transfers === 1 ? 'transfer' : 'transfers'}`,
      );
    }
    return chips;
  });

  protected readonly maxDuration = new FormControl<number | null>(null, [Validators.min(1)]);
  protected readonly maxTransfers = new FormControl<number | null>(null, [Validators.min(0)]);

  /** What to tell the rider: a wait, or the recommended trip's departure when planned ahead. */
  protected readonly advice = computed<{ text?: string; trip?: Trip }>(() => {
    const data = this.data();
    if (data === null) {
      return {};
    }
    const trip = data.trips.find((t) => t.uid === data.recommended_uid);
    if (data.recommended_uid === null || trip === undefined) {
      return { text: 'No trip available' };
    }
    if (data.wait_minutes === null) {
      return { trip };
    }
    return { text: data.wait_minutes === 0 ? 'Leave now' : `Wait ${data.wait_minutes} min` };
  });

  private readonly api = inject(Api);
  private readonly destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    this.maxDuration.setValue(this.commute().max_duration_minutes ?? null);
    this.maxTransfers.setValue(this.commute().max_transfers ?? null);
    this.savedDuration.set(this.commute().max_duration_minutes ?? null);
    this.savedTransfers.set(this.commute().max_transfers ?? null);
    void this.refresh();
    const timer = setInterval(() => void this.refresh(), REFRESH_MS);
    this.destroyRef.onDestroy(() => clearInterval(timer));
  }

  /** The usual departure time as HH:mm, or null when none is set. */
  protected readonly usualTime = computed(
    () => this.commute().usual_departure_time?.slice(0, 5) || null,
  );

  /** Loads the trips; `fromNow` plans from now instead of the usual time, for this load only. */
  protected async refresh(fromNow = false): Promise<void> {
    try {
      const data = await this.api.invoke(commutesTripsRetrieve, {
        id: String(this.commute().id),
        ...(fromNow ? { now: true } : {}),
      });
      this.data.set(data);
      this.error.set('');
      this.tripsLoaded.emit(data.trips);
    } catch {
      this.error.set('Train times are unavailable right now.');
    }
  }

  /** Saves the filters as this commute's defaults, then reloads the trips under them. */
  protected async saveFilters(): Promise<void> {
    if (this.maxDuration.invalid || this.maxTransfers.invalid) {
      this.filtersOpen.set(true);
      return;
    }
    try {
      await this.api.invoke(commutesPartialUpdate, {
        id: String(this.commute().id),
        body: {
          max_duration_minutes: this.maxDuration.value,
          max_transfers: this.maxTransfers.value,
        },
      });
      this.filterError.set('');
      this.savedDuration.set(this.maxDuration.value);
      this.savedTransfers.set(this.maxTransfers.value);
    } catch {
      this.filterError.set('Could not save the filters.');
      this.filtersOpen.set(true);
      return;
    }
    await this.refresh();
  }
}
