import type { SaveMeta } from './serialize';

const DB_NAME = 'simulator-saves';
export const SLOTS = ['slot1', 'slot2', 'slot3', 'auto'] as const;
export const SLOT_LABEL: Record<string, string> = { slot1: 'スロット1', slot2: 'スロット2', slot3: 'スロット3', auto: 'オートセーブ' };

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      if (!db.objectStoreNames.contains('data')) db.createObjectStore('data');
      if (!db.objectStoreNames.contains('terrain')) db.createObjectStore('terrain');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(stores, mode);
        const r = fn(t);
        t.oncomplete = () => {
          db.close();
          resolve(r ? (r.result as T) : undefined);
        };
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export async function putSave(key: string, meta: SaveMeta, data: Uint8Array): Promise<void> {
  await tx(['meta', 'data'], 'readwrite', (t) => {
    t.objectStore('meta').put(meta, key);
    t.objectStore('data').put(data, key);
  });
}

export async function getSave(key: string): Promise<{ meta: SaveMeta; data: Uint8Array<ArrayBuffer> } | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(['meta', 'data'], 'readonly');
    const m = t.objectStore('meta').get(key);
    const d = t.objectStore('data').get(key);
    t.oncomplete = () => {
      db.close();
      resolve(m.result && d.result ? { meta: m.result, data: d.result } : undefined);
    };
    t.onerror = () => reject(t.error);
  });
}

export async function deleteSave(key: string): Promise<void> {
  await tx(['meta', 'data'], 'readwrite', (t) => {
    t.objectStore('meta').delete(key);
    t.objectStore('data').delete(key);
  });
}

export async function listMeta(): Promise<Record<string, SaveMeta>> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const out: Record<string, SaveMeta> = {};
    const t = db.transaction('meta', 'readonly');
    const req = t.objectStore('meta').openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (c) {
        out[String(c.key)] = c.value;
        c.continue();
      }
    };
    t.oncomplete = () => {
      db.close();
      resolve(out);
    };
    t.onerror = () => reject(t.error);
  });
}

/** Cache of generated terrain (heights). Saves the regeneration at save load (over ten seconds at 4096) */
const TERRAIN_KEEP = 3;

export async function getTerrain(key: string): Promise<Uint8Array | undefined> {
  try {
    const db = await open();
    return await new Promise((resolve, reject) => {
      const t = db.transaction('terrain', 'readonly');
      const r = t.objectStore('terrain').get(key);
      t.oncomplete = () => {
        db.close();
        resolve(r.result?.height as Uint8Array | undefined);
      };
      t.onerror = () => reject(t.error);
    });
  } catch {
    return undefined;
  }
}

export async function putTerrain(key: string, height: Uint8Array): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction('terrain', 'readwrite');
      const st = t.objectStore('terrain');
      st.put({ height, at: Date.now() }, key);
      // Delete the oldest to keep TERRAIN_KEEP entries
      const all = st.openCursor();
      const items: { key: IDBValidKey; at: number }[] = [];
      all.onsuccess = () => {
        const c = all.result;
        if (c) {
          items.push({ key: c.key, at: c.value.at ?? 0 });
          c.continue();
        } else {
          items.sort((a, b) => b.at - a.at);
          for (const it of items.slice(TERRAIN_KEEP)) st.delete(it.key);
        }
      };
      t.oncomplete = () => {
        db.close();
        resolve();
      };
      t.onerror = () => reject(t.error);
    });
  } catch {
    // Ignore failures such as running out of space (it is only a cache)
  }
}
