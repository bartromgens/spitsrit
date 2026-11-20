import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Auth } from './auth';
import { testProviders } from './testing';

describe('Auth', () => {
  let auth: Auth;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: testProviders });
    auth = TestBed.inject(Auth);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads the logged-in user', async () => {
    const loading = auth.load();
    http.expectOne('/api/auth/me/').flush({ id: 1, username: 'bart' });
    await loading;
    expect(auth.loggedIn()).toBe(true);
  });

  it('treats an empty response as logged out', async () => {
    const loading = auth.load();
    http.expectOne('/api/auth/me/').flush(null, { status: 204, statusText: 'No Content' });
    await loading;
    expect(auth.loggedIn()).toBe(false);
  });

  it('logs in and out', async () => {
    const login = auth.login('bart', 'secret');
    const request = http.expectOne('/api/auth/login/');
    expect(request.request.body).toEqual({ username: 'bart', password: 'secret' });
    request.flush({ id: 1, username: 'bart' });
    await login;
    expect(auth.user()?.username).toBe('bart');

    const logout = auth.logout();
    http.expectOne('/api/auth/logout/').flush(null, { status: 204, statusText: 'No Content' });
    await logout;
    expect(auth.user()).toBeNull();
  });
});
