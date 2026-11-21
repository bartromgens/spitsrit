import { Component, input } from '@angular/core';

/** The number of carriages as a large number with a carriage icon; hidden when unknown. */
@Component({
  selector: 'app-carriages',
  styleUrl: './carriages.scss',
  templateUrl: './carriages.html',
})
export class Carriages {
  /** Shown exactly as NS reports it. */
  readonly count = input<number | null | undefined>(null);
}
