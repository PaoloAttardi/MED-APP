const CACHE_NAME = 'medtracker-cache-v2';

// Assets to precache on install
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Resolve an asset path relative to the SW registration scope so it works
// regardless of the configured base path (e.g. "/MED-APP/")
function assetUrl(path) {
  return new URL(path, self.registration.scope).href;
}

// String helpers to compute local date/time without pulling in dependencies
function pad2(n) {
  return String(n).padStart(2, '0');
}

function getLocalDateString(date) {
  const d = date || new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function getHoursMinutesString(date) {
  const d = date || new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// Active period of an intake window = [notification time, next window / 23:59:59]
function windowActiveRange(window, sortedWindows, dateStr) {
  const start = new Date(`${dateStr}T${window.notification_time}:00`);
  const currentIndex = sortedWindows.findIndex((w) => w.id === window.id);
  let end;

  if (currentIndex < sortedWindows.length - 1) {
    const nextWindow = sortedWindows[currentIndex + 1];
    end = new Date(`${dateStr}T${nextWindow.notification_time}:00`);
  } else {
    end = new Date(`${dateStr}T23:59:59`);
  }

  return { start, end };
}

// Open IndexedDB database (duplicate connection logic for SW context in pure JS)
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('medtracker_db', 2);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('drugs')) {
        db.createObjectStore('drugs', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('time_windows')) {
        const store = db.createObjectStore('time_windows', { keyPath: 'id' });
        store.createIndex('drug_id', 'drug_id', { unique: false });
      }
      if (!db.objectStoreNames.contains('dose_events')) {
        const store = db.createObjectStore('dose_events', { keyPath: 'id' });
        store.createIndex('drug_id', 'drug_id', { unique: false });
        store.createIndex('time_window_id', 'time_window_id', { unique: false });
        store.createIndex('scheduled_datetime', 'scheduled_datetime', { unique: false });
      }
      if (!db.objectStoreNames.contains('notification_log')) {
        db.createObjectStore('notification_log', { keyPath: 'key' });
      }
    };
  });
}

