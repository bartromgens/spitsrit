import { HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { Station, Trip } from '../api/models';
import { settle, testProviders } from '../testing';
import { TripPlanner } from './trip-planner';

const utrecht: Station = { code: 'UT', name: 'Utrecht Centraal' };
const maastricht: Station = { code: 'MT', name: 'Maastricht' };

/** Only the fields the list reads; the rest is irrelevant to the filters. */
function tripWith(uid: string, transfers: number): Trip {
  return {
    uid,
    departure_planned: '2026-11-20T08:00:00Z',
    departure_actual: '2026-11-20T08:00:00Z',
    arrival_planned: '2026-11-20T10:00:00Z',
    arrival_actual: '2026-11-20T10:00:00Z',
    departure_delay_minutes: 0,
    arrival_delay_minutes: 0,
    duration_minutes: 120,
    departure_track: '5',
    transfers,
    status: 'NORMAL',
    cancelled: false,
    crowd_forecast: 'LOW',
    train: 'IC 900',
    seats: null,
    carriages: null,
    train_type: null,
    shorter_stock: null,
    shorter_stock_warning: null,
    train_origin: 'Utrecht',
    train_destination: 'Maastricht',
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
}

const response = (trips: Trip[]) => ({
  fetched_at: '',
  trips,
  recommended_uid: trips[0]?.uid ?? null,
  wait_minutes: 0,
});

interface Internals {
  pick(side: 'origin' | 'destination', event: MatAutocompleteSelectedEvent): void;
  plan(): Promise<void>;
}

describe('TripPlanner filters', () => {
  let fixture: ComponentFixture<TripPlanner>;
  let planner: Internals;
  let http: HttpTestingController;
  let element: HTMLElement;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ imports: [TripPlanner], providers: testProviders });
    fixture = TestBed.createComponent(TripPlanner);
    planner = fixture.componentInstance as unknown as Internals;
    http = TestBed.inject(HttpTestingController);
    element = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    for (const [side, station] of [
      ['origin', utrecht],
      ['destination', maastricht],
    ] as const) {
      planner.pick(side, { option: { value: station } } as MatAutocompleteSelectedEvent);
    }
  });

  const q = <T extends HTMLElement>(testid: string): T | null =>
    element.querySelector<T>(`[data-testid="${testid}"]`);
  const chips = (): string[] =>
    Array.from(element.querySelectorAll('[data-testid="filter-chip"]')).map(
      (c) => c.textContent?.trim() ?? '',
    );
  const open = async (): Promise<void> => {
    q('filters-toggle')!.click();
    await settle(fixture);
  };
  /** Picks an option of the transfers select by index: 0 Any, 1 Direct only, 2 one or fewer. */
  const choose = async (index: number): Promise<void> => {
    const select = q<HTMLSelectElement>('max-transfers')!;
    select.selectedIndex = index;
    select.dispatchEvent(new Event('change'));
    await settle(fixture);
  };

  it('is collapsed with no chips by default', () => {
    expect(q('filters-toggle')).not.toBeNull();
    expect(q('max-transfers')).toBeNull();
    expect(q('max-duration')).toBeNull();
    expect(chips()).toEqual([]);
  });

  it('plans with Direct only as max_transfers=0 and shows the direct trips', async () => {
    await open();
    await choose(1);
    const planned = planner.plan();
    http
      .expectOne('/api/trips/?from=UT&max_transfers=0&to=MT')
      .flush(response([tripWith('direct', 0)]));
    await planned;
    await settle(fixture);
    expect(element.querySelectorAll('[data-testid="trip-row-button"]').length).toBe(1);
    expect(element.textContent).not.toContain('1 transfer');
    expect(element.textContent).toContain('IC');
  });

  it('shows chips for active filters only, and tapping one opens the filters', async () => {
    await open();
    await choose(1);
    q<HTMLButtonElement>('filters-toggle')!.click();
    await settle(fixture);
    expect(q('max-transfers')).toBeNull();
    expect(chips()).toEqual(['Direct only']);

    q<HTMLButtonElement>('filter-chip')!.click();
    await settle(fixture);
    expect(q('max-transfers')).not.toBeNull();
    expect(chips()).toEqual([]);
  });

  it('passes the max duration along', async () => {
    await open();
    const input = q<HTMLInputElement>('max-duration')!;
    input.value = '90';
    input.dispatchEvent(new Event('input'));
    await settle(fixture);
    const planned = planner.plan();
    http.expectOne('/api/trips/?from=UT&max_duration=90&to=MT').flush(response([]));
    await planned;
  });

  it('re-plans when a filter changes while results are shown', async () => {
    const planned = planner.plan();
    http.expectOne('/api/trips/?from=UT&to=MT').flush(response([tripWith('a', 2)]));
    await planned;
    await settle(fixture);
    await open();

    await choose(2);
    http.expectOne('/api/trips/?from=UT&max_transfers=1&to=MT').flush(response([]));
    await settle(fixture);
  });

  it('does not plan when a filter changes before any results', async () => {
    await open();
    await choose(1);
    http.expectNone((r) => r.url.startsWith('/api/trips/'));
  });
});
