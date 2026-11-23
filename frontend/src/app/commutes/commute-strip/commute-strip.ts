import { Component, effect, inject, output, signal } from '@angular/core';
import { MatChipsModule } from '@angular/material/chips';
import { RouterLink } from '@angular/router';
import { Api } from '../../api/api';
import { commutesList } from '../../api/functions';
import { Commute } from '../../api/models';
import { Auth } from '../../auth';
import { sortCommutes } from '../commutes';

/** A row of the user's commutes as chips; tapping one reports it so the planner can run it. */
@Component({
  imports: [MatChipsModule, RouterLink],
  selector: 'app-commute-strip',
  styleUrl: './commute-strip.scss',
  templateUrl: './commute-strip.html',
})
export class CommuteStrip {
  readonly chosen = output<Commute>();

  protected readonly auth = inject(Auth);
  protected readonly commutes = signal<Commute[]>([]);

  private readonly api = inject(Api);

  constructor() {
    effect(() => {
      if (this.auth.loggedIn()) {
        void this.load();
      } else {
        this.commutes.set([]);
      }
    });
  }

  /** "08:05" from the API's "08:05:00". */
  protected time(commute: Commute): string {
    return commute.usual_departure_time?.slice(0, 5) ?? '';
  }

  private async load(): Promise<void> {
    try {
      this.commutes.set(sortCommutes((await this.api.invoke(commutesList)).results, new Date()));
    } catch {
      // The strip is a shortcut; without it the planner still works.
      this.commutes.set([]);
    }
  }
}
