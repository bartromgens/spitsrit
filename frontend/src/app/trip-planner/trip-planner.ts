import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  FormControl,
  FormGroup,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { map } from 'rxjs';
import { MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { Api } from '../api/api';
import { tripsRetrieve } from '../api/functions';
import { Commute, CommuteTrips, Station, Trip } from '../api/models';
import { CommuteStrip } from '../commutes/commute-strip/commute-strip';
import { Desktop } from '../shared/desktop/desktop';
import { FilterChips } from '../shared/filter-chips/filter-chips';
import { StationAutocomplete } from '../shared/station-autocomplete/station-autocomplete';
import { TimeControl } from '../shared/time-control/time-control';
import { TimeModel, clock, isEarlierThanNow } from '../shared/time-control/time-model';
import { TripDetails } from '../shared/trip-details/trip-details';
import { TripList } from '../shared/trip-list/trip-list';
import { TripListSkeleton } from '../shared/trip-list-skeleton/trip-list-skeleton';
import { TripSelection } from '../shared/trip-selection/trip-selection';
import { LastStationsStore } from './last-stations';

/** The planner has one list of trips; this is its owner in the selection. */
const RESULTS = 0;

type Side = 'origin' | 'destination';

/** Proof of concept: pick two stations and show the NS trip advice for them. */
@Component({
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    CommuteStrip,
    FilterChips,
    StationAutocomplete,
    TimeControl,
    TripDetails,
    TripList,
    TripListSkeleton,
  ],
  providers: [TripSelection],
  selector: 'app-trip-planner',
  styleUrl: './trip-planner.scss',
  templateUrl: './trip-planner.html',
  host: { '[class.with-details]': 'selection.withDetails()' },
})
export class TripPlanner {
  protected readonly result = signal<CommuteTrips | null>(null);
  protected readonly error = signal('');
  /** Whether a plan request is in flight; placeholder rows hold the results' place meanwhile. */
  protected readonly loading = signal(false);
  /** The destination of the shown trips; their details show its OV-fiets count. */
  protected readonly destination = signal<Station | null>(null);

  protected readonly form = inject(NonNullableFormBuilder).group({
    origin: ['', Validators.required],
    destination: ['', Validators.required],
    /** `HH:mm`. While following it shows the clock. Unlike the stations, it is not remembered. */
    time: [clock(new Date())],
  });

  /** Trip filters; like the time they are not remembered. `null` means no limit. */
  protected readonly filters = new FormGroup({
    maxTransfers: new FormControl<number | null>(null),
    maxDuration: new FormControl<number | null>(null, [Validators.min(1)]),
  });
  protected readonly filtersOpen = signal(false);
  protected readonly maxTransfers = toSignal(this.filters.controls.maxTransfers.valueChanges, {
    initialValue: null,
  });
  /** The duration limit in force; an invalid value limits nothing. */
  protected readonly maxDuration = toSignal(
    this.filters.controls.maxDuration.valueChanges.pipe(
      map(() =>
        this.filters.controls.maxDuration.valid ? this.filters.controls.maxDuration.value : null,
      ),
    ),
    { initialValue: null },
  );

  /** The time field's state: following the clock, depart or arrive, and "around" a commute's time. */
  protected readonly time = new TimeModel(this.form.controls.time);
  /** The time the shown results were planned around. */
  protected readonly resultTime = signal('');
  /** Whether the shown results are for arriving by `resultTime`. */
  protected readonly resultArrive = signal(false);

  /** The trip whose details are open: beside the results on wide screens, over them on phones. */
  protected readonly selection = inject(TripSelection);
  protected readonly selectedUid = computed(() => this.selection.uidFor(RESULTS));
  private readonly api = inject(Api);
  private readonly lastStations = inject(LastStationsStore);
  protected readonly wide = inject(Desktop).wide;
  private readonly picked: Record<Side, Station | null> = { origin: null, destination: null };

  constructor() {
    this.restore();
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
    if (ahead) this.time.write(usual, false);
    else this.time.followNow();
    this.time.around.set(ahead);
    this.time.arrive.set(false);
    return this.plan();
  }

  /** Opens the details of a trip, or closes them when its row is clicked again. */
  protected select(trip: Trip): void {
    this.selection.toggle(RESULTS, trip);
  }

  /** Plans again under the changed filters, when there is something to update. */
  protected filterChanged(): void {
    if (this.result() !== null) void this.plan();
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
    if (this.time.needsTime()) {
      this.fail('Pick a time to arrive by.');
      return;
    }
    if (this.filters.controls.maxDuration.invalid) {
      this.filtersOpen.set(true);
      this.fail('Max duration must be at least 1 minute.');
      return;
    }
    this.loading.set(true);
    this.error.set('');
    this.selection.close();
    const { maxTransfers, maxDuration } = this.filters.getRawValue();
    try {
      const result = await this.api.invoke(tripsRetrieve, {
        from: from.code,
        to: to.code,
        ...this.time.params(),
        ...(maxTransfers !== null && { max_transfers: maxTransfers }),
        ...(maxDuration !== null && { max_duration: maxDuration }),
      });
      this.result.set(result);
      // Beside the results the details pane is never empty; on a phone details open on tap.
      this.selection.openDefault(RESULTS, result.trips, result.recommended_uid);
      this.resultTime.set(this.form.controls.time.value);
      this.resultArrive.set(this.time.arrive());
      this.destination.set(to);
      this.lastStations.save(from, to);
    } catch {
      this.fail('Train times are unavailable right now.');
    } finally {
      this.loading.set(false);
    }
  }

  private restore(): void {
    const saved = this.lastStations.load();
    if (!saved) return;
    for (const side of ['origin', 'destination'] as const) {
      this.picked[side] = saved[side];
      this.form.controls[side].setValue(saved[side].name, { emitEvent: false });
    }
  }

  private fail(message: string): void {
    this.result.set(null);
    this.destination.set(null);
    this.selection.close();
    this.error.set(message);
  }
}
