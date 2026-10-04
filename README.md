# MedTracker

Promemoria di assunzione farmaci e controllo scorte. **App Android nativa, 100% offline**: nessun backend, nessun Web Push, nessun account. I dati stanno in IndexedDB sul dispositivo.

## Stack

React 19 · TypeScript · Vite · Capacitor 8 · `@capacitor/local-notifications`

## Comandi

```bash
npm install
npm run dev            # sviluppo web (solo per iterare sulla UI)
npm run check          # assert su finestre di assunzione e calendario
npm run lint
npm run build          # tsc -b + vite build -> dist/
npm run android:sync   # build + copia dist/ nell'APK
```

## Build dell'APK

Serve JDK 21 e l'SDK Android. L'APK si produce così:

```bash
npm run android:sync
./android/gradlew -p android assembleDebug
```

L'output è `android/app/build/outputs/apk/debug/app-debug.apk`.

> `android/local.properties` e `org.gradle.java.home` sono impostazioni di macchina e non vanno committate: il build si guida con `JAVA_HOME` e l'SDK Manager.

Istruzioni di installazione, permessi e impostazioni OEM: **[DEPLOY_ANDROID.md](DEPLOY_ANDROID.md)**.

## Documentazione

- [CONTEXT.md](CONTEXT.md) — glossario del dominio e note architetturali.
- [docs/adr/](docs/adr/) — decisioni di progetto, inclusa la migrazione da PWA a nativo.
- [Technical_Requiremnts.md](Technical_Requiremnts.md) — specifiche del progetto di origine (PWA); la build consegnata è l'APK nativo descritto in ADR 0001.

## Note operative

- Gli allarmi sono nativi (`AlarmManager`, `setExact`) e sopravvivono a Doze e spegnimento schermo. Dopo un reboot `@capacitor/local-notifications` li ri-armi da solo.
- Se il telefono era in aereo o spento, all'apertura dell'app viene fatto il catch-up delle finestre ancora aperte. Il log di deduplicazione viene scritto all'arming, quindi nessuna dose viene notificata due volte.
- Alcuni OEM congelano l'app in deep sleep: dalle Impostazioni si può aprire la schermata di esenzione batteria.
