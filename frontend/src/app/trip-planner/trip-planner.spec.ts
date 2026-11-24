import { readFileSync } from 'node:fs';
import { HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { Commute, Station, Trip } from '../api/models';
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
  train_parts: [],
  punctuality: null,
  messages: [],
  legs: [],
  coach_crowding: [],
  platform_features: [],
  split_stations: [],
  board_destination: null,
  min_seats: null,
};

/** The protected members the template uses, reachable from the test. */
interface Internals {
  form: TripPlanner['form'];
  pick(side: 'origin' | 'destination', event: MatAutocompleteSelectedEvent): void;
  plan(): Promise<void>;
  planCommute(commute: Commute): Promise<void>;
}

function commute(usual: string | null): Commute {
  return {
    id: 1,
    name: 'Home',
    created_at: '',
    origin_code: 'UT',
    origin_name: utrecht.name,
    destination_code: 'ASD',
    destination_name: amsterdam.name,
    usual_departure_time: usual,
  };
}

const empty = {
  fetched_at: '',
  trips: [],
  recommended_uid: null,
  wait_minutes: null,
  planned_from_usual_time: false,
  planned_tomorrow: false,
};

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

  it('shows the OV-fiets count at the destination in the trip details', async () => {
    choose(utrecht, amsterdam);
    const planned = planner.plan();
    http
      .expectOne('/api/trips/?from=UT&to=ASD')
      .flush({ fetched_at: '', trips: [trip], recommended_uid: 'a', wait_minutes: 0 });
    await planned;
    await settle(fixture);
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('app-ov-fiets-count')).toBeNull();
    element.querySelector<HTMLButtonElement>('[data-testid="trip-row-button"]')!.click();
    await settle(fixture);
    http.expectOne('/api/stations/ASD/ov-fiets/').flush({
      station_code: 'ASD',
      available: 20,
      locations: [{ name: 'Amsterdam Centraal IJzijde', available: 20, open: 'Yes' }],
    });
    await settle(fixture);
    expect(element.querySelector('[data-testid="trip-details"]')?.textContent).toContain(
      '20 OV-fietsen at Amsterdam Centraal',
    );
  });

  it('opens the details of a clicked trip beside the results and closes them again', async () => {
    choose(utrecht, amsterdam);
    const planned = planner.plan();
    http
      .expectOne('/api/trips/?from=UT&to=ASD')
      .flush({ fetched_at: '', trips: [trip], recommended_uid: 'a', wait_minutes: 0 });
    await planned;
    await settle(fixture);
    const element = fixture.nativeElement as HTMLElement;
    const details = (): Element | null => element.querySelector('[data-testid="trip-details"]');
    const row = (): HTMLButtonElement => element.querySelector('[data-testid="trip-row-button"]')!;
    expect(details()).toBeNull();

    row().click();
    await settle(fixture);
    expect(details()).not.toBeNull();
    expect(row().getAttribute('aria-expanded')).toBe('true');
    expect(element.classList).toContain('with-details');

    element.querySelector<HTMLButtonElement>('[data-testid="trip-details-close"]')!.click();
    await settle(fixture);
    expect(details()).toBeNull();
    expect(element.classList).not.toContain('with-details');

    row().click();
    await settle(fixture);
    row().click();
    await settle(fixture);
    expect(details()).toBeNull();
  });

  it('closes the details when planning again', async () => {
    choose(utrecht, amsterdam);
    const flush = (): void =>
      http
        .expectOne('/api/trips/?from=UT&to=ASD')
        .flush({ fetched_at: '', trips: [trip], recommended_uid: 'a', wait_minutes: 0 });
    let planned = planner.plan();
    flush();
    await planned;
    await settle(fixture);
    const element = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLButtonElement>('[data-testid="trip-row-button"]')!.click();
    await settle(fixture);
    planned = planner.plan();
    flush();
    await planned;
    await settle(fixture);
    expect(element.querySelector('[data-testid="trip-details"]')).toBeNull();
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
      time: expect.stringMatching(/^\d{2}:\d{2}$/),
    });
    const replanned = next.plan();
    http
      .expectOne('/api/trips/?from=UT&to=ASD')
      .flush({ fetched_at: '', trips: [], recommended_uid: null, wait_minutes: null });
    await replanned;
  });

  it('starts empty without or with unreadable stored stations', () => {
    const clockTime = expect.stringMatching(/^\d{2}:\d{2}$/);
    expect(planner.form.getRawValue()).toEqual({ origin: '', destination: '', time: clockTime });
    localStorage.setItem('spitsrit.lastTrip', '{nope');
    const again = TestBed.createComponent(TripPlanner);
    expect((again.componentInstance as unknown as Internals).form.getRawValue()).toEqual({
      origin: '',
      destination: '',
      time: clockTime,
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
    planner.form.setValue({ origin: 'Utr', destination: 'Ams', time: '' });
    await planner.plan();
    await settle(fixture);
    http.expectNone('/api/trips/?from=UT&to=ASD');
    expect(text()).toContain('Pick both stations from the suggestions.');
  });

  it('refuses identical stations', async () => {
    choose(utrecht, utrecht);
    planner.form.setValue({ origin: utrecht.name, destination: utrecht.name, time: '' });
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

  describe('departure time', () => {
    const input = (): HTMLInputElement =>
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="departure-time"]')!;
    const hint = (): string =>
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="departure-hint"]')!
        .textContent!;

    /** The one trips request, matched on its query parameters (the colon in a time is encoded). */
    const expectTrips = (extra: Record<string, string>) => {
      const expected = { from: 'UT', to: 'ASD', ...extra };
      return http.expectOne(
        (req) =>
          req.url === '/api/trips/' &&
          req.params.keys().length === Object.keys(expected).length &&
          Object.entries(expected).every(([key, value]) => req.params.get(key) === value),
      );
    };

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
      vi.setSystemTime(new Date(2026, 10, 20, 9, 0)); // 09:00 local
      // A planner created now starts on the faked clock.
      fixture = TestBed.createComponent(TripPlanner);
      planner = fixture.componentInstance as unknown as Internals;
      fixture.detectChanges();
    });

    afterEach(() => vi.useRealTimers());

    /** `settle` waits on a real timeout, which is faked here. */
    const settled = async (): Promise<void> => {
      await fixture.whenStable();
      fixture.detectChanges();
    };
    const nowButton = (): HTMLButtonElement =>
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="time-now"]')!;
    const hintElement = (): Element | null =>
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="departure-hint"]');

    it('shows the current time on load and plans from now without sending a time', async () => {
      expect(planner.form.controls.time.value).toBe('09:00');
      expect(input().value).toBe('09:00');
      expect(hintElement()).toBeNull();
      choose(utrecht, amsterdam);
      vi.setSystemTime(new Date(2026, 10, 20, 9, 20));
      const planned = planner.plan();
      http.expectOne('/api/trips/?from=UT&to=ASD').flush(empty);
      await planned;
    });

    it('follows the clock every minute until the field is edited', () => {
      vi.advanceTimersByTime(60_000);
      fixture.detectChanges();
      expect(input().value).toBe('09:01');
      vi.advanceTimersByTime(5 * 60_000);
      expect(planner.form.controls.time.value).toBe('09:06');

      input().value = '16:00';
      input().dispatchEvent(new Event('input'));
      vi.advanceTimersByTime(2 * 60_000);
      fixture.detectChanges();
      expect(planner.form.controls.time.value).toBe('16:00');
    });

    it('sends the chosen time, and says tomorrow for a time that has passed', async () => {
      planner.form.controls.time.setValue('16:00');
      fixture.detectChanges();
      expect(hintElement()).toBeNull();
      planner.form.controls.time.setValue('07:30');
      fixture.detectChanges();
      expect(hint()).toContain('tomorrow');
      choose(utrecht, amsterdam);
      const planned = planner.plan();
      expectTrips({ time: '07:30' }).flush(empty);
      await planned;
    });

    it('does not say tomorrow while following the clock', () => {
      vi.setSystemTime(new Date(2026, 10, 20, 9, 30));
      fixture.detectChanges();
      expect(hintElement()).toBeNull();
    });

    it('goes back to following now with the Now button', async () => {
      expect(nowButton().classList).toContain('subdued');
      planner.form.controls.time.setValue('07:30');
      fixture.detectChanges();
      expect(nowButton().classList).not.toContain('subdued');
      vi.setSystemTime(new Date(2026, 10, 20, 9, 10));
      nowButton().click();
      fixture.detectChanges();
      expect(input().value).toBe('09:10');
      expect(nowButton().classList).toContain('subdued');
      expect(hintElement()).toBeNull();
      vi.advanceTimersByTime(60_000);
      expect(planner.form.controls.time.value).toBe('09:11');
      choose(utrecht, amsterdam);
      const planned = planner.plan();
      http.expectOne('/api/trips/?from=UT&to=ASD').flush(empty);
      await planned;
    });

    it('keeps the Now button visible while following the clock', () => {
      expect(nowButton()).not.toBeNull();
      nowButton().click();
      fixture.detectChanges();
      expect(nowButton()).not.toBeNull();
    });

    it('does not restore the time after a reload', async () => {
      choose(utrecht, amsterdam);
      planner.form.controls.time.setValue('16:00');
      const planned = planner.plan();
      expectTrips({ time: '16:00' }).flush(empty);
      await planned;
      const again = TestBed.createComponent(TripPlanner);
      expect((again.componentInstance as unknown as Internals).form.controls.time.value).toBe(
        '09:00',
      );
    });

    it('fills in an upcoming usual time from a chip and plans around it', async () => {
      const planned = planner.planCommute(commute('16:00:00'));
      expectTrips({ time: '16:00', around: 'true' }).flush({
        ...empty,
        planned_from_usual_time: true,
      });
      await planned;
      await settled();
      expect(planner.form.controls.time.value).toBe('16:00');
      expect(text()).toContain('Trains around 16:00');
    });

    it('plans from now for a chip whose usual time has passed or is missing', async () => {
      for (const usual of ['08:00:00', null]) {
        planner.form.controls.time.setValue('12:00');
        const planned = planner.planCommute(commute(usual));
        http.expectOne('/api/trips/?from=UT&to=ASD').flush(empty);
        await planned;
        expect(planner.form.controls.time.value).toBe('09:00');
      }
      vi.advanceTimersByTime(60_000);
      expect(planner.form.controls.time.value).toBe('09:01');
    });

    it('plans from the typed time, not around it, after editing a chip’s time', async () => {
      const first = planner.planCommute(commute('16:00:00'));
      expectTrips({ time: '16:00', around: 'true' }).flush(empty);
      await first;
      planner.form.controls.time.setValue('17:00');
      const second = planner.plan();
      expectTrips({ time: '17:00' }).flush(empty);
      await second;
    });

    describe('arrive by', () => {
      const click = (testid: string): void => {
        (fixture.nativeElement as HTMLElement)
          .querySelector<HTMLElement>(`[data-testid="${testid}"] button`)!
          .click();
        fixture.detectChanges();
      };
      const planButton = (): HTMLButtonElement =>
        (fixture.nativeElement as HTMLElement).querySelector('[data-testid="plan"]')!;

      it('defaults to Depart', () => {
        const toggles = (fixture.nativeElement as HTMLElement).querySelectorAll(
          'mat-button-toggle',
        );
        expect(toggles[0].classList).toContain('mat-button-toggle-checked');
        expect(toggles[1].classList).not.toContain('mat-button-toggle-checked');
        const label = (): string =>
          (fixture.nativeElement as HTMLElement).querySelector('mat-label')!.textContent!;
        expect(label()).toBe('From');
        expect(text()).toContain('Departure');
        click('mode-arrive');
        expect(text()).toContain('Arrival');
        expect(text()).not.toContain('Departure');
      });

      it('disables Plan while the time follows the clock', async () => {
        click('mode-arrive');
        expect(planButton().disabled).toBe(true);
        expect(input().value).toBe('09:00');
        expect(text()).toContain('Pick a time to arrive by');
        choose(utrecht, amsterdam);
        await planner.plan();
        http.expectNone('/api/trips/?from=UT&to=ASD');
        planner.form.controls.time.setValue('10:00');
        fixture.detectChanges();
        expect(planButton().disabled).toBe(false);
        nowButton().click();
        fixture.detectChanges();
        expect(planButton().disabled).toBe(true);
        click('mode-depart');
        expect(planButton().disabled).toBe(false);
      });

      it('sends the arrival time', async () => {
        click('mode-arrive');
        planner.form.controls.time.setValue('10:00');
        choose(utrecht, amsterdam);
        const planned = planner.plan();
        expectTrips({ time: '10:00', arrive: 'true' }).flush(empty);
        await planned;
        await settled();
        expect(text()).toContain('Arriving by 10:00');
      });

      it('does not remember the choice after a reload', async () => {
        click('mode-arrive');
        planner.form.controls.time.setValue('10:00');
        choose(utrecht, amsterdam);
        const planned = planner.plan();
        expectTrips({ time: '10:00', arrive: 'true' }).flush(empty);
        await planned;
        const again = TestBed.createComponent(TripPlanner);
        again.detectChanges();
        const toggles = (again.nativeElement as HTMLElement).querySelectorAll('mat-button-toggle');
        expect(toggles[0].classList).toContain('mat-button-toggle-checked');
      });

      it('plans a commute chip by departure', async () => {
        click('mode-arrive');
        planner.form.controls.time.setValue('10:00');
        const planned = planner.planCommute(commute('16:00:00'));
        expectTrips({ time: '16:00', around: 'true' }).flush(empty);
        await planned;
      });
    });
  });

  it('searches stations as you type', async () => {
    planner.form.controls.origin.setValue('Utr');
    await new Promise((resolve) => setTimeout(resolve, 300));
    http.expectOne('/api/stations/?q=Utr').flush([utrecht]);
    await settle(fixture);
    expect(planner.form.controls.origin.value).toBe('Utr');
  });

  describe('form spacing', () => {
    it('gives every form field dynamic subscript sizing', () => {
      // The station fields moved to app-station-autocomplete, the time field to app-time-control.
      const planner = readFileSync('src/app/trip-planner/trip-planner.html', 'utf8');
      const stations = planner.match(/<app-station-autocomplete\b[^>]*>/g) ?? [];
      expect(stations.length).toBe(2);
      const time = readFileSync('src/app/shared/time-control/time-control.html', 'utf8');
      const fields = [...stations, ...(time.match(/<mat-form-field\b[^>]*>/g) ?? [])];
      expect(fields.length).toBe(3);
      for (const tag of fields) {
        expect(tag).toContain('subscriptSizing="dynamic"');
      }
    });

    it('sizes the toggle and the Now button with the shared control-height token', () => {
      const scss = readFileSync('src/app/shared/time-control/time-control.scss', 'utf8');
      expect(readFileSync('src/styles/_tokens.scss', 'utf8')).toContain('--sp-control-height:');
      expect(scss).toMatch(/--mat-button-toggle-height:\s*var\(--sp-control-height\)/);
      expect(scss).toMatch(/\n\s+height:\s*var\(--sp-control-height\)/);
      expect(scss).toMatch(/--mat-button-toggle-shape:\s*var\(--sp-radius-md\)/);
    });
  });
});
