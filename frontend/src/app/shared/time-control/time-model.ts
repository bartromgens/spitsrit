import { DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl } from '@angular/forms';

const MINUTE_MS = 60_000;

/** The time of day as `HH:mm`, as a time input shows it. */
export function clock(now: Date): string {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

/** Whether a `HH:MM` time of day has already passed today, to the minute. */
export function isEarlierThanNow(time: string, now: Date): boolean {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes < now.getHours() * 60 + now.getMinutes();
}

/**
 * The state behind `app-time-control`: the `HH:mm` control, whether it follows the clock, and
 * whether it is a departure or an arrival time. Create it in an injection context; it stops with it.
 */
export class TimeModel {
  /** Whether the field follows the clock; planning then sends no time, so it is "now". */
  readonly following = signal(true);
  /** Whether the time came from a commute chip, so the results are "around" it. */
  readonly around = signal(false);
  /** Whether the time is when to arrive instead of when to leave. */
  readonly arrive = signal(false);

  private readonly value;
  /** Whether the chosen time is earlier than now, so the plan is for tomorrow. */
  readonly tomorrow = computed(() => {
    const time = this.value();
    return !this.following() && time !== '' && isEarlierThanNow(time, new Date());
  });
  /** Arriving by needs a chosen time: while following the clock there is nothing to arrive by. */
  readonly needsTime = computed(() => this.arrive() && (this.following() || this.value() === ''));

  /** Set while the model itself writes the time, so that is not taken for an edit. */
  private writing = false;
  private readonly destroyRef = inject(DestroyRef);

  constructor(readonly control: FormControl<string>) {
    this.value = toSignal(control.valueChanges, { initialValue: control.value });
    // An edit of the field stops it following the clock and ends "around" planning.
    control.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (this.writing) return;
      this.following.set(false);
      this.around.set(false);
    });
    this.tick();
  }

  /** Puts the field back to following the clock. */
  followNow(): void {
    this.write(clock(new Date()), true);
  }

  /** Shows a time, either following the clock or fixed. */
  write(time: string, following: boolean): void {
    this.writing = true;
    this.control.setValue(time);
    this.writing = false;
    this.following.set(following);
    this.around.set(false);
  }

  /** The time parameters of a plan request: none while following the clock. */
  params(): { time?: string; around?: boolean; arrive?: boolean } {
    const time = this.control.value;
    if (this.following() || time === '') return {};
    if (this.arrive()) return { time, arrive: true };
    return this.around() ? { time, around: true } : { time };
  }

  /** Keeps the field on the clock: refreshes it at the start of every minute while following. */
  private tick(): void {
    const timer = setTimeout(
      () => {
        if (this.following()) this.followNow();
        this.tick();
      },
      MINUTE_MS - (Date.now() % MINUTE_MS),
    );
    this.destroyRef.onDestroy(() => clearTimeout(timer));
  }
}
