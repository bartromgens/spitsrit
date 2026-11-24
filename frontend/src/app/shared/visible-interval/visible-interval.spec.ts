import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { visibleInterval } from './visible-interval';

const MS = 120_000;

@Component({ selector: 'app-host', template: '' })
class Host {
  readonly calls = vi.fn();
  constructor() {
    visibleInterval(this.calls, MS);
  }
}

describe('visibleInterval', () => {
  let state: DocumentVisibilityState;

  const setVisibility = (next: DocumentVisibilityState): void => {
    state = next;
    document.dispatchEvent(new Event('visibilitychange'));
  };
  const create = (): Host => TestBed.createComponent(Host).componentInstance;

  beforeEach(() => {
    vi.useFakeTimers();
    state = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => state);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('calls back every interval while visible', () => {
    const host = create();
    vi.advanceTimersByTime(MS * 2);
    expect(host.calls).toHaveBeenCalledTimes(2);
  });

  it('does not call back while hidden', () => {
    const host = create();
    setVisibility('hidden');
    vi.advanceTimersByTime(MS * 5);
    expect(host.calls).not.toHaveBeenCalled();
  });

  it('does not start while the page is created hidden', () => {
    state = 'hidden';
    const host = create();
    vi.advanceTimersByTime(MS * 5);
    expect(host.calls).not.toHaveBeenCalled();
  });

  it('calls back once at once when visible after more than the interval, then every interval', () => {
    const host = create();
    setVisibility('hidden');
    vi.advanceTimersByTime(MS + 1);
    setVisibility('visible');
    expect(host.calls).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(MS);
    expect(host.calls).toHaveBeenCalledTimes(2);
  });

  it('does not call back at once when visible again within the interval', () => {
    const host = create();
    setVisibility('hidden');
    vi.advanceTimersByTime(MS - 1000);
    setVisibility('visible');
    expect(host.calls).not.toHaveBeenCalled();
    vi.advanceTimersByTime(MS);
    expect(host.calls).toHaveBeenCalledTimes(1);
  });

  it('stops when destroyed', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.destroy();
    vi.advanceTimersByTime(MS * 2);
    setVisibility('visible');
    expect(fixture.componentInstance.calls).not.toHaveBeenCalled();
  });
});
