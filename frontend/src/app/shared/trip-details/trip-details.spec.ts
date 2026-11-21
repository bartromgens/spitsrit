import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Leg, Trip } from '../../api/models';
import { TripDetails } from './trip-details';

const ride: Leg = {
  travel_type: 'PUBLIC_TRANSIT',
  name: 'IC 2136',
  category: 'Intercity',
  operator: 'NS',
  direction: 'Den Haag Centraal',
  origin: 'Utrecht Centraal',
  departure_planned: '2026-11-20T08:00:00Z',
  departure_actual: '2026-11-20T08:02:00Z',
  departure_track: '7',
  departure_track_changed: true,
  destination: 'Gouda',
  arrival_planned: '2026-11-20T08:18:00Z',
  arrival_actual: '2026-11-20T08:18:00Z',
  arrival_track: '3',
  arrival_track_changed: false,
  exit_side: 'RIGHT',
  cancelled: false,
  crowd_forecast: 'HIGH',
  punctuality: 87.5,
  stops: [
    {
      name: 'Utrecht Centraal',
      arrival_planned: null,
      arrival_actual: null,
      departure_planned: '2026-11-20T08:00:00Z',
      departure_actual: '2026-11-20T08:02:00Z',
      track: '7',
      track_changed: true,
      passing: false,
      cancelled: false,
    },
    {
      name: 'Woerden',
      arrival_planned: null,
      arrival_actual: null,
      departure_planned: null,
      departure_actual: null,
      track: null,
      track_changed: false,
      passing: true,
      cancelled: false,
    },
    {
      name: 'Gouda',
      arrival_planned: '2026-11-20T08:18:00Z',
      arrival_actual: '2026-11-20T08:18:00Z',
      departure_planned: null,
      departure_actual: null,
      track: '3',
      track_changed: false,
      passing: false,
      cancelled: false,
    },
  ],
  notes: ['Reserveren niet nodig'],
  messages: ['Werkzaamheden - Minder treinen'],
  transfer_messages: ['Overstap op hetzelfde perron'],
  shorter_stock_warning: null,
  bicycle_spots: 6,
};

const walk: Leg = {
  ...ride,
  travel_type: 'WALK',
  name: 'Lopen',
  category: null,
  origin: 'Gouda',
  destination: 'Gouda Goverwelle',
  stops: [],
  notes: [],
  messages: [],
  transfer_messages: [],
};

const trip: Trip = {
  uid: 'a',
  departure_planned: '2026-11-20T08:00:00Z',
  departure_actual: '2026-11-20T08:02:00Z',
  arrival_planned: '2026-11-20T08:30:00Z',
  arrival_actual: '2026-11-20T08:30:00Z',
  departure_delay_minutes: 2,
  arrival_delay_minutes: 0,
  duration_minutes: 28,
  departure_track: '7',
  transfers: 1,
  status: 'NORMAL',
  cancelled: false,
  crowd_forecast: 'HIGH',
  train: 'IC 2136',
  seats: 740,
  carriages: 8,
  train_type: 'VIRM',
  shorter_stock: null,
  shorter_stock_warning: null,
  train_origin: 'Utrecht Centraal',
  train_destination: 'Den Haag Centraal',
  train_parts: [
    {
      stock_identifier: '9469',
      facilities: ['WIFI', 'STILTE', 'NEW_THING'],
      image_url: 'https://vt.ns-mlab.nl/v1/images/virmm1_4.png',
      destination: null,
    },
    { stock_identifier: '9596', facilities: [], image_url: null, destination: null },
  ],
  punctuality: 90,
  messages: ['Storing tussen Gouda en Rotterdam'],
  legs: [ride, walk],
  coach_crowding: [],
  platform_features: [],
  split_stations: [],
  combine_stations: [],
  board_destination: null,
};

