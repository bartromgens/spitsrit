import { HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { OvFiets, OvFietsLocation } from '../../api/models';
import { settle, testProviders } from '../../testing';
import { OvFietsCount } from './ov-fiets-count';

function point(overrides: Partial<OvFietsLocation>): OvFietsLocation {
  return { name: 'Utrecht Centraal Knoop', available: 33, open: 'Yes', ...overrides };
}

function ovFiets(...locations: OvFietsLocation[]): OvFiets {
  const counts = locations.flatMap((l) =>
    l.available === null || l.open === 'No' ? [] : [l.available],
  );
  return {
    station_code: 'UT',
    available: counts.length ? counts.reduce((a, b) => a + b, 0) : null,
    locations,
  };
}

describe('OvFietsCount', () => {
  let fixture: ComponentFixture<OvFietsCount>;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [OvFietsCount], providers: testProviders });
    fixture = TestBed.createComponent(OvFietsCount);
    fixture.componentRef.setInput('stationCode', 'UT');
    fixture.componentRef.setInput('stationName', 'Utrecht Centraal');
    http = TestBed.inject(HttpTestingController);
    await fixture.whenStable();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const text = (): string => (el().textContent ?? '').replace(/\s+/g, ' ').trim();
  const rows = (): (string | undefined)[][] =>
    Array.from(el().querySelectorAll('li')).map((li) =>
      Array.from(li.querySelectorAll('span')).map((span) => span.textContent?.trim()),
    );
  const respond = async (body: OvFiets | null, status = 200): Promise<void> => {
    http
      .expectOne('/api/stations/UT/ov-fiets/')
      .flush(body, { status, statusText: status === 200 ? 'OK' : 'Error' });
    await settle(fixture);
  };

  it('shows the total at the station with a bike icon', async () => {
    await respond(ovFiets(point({})));
    expect(text()).toContain('33 OV-fietsen at Utrecht Centraal');
    expect(el().querySelector('app-facility-icon')).not.toBeNull();
    expect(el().querySelector('ul')).toBeNull();
  });

  it('says one bike in the singular', async () => {
    await respond(ovFiets(point({ available: 1 })));
    expect(text()).toContain('1 OV-fiets at Utrecht Centraal');
  });

  it('lists each rental point, without the station name, when there are several', async () => {
    await respond(
      ovFiets(
        point({ name: 'Utrecht Centraal Jaarbeursplein', available: 10 }),
        point({ name: 'Utrecht Centraal Knoop', available: 33 }),
        point({ name: 'Fietsenstalling Oost', available: null }),
        point({ name: 'Utrecht Centraal Stationsplein', available: 4, open: 'No' }),
      ),
    );
    expect(text()).toContain('43 OV-fietsen at Utrecht Centraal');
    expect(rows()).toEqual([
      ['Jaarbeursplein', '10'],
      ['Knoop', '33'],
      ['Fietsenstalling Oost', '?'],
      ['Stationsplein', 'closed'],
    ]);
    expect(el().querySelectorAll('li.closed')).toHaveLength(1);
  });

  it('drops the station name however NS joins it to the rental point', async () => {
    fixture.componentRef.setInput('stationName', 'Leiden Centraal');
    await respond(
      ovFiets(
        point({ name: 'Leiden Centraal,Uitgang LUMC', available: 6 }),
        point({ name: 'Leiden Centraal, Centrumzijde', available: 28, open: 'No' }),
        point({ name: 'Leiden Centraal', available: 1 }),
      ),
    );
    expect(text()).toContain('7 OV-fietsen at Leiden Centraal');
    expect(rows()).toEqual([
      ['Uitgang LUMC', '6'],
      ['Centrumzijde', 'closed'],
      ['Leiden Centraal', '1'],
    ]);
  });

  it('says closed now when every rental point is closed', async () => {
    await respond(ovFiets(point({ open: 'No' }), point({ name: 'Oost', open: 'No' })));
    expect(text()).toContain('OV-fiets at Utrecht Centraal: closed now');
  });

  it('says when no rental point gives a number', async () => {
    await respond(ovFiets(point({ available: null })));
    expect(text()).toContain('OV-fiets at Utrecht Centraal: number unknown');
  });

  it('shows nothing for a station without OV-fiets', async () => {
    await respond(ovFiets());
    expect(text()).toBe('');
  });

  it('shows nothing when the count is unavailable', async () => {
    await respond(null, 502);
    expect(text()).toBe('');
  });

  it('loads the new station when it changes, ignoring a late answer for the old one', async () => {
    fixture.componentRef.setInput('stationCode', 'ASD');
    fixture.componentRef.setInput('stationName', 'Amsterdam Centraal');
    await fixture.whenStable();
    http
      .expectOne('/api/stations/ASD/ov-fiets/')
      .flush({ ...ovFiets(point({})), station_code: 'ASD' });
    await settle(fixture);
    await respond(ovFiets(point({ available: 2 })));
    expect(text()).toContain('33 OV-fietsen at Amsterdam Centraal');
  });
});

describe('OvFietsCount refresh', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reloads the count every minute', async () => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({ imports: [OvFietsCount], providers: testProviders });
    const fixture = TestBed.createComponent(OvFietsCount);
    fixture.componentRef.setInput('stationCode', 'UT');
    fixture.componentRef.setInput('stationName', 'Utrecht Centraal');
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne('/api/stations/UT/ov-fiets/').flush(ovFiets(point({})));
    await vi.advanceTimersByTimeAsync(60_000);
    http.expectOne('/api/stations/UT/ov-fiets/').flush(ovFiets(point({ available: 5 })));
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('5 OV-fietsen');
  });
});
