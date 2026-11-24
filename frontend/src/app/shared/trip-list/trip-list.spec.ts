import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Trip } from '../../api/models';
import { TripList } from './trip-list';

const trip: Trip = {
  uid: 'a',
  departure_planned: '2026-11-20T08:00:00Z',
  departure_actual: '2026-11-20T08:00:00Z',
  arrival_planned: '2026-11-20T08:30:00Z',
  arrival_actual: '2026-11-20T08:30:00Z',
  departure_delay_minutes: 0,
  arrival_delay_minutes: 0,
  duration_minutes: 30,
  departure_track: '5',
  transfers: 0,
  status: 'NORMAL',
  cancelled: false,
  crowd_forecast: 'LOW',
  train: 'IC 2736',
  seats: 620,
  carriages: 8,
  train_type: 'VIRM',
  shorter_stock: null,
  shorter_stock_warning: null,
  train_origin: 'Nijmegen',
  train_destination: 'Den Haag C.',
  train_parts: [],
  punctuality: null,
  messages: [],
  legs: [],
  coach_crowding: [],
  platform_features: [],
  split_stations: [],
  board_destination: null,
  min_seats: null,
};

@Component({
  imports: [TripList],
  template: `<app-trip-list
    [trips]="trips"
    recommendedUid="a"
    [selectedUid]="selectedUid()"
    (tripSelected)="picked.push($event.uid)"
  />`,
})
class Host {
  readonly trips = [trip, { ...trip, uid: 'b' }];
  readonly selectedUid = signal<string | null>(null);
  readonly picked: string[] = [];
}

describe('TripList', () => {
  let fixture: ComponentFixture<Host>;
  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const buttons = (): HTMLButtonElement[] =>
    Array.from(element().querySelectorAll<HTMLButtonElement>('[data-testid="trip-row-button"]'));

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [Host] });
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  it('renders each trip as a button that controls the details panel', () => {
    expect(buttons().length).toBe(2);
    expect(buttons()[0].getAttribute('aria-controls')).toBe('trip-details');
    expect(buttons().map((b) => b.getAttribute('aria-expanded'))).toEqual(['false', 'false']);
    expect(element().querySelector('li.best')).not.toBeNull();
  });

  it('emits the trip of the clicked row', () => {
    buttons()[1].click();
    expect(fixture.componentInstance.picked).toEqual(['b']);
  });

  it('marks the selected row expanded and selected', async () => {
    fixture.componentInstance.selectedUid.set('b');
    await fixture.whenStable();
    expect(buttons().map((b) => b.getAttribute('aria-expanded'))).toEqual(['false', 'true']);
    expect(element().querySelectorAll('li.selected').length).toBe(1);
  });
});
