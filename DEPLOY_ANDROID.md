# Deploy su Android (APK, uso personale)

L'app è stata migrata a Capacitor 8: notifiche native, totalmente offline, nessun Service Worker.

## 1) APK già generato

- Path: `android/app/build/outputs/apk/debug/app-debug.apk`
- Dimensione: ~4.8 MB
- Firma: debug (perfetta per uso personale, sideload)

## 2) Opzione A — Trasferimento file (più semplice)

1. Copia `android/app/build/outputs/apk/debug/app-debug.apk` sul tuo telefono (USB, Google Drive, WhatsApp, Bluetooth, etc.)
2. Apri il file APK sul telefono. Android mostrerà un avviso "Installa app da sorgente sconosciuta".
3. Concedi il permesso e premi "Installa".
4. Apri l'app "MedTracker".

## 3) Opzione B — ADB via USB (rapida, per iterazioni future)

Requisiti: telefono con debug USB abilitato (Sviluppatore > Debug USB).

1. Collega il telefono al PC via USB.
2. Apri un terminale nella cartella `MED-APP`.
3. Installa l'APK:

```powershell
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

4. L'app viene installata automaticamente. Aprila dal launcher.

Per verificare se il dispositivo è connesso: `adb devices`

## 4) Configurazione post-installazione (importante per le notifiche)

All'avvio, l'app chiede il permesso **Notifiche**. Accettalo.

Nelle **Impostazioni → Manutenzione Dati / Impostazioni** dell'app trovi:

- **Allarmi esatti disattivati** — su alcuni Android (Android 12+) se il permesso viene revocato dalle impostazioni di sistema, appare questo pulsante. Premi **Attiva** per aprire le impostazioni di sistema e abilitarlo.
- **Ottimizzazione batteria** — alcuni OEM (Xiaomi/MIUI, Huawei/EMUI, Oppo/Realme, Vivo) congelano l'app in deep sleep. Premi **Apri** e imposta **Batteria → Non limitato**. Suggerimento: verifica anche "Avvio automatico" nell'app manager del produttore.

### Consiglio pratico OEM aggressivi

- Xiaomi: Impostazioni → App → Gestione app → MedTracker → Avvio automatico + Risparmio batteria → Nessun limite
- Huawei: Gestione avvio + Protezione app
- Oppo/Realme: Avvio automatico + Background app management
- Samsung (OneUI): in genere basta il permesso allarmi esatti, può essere richiesto "App in sonno profondo" una tantum

## 5) Rigenerare l'APK dopo modifiche

```powershell
npm run build
npm run android:sync
cd android && .\gradlew.bat assembleDebug
```

Oppure lo shortcut: `npm run android:apk`

L'APK aggiornato sovrascrive quello in `android/app/build/outputs/apk/debug/app-debug.apk`.

## 6) Note

- App **100% offline**: tutti i dati stanno in IndexedDB locale. Nessuna migrazione necessaria (hai scelto "Non ho dati da salvare").
- I promemoria sono schedulati nativamente con allarmi esatti: funzionano a schermo spento e in Doze.
- Gli allarmi si ri-armano da soli dopo un reboot: `@capacitor/local-notifications` registra un `BOOT_COMPLETED` receiver (`LocalNotificationRestoreReceiver`) che rilegge da `NotificationStorage` e rischedula; le notifiche scadute durante lo spegnimento vengono riprogrammate a +15 secondi. Non devi aprire l'app dopo un riavvio.
- Il tasto "Ho preso la dose" nelle notifiche conferma immediatamente la dose e aggiorna lo stock.
- Se il telefono era in aereo o spento, all'apertura dell'app viene fatto il **catch-up** delle finestre ancora aperte (notifiche immediate, deduplicate). Il log di deduplicazione viene scritto già all'arming degli allarmi, quindi una dose già consegnata da `AlarmManager` non viene notificata due volte.
