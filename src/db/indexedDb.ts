const DB_NAME = 'medtracker_db';
const DB_VERSION = 1;

export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // Works in both window and service worker (self)
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(request.error);
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (_event) => {
      const db = request.result;

      // Create Drug store
      if (!db.objectStoreNames.contains('drugs')) {
        db.createObjectStore('drugs', { keyPath: 'id' });
      }

      // Create TimeWindow store
      if (!db.objectStoreNames.contains('time_windows')) {
        const store = db.createObjectStore('time_windows', { keyPath: 'id' });
        store.createIndex('drug_id', 'drug_id', { unique: false });
      }

      // Create DoseEvent store
      if (!db.objectStoreNames.contains('dose_events')) {
        const store = db.createObjectStore('dose_events', { keyPath: 'id' });
        store.createIndex('drug_id', 'drug_id', { unique: false });
        store.createIndex('time_window_id', 'time_window_id', { unique: false });
        store.createIndex('scheduled_datetime', 'scheduled_datetime', { unique: false });
      }
    };
  });
}

// Utility to handle transactions in a promise-based way
export function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
