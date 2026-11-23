import { HttpTestingController } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { Station, Trip } from '../api/models';
import { Desktop } from '../shared/desktop/desktop';
import { settle, testProviders } from '../testing';
import { TripPlanner } from './trip-planner';

const utrecht: Station = { code: 'UT', name: 'Utrecht Centraal' };
const amsterdam: Station = { code: 'ASD', name: 'Amsterdam Centraal' };

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

interface Internals {
  pick(side: 'origin' | 'destination', event: MatAutocompleteSelectedEvent): void;
  plan(): Promise<void>;
}

describe('TripPlanner on desktop', () => {
  let fixture: ComponentFixture<TripPlanner>;
  let planner: Internals;
  let http: HttpTestingController;
  const wide = signal(true);

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const details = (): Element | null => element().querySelector('[data-testid="trip-details"]');
  const empty = (): Element | null => element().querySelector('[data-testid="trip-details-empty"]');
  const openTitle = (): string => details()?.querySelector('h2')?.textContent ?? '';

  beforeEach(() => {
    localStorage.clear();
    wide.set(true);
    TestBed.configureTestingModule({
      imports: [TripPlanner],
      providers: [...testProviders, { provide: Desktop, useValue: { wide } }],
    });
    fixture = TestBed.createComponent(TripPlanner);
    planner = fixture.componentInstance as unknown as Internals;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    for (const [side, station] of [
      ['origin', utrecht],
      ['destination', amsterdam],
    ] as const) {
      planner.pick(side, { option: { value: station } } as MatAutocompleteSelectedEvent);
    }
  });

  const planWith = async (uids: string[], recommended: string | null): Promise<void> => {
    const planned = planner.plan();
    http.expectOne('/api/trips/?from=UT&to=ASD').flush({
      fetched_at: '',
      trips: uids.map(trip),
      recommended_uid: recommended,
      wait_minutes: 0,
    });
    await planned;
    await settle(fixture);
  };

  const rows = (): HTMLButtonElement[] =>
    Array.from(element().querySelectorAll<HTMLButtonElement>('[data-testid="trip-row-button"]'));

  it('shows a prompt in the details pane before anything is planned', () => {
    expect(details()).toBeNull();
    expect(empty()?.textContent).toContain('Plan a trip');
  });

  it('opens the recommended trip after planning', async () => {
    await planWith(['a', 'b', 'c'], 'b');
    expect(details()).not.toBeNull();
    expect(empty()).toBeNull();
    expect(rows().map((r) => r.getAttribute('aria-expanded'))).toEqual(['false', 'true', 'false']);
  });

  it('falls back to the first trip without a recommendation', async () => {
    await planWith(['a', 'b'], null);
    expect(rows().map((r) => r.getAttribute('aria-expanded'))).toEqual(['true', 'false']);
  });

  it('shows an empty state when there are no trips', async () => {
    await planWith([], null);
    expect(details()).toBeNull();
    expect(empty()?.textContent).toContain('No trips to show');
  });

  it('lets another row be selected', async () => {
    await planWith(['a', 'b'], 'a');
    rows()[1].click();
    await settle(fixture);
    expect(rows().map((r) => r.getAttribute('aria-expanded'))).toEqual(['false', 'true']);
    expect(openTitle()).not.toBe('');
  });

  it('falls back to the recommended trip when a new plan no longer has the selected one', async () => {
    await planWith(['a', 'b'], 'a');
    rows()[1].click();
    await settle(fixture);
    await planWith(['c', 'd'], 'd');
    expect(rows().map((r) => r.getAttribute('aria-expanded'))).toEqual(['false', 'true']);
  });

  it('selects nothing on a narrow screen', async () => {
    wide.set(false);
    fixture.detectChanges();
    expect(empty()).toBeNull();
    await planWith(['a', 'b'], 'a');
    expect(details()).toBeNull();
    expect(empty()).toBeNull();
    expect(rows().map((r) => r.getAttribute('aria-expanded'))).toEqual(['false', 'false']);
  });
});
