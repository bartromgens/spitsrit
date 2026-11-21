import { DatePipe } from '@angular/common';
import { Component, input } from '@angular/core';

/** A departure time in mono, with the delay as `+3` in signal red when there is one. */
@Component({
  imports: [DatePipe],
  selector: 'app-departure-time',
  styleUrl: './departure-time.scss',
  templateUrl: './departure-time.html',
})
export class DepartureTime {
  readonly time = input.required<string>();
  readonly delayMinutes = input(0);
}
