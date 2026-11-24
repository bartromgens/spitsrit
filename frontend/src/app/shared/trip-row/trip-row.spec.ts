import { formatDate } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Leg, Trip } from '../../api/models';
import { TripRow } from './trip-row';

const leg: Leg = {
  travel_type: 'PUBLIC_TRANSIT',
  name: 'IC 2736',
  category: 'Intercity',
  operator: 'NS',
  direction: null,
  origin: 'Nijmegen',
  origin_code: 'NM',
  departure_planned: '2026-05-01T08:00:00Z',
  departure_actual: '2026-05-01T08:00:00Z',
  departure_track: '5',
  departure_track_changed: false,
  destination: 'Den Haag C.',
  destination_code: 'GVC',
  arrival_planned: '2026-05-01T08:30:00Z',
  arrival_actual: '2026-05-01T08:30:00Z',
  arrival_track: '3',
  arrival_track_changed: false,
  exit_side: null,
  cancelled: false,
  crowd_forecast: 'LOW',
  punctuality: null,
  stops: [],
  notes: [],
  messages: [],
  transfer_messages: [],
  bicycle_spots: null,
  shorter_stock_warning: null,
  seats: null,
  carriages: null,
  train_type: null,
  train_origin: null,
  train_parts: [],
  coach_crowding: [],
  platform_features: [],
  split_stations: [],
  board_destination: null,
};

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
  train_parts: [],
  punctuality: null,
  messages: [],
  legs: [],
  coach_crowding: [],
  platform_features: [],
  split_stations: [],
  board_destination: null,
  min_seats: 620,
};

// The pipe shows times in the runner's timezone; derive the expectation the same way.
const ARRIVES = formatDate(trip.arrival_actual, 'HH:mm', 'en-US');

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
    await render({
      min_seats: null,
      shorter_stock: 'BUSY',
      shorter_stock_warning: 'Kortere trein',
    });
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
    expect(mono).toEqual(['8', '620', ARRIVES, '30', '1']);
    expect(element().querySelector('.journey')?.classList.contains('sp-mono')).toBe(false);
  });

  it('keeps each journey value on one line', async () => {
    await render({ transfers: 1 });
    const values = Array.from(element().querySelectorAll('.arrival, .duration, .transfers')).map(
      (el) => el.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(values).toEqual([`arrives ${ARRIVES}`, '30 min', '1 transfer']);
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
    await render({ carriages: null, min_seats: null });
    expect(element().querySelector('app-carriages')).toBeNull();
    expect(element().querySelector('.seats')).toBeNull();
  });

  describe('with transfers', () => {
    const ride = (carriages: number | null): Leg => ({
      ...leg,
      carriages,
    });
    const counts = (): string[] =>
      Array.from(element().querySelectorAll('app-carriages .count')).map((c) => c.textContent!);

    it('shows every train in order: 8 → 4', async () => {
      await render({ transfers: 1, legs: [ride(8), ride(4)] });
      expect(counts()).toEqual(['8', '4']);
      expect(
        element().querySelector('app-carriages .counts')?.textContent?.replace(/\s+/g, ' '),
      ).toBe('8→4');
      expect(
        element().querySelector('app-carriages [role="img"]')?.getAttribute('aria-label'),
      ).toBe('8 carriages, then 4 carriages');
    });

    it('shows three trains without wrapping', async () => {
      await render({ transfers: 2, legs: [ride(8), ride(4), ride(6)] });
      expect(counts()).toEqual(['8', '4', '6']);
      expect(element().querySelector('app-carriages .multi')).not.toBeNull();
      expect(element().querySelector('.load')?.children).toHaveLength(2);
    });

    it('shows a ? for a train of unknown size', async () => {
      await render({ transfers: 1, legs: [ride(8), ride(null)] });
      expect(counts()).toEqual(['8', '?']);
    });

    it('hides the carriages when every train is unknown', async () => {
      await render({ transfers: 1, legs: [ride(null), ride(null)] });
      expect(element().querySelector('app-carriages')).toBeNull();
    });

    it('ignores walks between the trains', async () => {
      await render({
        transfers: 1,
        legs: [ride(8), { ...leg, travel_type: 'WALK', carriages: null }, ride(4)],
      });
      expect(counts()).toEqual(['8', '4']);
    });

    it('shows the lowest seat count, read out as a minimum', async () => {
      await render({ transfers: 1, legs: [ride(8), ride(4)], seats: 740, min_seats: 366 });
      const seats = element().querySelector('.seats');
      expect(seats?.getAttribute('aria-label')).toBe('at least 366 seats');
      expect(seats?.textContent).toContain('366');
    });

    it('keeps the first train type', async () => {
      await render({ transfers: 1, legs: [ride(8), ride(4)], train_type: 'VIRM', min_seats: 366 });
      expect(element().querySelector('.type')?.textContent).toBe('VIRM');
    });

    it('does not say at least for a direct trip', async () => {
      await render({ legs: [ride(8)] });
      expect(element().querySelector('.seats')?.getAttribute('aria-label')).toBe('620 seats');
    });
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
