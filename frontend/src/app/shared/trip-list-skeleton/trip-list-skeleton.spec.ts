import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TripListSkeleton } from './trip-list-skeleton';

describe('TripListSkeleton', () => {
  let fixture: ComponentFixture<TripListSkeleton>;

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [TripListSkeleton] });
    fixture = TestBed.createComponent(TripListSkeleton);
    await fixture.whenStable();
  });

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;

  it('shows five placeholder rows by default', () => {
    expect(el().querySelectorAll('li')).toHaveLength(5);
  });

  it('shows as many rows as asked for', async () => {
    fixture.componentRef.setInput('rows', 2);
    await fixture.whenStable();
    expect(el().querySelectorAll('li')).toHaveLength(2);
  });

  it('announces loading to screen readers and hides the empty shapes from them', () => {
    expect(el().getAttribute('role')).toBe('status');
    expect(el().textContent).toContain('Loading trips');
    expect(el().querySelector('ul')?.getAttribute('aria-hidden')).toBe('true');
  });
});
