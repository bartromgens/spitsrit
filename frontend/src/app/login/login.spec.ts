import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { settle, testProviders } from '../testing';
import { Login } from './login';

describe('Login', () => {
  async function submit(username: string, password: string) {
    const fixture = TestBed.createComponent(Login);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const [user, pass] = Array.from(element.querySelectorAll('input'));
    user.value = username;
    user.dispatchEvent(new Event('input'));
    pass.value = password;
    pass.dispatchEvent(new Event('input'));
    element.querySelector('form')?.dispatchEvent(new Event('submit'));
    return fixture;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [Login], providers: testProviders });
  });

  it('logs in and goes to the commutes page', async () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = await submit('bart', 'secret');
    TestBed.inject(HttpTestingController)
      .expectOne('/api/auth/login/')
      .flush({ id: 1, username: 'bart' });
    await fixture.whenStable();
    expect(navigate).toHaveBeenCalledWith('/commutes');
  });

  it('asks for an email address, not a username', async () => {
    const fixture = TestBed.createComponent(Login);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Email');
    expect(element.textContent).not.toContain('Username');
    expect(element.querySelector('a[href="/register"]')).not.toBeNull();
  });

  it('shows an error for a wrong password', async () => {
    const fixture = await submit('bart', 'wrong');
    TestBed.inject(HttpTestingController)
      .expectOne('/api/auth/login/')
      .flush({ detail: 'Invalid' }, { status: 400, statusText: 'Bad Request' });
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')).not.toBeNull();
  });

  describe('with Google', () => {
    async function open(googleLogin: boolean, error: string | null = null) {
      TestBed.overrideProvider(ActivatedRoute, {
        useValue: { snapshot: { queryParamMap: convertToParamMap(error ? { error } : {}) } },
      });
      const fixture = TestBed.createComponent(Login);
      await fixture.whenStable();
      TestBed.inject(HttpTestingController)
        .expectOne('/api/config/')
        .flush({ sentry_dsn: '', environment: 'test', release: 'x', google_login: googleLogin });
      await settle(fixture);
      return fixture.nativeElement as HTMLElement;
    }

    it('shows the Google button when Google login is configured', async () => {
      const link = (await open(true)).querySelector('a.google');
      expect(link?.getAttribute('href')).toBe('/api/auth/google/');
      expect(link?.textContent).toContain('Log in with Google');
    });

    it('hides the Google button when it is not configured', async () => {
      expect((await open(false)).querySelector('a.google')).toBeNull();
    });

    it('shows an error after a failed Google login', async () => {
      const element = await open(true, 'google');
      expect(element.querySelector('[role="alert"]')?.textContent).toContain('Google');
    });
  });
});
