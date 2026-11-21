import { Component, computed, input } from '@angular/core';

/** The platform number as a small square sign, like the ones on station platforms. */
@Component({
  selector: 'app-platform-sign',
  styleUrl: './platform-sign.scss',
  templateUrl: './platform-sign.html',
})
export class PlatformSign {
  readonly track = input<string | null | undefined>('');

  protected readonly label = computed(() => this.track() || '?');
}
