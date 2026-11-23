import { Component, input } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { TimeModel } from './time-model';

/** The Depart/Arrive switch, the time field and the Now button, with the hint below them. */
@Component({
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  selector: 'app-time-control',
  styleUrl: './time-control.scss',
  templateUrl: './time-control.html',
})
export class TimeControl {
  readonly model = input.required<TimeModel>();
}
