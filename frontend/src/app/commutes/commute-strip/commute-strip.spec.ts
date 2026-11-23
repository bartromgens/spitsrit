import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Commute, User } from '../../api/models';
import { Auth } from '../../auth';
import { settle, testProviders } from '../../testing';
import { CommuteStrip } from './commute-strip';

function commute(id: number, name: string, usual: string | null): Commute {
  return {
    id,
    name,
    created_at: '',
    origin_code: 'UT',
    origin_name: 'Utrecht Centraal',
    destination_code: 'ASD',
    destination_name: 'Amsterdam Centraal',
    usual_departure_time: usual,
  };
}

describe('CommuteStrip', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [CommuteStrip], providers: testProviders });
  });

  const render = async (loggedIn: boolean, commutes: Commute[] = []) => {
    if (loggedIn) TestBed.inject(Auth).user.set({ id: 1 } as User);
    const fixture = TestBed.createComponent(CommuteStrip);
    fixture.detectChanges();
    if (loggedIn) {
      TestBed.inject(HttpTestingController)
        .expectOne('/api/commutes/')
        .flush({ count: commutes.length, next: null, previous: null, results: commutes });
    }
    await settle(fixture);
    fixture.detectChanges();
    return { fixture, element: fixture.nativeElement as HTMLElement };
  };

  it('shows chips with name and usual time, ordered by next usual time', async () => {
    const now = new Date();
    const at = (offsetMinutes: number): string => {
      const d = new Date(now.getTime() + offsetMinutes * 60_000);
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:00`;
    };
    const later = commute(1, 'Later', at(180));
    const sooner = commute(2, 'Sooner', at(120));
    const none = commute(3, 'Anytime', null);
    const { element } = await render(true, [none, later, sooner]);
    const chips = Array.from(element.querySelectorAll('button.sp-chip')).map((c) =>
      c.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(chips).toEqual([
      `Sooner ${at(120).slice(0, 5)}`,
      `Later ${at(180).slice(0, 5)}`,
      'Anytime',
    ]);
    expect(element.querySelector('a[href="/commutes"]')?.textContent).toContain('All commutes');
    expect(element.querySelector('h2')?.textContent).toContain('Your commutes');
    expect(element.querySelector('button.sp-chip .sp-mono')?.textContent).toBe(at(120).slice(0, 5));
    expect(element.querySelector('mat-chip')).toBeNull();
  });

  it('emits the commute when its chip is tapped', async () => {
    const saved = commute(1, 'Morning', '08:05:00');
    const { fixture, element } = await render(true, [saved]);
    const chosen: Commute[] = [];
    fixture.componentInstance.chosen.subscribe((c) => chosen.push(c));
    element.querySelector<HTMLButtonElement>('button.sp-chip')?.click();
    expect(chosen).toEqual([saved]);
  });

  it('shows only the All commutes link without commutes', async () => {
    const { element } = await render(true, []);
    expect(element.querySelector('button.sp-chip')).toBeNull();
    expect(element.querySelector('a[href="/commutes"]')).not.toBeNull();
  });

  it('offers to save commutes when logged out', async () => {
    const { element } = await render(false);
    expect(element.querySelector('button.sp-chip')).toBeNull();
    expect(element.querySelector('a[href="/login"]')?.textContent).toContain('Save your commutes');
    TestBed.inject(HttpTestingController).expectNone('/api/commutes/');
  });
});
