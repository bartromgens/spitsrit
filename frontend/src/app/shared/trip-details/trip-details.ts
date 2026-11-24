import { DecimalPipe } from '@angular/common';
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
import { DepartureTime } from '../departure-time/departure-time';
import { StationSection } from '../station-section/station-section';
import { LegView, StopView, TripLeg } from '../trip-leg/trip-leg';

const EXIT_SIDES: Record<string, string> = { LEFT: 'left', RIGHT: 'right' };

function minutesLate(planned: string | null, actual: string | null): number {
  if (!planned || !actual) return 0;
  return Math.max(0, Math.round((Date.parse(actual) - Date.parse(planned)) / 60_000));
}

function stopView(stop: LegStop, index: number, leg: Leg): StopView {
  // Show the departure time, except at the last stop where only arrival matters.
  const last = index === leg.stops.length - 1;
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
 * Everything known about one trip: disruptions, and each leg with its train (units and
 * facilities), stops, tracks, crowding, punctuality and notes. Shown beside the results on
 * wide screens and as a full-screen overlay on phones; the parent decides where.
 */
@Component({
  imports: [DecimalPipe, DepartureTime, StationSection, TripLeg],
  selector: 'app-trip-details',
  styleUrl: './trip-details.scss',
  templateUrl: './trip-details.html',
  host: { '(keydown.escape)': 'closed.emit()' },
})
export class TripDetails {
  readonly trip = input.required<Trip>();
  /** Where the trip ends, to show its OV-fiets count; none when not known. */
  readonly destination = input<Station | null>(null);
  /** Where the trip starts: the origin of its first ride, when NS gave a station code for it. */
  protected readonly departure = computed<Station | null>(() => {
    const leg = this.trip().legs.find((l) => l.travel_type === 'PUBLIC_TRANSIT');
    return leg?.origin_code ? { code: leg.origin_code, name: leg.origin } : null;
  });
  /** The rider closed the details. */
  readonly closed = output();

  protected readonly legs = computed<LegView[]>(() =>
    this.trip().legs.map((leg) => ({
      leg,
      ride: leg.travel_type === 'PUBLIC_TRANSIT',
      departureDelay: minutesLate(leg.departure_planned, leg.departure_actual),
      arrivalDelay: minutesLate(leg.arrival_planned, leg.arrival_actual),
      exitSide: EXIT_SIDES[leg.exit_side ?? ''] ?? '',
      stops: leg.stops.map((stop, i) => stopView(stop, i, leg)),
    })),
  );

  private readonly closeButton = viewChild.required<ElementRef<HTMLButtonElement>>('closeButton');

  private readonly tripUid = computed(() => this.trip().uid);

  constructor() {
    // Move focus into the details whenever another trip opens, so keyboard and screen reader
    // users land on them; Escape or the close button take them back out. Keyed on the uid so a
    // refreshed copy of the same trip leaves focus where it is.
    afterRenderEffect(() => {
      this.tripUid();
      this.closeButton().nativeElement.focus();
    });
  }
}
