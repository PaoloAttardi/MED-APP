const CACHE_NAME = 'medtracker-cache-v1';

// Assets to precache on install
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Open IndexedDB database (duplicate connection logic for SW context in pure JS)
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('medtracker_db', 1);
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

function getSettingsFromLocalStorage() {
  // Service Workers do NOT have access to localStorage, so we will use a fallback or store settings in IndexedDB.
  // Wait, the settings schema specifies localStorage. For SW fallback, we will assume default settings:
  // low_stock_threshold_days = 4.
  return { low_stock_threshold_days: 4 };
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
          self.registration.showNotification(`⚠️ Scorta in esaurimento: ${drug.name}`, {
            body: `La scorta si esaurirà tra circa ${autonomy} giorni. Apri l'app per salvare l'evento in calendario.`,
            icon: '/icon-192.png',
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
        // If not open, open a new tab
        if (self.clients.openWindow) {
          return self.clients.openWindow('./');
        }
      })
    );
  }
});
