export function registerServiceWorker(onUpdate?: (registration: ServiceWorkerRegistration) => void) {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      const swUrl = './sw.js';

      navigator.serviceWorker
        .register(swUrl)
        .then((registration) => {
          console.log('Service Worker registered successfully:', registration.scope);

          registerPeriodicSync(registration);

          // Check for updates
          registration.addEventListener('updatefound', () => {
            const installingWorker = registration.installing;
            if (installingWorker) {
              installingWorker.addEventListener('statechange', () => {
                if (installingWorker.state === 'installed') {
                  if (navigator.serviceWorker.controller) {
                    // New content is available; trigger callback
                    console.log('New content available, please refresh.');
                    if (onUpdate) onUpdate(registration);
                  } else {
                    // Content is cached for offline use
                    console.log('Content is cached for offline use.');
                  }
                }
              });
            }
          });
        })
        .catch((error) => {
          console.error('Service Worker registration failed:', error);
        });
    });
  }
}

// Best-effort wake-up of the Service Worker on Android (Chrome).
// Not supported on iOS; the permission is not user-grantable, so no prompt appears.
async function registerPeriodicSync(registration: ServiceWorkerRegistration): Promise<void> {
  const sw = registration as ServiceWorkerRegistration & {
    periodicSync?: { register: (tag: string, options: { minInterval: number }) => Promise<void> };
  };

  if (!sw.periodicSync) {
    console.warn('Periodic Background Sync not supported in this browser.');
    return;
  }

  try {
    const permission = await (navigator.permissions as unknown as {
      query: (desc: { name: string }) => Promise<{ state: string }>;
    }).query({ name: 'periodic-background-sync' });

    if (permission.state === 'granted') {
      await sw.periodicSync.register('medtracker-sync', { minInterval: 60 * 60 * 1000 });
      console.log('Periodic Background Sync registered (best effort).');
    } else {
      console.warn('Periodic Background Sync permission denied:', permission.state);
    }
  } catch (err) {
    console.warn('Unable to register PeriodSyncBackground:', err);
  }
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) {
    console.warn('This browser does not support notifications.');
    return 'denied';
  }

  const permission = await Notification.requestPermission();
  console.log('Notification permission status:', permission);
  return permission;
}

export function getNotificationPermissionStatus(): NotificationPermission {
  if (!('Notification' in window)) {
    return 'denied';
  }
  return Notification.permission;
}
