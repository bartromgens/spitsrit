import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Leg } from '../../api/models';
import { testProviders } from '../../testing';
import { LegView, TripLeg } from './trip-leg';

const leg: Leg = {
  travel_type: 'PUBLIC_TRANSIT',
  name: 'IC 2136',
  category: 'Intercity',
  operator: 'NS',
  direction: 'Den Haag Centraal',
  origin: 'Utrecht Centraal',
  departure_planned: '2026-11-20T08:00:00Z',
  departure_actual: '2026-11-20T08:00:00Z',
  departure_track: '7',
  departure_track_changed: false,
  destination: 'Gouda',
  arrival_planned: '2026-11-20T08:18:00Z',
  arrival_actual: '2026-11-20T08:18:00Z',
  arrival_track: '3',
  arrival_track_changed: false,
  exit_side: 'RIGHT',
  cancelled: false,
  crowd_forecast: 'LOW',
  punctuality: 90,
  stops: [],
  notes: ['Reserveren niet nodig'],
  messages: [],
  transfer_messages: ['Overstap op hetzelfde perron'],
  shorter_stock_warning: null,
  origin_code: 'UT',
  destination_code: 'GD',
  bicycle_spots: 1,
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

const view: LegView = {
  leg,
  ride: true,
  departureDelay: 0,
  arrivalDelay: 0,
  exitSide: 'right',
  stops: [
    {
      name: 'Utrecht Centraal',
      time: '2026-11-20T08:00:00Z',
      delay: 0,
      track: '7',
      trackChanged: true,
      passing: false,
      cancelled: false,
      endpoint: true,
    },
    {
      name: 'Gouda',
      time: '2026-11-20T08:18:00Z',
      delay: 0,
      track: '3',
      trackChanged: false,
      passing: false,
      cancelled: false,
      endpoint: true,
    },
  ],
};

describe('TripLeg', () => {
  let fixture: ComponentFixture<TripLeg>;
  let element: HTMLElement;

  async function render(value: LegView): Promise<void> {
    fixture.componentRef.setInput('view', value);
    await fixture.whenStable();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TripLeg], providers: testProviders });
    fixture = TestBed.createComponent(TripLeg);
    element = fixture.nativeElement as HTMLElement;
  });

  it('has the leg class on its host', async () => {
    await render(view);
    expect(element.classList.contains('leg')).toBe(true);
  });

  it('shows the train, its stops, the door side, notes and transfer message', async () => {
    await render(view);
    expect(element.textContent).toContain('Intercity');
    expect(element.querySelectorAll('.stop').length).toBe(2);
    expect(element.querySelector('.changed')).not.toBeNull();
    expect(element.textContent).toContain('Doors open on the right at Gouda');
    expect(element.textContent).toContain('Reserveren niet nodig');
    expect(element.textContent).toContain('Overstap op hetzelfde perron');
    expect(element.querySelector('[data-testid="bicycle-spots"]')?.textContent).toContain(
      '1 bicycle place',
    );
  });

  it('shows a walk as one line', async () => {
    await render({ ...view, ride: false, leg: { ...leg, travel_type: 'WALK' }, stops: [] });
    expect(element.classList.contains('walk')).toBe(true);
    expect(element.querySelector('.stops')).toBeNull();
    expect(element.textContent?.replace(/\s+/g, ' ')).toContain(
      'Walk from Utrecht Centraal to Gouda',
    );
  });

  it('marks a cancelled leg', async () => {
    await render({ ...view, leg: { ...leg, cancelled: true } });
    expect(element.classList.contains('cancelled')).toBe(true);
    expect(element.textContent).toContain('This train is cancelled.');
  });
});
