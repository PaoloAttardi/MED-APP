# ADR 0001: Migrare da PWA+GitHub Pages ad APK nativo con Capacitor

**Stato**: Accettato  
**Data**: 2026-10-04  
**Decision Maker**: Consenso tecnico

## Contesto

L'app MedTracker aveva un'implementazione PWA con Service Worker e notifiche gestite tramite `setInterval` + Periodic Background Sync. I test pratici su Android hanno mostrato:
- `setInterval` viene congelato dalla maggior parte degli OEM quando l'app è in background e lo schermo è spento.
- Periodic Background Sync non è affidabile: Chrome lo clampa a circa una volta al giorno, solo quando il dispositivo è inattivo, in carica e su Wi-Fi. 
- Non esiste `showTrigger`/`TimestampTrigger` (la proposta Chrome è stata abbandonata). 
- Android 14+ rende `SCHEDULE_EXACT_ALARM` negato di default e non richiedibile via dialogo, mentre `USE_EXACT_ALARM` è concesso all'installazione.

L'obiettivo è avere notifiche affidabili, totalmente offline, per uso personale sideloadato.

## Decisione

Passare a un APK nativo via Capacitor 8 (`@capacitor/core`, `@capacitor/android`, `@capacitor/local-notifications`), eliminando del tutto il Service Worker e GitHub Pages.

## Motivazioni

- **Affidabilità**: le notifiche vengono programmate via `AlarmManager` (`setExact`/`allowWhileIdle`) dall'OS, quindi sopravvivono a Doze e spegnimento schermo. Il reboot è coperto dal `LocalNotificationRestoreReceiver` del plugin, che rischedula da `NotificationStorage` (e riprogramma a +15s le notifiche scadute durante lo spegnimento).
- **Zero backend**: `@capacitor/local-notifications` è interamente locale. Nessun Web Push, nessun server. Coerente con "totally offline".
- **Permessi Android 14**: possiamo dichiarare sia `USE_EXACT_ALARM` (install-time) sia `SCHEDULE_EXACT_ALARM` (fallback). Per una build sideloadata personale, `USE_EXACT_ALARM` elimina completamente l'attrito.
- **Corretto dominio dei dati**: IndexedDB passa da `https://paoloattardi.github.io/` (origin web) a `https://localhost` nella WebView dell'APK. Un APK nativo elimina l'ambiguità tra due ambienti.
- **Deleghiamo all'OS**: la responsabilità dello scheduling esce dal processo JS in background (sempre soggetto a throttling OEM) ed entra nel sistema. 

## Conseguenze

- Il bundle viene impacchettato in un APK (installazione via adb o trasferimento file). 
- Vite passa da `base: '/MED-APP/'` a `base: './'` per funzionare con `https://localhost` nella WebView.
- Manifest PWA, 404.html, workflow GitHub Pages e Service Worker vengono rimossi.
- Le icone vengono normalizzate: il vecchio `icon-192.png`/`512.png` erano JPEG travestiti da PNG e vengono sostituiti/gestiti da Capacitor Assets (icona launcher e drawable monocromatico per la barra di stato).
- Viene aggiunto un piccolo plugin nativo `BatterySettings` (Java) per aprire direttamente le impostazioni "Ignore battery optimizations", evitando di introdurre dipendenze npm non esistenti.
- Il codice della logica applicativa resta invariato (stessi helper puri, stessi repository IndexedDB). Solo lo strato di trasporto delle notifiche cambia da polling a push.

## Alternative valutate

- **TWA/Bubblewrap**: avvolge la PWA ma eredita esattamente gli stessi problemi di scheduling del Web (timer + Periodic Background Sync). Rifiutato.
- **PWA + Web Push**: richiede un backend sempre attivo per inviare push a orario, contraddice il requisito "totally offline". Rifiutato.
- **Mantenere SW come cache**: in un APK gli asset sono già impacchettati; il SW aggiunge complessità (due percorsi paralleli) e introduce i bug già presenti (discrepanza di confini finestre tra pagina/SW, skip impliciti per finestre disabilitate). Rifiutato.
