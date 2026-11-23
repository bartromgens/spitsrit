import { Injectable } from '@angular/core';
import { Station } from '../api/models';

const STORAGE_KEY = 'spitsrit.lastTrip';

export interface LastStations {
  origin: Station;
  destination: Station;
}

function isStation(value: unknown): value is Station {
  const station = value as Partial<Station> | null;
  return typeof station?.code === 'string' && typeof station.name === 'string';
}

/** The stations of the last planned trip, remembered in this browser. */
@Injectable({ providedIn: 'root' })
export class LastStationsStore {
  save(origin: Station, destination: Station): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ origin, destination }));
    } catch {
      // Storage can be full or blocked; remembering is best effort.
    }
  }

  /** The remembered stations, or null when there are none or they cannot be read. */
  load(): LastStations | null {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
      if (typeof saved !== 'object' || saved === null) return null;
      const { origin, destination } = saved as Record<keyof LastStations, unknown>;
      return isStation(origin) && isStation(destination) ? { origin, destination } : null;
    } catch {
      // Unreadable storage or invalid JSON: start with empty fields.
      return null;
    }
  }
}
