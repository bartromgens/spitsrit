import { Component, computed, input } from '@angular/core';

/**
 * Placeholder rows shaped like trip rows, shown while trips load so the list does not jump when
 * the real rows arrive. Screen readers hear "Loading trips" instead of the empty shapes.
 */
@Component({
  imports: [],
  selector: 'app-trip-list-skeleton',
  styleUrl: './trip-list-skeleton.scss',
  templateUrl: './trip-list-skeleton.html',
  host: { role: 'status', 'data-testid': 'trip-list-skeleton' },
})
export class TripListSkeleton {
  /** How many placeholder rows to show. */
  readonly rows = input(5);

  protected readonly indexes = computed(() => Array.from({ length: this.rows() }, (_, i) => i));
}
