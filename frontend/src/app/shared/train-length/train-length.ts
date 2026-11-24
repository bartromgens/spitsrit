import { Component, input } from '@angular/core';

/**
 * The train size as a small seat icon and count with the train type in small text, and a
 * warning badge when NS says the train is shorter than usual. Hides itself when the size
 * is unknown, unless there is a shorter-train warning.
 */
@Component({
  selector: 'app-train-length',
  styleUrl: './train-length.scss',
  templateUrl: './train-length.html',
})
export class TrainLength {
  readonly seats = input<number | null | undefined>(null);
  /** The seats are the lowest of several trains, so they are read out as a minimum. */
  readonly atLeast = input(false);
  readonly trainType = input<string | null | undefined>(null);
  readonly shorterStock = input<string | null | undefined>(null);
  readonly shorterStockWarning = input<string | null | undefined>(null);
}