describe('TripDetails', () => {
  let fixture: ComponentFixture<TripDetails>;
  let element: HTMLElement;

  async function render(value: Trip): Promise<void> {
    fixture.componentRef.setInput('trip', value);
    await fixture.whenStable();
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [TripDetails] });
    fixture = TestBed.createComponent(TripDetails);
    element = fixture.nativeElement as HTMLElement;
    await render(trip);
  });

  const text = (): string => element.textContent?.replace(/\s+/g, ' ') ?? '';

  it('summarises the trip with its disruptions', () => {
    expect(text()).toContain('28 min');
    expect(text()).toContain('1 transfer');
    expect(text()).toContain('90% on time');
    expect(text()).toContain('Storing tussen Gouda en Rotterdam');
  });

  it('lists the units of the train with their facilities in plain words', () => {
    const units = element.querySelectorAll('[data-testid="train-units"] li');
    expect(units.length).toBe(2);
    expect(units[0].textContent).toContain('9469');
    expect(units[0].textContent).toContain('Wi-Fi');
    expect(units[0].textContent).toContain('Quiet zone');
    expect(units[0].textContent).toContain('new_thing');
    expect(units[1].textContent).toContain('no facilities listed');
    expect(text()).toContain('8 carriages in 2 units');
  });

  it('shows the side views of the units that have one, in train order', () => {
    const strip = element.querySelector('[data-testid="train-images"]')!;
    const images = [...strip.querySelectorAll('img')].map((img) => img.getAttribute('src'));
    expect(images).toEqual(['https://vt.ns-mlab.nl/v1/images/virmm1_4.png']);
    expect(strip.getAttribute('aria-label')).toBe('VIRM, 1 unit');
  });

  it('hides a unit image that fails to load', () => {
    const img = element.querySelector<HTMLImageElement>('[data-testid="train-images"] img')!;
    img.dispatchEvent(new Event('error'));
    expect(img.hidden).toBe(true);
  });

  it('leaves out the image strip when no unit has an image', async () => {
    await render({
      ...trip,
      train_parts: trip.train_parts.map((part) => ({ ...part, image_url: null })),
    });
    expect(element.querySelector('[data-testid="train-images"]')).toBeNull();
  });

  it('shows the bicycle places of a leg', async () => {
    expect(text()).toContain('6 bicycle places');
    await render({ ...trip, legs: [{ ...ride, bicycle_spots: 1 }] });
    expect(text()).toContain('1 bicycle place');
    await render({ ...trip, legs: [{ ...ride, bicycle_spots: null }] });
    expect(element.querySelector('[data-testid="bicycle-spots"]')).toBeNull();
  });

  it('says where the train splits and which part to board', async () => {
    await render({
      ...trip,
      split_stations: ['Amersfoort Centraal'],
      board_destination: 'Enschede',
      train_parts: [
        { ...trip.train_parts[0], destination: 'Zwolle' },
        {
          ...trip.train_parts[1],
          destination: 'Enschede',
          image_url: 'https://vt.ns-mlab.nl/v1/images/virm_4.png',
        },
      ],
    });
    expect(text()).toContain('This train splits at Amersfoort Centraal.');
    expect(text()).toContain('Board the part to Enschede.');
    const units = [...element.querySelectorAll('[data-testid="train-units"] li')];
    expect(units[0].textContent).toContain('to Zwolle');
    expect(units[0].textContent).not.toContain('your part');
    expect(units[1].textContent).toContain('your part');
    const images = [...element.querySelectorAll('[data-testid="train-images"] img')];
    expect(images.map((img) => img.classList.contains('other'))).toEqual([true, false]);
  });

  it('asks to check the part when it is unknown which one to board', async () => {
    await render({ ...trip, split_stations: ['Amersfoort Centraal'] });
    expect(text()).toContain('Check which part goes to your stop.');
    expect(text()).not.toContain(' to unknown');
  });

  it('says where another train joins', async () => {
    await render({ ...trip, combine_stations: ['Amersfoort Centraal'] });
    expect(text()).toContain('Another train joins this one at Amersfoort Centraal.');
  });

  it('places the crowding per carriage and the platform features along the train', async () => {
    await render({
      ...trip,
      coach_crowding: [
        { start: 0, width: 100, kind: 'LOW', description: '' },
        { start: 100, width: 100, kind: 'HIGH', description: '' },
        { start: 200, width: 200, kind: 'UNKNOWN', description: '' },
      ],
      platform_features: [
        { start: 100, width: 4, kind: 'LIFT', description: 'Lift' },
        { start: 900, width: 50, kind: 'STAIRS', description: '' },
      ],
    });
    const coaches = [...element.querySelectorAll<HTMLElement>('.coach')];
    expect(coaches.map((c) => c.className.replace('coach ', ''))).toEqual([
      'low',
      'high',
      'unknown',
    ]);
    expect(coaches.map((c) => [c.style.left, c.style.width])).toEqual([
      ['0%', '25%'],
      ['25%', '25%'],
      ['50%', '50%'],
    ]);
    expect(coaches[1].getAttribute('aria-label')).toBe('Carriage 2: very busy');
    const features = [...element.querySelectorAll<HTMLElement>('.feature')];
    expect(features.map((f) => [f.style.left, f.style.width, f.title])).toEqual([
      ['25%', '1%', 'Lift'],
      ['100%', '1%', 'stairs'],
    ]);
    expect(text()).toContain('On the platform: Lift, stairs');
  });

  it('leaves the platform off without carriages to place it along', async () => {
    await render({
      ...trip,
      platform_features: [{ start: 1, width: 1, kind: 'LIFT', description: 'Lift' }],
    });
    expect(element.querySelector('[data-testid="platform-features"]')).toBeNull();
    expect(element.querySelector('[data-testid="coach-crowding"]')).toBeNull();
  });

  it('shows each leg with its stops, tracks and notes', () => {
    expect(text()).toContain('Intercity');
    expect(text()).toContain('towards Den Haag Centraal');
    expect(text()).toContain('88% on time');
    expect(text()).toContain('Werkzaamheden - Minder treinen');
    expect(text()).toContain('Doors open on the right at Gouda.');
    expect(text()).toContain('Reserveren niet nodig');
    expect(text()).toContain('Overstap op hetzelfde perron');
    const stops = [...element.querySelectorAll('.stop')].map((s) => s.textContent ?? '');
    expect(stops.length).toBe(3);
    expect(stops[0]).toContain('Utrecht Centraal');
    expect(stops[0]).toContain('+2');
    expect(stops[0]).toContain('(changed)');
    expect(stops[1]).toContain('(passes)');
    expect(stops[2]).not.toContain('(changed)');
    expect(text()).toContain('Walk from Gouda to Gouda Goverwelle');
  });

  it('falls back to the leg ends when NS lists no stops', async () => {
    await render({ ...trip, legs: [{ ...ride, stops: [] }] });
    const stops = [...element.querySelectorAll('.stop')].map((s) => s.textContent ?? '');
    expect(stops).toHaveLength(2);
    expect(stops[0]).toContain('Utrecht Centraal');
    expect(stops[1]).toContain('Gouda');
  });

  it('says when the trip is cancelled or direct', async () => {
    await render({ ...trip, cancelled: true, transfers: 0, status: 'CANCELLED' });
    expect(text()).toContain('This trip is cancelled.');
    expect(text()).toContain('direct');
    expect(text()).toContain('cancelled');
  });

  it('leaves out the train section when nothing is known about it', async () => {
    await render({ ...trip, seats: null, train_type: null, train_parts: [] });
    expect(text()).not.toContain('Your train');
  });

  it('closes with the close button and with Escape', () => {
    let closed = 0;
    fixture.componentInstance.closed.subscribe(() => closed++);
    element.querySelector<HTMLButtonElement>('[data-testid="trip-details-close"]')!.click();
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(closed).toBe(2);
  });

  it('moves focus to the close button when it opens', () => {
    expect(document.activeElement).toBe(
      element.querySelector('[data-testid="trip-details-close"]'),
    );
  });
});
