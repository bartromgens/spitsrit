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
    seats: 620,
    carriages: 8,
    train_type: 'VIRM',
    shorter_stock: null,
    shorter_stock_warning: null,
    train_origin: 'Nijmegen',
    train_destination: 'Den Haag C.',
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
    localStorage.clear();
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

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const toggle = async (): Promise<void> => {
    el().querySelector<HTMLButtonElement>('[data-testid="filters-toggle"]')!.click();
    await settle(fixture);
  };
  const chipTexts = (): string[] =>
    Array.from(el().querySelectorAll('[data-testid="filter-chip"]')).map((c) =>
      (c.textContent ?? '').trim(),
    );

  it('shows the route and tells you to leave now', async () => {
    await flush(
      trips({ trips: [trip({ train: 'IC 2736' })], recommended_uid: 'a', wait_minutes: 0 }),
    );
    expect(text()).toContain('Utrecht Centraal → Amsterdam Centraal');
    expect(text()).toContain('Leave now');
    expect(text()).toContain('IC');
    expect(text()).not.toContain('2736');
    expect(text()).toContain('platform 5');
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('[aria-label="620 seats"]')).not.toBeNull();
    expect(element.querySelector('[aria-label="8 carriages"]')).not.toBeNull();
  });

  it('always shows the train route, without a toggle', async () => {
    await flush(trips({ trips: [trip({})], recommended_uid: 'a', wait_minutes: 0 }));
    const element = fixture.nativeElement as HTMLElement;
    expect(text()).not.toContain('Show train route');
    expect(element.querySelector('[data-testid="train-route"]')?.textContent).toContain(
      'Nijmegen → Den Haag C.',
    );
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

  it('lays the results out edge to edge on mobile', async () => {
    await flush(trips({ trips: [trip({ uid: 'a' })] }));
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('ul.sp-trips')?.classList).toContain('sp-full-bleed');
    expect(element.querySelector('mat-card')?.classList).toContain('sp-card');
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

  it('shows the saved filters', async () => {
    const filtered = TestBed.createComponent(CommuteBoard);
    filtered.componentRef.setInput('commute', {
      ...commute,
      max_duration_minutes: 45,
      max_transfers: 1,
    });
    filtered.detectChanges();
    (filtered.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-testid="filters-toggle"]')!
      .click();
    filtered.detectChanges();
    const inputs = (filtered.nativeElement as HTMLElement).querySelectorAll('input');
    expect(inputs[0].value).toBe('45');
    expect(inputs[1].value).toBe('1');
    http.match('/api/commutes/7/trips/').forEach((r) => r.flush(trips({})));
    await settle(filtered);
  });

  it('saves changed filters as the commute defaults and reloads the trips', async () => {
    await flush(trips({}));
    await toggle();
    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      '[data-testid="max-transfers"]',
    )!;
    input.value = '1';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('change'));
    const patch = http.expectOne('/api/commutes/7/');
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ max_duration_minutes: null, max_transfers: 1 });
    patch.flush(commute);
    await new Promise((resolve) => setTimeout(resolve));
    await flush(trips({ trips: [trip({})], recommended_uid: 'a', wait_minutes: 0 }));
    expect(text()).toContain('Leave now');
  });

  it('does not save an invalid filter', async () => {
    await flush(trips({}));
    await toggle();
    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      '[data-testid="max-duration"]',
    )!;
    input.value = '0';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('change'));
    await settle(fixture);
    http.expectNone('/api/commutes/7/');
  });

  it('says when the filters could not be saved', async () => {
    await flush(trips({}));
    await toggle();
    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      '[data-testid="max-duration"]',
    )!;
    input.value = '30';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('change'));
    http.expectOne('/api/commutes/7/').flush(null, { status: 500, statusText: 'Error' });
    await settle(fixture);
    expect(text()).toContain('Could not save the filters.');
  });

  it('refreshes on demand and emits removal', async () => {
    await flush(trips({}));
    const removed: Commute[] = [];
    fixture.componentInstance.removed.subscribe((c) => removed.push(c));
    const buttons = Array.from(el().querySelectorAll('button'));
    const refresh = buttons.find((b) => b.textContent?.trim() === 'Refresh')!;
    const remove = buttons.find((b) => b.textContent?.trim() === 'Delete')!;
    refresh.click();
    await flush(trips({ trips: [trip({})], recommended_uid: 'a', wait_minutes: 3 }));
    expect(text()).toContain('Wait 3 min');
    remove.click();
    expect(removed).toEqual([commute]);
  });

  it('hides the fields and chips when no filter is set', async () => {
    await flush(trips({}));
    expect(el().querySelector('input')).toBeNull();
    expect(chipTexts()).toEqual([]);
    expect(el().querySelector('[data-testid="filters-toggle"]')).not.toBeNull();
  });

  it('shows chips only for the filters that are set, and expands from a chip', async () => {
    const filtered = TestBed.createComponent(CommuteBoard);
    filtered.componentRef.setInput('commute', { ...commute, max_transfers: 1 });
    filtered.detectChanges();
    const root = filtered.nativeElement as HTMLElement;
    const chips = root.querySelectorAll<HTMLElement>('[data-testid="filter-chip"]');
    expect(Array.from(chips).map((c) => c.textContent?.trim())).toEqual(['Max 1 transfer']);
    expect(root.querySelector('input')).toBeNull();
    root.querySelector<HTMLButtonElement>('button[data-testid="filter-chip"]')!.click();
    filtered.detectChanges();
    expect(root.querySelectorAll('input').length).toBe(2);
    http.match('/api/commutes/7/trips/').forEach((r) => r.flush(trips({})));
    await settle(filtered);
  });

  it('puts the filters icon button in the card header', async () => {
    await flush(trips({}));
    const button = el().querySelector<HTMLButtonElement>(
      'mat-card-header [data-testid="filters-toggle"]',
    )!;
    expect(button.getAttribute('aria-label')).toBe('Filters');
    expect(button.textContent?.trim()).toBe('');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    await toggle();
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });

  it('expands and collapses with the Filters button', async () => {
    await flush(trips({}));
    await toggle();
    expect(el().querySelectorAll('input').length).toBe(2);
    await toggle();
    expect(el().querySelector('input')).toBeNull();
  });

  it('words the chips plainly, with "Direct only" for no transfers', async () => {
    const filtered = TestBed.createComponent(CommuteBoard);
    filtered.componentRef.setInput('commute', {
      ...commute,
      max_duration_minutes: 55,
      max_transfers: 0,
    });
    filtered.detectChanges();
    const chips = (filtered.nativeElement as HTMLElement).querySelectorAll(
      '[data-testid="filter-chip"]',
    );
    expect(Array.from(chips).map((c) => c.textContent?.trim())).toEqual([
      'Max 55 min',
      'Direct only',
    ]);
    http.match('/api/commutes/7/trips/').forEach((r) => r.flush(trips({})));
    await settle(filtered);
  });

  it('updates the chips after saving', async () => {
    await flush(trips({}));
    await toggle();
    const input = el().querySelector<HTMLInputElement>('[data-testid="max-duration"]')!;
    input.value = '50';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('change'));
    http.expectOne('/api/commutes/7/').flush(commute);
    await new Promise((resolve) => setTimeout(resolve));
    await flush(trips({}));
    await toggle();
    expect(chipTexts()).toEqual(['Max 50 min']);
  });

  it('expands on a filter error', async () => {
    await flush(trips({}));
    expect(el().querySelector('input')).toBeNull();
    // Collapsed fields cannot fail validation, so drive the save path directly.
    fixture.componentInstance['maxDuration'].setValue(0);
    await fixture.componentInstance['saveFilters']();
    await settle(fixture);
    expect(el().querySelectorAll('input').length).toBe(2);
  });
});
