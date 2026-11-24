import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, input } from '@angular/core';
import { Leg } from '../../api/models';
import { Crowding } from '../crowding/crowding';
import { DepartureTime } from '../departure-time/departure-time';
import { PlatformSign } from '../platform-sign/platform-sign';
import { TripTrain } from '../trip-train/trip-train';

/** One stop of a leg as shown: the time to show, its delay and the track. */
export interface StopView {
  name: string;
  time: string | null;
  delay: number;
  track: string | null;
  trackChanged: boolean;
  passing: boolean;
  cancelled: boolean;
  /** The first or last stop of the leg: where you board or get off. */
  endpoint: boolean;
}

/** A leg with what the template needs worked out: whether it is a ride, delays, side, stops. */
export interface LegView {
  leg: Leg;
  ride: boolean;
  departureDelay: number;
  arrivalDelay: number;
  exitSide: string;
  stops: StopView[];
}

/**
 * One leg of a trip: a ride with its crowding, its train, bicycle places, stop list, door side and notes,
 * or a walk or transfer line. Used as the `<li>` of the trip's list of legs.
 */
@Component({
  imports: [DatePipe, DecimalPipe, Crowding, DepartureTime, PlatformSign, TripTrain],
  // eslint-disable-next-line @angular-eslint/component-selector -- the attribute form keeps the host a valid `<li>` inside the legs' `<ol>`
  selector: 'li[app-trip-leg]',
  styleUrl: './trip-leg.scss',
  templateUrl: './trip-leg.html',
  host: {
    class: 'leg',
    '[class.walk]': '!view().ride',
    '[class.cancelled]': 'view().leg.cancelled',
  },
})
export class TripLeg {
  readonly view = input.required<LegView>();
}
