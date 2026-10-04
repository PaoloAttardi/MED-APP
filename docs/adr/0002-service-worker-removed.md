# ADR 0002: Rimozione completa del Service Worker

**Stato**: Accettato  
**Data**: 2026-10-04  

## Contesto

Il Service Worker `public/sw.js` svolgeva tre ruoli: precaching offline, ricezione delle notifiche web e gestione del click "Ho preso la dose" con accesso diretto a IndexedDB. Con la migrazione a notifiche native (`@capacitor/local-notifications`), l'OS riceve e mostra le notifiche e il click viene gestito dall'app via `localNotificationActionPerformed`. 

## Problemi riscontrati

- Doppio percorso: due code distinte (TS nel renderer, JS nello SW) che calcolavano i confini delle finestre in modo leggermente diverso → rischio di deduplicazione asimmetrica.
- Hardcoded `threshold 4` nello SW perché non poteva leggere `localStorage` (le impostazioni reali sono disponibili nel renderer).
- Gli `SKIPPED_IMPLICIT` venivano loggati anche per finestre con `notification_enabled === false` nello SW.
- `addAll` atomico: un singolo asset mancante poteva rendere lo SW irrecuperabile e bloccare installazione/aggiornamento.
- L'handler `notificationclick` era parte della logica di dominio e divergeva da `stockEngine` (fonte di verità per decremento stock, idempotenza e aggiornamento flag scorta bassa).

## Decisione

Eliminare completamente `public/sw.js`, `src/serviceWorkerRegistration.ts`, `public/manifest.json`, `public/404.html`, il listener `navigator.serviceWorker` in App e Dashboard, e il workflow GitHub Pages.

## Motivazioni

- **Single source of truth**: il decremento dello stock, l'idempotenza e il rilevamento "stock just entered low" devono avvenire in `stockEngine.processDoseConfirmation`, leggendo le impostazioni reali. 
- **Meno superficie di errore**: nessuna duplicazione tra renderer e SW. 
- **Asset locali**: con Capacitor, tutto è impacchettato dentro l'APK; la cache offline del SW era ridondante e soggetta agli hash non allineati del vecchio build.
- **Affidabilità**: l'OS garantisce la consegna della notifica nativa e il risveglio dell'app al click, evitando la dipendenza da `navigator.serviceWorker.ready` (che poteva "appendere" se l'SW non si installava mai).

## Conseguenze

- Il click "Ho preso la dose" viene ora processato in `notificationScheduler.confirmDose` che delega a `stockEngine.processDoseConfirmation`. 
- Viene mantenuto e corretto `notificationScheduler.catchUpOpenWindows` (deduplicato tramite `notificationLog`) per gestire i casi in cui il telefono era offline/aereo.
- `EVERY_TWO_DAYS` passa da "parità di autonomia" a "giorni trascorsi dall'ultima notifica effettivamente inviata" (`getLastFiredAt`), fixando il comportamento alla semantica "ogni 2 giorni".
- Gli skip impliciti sono filtrati per `notification_enabled === true`, allineando il comportamento a `calculateDailyDose`.
- Viene aggiunto un piccolo plugin nativo per l'apertura delle impostazioni di ottimizzazione batteria.
