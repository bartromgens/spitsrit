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
import { Leg, LegStop, Station, Trip } from '../../api/models';
import { Crowding } from '../crowding/crowding';
import { DepartureTime } from '../departure-time/departure-time';
import { FacilityIcon } from '../facility-icon/facility-icon';
import { OvFietsCount } from '../ov-fiets-count/ov-fiets-count';
import { PlatformSign } from '../platform-sign/platform-sign';
import { TrainLength } from '../train-length/train-length';

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
  imports: [
    DatePipe,
    DecimalPipe,
    Crowding,
    DepartureTime,
    FacilityIcon,
    OvFietsCount,
    PlatformSign,
    TrainLength,
  ],
  selector: 'app-trip-details',
  styleUrl: './trip-details.scss',
  templateUrl: './trip-details.html',
  host: { '(keydown.escape)': 'closed.emit()' },
})
export class TripDetails {
  readonly trip = input.required<Trip>();
  /** Where the trip ends, to show its OV-fiets count; none when not known. */
  readonly destination = input<Station | null>(null);
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

  /** NS's side views of the units in train order, for those that have one. */
  protected readonly images = computed(() =>
    this.trip()
      .train_parts.map((part) => part.image_url)
      .filter((url): url is string => !!url),
  );

  protected readonly imagesLabel = computed(() => {
    const count = this.images().length;
    return `${this.trip().train_type ?? 'Train'}, ${count} unit${count === 1 ? '' : 's'}`;
  });

  private readonly closeButton = viewChild.required<ElementRef<HTMLButtonElement>>('closeButton');

  constructor() {
    // Move focus into the details whenever another trip opens, so keyboard and screen reader
    // users land on them; Escape or the close button take them back out.
    afterRenderEffect(() => {
      this.trip();
      this.closeButton().nativeElement.focus();
    });
  }

  /** An image that fails to load leaves no broken-image icon or gap in the strip. */
  protected hideImage(event: Event): void {
    (event.target as HTMLElement).hidden = true;
  }
}
