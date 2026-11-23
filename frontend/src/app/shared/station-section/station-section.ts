import { Component, computed, input, signal } from '@angular/core';
import { Station } from '../../api/models';
import { OvFietsCount } from '../ov-fiets-count/ov-fiets-count';
import { StationToilet } from '../station-toilet/station-toilet';

let nextId = 0;

/**
 * What a rider finds at a station: its toilets and, when asked, its OV-fiets count. The heading
 * only shows once there is something to put under it; the parts keep loading meanwhile.
 */
@Component({
  imports: [OvFietsCount, StationToilet],
  selector: 'app-station-section',
  styleUrl: './station-section.scss',
  templateUrl: './station-section.html',
})
export class StationSection {
  readonly station = input.required<Station>();
  /** Also show the OV-fiets count, for where the trip ends. */
  readonly ovFiets = input(false);

  protected readonly headingId = `station-section-${nextId++}`;
  protected readonly hasToilet = signal(false);
  protected readonly hasOvFiets = signal(false);
  protected readonly empty = computed(
    () => !this.hasToilet() && !(this.ovFiets() && this.hasOvFiets()),
  );
}
