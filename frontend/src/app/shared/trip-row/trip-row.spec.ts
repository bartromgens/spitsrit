import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Trip } from '../../api/models';
import { TripRow } from './trip-row';

const trip: Trip = {
  uid: 'a',
  departure_planned: '2026-05-01T08:00:00Z',
  departure_actual: '2026-05-01T08:00:00Z',
  departure_delay_minutes: 0,
  arrival_planned: '2026-05-01T08:30:00Z',
  arrival_actual: '2026-05-01T08:30:00Z',
  arrival_delay_minutes: 0,
  duration_minutes: 30,
  transfers: 0,
  departure_track: '5',
  status: 'NORMAL',
  cancelled: false,
  crowd_forecast: 'HIGH',
  train: 'IC 2736',
  seats: 620,
  units: 4,
  train_type: 'VIRM',
  shorter_stock: null,
  shorter_stock_warning: null,
};

describe('TripRow', () => {
  let fixture: ComponentFixture<TripRow>;
  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const render = async (changes: Partial<Trip>, inputs: Record<string, boolean> = {}) => {
    fixture.componentRef.setInput('trip', { ...trip, ...changes });
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TripRow] }).compileComponents();
    fixture = TestBed.createComponent(TripRow);
  });

  it('shows the train, its seats, platform sign and crowding', async () => {
    await render({});
    expect(element().textContent).toContain('IC 2736');
    expect(element().textContent).toContain('~620 seats');
    expect(element().querySelector('.shorter')).toBeNull();
    expect(element().querySelector('.sign')?.textContent).toBe('5');
    expect(element().querySelectorAll('.pip.filled')).toHaveLength(3);
    expect(element().textContent).toContain('30 min');
  });

  it('hides the size when unknown and flags a shorter train', async () => {
    await render({ seats: null, shorter_stock: 'BUSY', shorter_stock_warning: 'Kortere trein' });
    expect(element().textContent).not.toContain('seats');
    expect(element().querySelector('.shorter')?.getAttribute('title')).toBe('Kortere trein');
  });

  it('shows a departure delay only when the train is late', async () => {
    await render({});
    expect(element().querySelector('app-departure-time .delay')).toBeNull();
    await render({ departure_delay_minutes: 4 });
    expect(element().querySelector('app-departure-time .delay')?.textContent).toContain('+4');
  });

  it('shows the arrival delay only when asked to', async () => {
    await render({ arrival_delay_minutes: 6 });
    expect(element().textContent).not.toContain('(+6)');
    await render({ arrival_delay_minutes: 6 }, { arrivalDelay: true });
    expect(element().textContent).toContain('(+6)');
  });

  it('marks the recommended trip with a signal', async () => {
    await render({});
    expect(element().querySelector('.signal')).toBeNull();
    await render({}, { recommended: true });
    expect(element().querySelector('.signal')).not.toBeNull();
  });

  it('shows cancelled trips as cancelled without details', async () => {
    await render({ cancelled: true });
    expect(element().textContent).toContain('Cancelled');
    expect(element().textContent).not.toContain('IC 2736');
  });

  it('pluralises transfers', async () => {
    await render({ transfers: 1 });
    expect(element().textContent).toMatch(/1 transfer(?!s)/);
    await render({ transfers: 2 });
    expect(element().textContent).toContain('2 transfers');
  });
});
