import { DatePipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { Trip } from '../../api/models';
import { Carriages } from '../carriages/carriages';
import { Crowding } from '../crowding/crowding';
import { DepartureTime } from '../departure-time/departure-time';
import { PlatformSign } from '../platform-sign/platform-sign';
import { TrainLength } from '../train-length/train-length';

// Full names for the codes riders see most, shown on hover and read out to screen readers.
const TRAIN_TYPE_NAMES: Record<string, string> = { IC: 'Intercity', SPR: 'Sprinter' };

/** One trip as a departure-board row: time, train, platform sign, crowding and arrival. */
@Component({
  imports: [DatePipe, Carriages, Crowding, DepartureTime, PlatformSign, TrainLength],
  selector: 'app-trip-row',
  styleUrl: './trip-row.scss',
  templateUrl: './trip-row.html',
})
export class TripRow {
  readonly trip = input.required<Trip>();
  /** Highlights the row as the trip to take, like a green signal. */
  readonly recommended = input(false);
  /** Whether to show the arrival delay next to the arrival time. */
  readonly arrivalDelay = input(false);

  // "IC 2736" is shown as "IC": NS's own short category code, never the number.
  protected readonly trainType = computed(() => this.trip().train.replace(/\s*\d+$/, ''));
  protected readonly trainTypeName = computed(() => TRAIN_TYPE_NAMES[this.trainType()] ?? '');

  /** The whole train's route, when both ends are known. */
  protected readonly route = computed(() => {
    const { train_origin: origin, train_destination: destination } = this.trip();
    return origin && destination ? { origin, destination } : null;
  });
}
