import { HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { Station, Trip } from '../api/models';
import { settle, testProviders } from '../testing';
import { TripPlanner } from './trip-planner';

const utrecht: Station = { code: 'UT', name: 'Utrecht Centraal' };
const amsterdam: Station = { code: 'ASD', name: 'Amsterdam Centraal' };

const trip: Trip = {
  uid: 'a',
  departure_planned: '2026-11-20T08:00:00Z',
  departure_actual: '2026-11-20T08:00:00Z',
  arrival_planned: '2026-11-20T08:30:00Z',
  arrival_actual: '2026-11-20T08:30:00Z',
  departure_delay_minutes: 0,
  arrival_delay_minutes: 0,
  duration_minutes: 30,
  departure_track: '5',
  transfers: 1,
  status: 'NORMAL',
  cancelled: false,
  crowd_forecast: 'LOW',
  train: 'IC 2736',
  seats: 620,
  carriages: 8,
  train_type: 'VIRM',
  shorter_stock: null,
  shorter_stock_warning: null,
  train_origin: 'Nijmegen',
  train_destination: 'Den Haag C.',
};

/** The protected members the template uses, reachable from the test. */
interface Internals {
  form: TripPlanner['form'];
  pick(side: 'origin' | 'destination', event: MatAutocompleteSelectedEvent): void;
  plan(): Promise<void>;
}

describe('TripPlanner', () => {
  let fixture: ComponentFixture<TripPlanner>;
  let planner: Internals;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ imports: [TripPlanner], providers: testProviders });
    fixture = TestBed.createComponent(TripPlanner);
    planner = fixture.componentInstance as unknown as Internals;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  const text = (): string => (fixture.nativeElement as HTMLElement).textContent ?? '';
  const choose = (origin: Station, destination: Station): void => {
    for (const [side, station] of [
      ['origin', origin],
      ['destination', destination],
    ] as const) {
      planner.pick(side, { option: { value: station } } as MatAutocompleteSelectedEvent);
    }
  };

  it('plans a trip between the picked stations and shows the results', async () => {
    choose(utrecht, amsterdam);
    const planned = planner.plan();
    http
      .expectOne('/api/trips/?from=UT&to=ASD')
      .flush({ fetched_at: '', trips: [trip], recommended_uid: 'a', wait_minutes: 0 });
    await planned;
    await settle(fixture);
    expect(text()).toContain('IC');
    expect(text()).not.toContain('2736');
    expect(text()).not.toContain('Show train route');
    expect(text()).toContain('Nijmegen → Den Haag C.');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[aria-label="620 seats"]'),
    ).not.toBeNull();
    expect(text()).toContain('platform 5');
    expect(text()).toContain('1 transfer');
    expect((fixture.nativeElement as HTMLElement).querySelector('li.best')).not.toBeNull();
  });

  it('holds the place of the results with placeholder rows while planning', async () => {
    const element = fixture.nativeElement as HTMLElement;
    const skeleton = (): Element | null =>
      element.querySelector('[data-testid="trip-list-skeleton"]');
    const button = (): HTMLButtonElement => element.querySelector('button[type="submit"]')!;
    expect(skeleton()).toBeNull();
    choose(utrecht, amsterdam);
    const planned = planner.plan();
    await settle(fixture);
    expect(skeleton()).not.toBeNull();
    expect(button().disabled).toBe(true);
    http
      .expectOne('/api/trips/?from=UT&to=ASD')
      .flush({ fetched_at: '', trips: [trip], recommended_uid: 'a', wait_minutes: 0 });
    await planned;
    await settle(fixture);
    expect(skeleton()).toBeNull();
    expect(button().disabled).toBe(false);
    expect(element.querySelector('[data-testid="trip-results"]')).not.toBeNull();
  });

  it('drops the placeholders when planning fails', async () => {
    choose(utrecht, amsterdam);
    const planned = planner.plan();
    http.expectOne('/api/trips/?from=UT&to=ASD').flush(null, { status: 503, statusText: 'x' });
    await planned;
    await settle(fixture);
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('[data-testid="trip-list-skeleton"]')).toBeNull();
    expect(text()).toContain('Train times are unavailable right now.');
  });

  it('remembers the planned stations and pre-fills them next time', async () => {
    choose(utrecht, amsterdam);
    const planned = planner.plan();
    http
      .expectOne('/api/trips/?from=UT&to=ASD')
      .flush({ fetched_at: '', trips: [], recommended_uid: null, wait_minutes: null });
    await planned;

    const again = TestBed.createComponent(TripPlanner);
    const next = again.componentInstance as unknown as Internals;
    expect(next.form.getRawValue()).toEqual({
      origin: 'Utrecht Centraal',
      destination: 'Amsterdam Centraal',
    });
    const replanned = next.plan();
    http
      .expectOne('/api/trips/?from=UT&to=ASD')
      .flush({ fetched_at: '', trips: [], recommended_uid: null, wait_minutes: null });
    await replanned;
  });

  it('starts empty without or with unreadable stored stations', () => {
    expect(planner.form.getRawValue()).toEqual({ origin: '', destination: '' });
    localStorage.setItem('spitsrit.lastTrip', '{nope');
    const again = TestBed.createComponent(TripPlanner);
    expect((again.componentInstance as unknown as Internals).form.getRawValue()).toEqual({
      origin: '',
      destination: '',
    });
  });

  it('does not remember stations when planning fails', async () => {
    choose(utrecht, utrecht);
    await planner.plan();
    expect(localStorage.getItem('spitsrit.lastTrip')).toBeNull();
  });

  it('lays the results out edge to edge on mobile', async () => {
    choose(utrecht, amsterdam);
    const planned = planner.plan();
    http.expectOne('/api/trips/?from=UT&to=ASD').flush({
      fetched_at: '',
      trips: [],
      recommended_uid: null,
      wait_minutes: null,
    });
    await planned;
    await settle(fixture);
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('ul.sp-trips')?.classList).toContain('sp-full-bleed');
    expect(element.querySelector('mat-card')?.classList).toContain('sp-card');
  });

  it('says when there are no trips', async () => {
    choose(utrecht, amsterdam);
    const planned = planner.plan();
    http
      .expectOne('/api/trips/?from=UT&to=ASD')
      .flush({ fetched_at: '', trips: [], recommended_uid: null, wait_minutes: null });
    await planned;
    await settle(fixture);
    expect(text()).toContain('No upcoming trips.');
  });

  it('asks for stations from the suggestions', async () => {
    planner.form.setValue({ origin: 'Utr', destination: 'Ams' });
    await planner.plan();
    await settle(fixture);
    http.expectNone('/api/trips/?from=UT&to=ASD');
    expect(text()).toContain('Pick both stations from the suggestions.');
  });

  it('refuses identical stations', async () => {
    choose(utrecht, utrecht);
    planner.form.setValue({ origin: utrecht.name, destination: utrecht.name });
    await planner.plan();
    await settle(fixture);
    expect(text()).toContain('Origin and destination must differ.');
  });

  it('shows an error when the trips cannot be loaded', async () => {
    choose(utrecht, amsterdam);
    const planned = planner.plan();
    http
      .expectOne('/api/trips/?from=UT&to=ASD')
      .flush(null, { status: 503, statusText: 'Unavailable' });
    await planned;
    await settle(fixture);
    expect(text()).toContain('Train times are unavailable');
  });

  it('searches stations as you type', async () => {
    planner.form.controls.origin.setValue('Utr');
    await new Promise((resolve) => setTimeout(resolve, 300));
    http.expectOne('/api/stations/?q=Utr').flush([utrecht]);
    await settle(fixture);
    expect(planner.form.controls.origin.value).toBe('Utr');
  });
});
