import { Component, computed, input } from '@angular/core';

const LEVELS: Record<string, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };
const LABELS = ['', 'quiet', 'busy', 'very busy'];
const PIPS = [1, 2, 3];

/** The crowd forecast as a row of three person pips: low, medium or high. */
@Component({
  selector: 'app-crowding',
  styleUrl: './crowding.scss',
  templateUrl: './crowding.html',
})
export class Crowding {
  /** The NS crowd forecast: `LOW`, `MEDIUM`, `HIGH`, or anything else for unknown. */
  readonly forecast = input('');

  protected readonly pips = PIPS;
  protected readonly level = computed(() => LEVELS[this.forecast().toUpperCase()] ?? 0);
  protected readonly label = computed(() => LABELS[this.level()]);
}
