import { Component, inject } from '@angular/core';
import { MatSlideToggle, MatSlideToggleChange } from '@angular/material/slide-toggle';
import { TrainRouteSetting } from '../train-route-setting';

/** The "Show train route" switch shown above a list of trips. */
@Component({
  imports: [MatSlideToggle],
  selector: 'app-train-route-toggle',
  styleUrl: './train-route-toggle.scss',
  templateUrl: './train-route-toggle.html',
})
export class TrainRouteToggle {
  protected readonly setting = inject(TrainRouteSetting);

  protected change(event: MatSlideToggleChange): void {
    this.setting.set(event.checked);
  }
}
