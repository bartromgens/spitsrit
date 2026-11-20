import { DatePipe } from '@angular/common';
import {
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { Api } from '../api/api';
import { commutesTripsRetrieve } from '../api/functions';
import { Commute, CommuteTrips } from '../api/models';

const REFRESH_MS = 60_000;

/** Live upcoming trips for one commute, with the trip to take highlighted. */
@Component({
  imports: [DatePipe, MatButtonModule, MatCardModule, MatChipsModule],
  selector: 'app-commute-board',
  styleUrl: './commute-board.scss',
  templateUrl: './commute-board.html',
})
export class CommuteBoard implements OnInit {
  readonly commute = input.required<Commute>();
  readonly removed = output<Commute>();

  protected readonly data = signal<CommuteTrips | null>(null);
  protected readonly error = signal('');

  protected readonly advice = computed(() => {
    const data = this.data();
    if (data === null) {
      return '';
    }
    if (data.recommended_uid === null || data.wait_minutes === null) {
      return 'No trip available right now';
    }
    return data.wait_minutes === 0 ? 'Leave now' : `Wait ${data.wait_minutes} min`;
  });

  private readonly api = inject(Api);
  private readonly destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    void this.refresh();
    const timer = setInterval(() => void this.refresh(), REFRESH_MS);
    this.destroyRef.onDestroy(() => clearInterval(timer));
  }

  protected async refresh(): Promise<void> {
    try {
      this.data.set(
        await this.api.invoke(commutesTripsRetrieve, { id: String(this.commute().id) }),
      );
      this.error.set('');
    } catch {
      this.error.set('Train times are unavailable right now.');
    }
  }
}
