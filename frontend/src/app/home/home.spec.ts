import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { User } from '../api/models';
import { Auth } from '../auth';
import { settle, testProviders } from '../testing';
import { Home } from './home';

describe('Home', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ imports: [Home], providers: testProviders });
  });

  it('does not show the health check', async () => {
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    await settle(fixture);
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('[data-testid="health"]')).toBeNull();
    expect(element.textContent).not.toContain('Health');
    TestBed.inject(HttpTestingController).expectNone('/healthz');
  });

  it('puts the planner first, without the old commutes card', async () => {
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    await settle(fixture);
    const element = fixture.nativeElement as HTMLElement;
    expect(element.firstElementChild?.tagName).toBe('APP-TRIP-PLANNER');
    expect(element.querySelector('mat-card-title')?.textContent).toContain('Plan a trip');
    expect(element.textContent).not.toContain('Your commutes');
  });

  it('offers to save commutes when logged out', async () => {
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    await settle(fixture);
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('a[href="/login"]')?.textContent).toContain('Save your commutes');
    expect(element.querySelector('mat-chip')).toBeNull();
  });

  it('fills in and plans a commute when its chip is tapped', async () => {
    TestBed.inject(Auth).user.set({ id: 1, username: 'ada' } as User);
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/commutes/').flush({
      count: 1,
      next: null,
      previous: null,
      results: [
        {
          id: 1,
          name: 'Morning',
          created_at: '',
          origin_code: 'UT',
          origin_name: 'Utrecht Centraal',
          destination_code: 'ASD',
          destination_name: 'Amsterdam Centraal',
          usual_departure_time: '08:05:00',
        },
      ],
    });
    await settle(fixture);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('mat-chip')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Morning 08:05',
    );
    element.querySelector<HTMLButtonElement>('mat-chip button')?.click();
    http
      .expectOne('/api/trips/?from=UT&to=ASD')
      .flush({ fetched_at: '', trips: [], recommended_uid: null, wait_minutes: 0 });
    await settle(fixture);
    fixture.detectChanges();
    const inputs = element.querySelectorAll<HTMLInputElement>('input');
    expect(inputs[0].value).toBe('Utrecht Centraal');
    expect(inputs[1].value).toBe('Amsterdam Centraal');
    expect(element.querySelector('[data-testid="trip-results"]')).not.toBeNull();
    expect(JSON.parse(localStorage.getItem('spitsrit.lastTrip') ?? 'null')).toEqual({
      origin: { code: 'UT', name: 'Utrecht Centraal' },
      destination: { code: 'ASD', name: 'Amsterdam Centraal' },
    });
  });
});
