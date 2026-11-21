import { Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { Api } from '../../api/api';
import { stationsOvFietsRetrieve } from '../../api/functions';
import { OvFiets } from '../../api/models';
import { FacilityIcon } from '../facility-icon/facility-icon';

const REFRESH_MS = 60_000;

interface RentalPoint {
  name: string;
  status: string;
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

  private readonly data = signal<OvFiets | null>(null);
  private readonly api = inject(Api);

  /** The headline, such as "53 OV-fietsen at Utrecht Centraal"; empty when there is nothing to show. */
  protected readonly summary = computed(() => {
    const data = this.data();
    if (data === null || data.locations.length === 0) {
      return '';
    }
    const at = `at ${this.stationName()}`;
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
    const prefix = `${this.stationName()} `;
    return locations.map((location) => ({
      name: location.name.startsWith(prefix) ? location.name.slice(prefix.length) : location.name,
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
    const timer = setInterval(() => void this.load(this.stationCode()), REFRESH_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
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
