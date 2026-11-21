import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DepartureTime } from './departure-time';

describe('DepartureTime', () => {
  let fixture: ComponentFixture<DepartureTime>;
  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [DepartureTime] }).compileComponents();
    fixture = TestBed.createComponent(DepartureTime);
    fixture.componentRef.setInput('time', '2026-05-01T08:05:00Z');
  });

  it('shows the time as HH:mm', async () => {
    await fixture.whenStable();
    expect(element().querySelector('time')?.textContent).toMatch(/^\d{2}:\d{2}$/);
  });

  it('hides the delay when it is zero', async () => {
    fixture.componentRef.setInput('delayMinutes', 0);
    await fixture.whenStable();
    expect(element().querySelector('.delay')).toBeNull();
  });

  it('shows a positive delay as +N', async () => {
    fixture.componentRef.setInput('delayMinutes', 3);
    await fixture.whenStable();
    expect(element().querySelector('.delay')?.textContent).toContain('+3');
  });
});
