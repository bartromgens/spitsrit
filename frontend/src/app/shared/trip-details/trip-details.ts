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
import { Leg, LegStop, Span, Station, Trip, TrainPart } from '../../api/models';
import { Crowding } from '../crowding/crowding';
import { DepartureTime } from '../departure-time/departure-time';
import { FacilityIcon } from '../facility-icon/facility-icon';
import { OvFietsCount } from '../ov-fiets-count/ov-fiets-count';
import { PlatformSign } from '../platform-sign/platform-sign';
import { StationToilet } from '../station-toilet/station-toilet';
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
  /** The NS station code where you board or get off, to look up its toilets; else null. */
  stationCode: string | null;
}

interface LegView {
  leg: Leg;
  ride: boolean;
  departureDelay: number;
  arrivalDelay: number;
  exitSide: string;
  stops: StopView[];
}

// Crowding per carriage, as a level for the signal colours.
const COACH_LEVELS: Record<string, string> = { LOW: 'low', MEDIUM: 'medium', HIGH: 'high' };
const COACH_LABELS: Record<string, string> = { low: 'quiet', medium: 'busy', high: 'very busy' };

/** A span placed along the train, in percent of the train's length. */
interface Placed {
  left: number;
  width: number;
  label: string;
  level: string;
}

/** Places spans along the train: NS's units are unknown, so the coaches set the full length. */
function place(spans: Span[], length: number, label: (span: Span) => string): Placed[] {
  return spans.map((span) => {
    const left = Math.min(100, (span.start / length) * 100);
    return {
      left,
      width: Math.max(1, Math.min(100 - left, (span.width / length) * 100)),
      label: label(span),
      level: COACH_LEVELS[span.kind] ?? 'unknown',
    };
  });
}

function featureLabel(span: Span): string {
  return span.description || span.kind.toLowerCase().replaceAll('_', ' ');
}

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
    stationCode: index === 0 ? leg.origin_code : last ? leg.destination_code : null,
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
    StationToilet,
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
      stops: leg.stops.map((stop, i) => stopView(stop, i, leg)),
    })),
  );

  /** NS's side views of the units in train order, for those that have one. */
  protected readonly images = computed(() =>
    this.trip()
      .train_parts.filter((part) => !!part.image_url)
      .map((part) => ({ url: part.image_url!, other: this.otherPart(part) })),
  );

  /** Whether the units go to different places, so each unit's destination is worth showing. */
  protected readonly destinationsDiffer = computed(
    () => new Set(this.trip().train_parts.map((part) => part.destination ?? '')).size > 1,
  );

  /** The length of the train in NS's layout units: where the last coach ends. */
  private readonly trainLength = computed(() =>
    Math.max(0, ...this.trip().coach_crowding.map((span) => span.start + span.width)),
  );

  protected readonly coaches = computed(() =>
    place(this.trip().coach_crowding, this.trainLength(), (span) => {
      const level = COACH_LEVELS[span.kind];
      return level ? COACH_LABELS[level] : 'unknown';
    }),
  );

  /** Platform features along the train; without coaches there is no scale to place them on. */
  protected readonly platform = computed(() =>
    this.trainLength() > 0
      ? place(this.trip().platform_features, this.trainLength(), featureLabel)
      : [],
  );

  protected readonly platformLabels = computed(() => [
    ...new Set(this.trip().platform_features.map(featureLabel)),
  ]);

  /** A unit that does not go where the rider needs to, once the train splits. */
  protected otherPart(part: TrainPart): boolean {
    const wanted = this.trip().board_destination;
    return !!wanted && !!part.destination && part.destination !== wanted;
  }

  protected readonly imagesLabel = computed(() => {
    const count = this.images().length;
    return `${this.trip().train_type ?? 'Train'}, ${count} unit${count === 1 ? '' : 's'}`;
  });

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

  /** An image that fails to load leaves no broken-image icon or gap in the strip. */
  protected hideImage(event: Event): void {
    (event.target as HTMLElement).hidden = true;
  }
}
