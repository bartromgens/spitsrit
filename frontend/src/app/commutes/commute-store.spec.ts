import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Commute, CommuteRequest, User } from '../api/models';
import { Auth } from '../auth';
import { testProviders } from '../testing';
import { CommuteStore, STORAGE_KEY } from './commute-store';

const request: CommuteRequest = {
  name: 'To work',
  origin_code: 'UT',
  origin_name: 'Utrecht Centraal',
  destination_code: 'ASD',
  destination_name: 'Amsterdam Centraal',
  usual_departure_time: '08:05:00',
};

const stored = (): Commute[] => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as Commute[];
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve));

describe('CommuteStore', () => {
  let store: CommuteStore;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: testProviders });
    store = TestBed.inject(CommuteStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => vi.restoreAllMocks());

  describe('logged out', () => {
    it('keeps commutes under the versioned key, with a local id', async () => {
      const created = await store.add(request);
      expect(STORAGE_KEY).toBe('spitsrit.commutes.v1');
      expect(created.id).toBe(1);
      expect(stored()).toEqual([created]);
      expect((await store.add({ ...request, name: 'Home' })).id).toBe(2);
      expect((await store.list()).map((c) => c.name)).toEqual(['To work', 'Home']);
      http.expectNone(() => true);
    });

    it('updates and removes commutes', async () => {
      const { id } = await store.add(request);
      const updated = await store.update(id, { max_duration_minutes: 40, max_transfers: 0 });
      expect(updated.max_duration_minutes).toBe(40);
      expect(stored()[0].max_transfers).toBe(0);
      await expect(store.update(99, { name: 'x' })).rejects.toThrow();
      await store.remove(id);
      expect(await store.list()).toEqual([]);
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('treats corrupt stored data as no commutes', async () => {
      localStorage.setItem(STORAGE_KEY, '{not json');
      expect(await store.list()).toEqual([]);
      localStorage.setItem(STORAGE_KEY, JSON.stringify([{ id: 'x' }, 5]));
      expect(await store.list()).toEqual([]);
      expect(store.storageUnavailable()).toBe(false);
    });

    it('loads trips through /api/trips/ with the commute settings', async () => {
      const commute = await store.add({
        ...request,
        max_duration_minutes: 45,
        max_transfers: 0,
      });
      const loading = store.trips(commute);
      const call = http.expectOne((r) => r.url === '/api/trips/');
      expect(call.request.params.keys().sort()).toEqual([
        'from',
        'max_duration',
        'max_transfers',
        'to',
        'usual',
      ]);
      expect(call.request.params.get('from')).toBe('UT');
      expect(call.request.params.get('to')).toBe('ASD');
      expect(call.request.params.get('max_duration')).toBe('45');
      expect(call.request.params.get('max_transfers')).toBe('0');
      expect(call.request.params.get('usual')).toBe('08:05');
      call.flush({ trips: [] });
      expect(await loading).toEqual({ trips: [] });
    });

    it('plans from now without the usual time when asked to leave now instead', async () => {
      const commute = await store.add(request);
      const loading = store.trips(commute, true);
      const call = http.expectOne((r) => r.url === '/api/trips/');
      expect(call.request.params.has('usual')).toBe(false);
      expect(call.request.params.has('max_duration')).toBe(false);
      call.flush({ trips: [] });
      await loading;
    });

    it('keeps commutes in memory when storage is unavailable', async () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('denied', 'SecurityError');
      });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('denied', 'SecurityError');
      });
      expect(await store.list()).toEqual([]);
      expect(store.storageUnavailable()).toBe(true);
      await store.add(request);
      await store.add({ ...request, name: 'Home' });
      expect((await store.list()).map((c) => c.name)).toEqual(['To work', 'Home']);
    });

    it('keeps commutes in memory when writing fails', async () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('full', 'QuotaExceededError');
      });
      await store.add(request);
      expect(store.storageUnavailable()).toBe(true);
      expect(await store.list()).toHaveLength(1);
    });
  });

  describe('logged in', () => {
    beforeEach(() => {
      TestBed.inject(Auth).user.set({ id: 1 } as User);
    });

    const account = (...results: Partial<Commute>[]): object => ({
      count: results.length,
      next: null,
      previous: null,
      results,
    });

    it('uses the commute endpoints', async () => {
      const listing = store.list();
      http.expectOne('/api/commutes/').flush(account({ id: 3, name: 'A' }));
      expect((await listing).map((c) => c.id)).toEqual([3]);

      const creating = store.add(request);
      http.expectOne((r) => r.method === 'POST').flush({ id: 4 });
      await creating;
      const updating = store.update(4, { name: 'B' });
      http.expectOne((r) => r.method === 'PATCH' && r.url === '/api/commutes/4/').flush({ id: 4 });
      await updating;
      const removing = store.remove(4);
      http.expectOne((r) => r.method === 'DELETE' && r.url === '/api/commutes/4/').flush(null);
      await removing;
      const loading = store.trips({ ...request, id: 4, created_at: '' }, true);
      const call = http.expectOne((r) => r.url === '/api/commutes/4/trips/');
      expect(call.request.params.get('now')).toBe('true');
      call.flush({ trips: [] });
      await loading;
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    const local = (id: number, extra: Partial<Commute> = {}): Commute => ({
      ...request,
      id,
      created_at: '',
      ...extra,
    });

    it('moves local commutes into the account, skipping duplicates, and clears them', async () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify([
          local(1),
          local(2, { name: 'Home', origin_code: 'ASD', destination_code: 'UT' }),
          local(3, { name: 'Evening', usual_departure_time: '17:30:00', max_transfers: 1 }),
        ]),
      );
      const listing = store.list();
      await tick();
      http
        .expectOne('/api/commutes/')
        .flush(account({ id: 9, ...request, usual_departure_time: '08:05:00' }));
      await tick();
      // The first is a duplicate by origin, destination and usual time; the others are created.
      const created: unknown[] = [];
      for (let i = 0; i < 2; i++) {
        const post = http.expectOne((r) => r.method === 'POST');
        created.push(post.request.body);
        post.flush({ id: 10 });
        await tick();
      }
      http.expectOne((r) => r.method === 'GET').flush(account({ id: 9 }, { id: 10 }));
      await listing;
      expect(created).toEqual([
        expect.objectContaining({ name: 'Home', origin_code: 'ASD' }),
        expect.objectContaining({ name: 'Evening', max_transfers: 1 }),
      ]);
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
      expect(store.moveNotice()).toBe('2 commutes added to your account.');
    });

    it('keeps the ones that fail locally and says so', async () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify([local(1), local(2, { name: 'Home', usual_departure_time: null })]),
      );
      const listing = store.list();
      await tick();
      http.expectOne('/api/commutes/').flush(account());
      await tick();
      http.expectOne((r) => r.method === 'POST').flush({ id: 10 });
      await tick();
      http
        .expectOne((r) => r.method === 'POST')
        .flush(null, { status: 500, statusText: 'Server Error' });
      await tick();
      http.expectOne((r) => r.method === 'GET').flush(account({ id: 10 }));
      await listing;
      expect(stored().map((c) => c.name)).toEqual(['Home']);
      expect(store.moveNotice()).toBe(
        '1 commute added to your account. 1 commute could not be added and stay on this device.',
      );
    });

    it('keeps everything locally when the account cannot be read, and does not retry', async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([local(1)]));
      const listing = store.list();
      await tick();
      http.expectOne('/api/commutes/').flush(null, { status: 500, statusText: 'Server Error' });
      await tick();
      http.expectOne('/api/commutes/').flush(account());
      await listing;
      expect(stored()).toHaveLength(1);
      expect(store.moveNotice()).toContain('stay on this device');

      const again = store.list();
      http.expectOne('/api/commutes/').flush(account());
      await again;
    });

    it('moves nothing when there are no local commutes', async () => {
      const listing = store.list();
      http.expectOne('/api/commutes/').flush(account());
      await listing;
      expect(store.moveNotice()).toBe('');
    });
  });
});
