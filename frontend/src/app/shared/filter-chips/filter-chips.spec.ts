import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FilterChips } from './filter-chips';

@Component({
  imports: [FilterChips],
  template: `<app-filter-chips
    [maxDuration]="duration()"
    [maxTransfers]="transfers()"
    (chosen)="chosen = chosen + 1"
  />`,
})
class Host {
  readonly duration = signal<number | null>(null);
  readonly transfers = signal<number | null>(null);
  chosen = 0;
}

describe('FilterChips', () => {
  let fixture: ComponentFixture<Host>;

  const chips = (): string[] =>
    Array.from<HTMLElement>(
      fixture.nativeElement.querySelectorAll('[data-testid="filter-chip"]'),
    ).map((el) => el.textContent?.trim() ?? '');

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  it('shows nothing without active filters', () => {
    expect(chips()).toEqual([]);
    expect(fixture.nativeElement.querySelector('ul')).toBeNull();
  });

  it('labels the active filters', async () => {
    fixture.componentInstance.duration.set(90);
    fixture.componentInstance.transfers.set(0);
    await fixture.whenStable();
    expect(chips()).toEqual(['Max 90 min', 'Direct only']);

    fixture.componentInstance.transfers.set(1);
    await fixture.whenStable();
    expect(chips()[1]).toBe('Max 1 transfer');

    fixture.componentInstance.transfers.set(2);
    await fixture.whenStable();
    expect(chips()[1]).toBe('Max 2 transfers');
  });

  it('emits chosen when a chip is tapped', async () => {
    fixture.componentInstance.transfers.set(0);
    await fixture.whenStable();
    fixture.nativeElement.querySelector('[data-testid="filter-chip"]').click();
    expect(fixture.componentInstance.chosen).toBe(1);
  });
});
