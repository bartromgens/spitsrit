import { HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Commute, Trip, User } from '../api/models';
import { Auth } from '../auth';
import { settle, testProviders } from '../testing';
import { Commutes } from './commutes';

const saved: Commute = {
  id: 1,
  name: 'To work',
  origin_code: 'UT',
  origin_name: 'Utrecht Centraal',
  destination_code: 'ASD',
  destination_name: 'Amsterdam Centraal',
  created_at: '2026-11-20T07:00:00Z',
};

interface Internals {
  form: Commutes['form'];
  pick(side: 'origin' | 'destination', event: unknown): void;
  add(): Promise<void>;
}

describe('Commutes', () => {
  let fixture: ComponentFixture<Commutes>;
  let http: HttpTestingController;
  let page: Internals;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const stationEvent = (code: string, name: string): unknown => ({
    option: { value: { code, name } },
  });

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ imports: [Commutes], providers: testProviders });
    TestBed.inject(Auth).user.set({ id: 1 } as User);
    fixture = TestBed.createComponent(Commutes);
    page = fixture.componentInstance as unknown as Internals;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  const loadList = async (results: Commute[]): Promise<void> => {
    http
      .expectOne((r) => r.url === '/api/commutes/' && r.method === 'GET')
      .flush({ count: results.length, next: null, previous: null, results });
    await settle(fixture);
    fixture.detectChanges();
  };

  const fillForm = (name = 'To work', usualTime = ''): void => {
    page.form.patchValue({ name, usualTime });
    page.pick('origin', stationEvent('UT', 'Utrecht Centraal'));
    page.pick('destination', stationEvent('ASD', 'Amsterdam Centraal'));
  };

  it('shows a placeholder board while the commutes load', async () => {
    const skeleton = (): Element | null =>
      element().querySelector('[data-testid="commutes-skeleton"]');
    expect(skeleton()).not.toBeNull();
    expect(element().textContent).not.toContain('No commutes yet');
    await loadList([]);
    expect(skeleton()).toBeNull();
  });

  it('lists the commutes with their boards', async () => {
    await loadList([saved]);
    http.expectOne('/api/commutes/1/trips/').flush(null, { status: 503, statusText: 'x' });
    await settle(fixture);
    expect(element().textContent).toContain('To work');
  });

  it('invites you to add a first commute', async () => {
    await loadList([]);
    expect(element().textContent).toContain('No commutes yet');
  });

  it('reports a failure to load', async () => {
    http.expectOne((r) => r.url === '/api/commutes/').flush(null, { status: 500, statusText: 'x' });
    await settle(fixture);
    expect(element().textContent).toContain('could not be loaded');
  });

  it('saves a commute from the picked stations', async () => {
    await loadList([]);
    fillForm('To work', '08:05');
    const saving = page.add();
    const request = http.expectOne((r) => r.url === '/api/commutes/' && r.method === 'POST');
    expect(request.request.body).toEqual({
      name: 'To work',
      origin_code: 'UT',
      origin_name: 'Utrecht Centraal',
      destination_code: 'ASD',
      destination_name: 'Amsterdam Centraal',
      usual_departure_time: '08:05:00',
    });
    request.flush(saved);
    await saving;
    fixture.detectChanges();
    http.expectOne('/api/commutes/1/trips/').flush(null, { status: 503, statusText: 'x' });
    await settle(fixture);
    expect(element().querySelector('app-commute-board')).not.toBeNull();
    expect(page.form.getRawValue().name).toBe('');
  });

  it('refuses to save without picked stations', async () => {
    await loadList([]);
    page.form.patchValue({ name: 'x', origin: 'Utr', destination: 'Ams' });
    await page.add();
    await settle(fixture);
    expect(element().textContent).toContain('Pick both stations');
    http.expectNone((r) => r.method === 'POST');
  });

  it('refuses identical stations', async () => {
    await loadList([]);
    page.form.patchValue({ name: 'x' });
    page.pick('origin', stationEvent('UT', 'Utrecht Centraal'));
    page.pick('destination', stationEvent('UT', 'Utrecht Centraal'));
    await page.add();
    await settle(fixture);
    expect(element().textContent).toContain('must differ');
  });

  it('reports a failure to save', async () => {
    await loadList([]);
    fillForm();
    const saving = page.add();
    http
      .expectOne((r) => r.method === 'POST')
      .flush(null, { status: 400, statusText: 'Bad Request' });
    await saving;
    await settle(fixture);
    expect(element().textContent).toContain('could not be saved');
  });

  it('deletes a commute', async () => {
    await loadList([saved]);
    http.expectOne('/api/commutes/1/trips/').flush(null, { status: 503, statusText: 'x' });
    await settle(fixture);
    const buttons = Array.from(element().querySelectorAll('button'));
    buttons.find((b) => b.textContent?.includes('Delete'))?.click();
    http.expectOne((r) => r.method === 'DELETE').flush(null, { status: 204, statusText: 'x' });
    await settle(fixture);
    expect(element().querySelector('app-commute-board')).toBeNull();
  });

  it('reports a failure to delete', async () => {
    await loadList([saved]);
    http.expectOne('/api/commutes/1/trips/').flush(null, { status: 503, statusText: 'x' });
    await settle(fixture);
    const buttons = Array.from(element().querySelectorAll('button'));
    buttons.find((b) => b.textContent?.includes('Delete'))?.click();
    http.expectOne((r) => r.method === 'DELETE').flush(null, { status: 500, statusText: 'x' });
    await settle(fixture);
    expect(element().textContent).toContain('could not be deleted');
  });

  describe('trip details', () => {
    const other: Commute = {
      ...saved,
      id: 2,
      name: 'Way home', // sorts after "To work", so its board is the second one
      origin_code: 'ASD',
      origin_name: 'Amsterdam Centraal',
      destination_code: 'UT',
      destination_name: 'Utrecht Centraal',
    };

    const trip = (uid: string): Trip => ({
      uid,
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
    });
    const board = (uids: string[]): object => ({
      fetched_at: '',
      planned_from: '',
      planned_from_usual_time: false,
      trips: uids.map(trip),
      recommended_uid: uids[0] ?? null,
      wait_minutes: 0,
    });

    const details = (): Element | null => element().querySelector('[data-testid="trip-details"]');
    const rows = (boardIndex: number): HTMLButtonElement[] =>
      Array.from(
        element()
          .querySelectorAll('app-commute-board')
          [boardIndex].querySelectorAll<HTMLButtonElement>('[data-testid="trip-row-button"]'),
      );
    const click = async (button: HTMLButtonElement): Promise<void> => {
      button.click();
      await settle(fixture);
    };

    const loadBoards = async (): Promise<void> => {
      await loadList([saved, other]);
      http.expectOne('/api/commutes/1/trips/').flush(board(['a', 'b']));
      http.expectOne('/api/commutes/2/trips/').flush(board(['a', 'c']));
      await settle(fixture);
    };

    it('opens the details of a row with the commute destination and closes them', async () => {
      await loadBoards();
      expect(details()).toBeNull();
      await click(rows(0)[1]);
      expect(details()).not.toBeNull();
      expect(rows(0)[1].getAttribute('aria-expanded')).toBe('true');
      expect(rows(0)[0].getAttribute('aria-expanded')).toBe('false');
      expect(element().classList).toContain('with-details');
      http.expectOne('/api/stations/ASD/ov-fiets/').flush({
        station_code: 'ASD',
        available: 7,
        locations: [{ name: 'Amsterdam Centraal IJzijde', available: 7, open: 'Yes' }],
      });
      await settle(fixture);
      expect(details()?.textContent).toContain('7 OV-fietsen at Amsterdam Centraal');

      element().querySelector<HTMLButtonElement>('[data-testid="trip-details-close"]')!.click();
      await settle(fixture);
      expect(details()).toBeNull();
      expect(element().classList).not.toContain('with-details');
      expect(rows(0)[1].getAttribute('aria-expanded')).toBe('false');
    });

    it('shows one panel across boards and switches between them', async () => {
      await loadBoards();
      await click(rows(0)[0]);
      http.expectOne('/api/stations/ASD/ov-fiets/').flush({ station_code: 'ASD', locations: [] });
      await click(rows(1)[0]);
      // Same uid on another board is a different selection: the first board's row is deselected.
      expect(element().querySelectorAll('[data-testid="trip-details"]').length).toBe(1);
      expect(rows(0)[0].getAttribute('aria-expanded')).toBe('false');
      expect(rows(1)[0].getAttribute('aria-expanded')).toBe('true');
      http.expectOne('/api/stations/UT/ov-fiets/').flush({ station_code: 'UT', locations: [] });
      await settle(fixture);
      expect(details()?.textContent).toContain('Utrecht Centraal');
    });

    it('closes the details when the selected row is clicked again', async () => {
      await loadBoards();
      await click(rows(1)[1]);
      http.expectOne('/api/stations/UT/ov-fiets/').flush({ station_code: 'UT', locations: [] });
      await click(rows(1)[1]);
      expect(details()).toBeNull();
    });

    it('closes the details when a refresh no longer lists the trip', async () => {
      await loadBoards();
      await click(rows(0)[1]);
      http.expectOne('/api/stations/ASD/ov-fiets/').flush({ station_code: 'ASD', locations: [] });
      const refresh = Array.from(
        element().querySelectorAll('app-commute-board')[0].querySelectorAll('button'),
      ).find((b) => b.textContent?.includes('Refresh'))!;

      refresh.click();
      http.expectOne('/api/commutes/1/trips/').flush(board(['a', 'b']));
      await settle(fixture);
      expect(details()).not.toBeNull();

      refresh.click();
      http.expectOne('/api/commutes/1/trips/').flush(board(['a']));
      await settle(fixture);
      expect(details()).toBeNull();
    });

    it('keeps the details open when another board refreshes', async () => {
      await loadBoards();
      await click(rows(0)[1]);
      http.expectOne('/api/stations/ASD/ov-fiets/').flush({ station_code: 'ASD', locations: [] });
      const refresh = Array.from(
        element().querySelectorAll('app-commute-board')[1].querySelectorAll('button'),
      ).find((b) => b.textContent?.includes('Refresh'))!;
      refresh.click();
      http.expectOne('/api/commutes/2/trips/').flush(board(['x']));
      await settle(fixture);
      expect(details()).not.toBeNull();
    });

    it('closes the details when their commute is deleted', async () => {
      await loadBoards();
      await click(rows(0)[1]);
      http.expectOne('/api/stations/ASD/ov-fiets/').flush({ station_code: 'ASD', locations: [] });
      const remove = Array.from(
        element().querySelectorAll('app-commute-board')[0].querySelectorAll('button'),
      ).find((b) => b.textContent?.includes('Delete'))!;
      remove.click();
      http.expectOne((r) => r.method === 'DELETE').flush(null, { status: 204, statusText: 'x' });
      await settle(fixture);
      expect(details()).toBeNull();
    });
  });

  it('searches stations as you type', async () => {
    await loadList([]);
    page.form.controls.origin.setValue('utr');
    await new Promise((resolve) => setTimeout(resolve, 300));
    http
      .expectOne((r) => r.url === '/api/stations/' && r.params.get('q') === 'utr')
      .flush([{ code: 'UT', name: 'Utrecht Centraal' }]);
    await settle(fixture);
    page.form.controls.destination.setValue('u');
    await new Promise((resolve) => setTimeout(resolve, 300));
    http.expectNone((r) => r.url === '/api/stations/');
  });
});
