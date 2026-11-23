import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { Api } from '../../api/api';
import { stationsToiletsRetrieve } from '../../api/functions';
import { StationToilets } from '../../api/models';
import { FacilityIcon } from '../facility-icon/facility-icon';

/**
 * A toilet icon when a station has a public toilet, marked "closed" when every toilet there is
 * closed now. Shows nothing while loading, without a toilet, or when NS cannot tell.
 */
@Component({
  imports: [FacilityIcon],
  selector: 'app-station-toilet',
  styleUrl: './station-toilet.scss',
  templateUrl: './station-toilet.html',
})
export class StationToilet {
  /** The NS station code, such as `UT`. */
  readonly stationCode = input.required<string>();
  /** Spell it out ("Toilets", "Toilets · closed") instead of the bare icon. */
  readonly labelled = input(false);
  /** Whether there is a toilet to show; follows the data as it loads. */
  readonly present = output<boolean>();

  private readonly data = signal<StationToilets | null>(null);
  private readonly api = inject(Api);

  /** `open` when a toilet may be open now, `closed` when all are closed, `null` for none. */
  protected readonly state = computed<'open' | 'closed' | null>(() => {
    const toilets = this.data()?.toilets ?? [];
    if (toilets.length === 0) {
      return null;
    }
    return toilets.every((toilet) => toilet.open === 'No') ? 'closed' : 'open';
  });

  constructor() {
    effect(() => void this.load(this.stationCode()));
    effect(() => this.present.emit(this.state() !== null));
  }

  private async load(code: string): Promise<void> {
    let found: StationToilets | null = null;
    try {
      found = await this.api.invoke(stationsToiletsRetrieve, { code });
    } catch {
      // Toilets are extra information: without them the stop shows as before.
    }
    if (code === this.stationCode()) {
      this.data.set(found);
    }
  }
}
