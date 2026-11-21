import { HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Commute } from '../api/models';
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
    TestBed.configureTestingModule({ imports: [Commutes], providers: testProviders });
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
