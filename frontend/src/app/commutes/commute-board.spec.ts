import { HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Commute, CommuteTrips, Trip } from '../api/models';
import { settle, testProviders } from '../testing';
import { CommuteBoard } from './commute-board';

const commute: Commute = {
  id: 7,
  name: 'To work',
  origin_code: 'UT',
  origin_name: 'Utrecht Centraal',
  destination_code: 'ASD',
  destination_name: 'Amsterdam Centraal',
  created_at: '2026-11-20T07:00:00Z',
};

function trip(overrides: Partial<Trip>): Trip {
  return {
    uid: 'a',
    departure_planned: '2026-11-20T08:00:00Z',
    departure_actual: '2026-11-20T08:00:00Z',
    arrival_planned: '2026-11-20T08:30:00Z',
    arrival_actual: '2026-11-20T08:30:00Z',
    departure_delay_minutes: 0,
    arrival_delay_minutes: 0,
    duration_minutes: 30,
    departure_track: '5',
    transfers: 0,
    status: 'NORMAL',
    cancelled: false,
    crowd_forecast: 'LOW',
    train: 'IC 1234',
    train_length: 8,
    ...overrides,
  };
}

function trips(overrides: Partial<CommuteTrips>): CommuteTrips {
  return { fetched_at: '', trips: [], recommended_uid: null, wait_minutes: null, ...overrides };
}

describe('CommuteBoard', () => {
  let fixture: ComponentFixture<CommuteBoard>;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [CommuteBoard], providers: testProviders });
    fixture = TestBed.createComponent(CommuteBoard);
    fixture.componentRef.setInput('commute', commute);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  const text = (): string => (fixture.nativeElement as HTMLElement).textContent ?? '';
  const flush = async (body: CommuteTrips | null, status = 200): Promise<void> => {
    http
      .expectOne('/api/commutes/7/trips/')
      .flush(body, { status, statusText: status === 200 ? 'OK' : 'Error' });
    await settle(fixture);
  };

  it('shows the route and tells you to leave now', async () => {
    await flush(
      trips({ trips: [trip({ train: 'IC 2736' })], recommended_uid: 'a', wait_minutes: 0 }),
    );
    expect(text()).toContain('Utrecht Centraal → Amsterdam Centraal');
    expect(text()).toContain('Leave now');
    expect(text()).toContain('IC 2736');
    expect(text()).toContain('8 treinstellen');
    expect(text()).toContain('platform 5');
  });

  it('tells you to wait and highlights the recommended trip', async () => {
    await flush(
      trips({
        trips: [trip({ uid: 'a' }), trip({ uid: 'b', transfers: 1 })],
        recommended_uid: 'b',
        wait_minutes: 12,
      }),
    );
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('[data-testid="advice"]')?.textContent).toContain('Wait 12 min');
    const rows = element.querySelectorAll('li');
    expect(rows[0].classList.contains('best')).toBe(false);
    expect(rows[1].classList.contains('best')).toBe(true);
    expect(rows[1].textContent).toContain('1 transfer');
  });

  it('highlights delays and cancellations', async () => {
    await flush(
      trips({
        trips: [
          trip({ uid: 'a', departure_delay_minutes: 4, arrival_delay_minutes: 6 }),
          trip({ uid: 'b', cancelled: true }),
        ],
      }),
    );
    expect(text()).toContain('+4');
    expect(text()).toContain('(+6)');
    expect(text()).toContain('Cancelled');
    expect(text()).toContain('No trip available right now');
  });

  it('says when there are no trips', async () => {
    await flush(trips({}));
    expect(text()).toContain('No upcoming trips.');
  });

  it('shows an error when the trips cannot be loaded', async () => {
    await flush(null, 503);
    expect(text()).toContain('Train times are unavailable');
  });

  it('refreshes on demand and emits removal', async () => {
    await flush(trips({}));
    const removed: Commute[] = [];
    fixture.componentInstance.removed.subscribe((c) => removed.push(c));
    const buttons = (fixture.nativeElement as HTMLElement).querySelectorAll('button');
    buttons[0].click();
    await flush(trips({ trips: [trip({})], recommended_uid: 'a', wait_minutes: 3 }));
    expect(text()).toContain('Wait 3 min');
    buttons[1].click();
    expect(removed).toEqual([commute]);
  });
});
