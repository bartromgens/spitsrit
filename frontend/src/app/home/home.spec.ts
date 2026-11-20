import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { User } from '../api/models';
import { Auth } from '../auth';
import { settle, testProviders } from '../testing';
import { Home } from './home';

describe('Home', () => {
  beforeEach(() => {
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

  it('links to the login page when logged out', async () => {
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    await settle(fixture);
    const link = (fixture.nativeElement as HTMLElement).querySelector('a[href="/login"]');
    expect(link?.textContent).toContain('Log in');
    expect((fixture.nativeElement as HTMLElement).querySelector('app-trip-planner')).toBeNull();
  });

  it('links to the commutes when logged in', async () => {
    TestBed.inject(Auth).user.set({ id: 1, username: 'ada' } as User);
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    await settle(fixture);
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('a[href="/commutes"]')).not.toBeNull();
    expect(element.querySelector('app-trip-planner')).not.toBeNull();
    expect(element.querySelector('a[href="/login"]')).toBeNull();
  });
});
