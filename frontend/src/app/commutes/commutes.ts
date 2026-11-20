import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  MatAutocompleteModule,
  MatAutocompleteSelectedEvent,
} from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import { Api } from '../api/api';
import { commutesCreate, commutesDestroy, commutesList, stationsList } from '../api/functions';
import { Commute, Station } from '../api/models';
import { CommuteBoard } from './commute-board';

const SEARCH_DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

@Component({
  imports: [
    ReactiveFormsModule,
    MatAutocompleteModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    CommuteBoard,
  ],
  selector: 'app-commutes',
  styleUrl: './commutes.scss',
  templateUrl: './commutes.html',
})
export class Commutes {
  protected readonly commutes = signal<Commute[]>([]);
  protected readonly loaded = signal(false);
  protected readonly error = signal('');
  protected readonly originOptions = signal<Station[]>([]);
  protected readonly destinationOptions = signal<Station[]>([]);

  protected readonly form = inject(NonNullableFormBuilder).group({
    name: ['', Validators.required],
    origin: ['', Validators.required],
    destination: ['', Validators.required],
    usualTime: [''],
  });

  private readonly api = inject(Api);
  private origin: Station | null = null;
  private destination: Station | null = null;

  constructor() {
    void this.load();
    this.search('origin', this.originOptions);
    this.search('destination', this.destinationOptions);
  }

  protected pick(side: 'origin' | 'destination', event: MatAutocompleteSelectedEvent): void {
    const station = event.option.value as Station;
    if (side === 'origin') {
      this.origin = station;
    } else {
      this.destination = station;
    }
    this.form.controls[side].setValue(station.name, { emitEvent: false });
  }

  protected async add(): Promise<void> {
    const { name, origin, destination, usualTime } = this.form.getRawValue();
    if (
      this.form.invalid ||
      this.origin?.name !== origin ||
      this.destination?.name !== destination
    ) {
      this.error.set('Pick both stations from the suggestions.');
      return;
    }
    if (this.origin.code === this.destination.code) {
      this.error.set('Origin and destination must differ.');
      return;
    }
    try {
      const created = await this.api.invoke(commutesCreate, {
        body: {
          name,
          origin_code: this.origin.code,
          origin_name: this.origin.name,
          destination_code: this.destination.code,
          destination_name: this.destination.name,
          usual_departure_time: usualTime ? `${usualTime}:00` : null,
        },
      });
      this.commutes.update((all) => [...all, created]);
      this.form.reset();
      this.origin = null;
      this.destination = null;
      this.error.set('');
    } catch {
      this.error.set('The commute could not be saved.');
    }
  }

  protected async remove(commute: Commute): Promise<void> {
    try {
      await this.api.invoke(commutesDestroy, { id: String(commute.id) });
      this.commutes.update((all) => all.filter((c) => c.id !== commute.id));
    } catch {
      this.error.set('The commute could not be deleted.');
    }
  }

  private async load(): Promise<void> {
    try {
      this.commutes.set((await this.api.invoke(commutesList)).results);
    } catch {
      this.error.set('Your commutes could not be loaded.');
    }
    this.loaded.set(true);
  }

  private search(side: 'origin' | 'destination', options: typeof this.originOptions): void {
    this.form.controls[side].valueChanges
      .pipe(
        debounceTime(SEARCH_DEBOUNCE_MS),
        distinctUntilChanged(),
        switchMap((q) =>
          q.length < MIN_QUERY_LENGTH
            ? of<Station[]>([])
            : this.api.invoke(stationsList, { q }).catch(() => [] as Station[]),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((found) => options.set(found));
  }
}
