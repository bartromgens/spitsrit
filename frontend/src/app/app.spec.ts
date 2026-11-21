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

  it('says it is not affiliated with NS in the footer', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('footer')?.textContent).toContain('Not affiliated with NS');
  });

  it('shows the username when logged in', async () => {
    TestBed.inject(Auth).user.set({ id: 1, username: 'bart' });
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('mat-toolbar')?.textContent).toContain('bart');
  });

  it('logs out from the menu under the username, not from the toolbar', async () => {
    const auth = TestBed.inject(Auth);
    auth.user.set({ id: 1, username: 'bart' });
    const logout = vi.spyOn(auth, 'logout').mockResolvedValue();
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('mat-toolbar')?.textContent).not.toContain('Log out');
    element.querySelector<HTMLButtonElement>('[data-testid="user-menu"]')!.click();
    await fixture.whenStable();
    const item = document.querySelector<HTMLButtonElement>('[data-testid="logout"]');
    expect(item?.textContent?.trim()).toBe('Log out');
    item!.click();
    await fixture.whenStable();
    expect(logout).toHaveBeenCalled();
  });

  it('shows the navigation links in the toolbar after the brand', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const toolbar = element.querySelector('mat-toolbar');
    const links = Array.from(toolbar?.querySelectorAll('nav a') ?? []).map((a) => a.textContent);
    expect(links).toEqual(['Home', 'Commutes']);
    expect(element.querySelector('mat-sidenav')).toBeNull();
    const brand = toolbar?.querySelector('.brand') as Element;
    const nav = toolbar?.querySelector('nav') as Element;
    expect(brand.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('opens the mobile menu from the hamburger button', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    (element.querySelector('.menu-toggle') as HTMLButtonElement).click();
    await fixture.whenStable();
    const items = Array.from(document.querySelectorAll('a[mat-menu-item]')).map((a) =>
      a.textContent?.trim(),
    );
    expect(items).toEqual(['Home', 'Commutes']);
  });
});