function getFromStore(db, storeName, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getAllFromStore(db, storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function putInStore(db, storeName, item) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.put(item);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function addInStore(db, storeName, item) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.add(item);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getAllFromIndex(db, storeName, indexName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const index = tx.objectStore(storeName).index(indexName);
    const request = index.getAll(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Shared dedupe with the page scheduler: never fire the same reminder twice
function getLogKey(db, key) {
  return getFromStore(db, 'notification_log', key);
}

function putLogKey(db, key) {
  return putInStore(db, 'notification_log', { key, fired_at: new Date().toISOString() });
}

// True if a CONFIRMED or SKIPPED_VOLUNTARY event exists for the window on the date
async function hasConfirmationEvent(db, drugId, windowId, dateStr) {
  const events = await getAllFromIndex(db, 'dose_events', 'time_window_id', windowId);
  return events.some(
    (e) =>
      e.drug_id === drugId &&
      e.scheduled_datetime.startsWith(dateStr) &&
      (e.event_type === 'CONFIRMED' || e.event_type === 'SKIPPED_VOLUNTARY')
  );
}

// Best-effort dose reminders while the app is not open (Android / Chrome only,
// driven by Periodic Background Sync). Same catch-up + dedupe semantics as the page.
async function runDoseReminders(db) {
  if (!('Notification' in self) || Notification.permission !== 'granted') {
    return;
  }

  const drugs = await getAllFromStore(db, 'drugs');
  const todayStr = getLocalDateString();
  const now = new Date();

  for (const drug of drugs) {
    const windows = await getAllFromIndex(db, 'time_windows', 'drug_id', drug.id);
    const sorted = windows
      .filter((w) => w.notification_enabled)
      .sort((a, b) => a.notification_time.localeCompare(b.notification_time));

    for (const win of sorted) {
      const { start, end } = windowActiveRange(win, sorted, todayStr);
      if (now < start || now >= end) continue;

      const logKey = `dose:${win.id}:${todayStr}`;
      if (await getLogKey(db, logKey)) continue;

      if (await hasConfirmationEvent(db, drug.id, win.id, todayStr)) continue;

      try {
        self.registration.showNotification(`Ora del farmaco: ${drug.name}`, {
          body: `${win.label} ÔÇö ${win.dose_per_intake} ${drug.unit_label}`,
          icon: assetUrl('icon-192.png'),
          badge: assetUrl('icon-192.png'),
          tag: `dose-reminder-${drug.id}-${win.id}-${todayStr}`,
          data: {
            drugId: drug.id,
            windowId: win.id,
            scheduledDateTime: `${todayStr}T${win.notification_time}:00`
          },
          actions: [
            { action: 'confirm', title: 'Ho preso la dose' },
            { action: 'open', title: 'Apri app' }
          ],
          requireInteraction: true
        });
        await putLogKey(db, logKey);
      } catch (err) {
        console.error('SW: failed to show reminder notification:', err);
      }
    }
  }
}

// Look back up to 5 days and log skipped windows missed while the app was closed
async function runImplicitSkips(db) {
  const drugs = await getAllFromStore(db, 'drugs');
  const now = new Date();

  for (let dayOffset = 0; dayOffset <= 5; dayOffset++) {
    const targetDate = new Date();
    targetDate.setDate(now.getDate() - dayOffset);
    const dateStr = getLocalDateString(targetDate);

    for (const drug of drugs) {
      const windows = await getAllFromIndex(db, 'time_windows', 'drug_id', drug.id);
      if (windows.length === 0) continue;

      const sorted = [...windows].sort((a, b) => a.notification_time.localeCompare(b.notification_time));

      for (const win of sorted) {
        const { end } = windowActiveRange(win, sorted, dateStr);
        if (now <= end) continue;

        const events = await getAllFromIndex(db, 'dose_events', 'time_window_id', win.id);
        const hasEvent = events.some(
          (e) => e.drug_id === drug.id && e.scheduled_datetime.startsWith(dateStr)
        );
        if (hasEvent) continue;

        await addInStore(db, 'dose_events', {
          id: crypto.randomUUID(),
          drug_id: drug.id,
          time_window_id: win.id,
          event_type: 'SKIPPED_IMPLICIT',
          planned_dose: win.dose_per_intake,
          actual_dose: 0,
          scheduled_datetime: `${dateStr}T${win.notification_time}:00`,
          confirmed_at: end.toISOString(),
          stock_after: drug.current_stock
        });
        console.log(`SW: logged implicit skip for ${drug.name} - ${win.label} on ${dateStr}`);
      }
    }
  }
}

async function runPeriodicChecks() {
  try {
    const db = await openDB();
    await runImplicitSkips(db);
    await runDoseReminders(db);
  } catch (err) {
    console.error('SW: periodic checks failed:', err);
  }
}

// SW Install Event: Precache core assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// SW Activate Event: Clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// SW Fetch Event: Stale-while-revalidate for assets, caching dynamic files
self.addEventListener('fetch', (event) => {
  // Only handle GET requests and ignore chrome-extension:// or browser devtools requests
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) {
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.match(event.request).then((cachedResponse) => {
        const fetchPromise = fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        }).catch(() => {
          // If network fails, we fall back to cache
          return cachedResponse;
        });

        // Return cached response immediately if available, otherwise wait for network
        return cachedResponse || fetchPromise;
      });
    })
  );
});

// Best-effort wake-up used only on Android (Chrome). iOS Safari has no support.
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'medtracker-sync') {
    event.waitUntil(runPeriodicChecks());
  }
});

