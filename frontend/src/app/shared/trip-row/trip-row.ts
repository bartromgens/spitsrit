import { DatePipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { Trip } from '../../api/models';
import { Crowding } from '../crowding/crowding';
import { DepartureTime } from '../departure-time/departure-time';
import { PlatformSign } from '../platform-sign/platform-sign';
import { TrainLength } from '../train-length/train-length';

/** One trip as a departure-board row: time, train, platform sign, crowding and arrival. */
@Component({
  imports: [DatePipe, Crowding, DepartureTime, PlatformSign, TrainLength],
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

  // "IC 2736" is shown as a word in the UI font and a number in mono.
  private readonly trainParts = computed(
    () => /^(.*?)\s*(\d+)$/.exec(this.trip().train) ?? [this.trip().train, this.trip().train, ''],
  );
  protected readonly trainName = computed(() => this.trainParts()[1]);
  protected readonly trainNumber = computed(() => this.trainParts()[2]);
}
