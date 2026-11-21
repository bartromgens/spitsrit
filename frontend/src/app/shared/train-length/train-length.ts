import { Component, computed, input } from '@angular/core';

const MAX_CARS = 12;

/** The train length as a row of little cars, with the number of units next to it. */
@Component({
  selector: 'app-train-length',
  styleUrl: './train-length.scss',
  templateUrl: './train-length.html',
})
export class TrainLength {
  readonly length = input<number | null | undefined>(null);

  protected readonly cars = computed(() =>
    Array.from({ length: Math.min(this.length() ?? 0, MAX_CARS) }, (_, i) => i),
  );
}
