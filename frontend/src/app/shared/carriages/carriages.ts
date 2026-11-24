import { Component, computed, input } from '@angular/core';

/** The number of carriages as a large number with a carriage icon; a ? when unknown. */
@Component({
  selector: 'app-carriages',
  styleUrl: './carriages.scss',
  templateUrl: './carriages.html',
})
export class Carriages {
  /** Shown exactly as NS reports it. */
  readonly count = input<number | null | undefined>(null);
  /** One count per train, in order, shown as `8 → 4`; takes the place of `count` when given. */
  readonly counts = input<readonly (number | null | undefined)[] | null>(null);

  protected readonly shown = computed(() => this.counts() ?? [this.count()]);
  protected readonly label = computed(() => {
    const text = this.shown()
      .map((count) => (count ? `${count} carriages` : 'number of carriages unknown'))
      .join(', then ');
    return text.charAt(0).toUpperCase() + text.slice(1);
  });
}