// SW Notification Click Event: Handle "Ho preso la dose" quick-confirm and "Apri app"
self.addEventListener('notificationclick', (event) => {
  const notification = event.notification;
  const action = event.action;
  const data = notification.data || {};

  notification.close();

  if (action === 'confirm' && data.drugId && data.windowId) {
    // Process dose confirmation completely in background!
    event.waitUntil(
      openDB().then(async (db) => {
        const drug = await getFromStore(db, 'drugs', data.drugId);
        const window = await getFromStore(db, 'time_windows', data.windowId);

        if (!drug || !window) {
          console.error('Drug or window not found in SW');
          return;
        }

        // Idempotency check: see if a confirmed event already exists for today
        const scheduledDatePart = data.scheduledDateTime.split('T')[0];
        const existingEvents = await getAllFromIndex(db, 'dose_events', 'time_window_id', data.windowId);
        const alreadyConfirmed = existingEvents.some(e =>
          e.drug_id === data.drugId &&
          e.scheduled_datetime.startsWith(scheduledDatePart) &&
          (e.event_type === 'CONFIRMED' || e.event_type === 'SKIPPED_VOLUNTARY')
        );

        if (alreadyConfirmed) {
          console.log('SW: Dose already confirmed, ignoring click');
          return;
        }

        const actualDose = window.dose_per_intake;
        const newStock = Math.max(0, drug.current_stock - actualDose);

        // Save CONFIRMED event
        const now = new Date().toISOString();
        const eventId = crypto.randomUUID();
        const doseEvent = {
          id: eventId,
          drug_id: data.drugId,
          time_window_id: data.windowId,
          event_type: 'CONFIRMED',
          planned_dose: window.dose_per_intake,
          actual_dose: actualDose,
          scheduled_datetime: data.scheduledDateTime,
          confirmed_at: now,
          stock_after: newStock
        };
        await addInStore(db, 'dose_events', doseEvent);

        // Update drug stock
        const updatedDrug = {
          ...drug,
          current_stock: newStock,
          updated_at: now
        };

        // Evaluate low stock
        const timeWindows = await getAllFromIndex(db, 'time_windows', 'drug_id', data.drugId);
        const enabledWindows = timeWindows.filter(tw => tw.notification_enabled);
        const dailyDose = enabledWindows.reduce((sum, tw) => sum + tw.dose_per_intake, 0);
        const autonomy = dailyDose > 0 ? Math.floor(newStock / dailyDose) : Infinity;

        // Use threshold 4 as fallback since SW can't read localStorage directly (safely)
        const isLowStock = autonomy <= 4;
        let lowStockEntered = false;

        if (isLowStock && !drug.low_stock_alert_active && dailyDose > 0) {
          updatedDrug.low_stock_alert_active = true;
          lowStockEntered = true;
        }

        await putInStore(db, 'drugs', updatedDrug);

        // Notify client tabs
        const clientsList = await self.clients.matchAll({ type: 'window' });
        for (const client of clientsList) {
          client.postMessage({
            type: 'DOSE_CONFIRMED',
            drugId: data.drugId,
            windowId: data.windowId,
            timestamp: now,
            lowStockEntered,
            updatedStock: newStock
          });
        }

        // Trigger a native notification for low stock in background if entered
        if (lowStockEntered) {
          self.registration.showNotification(`ÔÜá´©Å Scorta in esaurimento: ${drug.name}`, {
            body: `La scorta si esaurir├á tra circa ${autonomy} giorni. Apri l'app per salvare l'evento in calendario.`,
            icon: assetUrl('icon-192.png'),
            tag: `low-stock-${drug.id}`,
            data: { drugId: drug.id }
          });
        }
      }).catch(err => {
        console.error('Background confirmation failed:', err);
      })
    );
  } else {
    // Default action: Open app
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then((clientsList) => {
        // If app window is open, focus it
        for (const client of clientsList) {
          if ('focus' in client) {
            return client.focus();
          }
        }
        // If not open, open a new tab at the app scope
        if (self.clients.openWindow) {
          return self.clients.openWindow(self.registration.scope);
        }
      })
    );
  }
});
