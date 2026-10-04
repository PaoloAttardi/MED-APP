# CONTEXT.md

## Glossario

- **Finestra di assunzione (Time Window)**: intervallo orario configurato per un farmaco in cui l'assunzione è prevista. Ha un orario di notifica (
otification_time) e un'etichetta (label). La durata è l'intervallo fino alla finestra successiva (o 23:59:59 se ultima).
- **Dose pianificata**: quantità prevista per un'intake (dose_per_intake).
- **Skip implicito (SKIPPED_IMPLICIT)**: dose non confermata entro la fine della finestra di assunzione (l'app ha aperto l'app dopo la scadenza o il dispositivo era spento/offline) → viene registrato al lancio dell'app durante il catch-up.
- **Skip volontario (SKIPPED_VOLUNTARY)**: l'utente ha premuto "Ho preso la dose" ma ha impostato dose effettiva 0 (salta dose).
- **Assunzione confermata (CONFIRMED)**: dose effettivamente assunta, stock decrementato.
- **Autonomia**: giorni stimati di scorta rimanente (loor(current_stock / daily_dose)). Infinity se daily_dose <= 0.
- **Scorta bassa**: autonomia <= soglia configurata (low_stock_threshold_days).
- **Armamento (re-arm)**: ricostruzione completa degli allarmi nativi a ogni lancio dell'app. Cancella i pending e ne rischedula un rolling window di 7 giorni. Non serve dopo un reboot: `@capacitor/local-notifications` registra `LocalNotificationRestoreReceiver` per `BOOT_COMPLETED`/`LOCKED_BOOT_COMPLETED`/`QUICKBOOT_POWERON`, rilegge `NotificationStorage` e rischedula (le scadute durante lo spegnimento vengono riprogrammate a +15s). Il re-arm al lancio serve a coprire finestre create o modificate dopo l'ultimo arming.
- **Refresh (`notificationScheduler.refresh`)**: unico punto di ingresso "i dati sono cambiati, ri-arma" = `scheduleAll()` seguito da `catchUpOpenWindows()`. Va chiamato dopo ogni salvataggio di farmaco o fascia oraria, non solo all'avvio. Gli ID del catch-up partono da 1_000_000 per non collidere con il range 1..N di `scheduleAll()`.
- **Log di deduplicazione**: le chiavi `dose:{windowId}:{data}` e `low:{drugId}:{data}` vengono scritte **all'arming** dell'allarme, non alla consegna: un allarme nativo consegnato da `AlarmManager` non lascia traccia in JS, quindi senza questo il catch-up non distinguerebbe "già consegnato" da "mai schedulato" e notificerebbe due volte.
- **Catch-up finestre aperte**: all'avvio, verifica finestre con start <= now < end, non ancora confermate e non firegate oggi → mostra notifica immediata (deduplicata) per colmare buchi (aereo/spento).
- **Canale notifiche**: dose-reminders (Android 8+), importance 4, vibrazione attiva.
- **Action Type**: dose-reminder con azione confirm ("Ho preso la dose").
- **Allarmi esatti**: setExact (Android 12+) — dichiara SCHEDULE_EXACT_ALARM e USE_EXACT_ALARM. Di default isExactNotification=true, isExactMandatory=false: se il permesso viene negato, il plugin ricade su inexact anziché rifiutare tutto.
- **Ottimizzazione batteria**: alcuni OEM congelano l'app in deep sleep nonostante AlarmManager; l'utente può aprire la schermata di esenzione dall'app (plugin nativo BatterySettings).

## Note architetturali

- App totalmente offline. Nessun backend, nessun Web Push, nessun server.
- Deploy nativo (APK) via Capacitor 8. Nessun Service Worker: rimosso per eliminare il doppio percorso di notifica e la cache precache con asset non hashed.
- Scheduling **push** (allarmi nativi) invece di **polling** (setInterval). Gli helper puri (getWindowActiveRange, getLocalDateString, getUpcomingOccurrences) sono invariati nell'interfaccia pubblica dove usati dai componenti.
- EVERY_TWO_DAYS per le scorte basse viene calcolato a partire dall'**ultima notifica effettivamente inviata** (getLastFiredAt), non dalla parità dell'autonomia (che scende ogni giorno). Il blocco if (currentHHMM !== '09:00') morto in produzione è stato rimosso.
- Gli skip impliciti sono loggati **solo** per finestre con 
otification_enabled === true (fix: evita di inventare eventi per dosi non conteggiate nel dailyDose).
- Il bottone "Ho preso la dose" viene gestito dall'app tramite localNotificationActionPerformed (processo live) e utilizza la soglia reale delle impostazioni (non hardcoded 4).
