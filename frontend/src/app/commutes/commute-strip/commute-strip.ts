import { Component, effect, inject, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Commute } from '../../api/models';
import { Auth } from '../../auth';
import { CommuteStore } from '../commute-store';
import { sortCommutes } from '../commutes';

/** A row of the user's commutes as chips; tapping one reports it so the planner can run it. */
@Component({
  imports: [RouterLink],
  selector: 'app-commute-strip',
  styleUrl: './commute-strip.scss',
  templateUrl: './commute-strip.html',
})
export class CommuteStrip {
  readonly chosen = output<Commute>();

  protected readonly auth = inject(Auth);
  protected readonly commutes = signal<Commute[]>([]);

  private readonly store = inject(CommuteStore);

  constructor() {
    effect(() => {
      // Reload when logging in or out: the commutes come from the account or this browser.
      this.auth.loggedIn();
      void this.load();
    });
  }

  /** "08:05" from the API's "08:05:00". */
  protected time(commute: Commute): string {
    return commute.usual_departure_time?.slice(0, 5) ?? '';
  }

  private async load(): Promise<void> {
    try {
      this.commutes.set(sortCommutes(await this.store.list(), new Date()));
    } catch {
      // The strip is a shortcut; without it the planner still works.
      this.commutes.set([]);
    }
  }
}
