import { Component, computed, input } from '@angular/core';
import { Leg, Span, TrainPart } from '../../api/models';
import { FacilityIcon } from '../facility-icon/facility-icon';
import { TrainLength } from '../train-length/train-length';

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

let nextId = 0;

/**
 * The "Your train" section of a train leg: seats, carriages and units, the train drawing with its
 * crowding and platform features, and each unit with its facilities.
 */
@Component({
  imports: [FacilityIcon, TrainLength],
  selector: 'app-trip-train',
  styleUrl: './trip-train.scss',
  templateUrl: './trip-train.html',
})
export class TripTrain {
  /** The train leg to show; each leg of a trip has its own train. */
  readonly leg = input.required<Leg>();

  /** Unique per instance: a trip with transfers shows several of these at once. */
  protected readonly headingId = `train-heading-${nextId++}`;

  /** NS's side views of the units in train order, for those that have one. */
  protected readonly images = computed(() =>
    this.leg()
      .train_parts.filter((part) => !!part.image_url)
      .map((part) => ({ url: part.image_url!, other: this.otherPart(part) })),
  );

  /** Whether the units go to different places, so each unit's destination is worth showing. */
  protected readonly destinationsDiffer = computed(
    () => new Set(this.leg().train_parts.map((part) => part.destination ?? '')).size > 1,
  );

  /** The length of the train in NS's layout units: where the last coach ends. */
  private readonly trainLength = computed(() =>
    Math.max(0, ...this.leg().coach_crowding.map((span) => span.start + span.width)),
  );

  protected readonly coaches = computed(() =>
    place(this.leg().coach_crowding, this.trainLength(), (span) => {
      const level = COACH_LEVELS[span.kind];
      return level ? COACH_LABELS[level] : 'unknown';
    }),
  );

  /** Platform features along the train; without coaches there is no scale to place them on. */
  protected readonly platform = computed(() =>
    this.trainLength() > 0
      ? place(this.leg().platform_features, this.trainLength(), featureLabel)
      : [],
  );

  protected readonly platformLabels = computed(() => [
    ...new Set(this.leg().platform_features.map(featureLabel)),
  ]);

  protected readonly imagesLabel = computed(() => {
    const count = this.images().length;
    return `${this.leg().train_type ?? 'Train'}, ${count} unit${count === 1 ? '' : 's'}`;
  });

  /** A unit that does not go where the rider needs to, once the train splits. */
  protected otherPart(part: TrainPart): boolean {
    const wanted = this.leg().board_destination;
    return !!wanted && !!part.destination && part.destination !== wanted;
  }

  /** An image that fails to load leaves no broken-image icon or gap in the strip. */
  protected hideImage(event: Event): void {
    (event.target as HTMLElement).hidden = true;
  }
}
