import { HttpTestingController } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Commute, Trip, User } from '../api/models';
import { Auth } from '../auth';
import { Desktop } from '../shared/desktop/desktop';
import { settle, testProviders } from '../testing';
import { Commutes } from './commutes';

const first: Commute = {
  id: 1,
  name: 'A first',
  origin_code: 'UT',
  origin_name: 'Utrecht Centraal',
  destination_code: 'ASD',
  destination_name: 'Amsterdam Centraal',
  created_at: '2026-11-20T07:00:00Z',
};
const second: Commute = { ...first, id: 2, name: 'B second' };

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

const board = (uids: string[], recommended: string | null): object => ({
  fetched_at: '',
  planned_from: '',
  planned_from_usual_time: false,
  trips: uids.map(trip),
  recommended_uid: recommended,
  wait_minutes: 0,
});

describe('Commutes on desktop', () => {
  let fixture: ComponentFixture<Commutes>;
  let http: HttpTestingController;
  const wide = signal(true);

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const details = (): Element | null => element().querySelector('[data-testid="trip-details"]');
  const empty = (): Element | null => element().querySelector('[data-testid="trip-details-empty"]');
  const expanded = (boardIndex: number): (string | null)[] =>
    Array.from(
      element()
        .querySelectorAll('app-commute-board')
        [boardIndex].querySelectorAll<HTMLButtonElement>('[data-testid="trip-row-button"]'),
    ).map((r) => r.getAttribute('aria-expanded'));

  beforeEach(() => {
    wide.set(true);
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [Commutes],
      providers: [...testProviders, { provide: Desktop, useValue: { wide } }],
    });
    TestBed.inject(Auth).user.set({ id: 1 } as User);
    fixture = TestBed.createComponent(Commutes);
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

  const flushBoard = async (id: number, body: object): Promise<void> => {
    http.expectOne(`/api/commutes/${id}/trips/`).flush(body);
    await settle(fixture);
  };

  it('opens the first board’s recommended trip without a click', async () => {
    await loadList([first, second]);
    // The second board answers first: only the first board in the list opens a trip.
    await flushBoard(2, board(['x', 'y'], 'y'));
    expect(details()).toBeNull();
    await flushBoard(1, board(['a', 'b', 'c'], 'b'));
    expect(details()).not.toBeNull();
    expect(empty()).toBeNull();
    expect(expanded(0)).toEqual(['false', 'true', 'false']);
    expect(expanded(1)).toEqual(['false', 'false']);
  });

  it('falls back to the first trip of the first board without a recommendation', async () => {
    await loadList([first]);
    await flushBoard(1, board(['a', 'b'], null));
    expect(expanded(0)).toEqual(['true', 'false']);
  });

  it('shows an empty state when the first board has no trips', async () => {
    await loadList([first]);
    await flushBoard(1, board([], null));
    expect(details()).toBeNull();
    expect(empty()?.textContent).toContain('Select a trip');
  });

  it('shows an empty state without commutes', async () => {
    await loadList([]);
    expect(empty()?.textContent).toContain('No trips to show');
  });

  it('falls back to the recommended trip when a refresh removes the selected one', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      await loadList([first]);
      await flushBoard(1, board(['a', 'b'], 'a'));
      element().querySelectorAll<HTMLButtonElement>('[data-testid="trip-row-button"]')[1].click();
      await settle(fixture);
      expect(expanded(0)).toEqual(['false', 'true']);

      await vi.advanceTimersByTimeAsync(60_000);
      await flushBoard(1, board(['c', 'd'], 'd'));
      expect(expanded(0)).toEqual(['false', 'true']);
      expect(details()).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not reopen details the rider closed when a board refreshes', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      await loadList([first]);
      await flushBoard(1, board(['a'], 'a'));
      element().querySelector<HTMLButtonElement>('[data-testid="trip-details-close"]')!.click();
      await settle(fixture);
      await vi.advanceTimersByTimeAsync(60_000);
      await flushBoard(1, board(['a'], 'a'));
      expect(details()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('selects nothing on a narrow screen', async () => {
    wide.set(false);
    fixture.detectChanges();
    await loadList([first]);
    await flushBoard(1, board(['a', 'b'], 'a'));
    expect(details()).toBeNull();
    expect(empty()).toBeNull();
    expect(expanded(0)).toEqual(['false', 'false']);
  });
});
