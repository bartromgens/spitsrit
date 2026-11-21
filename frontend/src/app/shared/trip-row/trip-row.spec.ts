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
  carriages: 8,
  train_type: 'VIRM',
  shorter_stock: null,
  shorter_stock_warning: null,
  train_origin: 'Nijmegen',
  train_destination: 'Den Haag C.',
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

  it('shows the train type, its seats, platform sign and crowding', async () => {
    await render({});
    expect(element().querySelector('.train')?.textContent).toBe('IC');
    expect(element().querySelector('.train')?.getAttribute('title')).toBe('Intercity');
    expect(element().querySelector('.seats')?.getAttribute('aria-label')).toBe('620 seats');
    expect(element().querySelector('.shorter')).toBeNull();
    expect(element().querySelector('.sign')?.textContent).toBe('5');
    expect(element().querySelectorAll('.pip.filled')).toHaveLength(3);
    expect(element().textContent).toContain('30 min');
  });

  it('hides the size when unknown and flags a shorter train', async () => {
    await render({ seats: null, shorter_stock: 'BUSY', shorter_stock_warning: 'Kortere trein' });
    expect(element().querySelector('.seats')).toBeNull();
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

  // The green dot column was removed (it shifted the row); the highlight now comes from the
  // list item, so only a screen-reader label marks the recommended trip.
  it('announces the recommended trip without adding a column', async () => {
    await render({});
    expect(element().textContent).not.toContain('Recommended');
    const columns = (): string[] =>
      Array.from(element().children)
        .filter((child) => !child.classList.contains('sr-only'))
        .map((child) => `${child.tagName}.${child.className}`);
    const normal = columns();
    await render({}, { recommended: true });
    expect(element().textContent).toContain('Recommended');
    expect(columns()).toEqual(normal);
    expect(element().querySelector('.signal')).toBeNull();
  });

  it('uses mono only for numbers', async () => {
    await render({ transfers: 1 });
    const mono = Array.from(element().querySelectorAll('.sp-mono')).map((el) => el.textContent);
    expect(mono).toEqual(['8', '620', '08:30', '30', '1']);
    expect(element().querySelector('.journey')?.classList.contains('sp-mono')).toBe(false);
  });

  it('keeps each journey value on one line', async () => {
    await render({ transfers: 1 });
    const values = Array.from(element().querySelectorAll('.arrival, .duration, .transfers')).map(
      (el) => el.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(values).toEqual(['arrives 08:30', '30 min', '1 transfer']);
  });

  it('shows cancelled trips as cancelled without details', async () => {
    await render({ cancelled: true });
    expect(element().textContent).toContain('Cancelled');
    expect(element().querySelector('.train')).toBeNull();
  });

  it('shows the train type but never the train number', async () => {
    await render({});
    expect(element().textContent).not.toContain('2736');
    await render({ train: 'SPR 5' });
    expect(element().querySelector('.train')?.textContent).toBe('SPR');
    expect(element().querySelector('.train')?.getAttribute('title')).toBe('Sprinter');
    await render({ train: 'ICE 12' });
    expect(element().querySelector('.train')?.textContent).toBe('ICE');
    expect(element().querySelector('.train')?.getAttribute('title')).toBeNull();
  });

  it('shows the carriages as a labelled icon next to the crowding, as reported', async () => {
    await render({ carriages: 4 });
    const load = element().querySelector('.load');
    expect(load?.querySelector('app-crowding')).not.toBeNull();
    expect(load?.querySelector('app-carriages svg')).not.toBeNull();
    expect(load?.querySelector('app-carriages .count')?.textContent).toBe('4');
    expect(load?.querySelector('[aria-label="4 carriages"]')).not.toBeNull();
    expect(element().textContent).not.toContain('carriages');
  });

  it('hides the carriages and the seats when unknown', async () => {
    await render({ carriages: null, seats: null });
    expect(element().querySelector('app-carriages svg')).toBeNull();
    expect(element().querySelector('.seats')).toBeNull();
  });

  it('shows the seats with an icon and the train type', async () => {
    await render({});
    expect(element().querySelector('.seats svg')).not.toBeNull();
    expect(element().querySelector('.type')?.textContent).toBe('VIRM');
  });

  it('always shows the train route when it is known', async () => {
    await render({});
    expect(element().querySelector('.route')?.textContent).toBe('Nijmegen → Den Haag C.');
    await render({ train_origin: null });
    expect(element().querySelector('.route')).toBeNull();
    await render({ train_origin: 'Nijmegen', train_destination: null });
    expect(element().querySelector('.route')).toBeNull();
  });

  it('pluralises transfers', async () => {
    await render({ transfers: 1 });
    expect(element().textContent).toMatch(/1 transfer(?!s)/);
    await render({ transfers: 2 });
    expect(element().textContent).toContain('2 transfers');
  });
});
