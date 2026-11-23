import { Component, DestroyRef, OnInit, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import {
  MatAutocompleteModule,
  MatAutocompleteSelectedEvent,
} from '@angular/material/autocomplete';
import { MatFormFieldModule, SubscriptSizing } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import { Api } from '../../api/api';
import { stationsList } from '../../api/functions';
import { Station } from '../../api/models';

const SEARCH_DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

/**
 * A station field: the text lives in the parent's `control`, and typing in it searches the
 * stations. The chosen option is reported as the autocomplete's own selection event.
 *
 * This is an input/output pair rather than a `ControlValueAccessor`: the forms hold the typed
 * text and the pages keep the picked `Station` beside it, to tell a pick from free text.
 */
@Component({
  imports: [ReactiveFormsModule, MatAutocompleteModule, MatFormFieldModule, MatInputModule],
  selector: 'app-station-autocomplete',
  styleUrl: './station-autocomplete.scss',
  templateUrl: './station-autocomplete.html',
})
export class StationAutocomplete implements OnInit {
  readonly control = input.required<FormControl<string>>();
  readonly label = input.required<string>();
  readonly subscriptSizing = input<SubscriptSizing>('fixed');
  readonly optionSelected = output<MatAutocompleteSelectedEvent>();

  protected readonly options = signal<Station[]>([]);

  private readonly api = inject(Api);
  private readonly destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    this.control()
      .valueChanges.pipe(
        debounceTime(SEARCH_DEBOUNCE_MS),
        distinctUntilChanged(),
        switchMap((q) =>
          q.length < MIN_QUERY_LENGTH
            ? of<Station[]>([])
            : this.api.invoke(stationsList, { q }).catch(() => [] as Station[]),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((found) => this.options.set(found));
  }
}
