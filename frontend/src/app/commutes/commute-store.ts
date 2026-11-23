import { Injectable, inject, signal } from '@angular/core';
import { Api } from '../api/api';
import {
  commutesCreate,
  commutesDestroy,
  commutesList,
  commutesPartialUpdate,
  commutesTripsRetrieve,
  tripsRetrieve,
} from '../api/functions';
import { Commute, CommuteRequest, CommuteTrips, PatchedCommuteRequest } from '../api/models';
import { Auth } from '../auth';

/** The browser-storage key; bump the version when the stored shape changes. */
export const STORAGE_KEY = 'spitsrit.commutes.v1';

/** "08:05" from the API's "08:05:00"; empty when there is no usual time. */
function hhmm(time: string | null | undefined): string {
  return time?.slice(0, 5) ?? '';
}

function isCommute(value: unknown): value is Commute {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const c = value as Record<string, unknown>;
  return (
    typeof c['id'] === 'number' &&
    ['name', 'origin_code', 'origin_name', 'destination_code', 'destination_name'].every(
      (key) => typeof c[key] === 'string',
    )
  );
}

function plural(count: number): string {
  return count === 1 ? '1 commute' : `${count} commutes`;
}

/**
 * The user's commutes: in the account through the API when logged in, otherwise in this browser's
 * localStorage. After a login the local ones are moved into the account.
 */
@Injectable({ providedIn: 'root' })
export class CommuteStore {
  /** Set when browser storage cannot be used, so the commutes only live until the page closes. */
  readonly storageUnavailable = signal(false);
  /** The outcome of moving local commutes into the account, for the commutes page. */
  readonly moveNotice = signal('');

  private readonly api = inject(Api);
  private readonly auth = inject(Auth);
  /** The commutes of this session; the fallback while storage is unavailable. */
  private memory: Commute[] = [];
  private moving: Promise<void> | null = null;
  private moveAttempted = false;

  async list(): Promise<Commute[]> {
    if (this.auth.loggedIn()) {
      const moving = this.moveLocal();
      if (moving !== null) {
        await moving;
      }
      return (await this.api.invoke(commutesList)).results;
    }
    this.moveAttempted = false;
    return this.read();
  }

  async add(body: CommuteRequest): Promise<Commute> {
    if (this.auth.loggedIn()) {
      return this.api.invoke(commutesCreate, { body });
    }
    const all = this.read();
    const created: Commute = {
      ...body,
      id: Math.max(0, ...all.map((c) => c.id)) + 1,
      created_at: new Date().toISOString(),
    };
    this.write([...all, created]);
    return created;
  }

  async update(id: number, body: PatchedCommuteRequest): Promise<Commute> {
    if (this.auth.loggedIn()) {
      return this.api.invoke(commutesPartialUpdate, { id: String(id), body });
    }
    const all = this.read();
    const current = all.find((c) => c.id === id);
    if (current === undefined) {
      throw new Error('Commute not found');
    }
    const updated = { ...current, ...body };
    this.write(all.map((c) => (c.id === id ? updated : c)));
    return updated;
  }

  async remove(id: number): Promise<void> {
    if (this.auth.loggedIn()) {
      await this.api.invoke(commutesDestroy, { id: String(id) });
      return;
    }
    this.write(this.read().filter((c) => c.id !== id));
  }

  /** The upcoming trips of a commute; `fromNow` plans from now instead of the usual time. */
  async trips(commute: Commute, fromNow = false): Promise<CommuteTrips> {
    if (this.auth.loggedIn()) {
      return this.api.invoke(commutesTripsRetrieve, {
        id: String(commute.id),
        ...(fromNow ? { now: true } : {}),
      });
    }
    const usual = hhmm(commute.usual_departure_time);
    return this.api.invoke(tripsRetrieve, {
      from: commute.origin_code,
      to: commute.destination_code,
      ...(commute.max_duration_minutes ? { max_duration: commute.max_duration_minutes } : {}),
      ...(commute.max_transfers !== null && commute.max_transfers !== undefined
        ? { max_transfers: commute.max_transfers }
        : {}),
      ...(usual && !fromNow ? { usual } : {}),
    });
  }

  /**
   * Creates the local commutes in the account, skipping ones it already has, and clears them.
   * Failed ones stay local. Runs once per login, and every list waits for it.
   */
  private moveLocal(): Promise<void> | null {
    if (this.moving === null && !this.moveAttempted && this.read().length > 0) {
      this.moveAttempted = true;
      this.moving = this.doMove().finally(() => (this.moving = null));
    }
    return this.moving;
  }

  private async doMove(): Promise<void> {
    const local = this.read();
    let existing: Commute[];
    try {
      existing = (await this.api.invoke(commutesList)).results;
    } catch {
      this.moveNotice.set(
        `${plural(local.length)} could not be added to your account and stay on this device.`,
      );
      return;
    }
    const key = (c: Commute): string =>
      [c.origin_code, c.destination_code, hhmm(c.usual_departure_time)].join('|');
    const known = new Set(existing.map(key));
    const failed: Commute[] = [];
    let added = 0;
    for (const commute of local) {
      if (known.has(key(commute))) {
        continue;
      }
      try {
        await this.api.invoke(commutesCreate, { body: this.toRequest(commute) });
        known.add(key(commute));
        added++;
      } catch {
        failed.push(commute);
      }
    }
    this.write(failed);
    const parts: string[] = [];
    if (added > 0) {
      parts.push(`${plural(added)} added to your account.`);
    }
    if (failed.length > 0) {
      parts.push(`${plural(failed.length)} could not be added and stay on this device.`);
    }
    this.moveNotice.set(parts.join(' '));
  }

  private toRequest(commute: Commute): CommuteRequest {
    return {
      name: commute.name,
      origin_code: commute.origin_code,
      origin_name: commute.origin_name,
      destination_code: commute.destination_code,
      destination_name: commute.destination_name,
      usual_departure_time: commute.usual_departure_time ?? null,
      max_duration_minutes: commute.max_duration_minutes ?? null,
      max_transfers: commute.max_transfers ?? null,
    };
  }

  private read(): Commute[] {
    if (this.storageUnavailable()) {
      return this.memory;
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed: unknown = raw === null ? [] : JSON.parse(raw);
      this.memory = Array.isArray(parsed) ? parsed.filter(isCommute) : [];
    } catch (error) {
      if (error instanceof SyntaxError) {
        // Corrupt text in our key counts as no commutes.
        this.memory = [];
      } else {
        this.storageUnavailable.set(true);
      }
    }
    return this.memory;
  }

  private write(commutes: Commute[]): void {
    this.memory = commutes;
    try {
      if (commutes.length === 0) {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(commutes));
      }
    } catch {
      this.storageUnavailable.set(true);
    }
  }
}
