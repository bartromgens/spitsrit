import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'spitsrit.showTrainRoute';

/** Whether trip rows show the train's whole route. One setting for the app, kept in the browser. */
@Injectable({ providedIn: 'root' })
export class TrainRouteSetting {
  private readonly state = signal(this.load());
  readonly show = this.state.asReadonly();

  set(value: boolean): void {
    this.state.set(value);
    try {
      localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
    } catch {
      // Storage can be blocked or full; the setting then only lasts until the page reloads.
    }
  }

  private load(): boolean {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }
}
