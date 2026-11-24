import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Leg } from '../../api/models';
import { testProviders } from '../../testing';
import { TripTrain } from './trip-train';

const leg: Leg = {
  travel_type: 'PUBLIC_TRANSIT',
  name: 'IC 2136',
  category: 'Intercity',
  operator: 'NS',
  direction: 'Den Haag Centraal',
  origin: 'Utrecht Centraal',
  origin_code: 'UT',
  departure_planned: '2026-11-20T08:00:00Z',
  departure_actual: '2026-11-20T08:00:00Z',
  departure_track: '7',
  departure_track_changed: false,
  destination: 'Den Haag Centraal',
  destination_code: 'GVC',
  arrival_planned: '2026-11-20T08:30:00Z',
  arrival_actual: '2026-11-20T08:30:00Z',
  arrival_track: '3',
  arrival_track_changed: false,
  exit_side: null,
  cancelled: false,
  crowd_forecast: 'LOW',
  punctuality: 90,
  stops: [],
  notes: [],
  messages: [],
  transfer_messages: [],
  bicycle_spots: null,
  shorter_stock_warning: null,
  seats: 740,
  carriages: 8,
  train_type: 'VIRM',
  train_origin: 'Utrecht Centraal',
  train_parts: [
    {
      stock_identifier: '9469',
      facilities: ['WIFI'],
      image_url: 'https://vt.ns-mlab.nl/v1/images/virmm1_4.png',
      destination: 'Zwolle',
    },
    { stock_identifier: '9596', facilities: [], image_url: null, destination: 'Enschede' },
  ],
  coach_crowding: [
    { kind: 'LOW', start: 0, width: 50, description: '' },
    { kind: 'HIGH', start: 50, width: 50, description: '' },
  ],
  platform_features: [],
  split_stations: ['Amersfoort Centraal'],
  board_destination: 'Enschede',
};

describe('TripTrain', () => {
  let fixture: ComponentFixture<TripTrain>;
  let element: HTMLElement;

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [TripTrain], providers: testProviders });
    fixture = TestBed.createComponent(TripTrain);
    element = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('leg', leg);
    await fixture.whenStable();
  });

  it('shows the carriages and units', () => {
    expect(element.querySelector('h3')?.textContent).toBe('Your train');
    expect(element.textContent?.replace(/\s+/g, ' ')).toContain('8 carriages in 2 units');
  });

  it('labels the section with its own heading', () => {
    const heading = element.querySelector('h3')!;
    expect(heading.id).not.toBe('');
    expect(element.querySelector('section')?.getAttribute('aria-labelledby')).toBe(heading.id);
  });

  it('lists each unit with its destination and marks the one to board', () => {
    const units = [...element.querySelectorAll('[data-testid="train-units"] li')];
    expect(units.length).toBe(2);
    expect(units[0].textContent).toContain('to Zwolle');
    expect(units[1].textContent).toContain('your part');
  });

  it('dims the images of units going elsewhere', () => {
    const images = element.querySelectorAll('[data-testid="train-images"] img');
    expect(images.length).toBe(1);
    expect(images[0].classList.contains('other')).toBe(true);
  });

  it('places the crowding per carriage along the train', () => {
    const coaches = [...element.querySelectorAll<HTMLElement>('.coach')];
    expect(coaches.map((c) => c.className)).toEqual(['coach low', 'coach high']);
    expect(coaches[1].style.left).toBe('50%');
  });

  it('says where the train splits', () => {
    expect(element.querySelector('[data-testid="train-split"]')?.textContent).toContain(
      'Amersfoort Centraal',
    );
  });

  it('flags a shorter train from the leg warning', async () => {
    expect(element.querySelector('.shorter')).toBeNull();
    fixture.componentRef.setInput('leg', { ...leg, shorter_stock_warning: 'Kortere trein' });
    await fixture.whenStable();
    expect(element.querySelector('.shorter')?.getAttribute('title')).toBe('Kortere trein');
  });
});
