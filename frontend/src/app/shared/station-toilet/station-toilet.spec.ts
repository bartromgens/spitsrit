import { HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { StationToilets, Toilet } from '../../api/models';
import { settle, testProviders } from '../../testing';
import { StationToilet } from './station-toilet';

function toilets(...items: Partial<Toilet>[]): StationToilets {
  return {
    station_code: 'UT',
    toilets: items.map((t) => ({ name: 'Stationshal', open: 'Yes', ...t })),
  };
}

describe('StationToilet', () => {
  let fixture: ComponentFixture<StationToilet>;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [StationToilet], providers: testProviders });
    fixture = TestBed.createComponent(StationToilet);
    fixture.componentRef.setInput('stationCode', 'UT');
    http = TestBed.inject(HttpTestingController);
    await fixture.whenStable();
  });

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const icon = (): Element | null => el().querySelector('[data-testid="station-toilet"]');
  const respond = async (body: StationToilets | null, status = 200): Promise<void> => {
    http
      .expectOne('/api/stations/UT/toilets/')
      .flush(body, { status, statusText: status === 200 ? 'OK' : 'Error' });
    await settle(fixture);
  };

  it('shows a toilet icon, named for screen readers, when the station has a toilet', async () => {
    await respond(toilets({}));
    expect(icon()?.getAttribute('title')).toBe('Toilet');
    expect(el().textContent).toContain('Toilet');
    expect(el().textContent).not.toContain('closed');
  });

  it('counts a toilet whose state is unknown as possibly open', async () => {
    await respond(toilets({ open: 'No' }, { open: 'Unknown' }));
    expect(icon()).not.toBeNull();
    expect(el().textContent).not.toContain('closed');
  });

  it('says closed when every toilet is closed now', async () => {
    await respond(toilets({ open: 'No' }, { open: 'No' }));
    expect(icon()).not.toBeNull();
    expect(el().textContent).toContain('closed');
  });

  it('shows nothing for a station without a toilet', async () => {
    await respond(toilets());
    expect(icon()).toBeNull();
  });

  it('shows nothing when NS cannot tell', async () => {
    await respond(null, 502);
    expect(icon()).toBeNull();
  });

  it('loads the new station when it changes, ignoring a late answer for the old one', async () => {
    fixture.componentRef.setInput('stationCode', 'BKL');
    await fixture.whenStable();
    http.expectOne('/api/stations/BKL/toilets/').flush({ station_code: 'BKL', toilets: [] });
    await settle(fixture);
    await respond(toilets({}));
    expect(icon()).toBeNull();
  });
});
