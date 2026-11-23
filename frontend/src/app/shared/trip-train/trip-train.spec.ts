import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Trip } from '../../api/models';
import { testProviders } from '../../testing';
import { TripTrain } from './trip-train';

const trip: Trip = {
  uid: 'a',
  departure_planned: '2026-11-20T08:00:00Z',
  departure_actual: '2026-11-20T08:00:00Z',
  arrival_planned: '2026-11-20T08:30:00Z',
  arrival_actual: '2026-11-20T08:30:00Z',
  departure_delay_minutes: 0,
  arrival_delay_minutes: 0,
  duration_minutes: 30,
  departure_track: '7',
  transfers: 0,
  status: 'NORMAL',
  cancelled: false,
  crowd_forecast: 'LOW',
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
      facilities: ['WIFI'],
      image_url: 'https://vt.ns-mlab.nl/v1/images/virmm1_4.png',
      destination: 'Zwolle',
    },
    { stock_identifier: '9596', facilities: [], image_url: null, destination: 'Enschede' },
  ],
  punctuality: 90,
  messages: [],
  legs: [],
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
    fixture.componentRef.setInput('trip', trip);
    await fixture.whenStable();
  });

  it('shows the carriages and units', () => {
    expect(element.querySelector('h3')?.textContent).toBe('Your train');
    expect(element.textContent?.replace(/\s+/g, ' ')).toContain('8 carriages in 2 units');
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
});
