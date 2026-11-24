import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { Api } from '../../api/api';
import { stationsOvFietsRetrieve } from '../../api/functions';
import { OvFiets } from '../../api/models';
import { FacilityIcon } from '../facility-icon/facility-icon';
import { visibleInterval } from '../visible-interval/visible-interval';

const REFRESH_MS = 60_000;

interface RentalPoint {
  name: string;
  closed: boolean;
  status: string;
}

/**
 * The rental point's name without the station's: NS writes "Utrecht Centraal Knoop" and
 * "Leiden Centraal, Centrumzijde". Keeps the full name when nothing else is left.
 */
function withoutStation(name: string, station: string): string {
  if (!name.startsWith(station)) {
    return name.trim();
  }
  const rest = name
    .slice(station.length)
    .replace(/^[\s,:–-]+/, '')
    .trim();
  return rest || name.trim();
}

function bikes(count: number): string {
  return count === 1 ? '1 OV-fiets' : `${count} OV-fietsen`;
}

/**
 * How many OV-fiets rental bikes a station has now, in total and per rental point. Shows
 * nothing while loading, when the station has no OV-fiets, or when the count is unavailable:
 * it is extra information that must not get in the way of the trips.
 */
@Component({
  imports: [FacilityIcon],
  selector: 'app-ov-fiets-count',
  styleUrl: './ov-fiets-count.scss',
  templateUrl: './ov-fiets-count.html',
})
export class OvFietsCount {
  readonly stationCode = input.required<string>();
  readonly stationName = input.required<string>();
  /** Whether there is a count to show; follows the data as it loads. */
  readonly present = output<boolean>();

  private readonly data = signal<OvFiets | null>(null);
  private readonly api = inject(Api);

  /** The headline, such as "53 OV-fietsen at Utrecht Centraal"; empty when there is nothing to show. */
  protected readonly summary = computed(() => {
    const data = this.data();
    if (data === null || data.locations.length === 0) {
      return '';
    }
    const at = `at ${this.stationName()}`;
    if (data.locations.every((location) => location.open === 'No')) {
      return `OV-fiets ${at}: closed now`;
    }
    return data.available === null
      ? `OV-fiets ${at}: number unknown`
      : `${bikes(data.available)} ${at}`;
  });

  /** Each rental point, named without the station's name, when the station has more than one. */
  protected readonly points = computed<RentalPoint[]>(() => {
    const locations = this.data()?.locations ?? [];
    if (locations.length < 2) {
      return [];
    }
    return locations.map((location) => ({
      name: withoutStation(location.name, this.stationName()),
      closed: location.open === 'No',
      status:
        location.open === 'No'
          ? 'closed'
          : location.available === null
            ? '?'
            : String(location.available),
    }));
  });

  constructor() {
    effect(() => void this.load(this.stationCode()));
    effect(() => this.present.emit(this.summary() !== ''));
    visibleInterval(() => void this.load(this.stationCode()), REFRESH_MS);
  }

  private async load(code: string): Promise<void> {
    try {
      const found = await this.api.invoke(stationsOvFietsRetrieve, { code });
      if (code === this.stationCode()) {
        this.data.set(found);
      }
    } catch {
      if (code === this.stationCode()) {
        this.data.set(null);
      }
    }
  }
}
