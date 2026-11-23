import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl } from '@angular/forms';
import { TimeControl } from './time-control';
import { TimeModel } from './time-model';

@Component({
  imports: [TimeControl],
  template: `<app-time-control [model]="time" />`,
})
class Host {
  readonly control = new FormControl('09:00', { nonNullable: true });
  readonly time = new TimeModel(this.control);
}

describe('TimeControl', () => {
  let fixture: ComponentFixture<Host>;
  let time: TimeModel;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const input = (): HTMLInputElement =>
    element().querySelector('[data-testid="departure-time"]') as HTMLInputElement;
  const hint = (): string | null =>
    element().querySelector('[data-testid="departure-hint"]')?.textContent?.trim() ?? null;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date(2026, 10, 20, 9, 0));
    fixture = TestBed.createComponent(Host);
    time = fixture.componentInstance.time;
    fixture.detectChanges();
  });

  afterEach(() => vi.useRealTimers());

  it('shows the control value and follows the clock each minute', () => {
    expect(input().value).toBe('09:00');
    vi.advanceTimersByTime(60_000);
    fixture.detectChanges();
    expect(input().value).toBe('09:01');
  });

  it('stops following when the field is edited, and Now follows again', () => {
    input().value = '16:00';
    input().dispatchEvent(new Event('input'));
    expect(time.following()).toBe(false);
    vi.advanceTimersByTime(2 * 60_000);
    expect(time.control.value).toBe('16:00');
    (element().querySelector('[data-testid="time-now"]') as HTMLButtonElement).click();
    expect(time.following()).toBe(true);
    expect(time.control.value).toBe('09:02');
  });

  it('says tomorrow for a passed time, but not while following', () => {
    expect(hint()).toBeNull();
    time.write('07:30', false);
    fixture.detectChanges();
    expect(hint()).toBe('tomorrow');
  });

  it('asks for a time when arriving while following the clock', () => {
    (element().querySelector('[data-testid="mode-arrive"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(time.arrive()).toBe(true);
    expect(hint()).toBe('Pick a time to arrive by');
  });

  it('sends no time params while following, and the chosen time otherwise', () => {
    expect(time.params()).toEqual({});
    time.write('16:00', false);
    expect(time.params()).toEqual({ time: '16:00' });
    time.around.set(true);
    expect(time.params()).toEqual({ time: '16:00', around: true });
    time.arrive.set(true);
    expect(time.params()).toEqual({ time: '16:00', arrive: true });
  });
});
