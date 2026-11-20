import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { Auth } from './auth';
import { authGuard } from './auth-guard';
import { testProviders } from './testing';

describe('authGuard', () => {
  const run = (url: string) =>
    TestBed.runInInjectionContext(() =>
      authGuard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
    );

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: testProviders });
  });

  it('redirects to login when logged out', () => {
    const result = run('/commutes');
    const router = TestBed.inject(Router);
    expect(router.serializeUrl(result as UrlTree)).toBe('/login?next=%2Fcommutes');
  });

  it('allows logged-in users', () => {
    TestBed.inject(Auth).user.set({ id: 1, username: 'bart' });
    expect(run('/commutes')).toBe(true);
  });
});
