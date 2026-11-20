import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { settle, testProviders } from '../../testing';
import { Register } from './register';

describe('Register', () => {
  async function submit(email: string, password: string) {
    const fixture = TestBed.createComponent(Register);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const [emailInput, passwordInput] = Array.from(element.querySelectorAll('input'));
    emailInput.value = email;
    emailInput.dispatchEvent(new Event('input'));
    passwordInput.value = password;
    passwordInput.dispatchEvent(new Event('input'));
    element.querySelector('form')?.dispatchEvent(new Event('submit'));
    return fixture;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [Register], providers: testProviders });
  });

  it('asks for an email address, not a username', async () => {
    const fixture = TestBed.createComponent(Register);
    await fixture.whenStable();
    const text = (fixture.nativeElement as HTMLElement).textContent;
    expect(text).toContain('Email');
    expect(text).not.toContain('Username');
  });

  it('creates the account and goes to the commutes page', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const fixture = await submit('bart@example.com', 'a-good-passphrase-42');
    const request = TestBed.inject(HttpTestingController).expectOne('/api/auth/register/');
    expect(request.request.body).toEqual({
      email: 'bart@example.com',
      password: 'a-good-passphrase-42',
    });
    request.flush({ id: 1, username: 'bart@example.com' }, { status: 201, statusText: 'Created' });
    await settle(fixture);
    expect(navigate).toHaveBeenCalledWith('/commutes');
  });

  it('does not send an invalid email address', async () => {
    await submit('not-an-email', 'a-good-passphrase-42');
    TestBed.inject(HttpTestingController).expectNone('/api/auth/register/');
  });

  it('shows the messages from the server', async () => {
    const fixture = await submit('bart@example.com', 'short');
    TestBed.inject(HttpTestingController)
      .expectOne('/api/auth/register/')
      .flush(
        { password: ['This password is too short.'] },
        { status: 400, statusText: 'Bad Request' },
      );
    await settle(fixture);
    const alert = (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('too short');
  });

  it('shows a generic message when the server fails', async () => {
    const fixture = await submit('bart@example.com', 'a-good-passphrase-42');
    TestBed.inject(HttpTestingController)
      .expectOne('/api/auth/register/')
      .flush(null, { status: 500, statusText: 'Server Error' });
    await settle(fixture);
    const alert = (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('failed');
  });
});
