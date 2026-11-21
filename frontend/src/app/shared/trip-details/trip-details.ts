import { DatePipe, DecimalPipe } from '@angular/common';
import {
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  input,
  output,
  viewChild,
} from '@angular/core';
import { Leg, LegStop, Trip } from '../../api/models';
import { Crowding } from '../crowding/crowding';
import { DepartureTime } from '../departure-time/departure-time';
import { PlatformSign } from '../platform-sign/platform-sign';
import { TrainLength } from '../train-length/train-length';

// NS facility codes on a train unit, in plain words. Unknown codes are shown as they come.
const FACILITIES: Record<string, string> = {
  WIFI: 'Wi-Fi',
  TOILET: 'Toilet',
  STILTE: 'Quiet zone',
  FIETS: 'Bicycles',
  STROOM: 'Power sockets',
  TOEGANKELIJK: 'Step-free',
};

const EXIT_SIDES: Record<string, string> = { LEFT: 'left', RIGHT: 'right' };

/** One stop of a leg as shown: the time to show, its delay and the track. */
interface StopView {
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

interface LegView {
  leg: Leg;
  ride: boolean;
  departureDelay: number;
  arrivalDelay: number;
  exitSide: string;
  stops: StopView[];
}

function minutesLate(planned: string | null, actual: string | null): number {
  if (!planned || !actual) return 0;
  return Math.max(0, Math.round((Date.parse(actual) - Date.parse(planned)) / 60_000));
}

function stopView(stop: LegStop, index: number, count: number): StopView {
  // Show the departure time, except at the last stop where only arrival matters.
  const last = index === count - 1;
  const planned = last
    ? (stop.arrival_planned ?? stop.departure_planned)
    : (stop.departure_planned ?? stop.arrival_planned);
  const actual = last
    ? (stop.arrival_actual ?? stop.departure_actual)
    : (stop.departure_actual ?? stop.arrival_actual);
  return {
    name: stop.name,
    time: actual ?? planned,
    delay: minutesLate(planned, actual),
    track: stop.track,
    trackChanged: stop.track_changed,
    passing: stop.passing,
    cancelled: stop.cancelled,
    endpoint: index === 0 || last,
  };
}

/**
 * Everything known about one trip: disruptions, the boarding train's units and facilities, and
 * each leg with its stops, tracks, crowding, punctuality and notes. Shown beside the results on
 * wide screens and as a full-screen overlay on phones; the parent decides where.
 */
@Component({
  imports: [DatePipe, DecimalPipe, Crowding, DepartureTime, PlatformSign, TrainLength],
  selector: 'app-trip-details',
  styleUrl: './trip-details.scss',
  templateUrl: './trip-details.html',
  host: { '(keydown.escape)': 'closed.emit()' },
})
export class TripDetails {
  readonly trip = input.required<Trip>();
  /** The rider closed the details. */
  readonly closed = output();

  protected readonly legs = computed<LegView[]>(() =>
    this.trip().legs.map((leg) => ({
      leg,
      ride: leg.travel_type === 'PUBLIC_TRANSIT',
      departureDelay: minutesLate(leg.departure_planned, leg.departure_actual),
      arrivalDelay: minutesLate(leg.arrival_planned, leg.arrival_actual),
      exitSide: EXIT_SIDES[leg.exit_side ?? ''] ?? '',
      stops: leg.stops.map((stop, i) => stopView(stop, i, leg.stops.length)),
    })),
  );

  private readonly closeButton = viewChild.required<ElementRef<HTMLButtonElement>>('closeButton');

  constructor() {
    // Move focus into the details whenever another trip opens, so keyboard and screen reader
    // users land on them; Escape or the close button take them back out.
    afterRenderEffect(() => {
      this.trip();
      this.closeButton().nativeElement.focus();
    });
  }

  protected facility(code: string): string {
    return FACILITIES[code] ?? code.toLowerCase();
  }
}
