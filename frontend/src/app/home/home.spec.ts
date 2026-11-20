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

  it('shows the health check', async () => {
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    TestBed.inject(HttpTestingController)
      .expectOne('/healthz')
      .flush({ status: 'ok', version: 'abc123', db: 'ok' });
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('[data-testid="health"]')?.textContent).toContain('abc123');
  });

  it('says when the backend is unreachable', async () => {
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    TestBed.inject(HttpTestingController)
      .expectOne('/healthz')
      .flush(null, { status: 503, statusText: 'Unavailable' });
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('not reachable');
  });

  it('links to the login page when logged out', async () => {
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    await settle(fixture);
    const link = (fixture.nativeElement as HTMLElement).querySelector('a[href="/login"]');
    expect(link?.textContent).toContain('Log in');
  });

  it('links to the commutes when logged in', async () => {
    TestBed.inject(Auth).user.set({ id: 1, username: 'ada' } as User);
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    await settle(fixture);
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('a[href="/commutes"]')).not.toBeNull();
    expect(element.querySelector('a[href="/login"]')).toBeNull();
  });
});
