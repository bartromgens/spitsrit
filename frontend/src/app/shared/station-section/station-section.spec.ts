import { HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { settle, testProviders } from '../../testing';
import { StationSection } from './station-section';

describe('StationSection', () => {
  let fixture: ComponentFixture<StationSection>;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [StationSection], providers: testProviders });
    fixture = TestBed.createComponent(StationSection);
    fixture.componentRef.setInput('station', { code: 'UT', name: 'Utrecht Centraal' });
    http = TestBed.inject(HttpTestingController);
    await fixture.whenStable();
  });

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;

  it('has no heading until there is something to show', async () => {
    expect(el().querySelector('h3')).toBeNull();
    http
      .expectOne('/api/stations/UT/toilets/')
      .flush({ station_code: 'UT', toilets: [{ name: 'Stationshal', open: 'Yes' }] });
    await settle(fixture);
    expect(el().querySelector('h3')?.textContent).toBe('At Utrecht Centraal');
  });

  it('only asks for OV-fiets when told to', async () => {
    http.expectOne('/api/stations/UT/toilets/').flush({ station_code: 'UT', toilets: [] });
    http.expectNone('/api/stations/UT/ov-fiets/');
    await settle(fixture);
    expect(el().querySelector('h3')).toBeNull();
  });
});
