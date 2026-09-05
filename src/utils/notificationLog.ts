import { openDatabase, promisifyRequest } from '../db/indexedDb';

const DAY_MS = 24 * 60 * 60 * 1000;

interface NotificationLogRecord {
  key: string;
  fired_at: string;
}

export async function isNotificationFired(key: string): Promise<boolean> {
  const db = await openDatabase();
  const tx = db.transaction('notification_log', 'readonly');
  const store = tx.objectStore('notification_log');
  const record = await promisifyRequest<NotificationLogRecord | undefined>(store.get(key));
  return Boolean(record);
}

export async function markNotificationFired(key: string): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction('notification_log', 'readwrite');
  const store = tx.objectStore('notification_log');
  await promisifyRequest(store.put({ key, fired_at: new Date().toISOString() }));
}

export async function pruneNotificationLog(maxAgeDays = 10): Promise<void> {
  const db = await openDatabase();
  const cutoff = Date.now() - maxAgeDays * DAY_MS;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('notification_log', 'readwrite');
    const store = tx.objectStore('notification_log');
    const request = store.getAll();

    request.onsuccess = () => {
      const records = request.result as NotificationLogRecord[];
      for (const record of records) {
        const firedAt = record.fired_at ? new Date(record.fired_at).getTime() : 0;
        if (firedAt < cutoff) {
          store.delete(record.key);
        }
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });
}
