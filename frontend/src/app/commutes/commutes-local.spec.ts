import { HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Commute } from '../api/models';
import { settle, testProviders } from '../testing';
import { STORAGE_KEY } from './commute-store';
import { Commutes } from './commutes';

const saved: Commute = {
  id: 1,
  name: 'To work',
  origin_code: 'UT',
  origin_name: 'Utrecht Centraal',
  destination_code: 'ASD',
  destination_name: 'Amsterdam Centraal',
  created_at: '2026-11-20T07:00:00Z',
  usual_departure_time: '08:05:00',
  max_duration_minutes: 45,
};

interface Internals {
  form: Commutes['form'];
  pick(side: 'origin' | 'destination', event: unknown): void;
  add(): Promise<void>;
}

describe('Commutes while logged out', () => {
  let fixture: ComponentFixture<Commutes>;
  let http: HttpTestingController;
  let page: Internals;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const stored = (): Commute[] =>
    JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as Commute[];
  const stationEvent = (code: string, name: string): unknown => ({
    option: { value: { code, name } },
  });

  const render = async (): Promise<void> => {
    TestBed.configureTestingModule({ imports: [Commutes], providers: testProviders });
    fixture = TestBed.createComponent(Commutes);
    page = fixture.componentInstance as unknown as Internals;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    await settle(fixture);
    fixture.detectChanges();
  };

  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('works without calling the commutes endpoints, with a calm note and a register link', async () => {
    await render();
    http.expectNone((r) => r.url.startsWith('/api/commutes'));
    expect(element().textContent).toContain('No commutes yet');
    const note = element().querySelector('[data-testid="local-note"]');
    expect(note?.textContent).toContain(
      'Saved on this device. Create an account to use your commutes on other devices.',
    );
    expect(note?.querySelector('a')?.getAttribute('href')).toBe('/register');
    expect(element().querySelector('[data-testid="storage-notice"]')).toBeNull();
  });

  it('saves a commute on this device and shows its board from /api/trips/', async () => {
    await render();
    page.form.patchValue({ name: 'To work', usualTime: '08:05' });
    page.pick('origin', stationEvent('UT', 'Utrecht Centraal'));
    page.pick('destination', stationEvent('ASD', 'Amsterdam Centraal'));
    await page.add();
    fixture.detectChanges();

    expect(stored()).toHaveLength(1);
    expect(stored()[0]).toMatchObject({ name: 'To work', usual_departure_time: '08:05:00' });
    const call = http.expectOne((r) => r.url === '/api/trips/');
    expect(call.request.params.get('usual')).toBe('08:05');
    call.flush({
      fetched_at: '',
      planned_from: '',
      planned_from_usual_time: true,
      planned_tomorrow: false,
      trips: [],
      recommended_uid: null,
      wait_minutes: null,
    });
    await settle(fixture);
    expect(element().querySelector('app-commute-board')).not.toBeNull();
  });

  it('lists the commutes saved earlier, saves filter edits and deletes them', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([saved]));
    await render();
    const first = http.expectOne((r) => r.url === '/api/trips/');
    expect(first.request.params.get('max_duration')).toBe('45');
    first.flush(null, { status: 503, statusText: 'x' });
    await settle(fixture);
    expect(element().textContent).toContain('To work');

    const input = element().querySelector<HTMLInputElement>('[data-testid="max-duration"]');
    element().querySelector<HTMLButtonElement>('[data-testid="filters-toggle"]')!.click();
    await settle(fixture);
    const field = element().querySelector<HTMLInputElement>('[data-testid="max-duration"]')!;
    expect(input).toBeNull();
    field.value = '30';
    field.dispatchEvent(new Event('input'));
    field.dispatchEvent(new Event('change'));
    await settle(fixture);
    expect(stored()[0].max_duration_minutes).toBe(30);
    http.expectOne((r) => r.url === '/api/trips/').flush(null, { status: 503, statusText: 'x' });
    await settle(fixture);

    Array.from(element().querySelectorAll('button'))
      .find((b) => b.textContent?.includes('Delete'))
      ?.click();
    await settle(fixture);
    expect(stored()).toEqual([]);
    expect(element().querySelector('app-commute-board')).toBeNull();
  });

  it('shows a small notice and still works when storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    await render();
    page.form.patchValue({ name: 'To work' });
    page.pick('origin', stationEvent('UT', 'Utrecht Centraal'));
    page.pick('destination', stationEvent('ASD', 'Amsterdam Centraal'));
    await page.add();
    fixture.detectChanges();
    http.expectOne((r) => r.url === '/api/trips/').flush(null, { status: 503, statusText: 'x' });
    await settle(fixture);
    expect(element().querySelector('[data-testid="storage-notice"]')).not.toBeNull();
    expect(element().querySelector('app-commute-board')).not.toBeNull();
  });
});
