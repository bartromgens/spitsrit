import { TestBed } from '@angular/core/testing';
import { TrainRouteSetting } from './train-route-setting';

describe('TrainRouteSetting', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('is off by default', () => {
    expect(TestBed.inject(TrainRouteSetting).show()).toBe(false);
  });

  it('remembers the choice across reloads', () => {
    TestBed.inject(TrainRouteSetting).set(true);
    TestBed.resetTestingModule();
    expect(TestBed.inject(TrainRouteSetting).show()).toBe(true);
    TestBed.inject(TrainRouteSetting).set(false);
    TestBed.resetTestingModule();
    expect(TestBed.inject(TrainRouteSetting).show()).toBe(false);
  });

  it('falls back to off when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const setting = TestBed.inject(TrainRouteSetting);
    expect(setting.show()).toBe(false);
    setting.set(true);
    expect(setting.show()).toBe(true);
  });
});
