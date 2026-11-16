/**
 * Where the app keeps its data on the device: accounts, the upload queues,
 * the login session. A small key/value interface so the logic can be tested
 * against memory and run against IndexedDB (browsers and Electron alike).
 */
export interface KvStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  /** Keys starting with `prefix`, in sorted order. */
  keys(prefix?: string): Promise<string[]>;
}

export class MemoryStore implements KvStore {
  private data = new Map<string, unknown>();

  async get<T>(key: string) {
    return this.data.has(key) ? (structuredClone(this.data.get(key)) as T) : undefined;
  }
  async set(key: string, value: unknown) {
    this.data.set(key, structuredClone(value));
  }
  async delete(key: string) {
    this.data.delete(key);
  }
  async keys(prefix = "") {
    return [...this.data.keys()].filter((k) => k.startsWith(prefix)).sort();
  }
}

const STORE = "kv";

const request = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

/**
 * IndexedDB holds far more than localStorage and survives a full results
 * queue, which matters: queued results are the only copy until they upload.
 * Falls back to memory (data lasts until the app closes) if it is unavailable.
 */
export function createIndexedDbStore(name = "typing-master"): KvStore {
  if (typeof indexedDB === "undefined") return new MemoryStore();

  let opened: Promise<IDBDatabase> | undefined;
  const open = () =>
    (opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));

  const withStore = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) => {
    const db = await open();
    return request(fn(db.transaction(STORE, mode).objectStore(STORE)));
  };

  return {
    get: async <T>(key: string) => (await withStore("readonly", (s) => s.get(key))) as T | undefined,
    set: async (key, value) => {
      await withStore("readwrite", (s) => s.put(value, key));
    },
    delete: async (key) => {
      await withStore("readwrite", (s) => s.delete(key));
    },
    keys: async (prefix = "") => {
      const all = (await withStore("readonly", (s) => s.getAllKeys())) as string[];
      return all.filter((k) => k.startsWith(prefix)).sort();
    },
  };
}
