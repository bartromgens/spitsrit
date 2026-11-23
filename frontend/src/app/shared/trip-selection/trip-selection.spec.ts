import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Trip } from '../../api/models';
import { Desktop } from '../desktop/desktop';
import { TripSelection } from './trip-selection';

const trip = (uid: string): Trip => ({ uid, marker: uid }) as unknown as Trip;

describe('TripSelection', () => {
  const wide = signal(true);
  let selection: TripSelection;

  beforeEach(() => {
    wide.set(true);
    TestBed.configureTestingModule({
      providers: [TripSelection, { provide: Desktop, useValue: { wide } }],
    });
    selection = TestBed.inject(TripSelection);
  });

  it('starts closed', () => {
    expect(selection.selected()).toBeNull();
    expect(selection.withDetails()).toBe(false);
    expect(selection.uidFor(1)).toBeNull();
  });

  it('toggles a trip open and shut, and counts it only for its own list', () => {
    selection.toggle(1, trip('a'));
    expect(selection.withDetails()).toBe(true);
    expect(selection.uidFor(1)).toBe('a');
    expect(selection.uidFor(2)).toBeNull();
    selection.toggle(2, trip('a'));
    expect(selection.uidFor(1)).toBeNull();
    expect(selection.uidFor(2)).toBe('a');
    selection.toggle(2, trip('a'));
    expect(selection.selected()).toBeNull();
  });

  it('closes for its own list only', () => {
    selection.toggle(1, trip('a'));
    selection.closeFor(2);
    expect(selection.uidFor(1)).toBe('a');
    selection.closeFor(1);
    expect(selection.selected()).toBeNull();
  });

  it('opens the recommended trip, else the first, on wide screens only', () => {
    selection.openDefault(1, [trip('a'), trip('b')], 'b');
    expect(selection.uidFor(1)).toBe('b');
    selection.openDefault(1, [trip('a'), trip('b')], null);
    expect(selection.uidFor(1)).toBe('a');
    wide.set(false);
    selection.openDefault(1, [trip('a')], 'a');
    expect(selection.selected()).toBeNull();
  });

  it('refreshes the open trip, falling back to the default when it left', () => {
    selection.toggle(1, trip('a'));
    const fresh = { ...trip('a'), marker: 'fresh' } as unknown as Trip;
    selection.refresh(1, [trip('b'), fresh], 'b');
    expect(selection.selected()?.trip).toBe(fresh);
    selection.refresh(1, [trip('b'), trip('c')], 'c');
    expect(selection.uidFor(1)).toBe('c');
    wide.set(false);
    selection.refresh(1, [trip('d')], 'd');
    expect(selection.selected()).toBeNull();
  });

  it('leaves another list’s selection alone on refresh', () => {
    selection.toggle(2, trip('a'));
    selection.refresh(1, [trip('b')], 'b');
    expect(selection.uidFor(2)).toBe('a');
  });

  it('opens the first list once, and only when nothing is open', () => {
    selection.openFirst(1, [trip('a')], 'a');
    expect(selection.uidFor(1)).toBe('a');
    selection.close();
    selection.openFirst(1, [trip('a')], 'a');
    expect(selection.selected()).toBeNull();
  });

  it('does not open the first list on a phone', () => {
    wide.set(false);
    selection.openFirst(1, [trip('a')], 'a');
    wide.set(true);
    selection.openFirst(1, [trip('a')], 'a');
    expect(selection.selected()).toBeNull();
  });
});
