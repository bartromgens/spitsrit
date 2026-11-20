import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { Auth } from './auth';
import { testProviders } from './testing';

describe('App', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [App], providers: testProviders });
  });

  it('shows a login link when logged out', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('mat-toolbar')?.textContent).toContain('Log in');
  });

  it('shows the username when logged in', async () => {
    TestBed.inject(Auth).user.set({ id: 1, username: 'bart' });
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('mat-toolbar')?.textContent).toContain('bart');
  });
});
