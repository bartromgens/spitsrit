import { TestBed } from '@angular/core/testing';
import { Trip } from '../../api/models';
import { Desktop, defaultTrip } from './desktop';

describe('defaultTrip', () => {
  const trips = [{ uid: 'a' }, { uid: 'b' }] as Trip[];

  it('prefers the recommended trip, then the first, then none', () => {
    expect(defaultTrip(trips, 'b')?.uid).toBe('b');
    expect(defaultTrip(trips, null)?.uid).toBe('a');
    expect(defaultTrip(trips, 'gone')?.uid).toBe('a');
    expect(defaultTrip([], null)).toBeNull();
  });
});

describe('Desktop', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('follows the details breakpoint', () => {
    let listener: (event: MediaQueryListEvent) => void = () => undefined;
    const query = {
      matches: false,
      addEventListener: (_: string, fn: typeof listener) => (listener = fn),
      removeEventListener: () => undefined,
    };
    vi.stubGlobal('matchMedia', (q: string) => {
      expect(q).toBe('(max-width: 52rem)');
      return query;
    });
    const desktop = TestBed.inject(Desktop);
    expect(desktop.wide()).toBe(true);
    listener({ matches: true } as MediaQueryListEvent);
    expect(desktop.wide()).toBe(false);
  });

  it('is not wide without matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(TestBed.inject(Desktop).wide()).toBe(false);
  });
});
