import { Component, input, output } from '@angular/core';
import { Trip } from '../../api/models';
import { TripRow } from '../trip-row/trip-row';

/** Trips as departure-board rows; each row is a button that selects its trip. */
@Component({
  imports: [TripRow],
  selector: 'app-trip-list',
  styleUrl: './trip-list.scss',
  templateUrl: './trip-list.html',
})
export class TripList {
  readonly trips = input.required<Trip[]>();
  /** The trip to take, highlighted like a green signal. */
  readonly recommendedUid = input<string | null>(null);
  /** The trip whose details are open. */
  readonly selectedUid = input<string | null>(null);
  /** Whether rows show the arrival delay next to the arrival time. */
  readonly arrivalDelay = input(false);
  readonly tripSelected = output<Trip>();
}
