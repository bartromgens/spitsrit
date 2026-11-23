import { TestBed } from '@angular/core/testing';
import { LastStationsStore } from './last-stations';

const utrecht = { code: 'UT', name: 'Utrecht Centraal' };
const amsterdam = { code: 'ASD', name: 'Amsterdam Centraal' };

describe('LastStationsStore', () => {
  let store: LastStationsStore;

  beforeEach(() => {
    localStorage.clear();
    store = TestBed.inject(LastStationsStore);
  });

  it('loads nothing before anything was saved', () => {
    expect(store.load()).toBeNull();
  });

  it('loads what was saved', () => {
    store.save(utrecht, amsterdam);
    expect(store.load()).toEqual({ origin: utrecht, destination: amsterdam });
  });

  it('ignores invalid JSON and incomplete stations', () => {
    localStorage.setItem('spitsrit.lastTrip', '{nope');
    expect(store.load()).toBeNull();
    localStorage.setItem('spitsrit.lastTrip', JSON.stringify({ origin: utrecht }));
    expect(store.load()).toBeNull();
    localStorage.setItem('spitsrit.lastTrip', 'null');
    expect(store.load()).toBeNull();
  });

  it('does not throw when storage is blocked', () => {
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    expect(() => store.save(utrecht, amsterdam)).not.toThrow();
    set.mockRestore();
  });
});
