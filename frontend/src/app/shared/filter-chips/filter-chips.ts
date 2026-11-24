import { Component, computed, input, output } from '@angular/core';

/** Chips for the active trip filters; tapping one asks the owner to open its filter fields. */
@Component({
  selector: 'app-filter-chips',
  styleUrl: './filter-chips.scss',
  templateUrl: './filter-chips.html',
})
export class FilterChips {
  readonly maxDuration = input<number | null>(null);
  readonly maxTransfers = input<number | null>(null);
  readonly chosen = output<void>();

  protected readonly chips = computed(() => {
    const chips: string[] = [];
    const duration = this.maxDuration();
    const transfers = this.maxTransfers();
    if (duration !== null) {
      chips.push(`Max ${duration} min`);
    }
    if (transfers !== null) {
      chips.push(
        transfers === 0
          ? 'Direct only'
          : `Max ${transfers} ${transfers === 1 ? 'transfer' : 'transfers'}`,
      );
    }
    return chips;
  });
}
