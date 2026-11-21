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
import { CommuteTrips, Station } from '../api/models';
import { TrainRouteToggle } from '../shared/train-route-toggle/train-route-toggle';
import { TripRow } from '../shared/trip-row/trip-row';

const SEARCH_DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

type Side = 'origin' | 'destination';

/** Proof of concept: pick two stations and show the NS trip advice for them. */
@Component({
  imports: [
    ReactiveFormsModule,
    MatAutocompleteModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    TrainRouteToggle,
    TripRow,
  ],
  selector: 'app-trip-planner',
  styleUrl: './trip-planner.scss',
  templateUrl: './trip-planner.html',
})
export class TripPlanner {
  protected readonly originOptions = signal<Station[]>([]);
  protected readonly destinationOptions = signal<Station[]>([]);
  protected readonly result = signal<CommuteTrips | null>(null);
  protected readonly error = signal('');

  protected readonly form = inject(NonNullableFormBuilder).group({
    origin: ['', Validators.required],
    destination: ['', Validators.required],
  });

  private readonly api = inject(Api);
  private readonly picked: Record<Side, Station | null> = { origin: null, destination: null };

  constructor() {
    this.search('origin', this.originOptions);
    this.search('destination', this.destinationOptions);
  }

  protected pick(side: Side, event: MatAutocompleteSelectedEvent): void {
    const station = event.option.value as Station;
    this.picked[side] = station;
    this.form.controls[side].setValue(station.name, { emitEvent: false });
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
    try {
      this.result.set(await this.api.invoke(tripsRetrieve, { from: from.code, to: to.code }));
      this.error.set('');
    } catch {
      this.fail('Train times are unavailable right now.');
    }
  }

  private fail(message: string): void {
    this.result.set(null);
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
