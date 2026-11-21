import { DatePipe } from '@angular/common';
import { Component, computed, inject, input } from '@angular/core';
import { Trip } from '../../api/models';
import { Carriages } from '../carriages/carriages';
import { Crowding } from '../crowding/crowding';
import { DepartureTime } from '../departure-time/departure-time';
import { PlatformSign } from '../platform-sign/platform-sign';
import { TrainLength } from '../train-length/train-length';
import { TrainRouteSetting } from '../train-route-setting';

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

  // "IC 2736" is shown as "Intercity": the train type only, never the number.
  protected readonly trainType = computed(() => {
    const category = this.trip().train.replace(/\s*\d+$/, '');
    return TRAIN_TYPE_NAMES[category] ?? category;
  });

  private readonly routeSetting = inject(TrainRouteSetting);
  /** The whole train's route, only when the setting is on and both ends are known. */
  protected readonly route = computed(() => {
    const { train_origin: origin, train_destination: destination } = this.trip();
    return this.routeSetting.show() && origin && destination ? { origin, destination } : null;
  });
}
