import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { testProviders } from '../testing';
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

  it('shows an error for a wrong password', async () => {
    const fixture = await submit('bart', 'wrong');
    TestBed.inject(HttpTestingController)
      .expectOne('/api/auth/login/')
      .flush({ detail: 'Invalid' }, { status: 400, statusText: 'Bad Request' });
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')).not.toBeNull();
  });
});
