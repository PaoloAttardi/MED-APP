# TECHNICAL REQUIREMENTS DOCUMENT
## MedTracker — Autoimmune Medication Adherence App
**Version:** 1.0  
**Date:** 2026-06-13  
**Status:** Ready for Implementation Agent  

---

## 1. Problem Definition

### Description
Patients affected by autoimmune diseases (e.g., Rheumatoid Arthritis, Lupus, Multiple Sclerosis, Crohn's Disease) follow complex, multi-drug pharmacological protocols with strict dosing schedules. Missed doses or stock-outs are clinically significant events that reduce therapeutic efficacy.

### Business Context and Objectives
- Provide a **single-patient, offline-first mobile application** to track drug intake adherence
- Enable the patient to configure per-drug schedules with custom time windows
- Automate stock depletion tracking and alert the patient before running out
- Integrate with the device-native calendar for stock-out event scheduling
- Maximize installation ease: **no app store, sideloading or web link**, targeting Android and iOS without requiring separate builds or store submissions

### Key Objectives
1. Reduce missed doses via configurable push notification reminders
2. Prevent therapy interruptions by tracking stock and triggering low-stock alerts
3. Allow the patient to confirm, modify, or implicitly skip doses without friction
4. Create calendar events and send recurring notifications when stock is critically low

---

## 2. Scope

### In-Scope
- Multi-drug management (add, edit, delete drugs)
- Per-drug configuration: daily dose (quantity per intake), custom time-window schedules, stock count
- Push notification reminders per time window, per drug, with configurable enable/disable
- In-notification quick-confirm action (confirm exact dose taken)
- In-app dose confirmation screen with actual-dose-taken input (allows deviation from planned dose)
- Automatic stock decrement upon dose confirmation
- Implicit skip logic: no confirmation within time window = dose skipped, stock unchanged
- Low-stock alert system: configurable threshold (default 4 days of autonomy), configurable reminder frequency
- Native calendar event creation when stock reaches low-stock threshold
- Global settings screen for threshold and notification frequency configuration
- Offline-first, local storage only (no backend, no sync)
- Cross-platform installable as a **Progressive Web App (PWA)** via direct URL or local file

### Out-of-Scope
- Multi-user / caregiver profiles
- Cloud sync or remote backup
- Authentication / access control
- Data export (PDF, CSV)
- Medical device certification (MDR/FDA)
- Doctor-facing dashboard or reporting
- Medication interaction warnings or clinical decision support
- Prescription management or pharmacy integration
- AI/ML components

### Assumptions

- **ASSUMPTION:** The chosen technology is a **PWA (Progressive Web App)** built with React + Vite + TypeScript, installable via browser "Add to Home Screen" on both Android and iOS. This satisfies the constraint of no store submission, simple installation via URL or local file serving, and cross-platform compatibility. Push notifications via the Web Push API are supported on Android (Chrome); on iOS 16.4+ they are supported when the PWA is installed to the Home Screen. This trade-off is acceptable given the "personal testing" constraint stated by the user.
- **ASSUMPTION:** "Time window" means a named label (e.g., "Mattina", "Dopo pranzo", "Sera") with an associated target notification time (HH:MM). The window is considered open from the notification time until the next window's notification time (or midnight for the last window of the day). Dose confirmation is accepted during this entire window.
- **ASSUMPTION:** If a drug has multiple intakes per day, each intake has its own independent time window, notification, and dose count. Stock is decremented per intake confirmation, not per day.
- **ASSUMPTION:** Stock quantity is expressed in number of individual pills/tablets (integer). Dose per intake is also expressed in number of pills (integer ≥ 1). Autonomy = `floor(current_stock / total_daily_pills)` where `total_daily_pills = sum of dose_per_intake across all time windows for that drug`.
- **ASSUMPTION:** "Delta aggiunto" means the patient inputs how many new pills they received; the app adds this delta to the current stock. The app does not reset stock to a fixed value.
- **ASSUMPTION:** The native calendar integration targets the device's default calendar app via the `data:text/calendar` URI scheme (ICS file download) or the Web Share API with an .ics file, which triggers the system calendar import on both Android and iOS. Direct calendar write via Web APIs (not available in PWAs) is out of scope.
- **ASSUMPTION:** Notification scheduling uses the Web Notifications API + Service Worker background sync. Because PWA background push requires a push server, and the user requires a fully local/offline solution, notifications are scheduled via the Service Worker's `setInterval`/alarm-equivalent using a periodic background sync or client-side scheduling. On iOS, this has known limitations (notifications only fire when the app is in foreground or recently used); this constraint is documented as a known limitation.
- **ASSUMPTION:** All data is persisted in `localStorage` and/or `IndexedDB` on the device. No network requests are made by the application after initial load.

---

## 3. Functional Requirements

---

### FR-001 — Drug Management: Add Drug
- **Priority:** High
- **Description:** The patient can add a new drug to be tracked.
- **Input:** Drug name (string, max 100 chars), unit label (e.g., "compressa/e", configurable string), initial stock count (integer ≥ 0).
- **Output:** A new `Drug` record persisted in local storage; drug appears in the drug list on the home screen.
- **Behavior:**
  - Form validation: name required, stock ≥ 0 integer.
  - After creation, the drug has zero time windows. The patient is immediately prompted (or redirected) to configure at least one time window.
  - Duplicate drug names are allowed (same drug at different doses may coexist); no uniqueness constraint.
- **Edge Cases:**
  - Stock input is non-integer → reject with inline validation error.
  - Name is empty → reject with inline validation error.
  - More than 20 drugs added → ASSUMPTION: no hard cap, but UX warning shown above 15 drugs.

---

### FR-002 — Drug Management: Edit Drug
- **Priority:** High
- **Description:** The patient can edit an existing drug's name, unit label, and current stock (delta).
- **Input:** Drug ID (internal), updated fields.
- **Output:** Updated `Drug` record persisted; UI reflects changes immediately.
- **Behavior:**
  - Stock edit is additive (delta): input field labeled "Aggiungi pasticche", result = `current_stock + delta`. Delta must be ≥ 0 integer.
  - Negative delta (manual correction) is supported via a separate "Correggi scorta" field that accepts an absolute value, with explicit warning "Stai sovrascrivendo la scorta attuale."
  - Changing drug name does not affect time windows or history.
- **Edge Cases:**
  - Delta input is negative → reject with inline error unless in correction mode.
  - Editing a drug while a notification is pending → notification uses updated drug name on next scheduling cycle.

---

### FR-003 — Drug Management: Delete Drug
- **Priority:** Medium
- **Description:** The patient can delete a drug and all its associated time windows, scheduled notifications, and stock data.
- **Input:** Drug ID.
- **Output:** Drug and all child records removed from local storage; scheduled notifications for this drug cancelled.
- **Behavior:**
  - Requires explicit confirmation dialog: "Eliminare [Drug Name] e tutti i dati associati? Questa azione non è reversibile."
  - All pending notifications for the drug's time windows are deregistered from the Service Worker.
- **Edge Cases:**
  - Deletion of drug with active notification (notification already displayed) → notification is dismissed if technically possible; otherwise it remains visible but tapping it will show a "Farmaco non trovato" message.

---

### FR-004 — Time Window Management: Add Time Window to Drug
- **Priority:** High
- **Description:** The patient can add one or more time windows (intake slots) to a drug, each with a custom name, a notification time, a planned dose quantity, and a notification enabled/disabled toggle.
- **Input:** Drug ID, window label (string, e.g., "Mattina", max 30 chars), notification time (HH:MM), dose per intake (integer ≥ 1), notification enabled (boolean, default true).
- **Output:** A `TimeWindow` record linked to the drug; notification scheduled in Service Worker.
- **Behavior:**
  - A drug may have between 1 and N time windows (no hard cap; ASSUMPTION: max 6 per drug for UI sanity).
  - Each time window is independent: separate notification, separate confirmation, separate stock impact.
  - Time windows are sorted by HH:MM in the UI.
  - Upon save, if notification is enabled, the Service Worker schedules a daily repeating notification at the specified HH:MM.
- **Edge Cases:**
  - Two time windows with the same HH:MM on the same drug → allowed, but user is warned.
  - Notification time in the past for today → first notification fires the following day.
  - Drug has no time windows → reminder badge shown on drug card: "Nessuna fascia oraria configurata."

---

### FR-005 — Time Window Management: Edit / Delete Time Window
- **Priority:** High
- **Description:** The patient can edit the label, notification time, dose quantity, and enabled state of a time window, or delete it entirely.
- **Input:** TimeWindow ID, updated fields.
- **Output:** Updated `TimeWindow` record; Service Worker notification reschedule or cancellation.
- **Behavior:**
  - Edit: existing notification is cancelled and a new one is scheduled with updated parameters.
  - Delete: notification is cancelled; time window record removed.
  - Disabling a time window (toggle off) cancels the notification but keeps the window record and configuration.
  - Re-enabling reschedules the notification.
- **Edge Cases:**
  - Editing time after the current day's notification has already fired → reschedule takes effect from the next day.

---

### FR-006 — Dose Confirmation via Notification (Quick Confirm)
- **Priority:** High
- **Description:** When a reminder notification fires, the patient can confirm dose intake directly from the notification without opening the app.
- **Input:** Notification action button tap ("Ho preso la dose").
- **Output:** Stock for the associated drug decremented by `dose_per_intake` of the time window. A `DoseEvent` record (type: CONFIRMED, actual_dose: planned_dose, timestamp: now) persisted.
- **Behavior:**
  - Notification displays: drug name, time window label, planned dose (e.g., "Metotrexato — Mattina — 3 compresse").
  - Action buttons on notification: "Ho preso la dose" (confirm) | "Apri app" (opens in-app confirmation screen).
  - Upon quick confirm: stock decremented immediately; notification dismissed.
  - Low-stock check is triggered after decrement (see FR-010).
- **Edge Cases:**
  - Patient taps confirm after the next time window has already fired → confirmation is accepted; timestamp records actual time.
  - Patient confirms twice (double tap bug) → idempotency check: if a CONFIRMED DoseEvent already exists for this DrugID + TimeWindowID + calendar date, second tap is ignored.
  - Stock would go below 0 → decrement to 0, show warning: "Scorta esaurita. Aggiornare la quantità."

---

### FR-007 — Dose Confirmation via In-App Screen
- **Priority:** High
- **Description:** The patient can confirm or modify a dose intake from within the app, either by navigating to a pending confirmation or via the "Apri app" notification action.
- **Input:** DrugID, TimeWindowID, actual dose taken (integer ≥ 0, pre-filled with planned dose).
- **Output:** `DoseEvent` record persisted; stock decremented by `actual_dose`.
- **Behavior:**
  - Screen shows: drug name, time window, planned dose, editable field for actual dose taken.
  - If `actual_dose` ≠ `planned_dose`: both values are stored in DoseEvent for reference; stock is decremented by `actual_dose`.
  - If `actual_dose` = 0: treated as a voluntary skip; stock unchanged; DoseEvent type = SKIPPED_VOLUNTARY.
  - Pending confirmations (not yet confirmed or timed out) are accessible from a "Da confermare" badge/list on the home screen.
  - A time window is "pending" from notification time until the start of the next time window for the same drug (or midnight for the last window).
- **Edge Cases:**
  - Patient opens in-app confirmation after already quick-confirming → form is pre-filled with confirmed values and is read-only, showing "Già confermata alle HH:MM."
  - `actual_dose` input is non-integer or negative → reject with inline validation error.

---

### FR-008 — Implicit Skip (Missed Dose)
- **Priority:** High
- **Description:** If no confirmation is received for a time window within its active period, the system registers a missed dose. Stock is NOT decremented.
- **Input:** Time-based trigger (end of time window).
- **Output:** `DoseEvent` record persisted (type: SKIPPED_IMPLICIT, actual_dose: 0, timestamp: window end time). No stock change.
- **Behavior:**
  - The "end of window" is defined as: the start time of the next scheduled time window for that drug on the same day, or 23:59 if it is the last window.
  - The Service Worker evaluates open windows at their end time and marks them as SKIPPED_IMPLICIT if no CONFIRMED or SKIPPED_VOLUNTARY event exists for that window + date.
  - Skipped doses do NOT trigger any notification or alert (purely silent tracking for future reference/autonomy calculation accuracy).
- **Edge Cases:**
  - Device is powered off during the window → upon next app open, the Service Worker evaluates all past unconfirmed windows and marks them as SKIPPED_IMPLICIT.
  - Multiple missed days → all unresolved past windows are batch-processed on app open.

---

### FR-009 — Stock Update (Refill)
- **Priority:** High
- **Description:** The patient can update the stock of a drug by adding a positive delta of pills received.
- **Input:** Drug ID, delta (integer ≥ 1) via the Edit Drug screen (FR-002).
- **Output:** `current_stock += delta`; persisted. Low-stock check re-evaluated (see FR-010); calendar event removed if autonomy > threshold.
- **Behavior:**
  - After refill, if autonomy is now above the configured threshold, any existing pending low-stock calendar ICS and notification cycle are cancelled/stopped.
  - The stock field on the drug card is updated immediately.
- **Edge Cases:**
  - Delta = 0 → rejected with inline error "Inserire un valore maggiore di 0."
  - Refill brings stock to extremely high value (e.g., 999) → no cap; display is managed via UI truncation.

---

### FR-010 — Low-Stock Detection and Alerting
- **Priority:** High
- **Description:** When the autonomy (days of remaining stock) for a drug drops to or below the configured threshold, the system initiates a low-stock alert cycle.
- **Input:** Triggered after any stock decrement event (FR-006, FR-007). Inputs: `current_stock`, `total_daily_dose`, `low_stock_threshold_days` (default: 4, configurable per FR-013).
- **Output:** If `floor(current_stock / total_daily_dose) <= low_stock_threshold_days`: (a) generate ICS calendar event (FR-011), (b) begin low-stock notification cycle (FR-012).
- **Behavior:**
  - Autonomy is calculated per drug independently.
  - `total_daily_dose = sum of dose_per_intake for all ENABLED time windows of the drug`.
  - Threshold comparison is re-evaluated after every stock change.
  - If the drug has no enabled time windows, autonomy check is skipped (no daily consumption defined).
  - Low-stock state is stored as a flag on the Drug record (`low_stock_alert_active: boolean`) to prevent duplicate calendar events.
- **Edge Cases:**
  - `total_daily_dose = 0` (all time windows disabled) → autonomy = Infinity; no alert triggered.
  - Stock = 0 → autonomy = 0; alert fires immediately.
  - Stock already in low-stock state and patient adds refill that exceeds threshold → alert cycle is deactivated (FR-009).

---

### FR-011 — Calendar Event Creation (Stock-Out Date)
- **Priority:** High
- **Description:** When low-stock state is first entered for a drug, the app generates a calendar event for the estimated stock-out date and offers it for import into the device's native calendar.
- **Input:** Drug name, estimated stock-out date = `today + floor(current_stock / total_daily_dose)` days.
- **Output:** An `.ics` file is generated client-side and triggered for download/import. On mobile, the OS handles the `.ics` file by opening the native calendar app for confirmation.
- **Behavior:**
  - Event title: "⚠️ Scorta in esaurimento: [Drug Name]"
  - Event date: all-day event on the calculated stock-out date.
  - Event description: "La scorta di [Drug Name] si esaurirà oggi. Ricordati di rinnovare la prescrizione."
  - The event is created only once per low-stock entry (idempotent: `low_stock_alert_active` flag prevents re-creation).
  - ASSUMPTION: Direct write to device calendar is not available via PWA Web APIs. The `.ics` download approach is used instead, which requires one manual tap from the user to confirm the import in their calendar app. This is an accepted limitation.
- **Edge Cases:**
  - Stock-out date is today → event is created for today.
  - Stock-out date is in the past (stock already = 0) → event is created for today with description noting stock is already exhausted.
  - User dismisses the calendar import → the app does not retry the calendar creation (it only attempts once per low-stock cycle entry).

---

### FR-012 — Low-Stock Recurring Notifications
- **Priority:** High
- **Description:** Once low-stock state is entered, the app sends recurring push notifications reminding the patient to reorder, at a frequency configurable by the patient.
- **Input:** `low_stock_notification_frequency` setting (enum: DAILY | EVERY_TWO_DAYS | DAY_BEFORE_ONLY). Drug name, estimated stock-out date.
- **Output:** Push notifications fired at the configured interval until either the stock is refilled above threshold or the stock-out date is reached.
- **Behavior:**
  - **DAILY:** notification fires every day at a fixed time (ASSUMPTION: 09:00, non-configurable; can be a future enhancement).
  - **EVERY_TWO_DAYS:** notification fires every 2 days starting from the day low-stock is detected.
  - **DAY_BEFORE_ONLY:** single notification fires on the day before the stock-out date.
  - Notification content: "⚠️ [Drug Name]: scorta in esaurimento. Autonomia stimata: X giorni."
  - Low-stock notifications are separate from dose reminder notifications and do not interfere with them.
  - When stock is refilled above threshold: all scheduled low-stock notifications for that drug are cancelled.
- **Edge Cases:**
  - `DAY_BEFORE_ONLY` selected but stock-out is today → notification fires immediately.
  - Patient receives a DAILY notification but ignores it for 3 days → notifications continue until refill or stock-out.
  - Low-stock notification fires at the same time as a dose reminder → both are delivered; they are independent.

---

### FR-013 — Settings Screen
- **Priority:** High
- **Description:** A global settings screen allows the patient to configure app-wide parameters.
- **Input:** User interaction with settings form.
- **Output:** Updated settings persisted in local storage.
- **Settings fields:**

| Setting | Type | Default | Scope |
|---|---|---|---|
| Low-stock threshold (days) | integer ≥ 1 | 4 | Global (applies to all drugs) |
| Low-stock notification frequency | enum: DAILY / OGNI_DUE_GIORNI / SOLO_GIORNO_PRIMA | DAILY | Global |

- **Behavior:**
  - Changes to low-stock threshold take effect immediately: all drug autonomy values are re-evaluated on save.
  - Changes to notification frequency reschedule all active low-stock notification cycles.
- **Edge Cases:**
  - Threshold set to 0 → reject with inline error "Il valore minimo è 1 giorno."
  - User changes frequency while in low-stock state → existing low-stock notification schedule is replaced with the new frequency.

---

### FR-014 — Home Screen / Dashboard
- **Priority:** High
- **Description:** The home screen displays all tracked drugs with their current status at a glance.
- **Output:** List of drug cards, each showing:
  - Drug name
  - Current stock count + unit
  - Days of autonomy remaining
  - Low-stock warning badge (if autonomy ≤ threshold)
  - Today's time windows with status (pending / confirmed / skipped)
  - Quick-access button to add stock
- **Behavior:**
  - Drug cards are sorted: drugs with low-stock first, then alphabetically.
  - "Da confermare" indicator is shown on time windows that are currently in their active period and unconfirmed.
  - Tapping a time window status opens the in-app confirmation screen (FR-007).

---

### FR-015 — Notification Permission Management
- **Priority:** High
- **Description:** On first launch, the app requests notification permission from the OS. If denied, the app shows an inline warning and disables all notification features gracefully.
- **Behavior:**
  - If permission is granted: Service Worker is registered and all enabled time window notifications are scheduled.
  - If permission is denied: dose reminders and low-stock notifications are non-functional; patient is informed via persistent banner: "Le notifiche sono disabilitate. Abilitale nelle impostazioni del dispositivo per ricevere i reminder."
  - Permission state is checked on every app open; if permission is re-granted after initial denial, notifications are re-scheduled.

---

## 4. Non-Functional Requirements

### Performance
- App initial load time (cold start, PWA cached): ≤ 1.5 seconds on mid-range Android device (2021+).
- Stock decrement + low-stock check: ≤ 100ms total computation time (entirely local, synchronous).
- ICS file generation: ≤ 200ms.
- Storage read/write operations (IndexedDB): ≤ 50ms per operation.

### Scalability
- Designed for a single patient with up to 20 drugs and up to 6 time windows per drug. No horizontal scalability requirement.
- Local storage footprint: estimated < 5 MB for 5 years of DoseEvent history with 20 drugs × 6 windows/day.

### Reliability
- All core features must function fully offline after initial PWA install (Service Worker caches all static assets).
- Data persistence: IndexedDB used (survives browser refresh, app close, device restart). `localStorage` may be used for settings only.
- Notification delivery reliability is subject to OS-level constraints (battery optimization, iOS background limitations). This is a documented known limitation, not a reliability defect of the app.

### Security
- No authentication required (v1.0).
- No data leaves the device. No network calls after initial load.
- No encryption of stored data required (v1.0).
- ASSUMPTION: The PWA is served over HTTPS (required for Service Workers and Push API). For local testing, `localhost` is acceptable.

### Compliance
- No medical device certification required. The app is a personal adherence support tool, not a clinical device.
- GDPR: no personal data is transmitted externally; local data is under the user's full control. No consent banner required (no tracking, no analytics).

### Observability
- No remote logging or monitoring.
- ASSUMPTION: A simple in-app error boundary (React ErrorBoundary) with a "Qualcosa è andato storto. Riavvia l'app." message is sufficient for error handling visibility.
- Console logging in development mode; suppressed in production build.

---

## 5. Data Requirements

### Drug Schema
```json
{
  "id": "uuid-v4",
  "name": "string (max 100)",
  "unit_label": "string (max 30, e.g., 'compressa/e')",
  "current_stock": "integer >= 0",
  "low_stock_alert_active": "boolean",
  "low_stock_alert_last_ics_date": "ISO date string | null",
  "created_at": "ISO datetime string",
  "updated_at": "ISO datetime string"
}
```

### TimeWindow Schema
```json
{
  "id": "uuid-v4",
  "drug_id": "uuid-v4 (FK -> Drug.id)",
  "label": "string (max 30)",
  "notification_time": "HH:MM (24h format string)",
  "dose_per_intake": "integer >= 1",
  "notification_enabled": "boolean",
  "created_at": "ISO datetime string"
}
```

### DoseEvent Schema
```json
{
  "id": "uuid-v4",
  "drug_id": "uuid-v4",
  "time_window_id": "uuid-v4",
  "event_type": "enum: CONFIRMED | SKIPPED_IMPLICIT | SKIPPED_VOLUNTARY",
  "planned_dose": "integer >= 1",
  "actual_dose": "integer >= 0",
  "scheduled_datetime": "ISO datetime string",
  "confirmed_at": "ISO datetime string | null",
  "stock_after": "integer >= 0"
}
```

### Settings Schema
```json
{
  "low_stock_threshold_days": "integer >= 1 (default: 4)",
  "low_stock_notification_frequency": "enum: DAILY | EVERY_TWO_DAYS | DAY_BEFORE_ONLY (default: DAILY)"
}
```

### Data Validation Rules
- All IDs are UUID v4 generated client-side.
- `current_stock` must never be persisted as negative; floor to 0 on underflow.
- `notification_time` must match regex `^([01]\d|2[0-3]):[0-5]\d$`.
- `event_type` is a closed enum; invalid values are rejected before persistence.
- All datetime strings are ISO 8601 in local timezone (no UTC conversion; purely local scheduling).

### Data Sources and Sinks
- **Source:** User input via app forms + Service Worker notification action events.
- **Sink:** IndexedDB (primary store for Drug, TimeWindow, DoseEvent); `localStorage` (Settings).
- No external data sources or sinks.

### Handling of Missing/Dirty Data
- On app boot, validate all records in IndexedDB against schema. Records with missing required fields are flagged in console and excluded from UI rendering (not deleted).
- ASSUMPTION: A lightweight schema migration utility is included to handle future field additions without breaking existing stored data (additive migrations only in v1.0).

---

## 6. System Architecture (Logical)

### Components

| Component | Responsibility |
|---|---|
| **React UI Layer** | All screens, forms, drug cards, settings. State managed via React Context + useReducer or Zustand. |
| **IndexedDB Data Layer** | Persistent storage for Drug, TimeWindow, DoseEvent. Accessed via a typed repository abstraction (e.g., `DrugRepository`, `DoseEventRepository`). |
| **Service Worker (SW)** | Background task runner. Manages notification scheduling (dose reminders, low-stock alerts), missed-dose detection at window-end, periodic background sync. |
| **Notification Manager** | Abstraction over Web Push / Notification API. Handles scheduling, cancellation, and action routing from notification taps. |
| **Stock Engine** | Pure functions: compute autonomy, evaluate low-stock state, decrement/increment stock, trigger calendar event creation. |
| **ICS Generator** | Client-side generation of RFC 5545-compliant `.ics` content for calendar event download. |
| **Settings Store** | `localStorage`-backed key-value store for global settings. Exposes reactive hooks for components. |

### Interaction Flow: Dose Reminder Cycle
```
[Daily at HH:MM] → Service Worker fires scheduled notification
  → Notification displayed on device (drug name, window label, planned dose)
  → [Action: "Ho preso la dose"] → SW posts message to client
      → Stock Engine: current_stock -= dose_per_intake
      → DoseEvent CONFIRMED persisted
      → Stock Engine: evaluate low-stock (FR-010)
          → [If low-stock entered] → ICS Generator → .ics download triggered
                                   → Notification Manager schedules low-stock cycle
      → UI updated
  → [Action: "Apri app"] → App opens to in-app confirmation screen (FR-007)
  → [No action before window end] → SW fires end-of-window check
      → DoseEvent SKIPPED_IMPLICIT persisted (no stock change)
```

### Interaction Flow: Low-Stock Alert Cycle
```
[Low-stock state entered] → ICS Generator creates .ics → User imports to native calendar
  → Notification Manager schedules low-stock notifications per configured frequency
      → [DAILY] fires at 09:00 every day
      → [EVERY_TWO_DAYS] fires at 09:00 every 2 days
      → [DAY_BEFORE_ONLY] fires at 09:00 on (stock_out_date - 1)
  → [Refill event] → Stock Engine re-evaluates
      → [Autonomy > threshold] → low_stock_alert_active = false
                               → Notification Manager cancels all low-stock notifications for drug
```

### External Dependencies
- **Web Notifications API** (browser native): notification display and action handling
- **Service Worker API** (browser native): background scheduling
- **IndexedDB API** (browser native): persistent local storage
- **Web Share API / `<a download>` trigger** (browser native): ICS file delivery
- **No external APIs, CDNs (after initial load), or backend services**

---

## 7. AI/ML-Specific Requirements

**Not applicable.** This application contains no AI/ML components.

---

## 8. API / Interface Contracts

This application is entirely client-side with no HTTP API. The internal interface contracts are:

### Repository Interface (TypeScript)

```typescript
interface DrugRepository {
  getAll(): Promise<Drug[]>;
  getById(id: string): Promise<Drug | null>;
  create(drug: Omit<Drug, 'id' | 'created_at' | 'updated_at'>): Promise<Drug>;
  update(id: string, patch: Partial<Drug>): Promise<Drug>;
  delete(id: string): Promise<void>;
}

interface TimeWindowRepository {
  getByDrugId(drugId: string): Promise<TimeWindow[]>;
  create(window: Omit<TimeWindow, 'id' | 'created_at'>): Promise<TimeWindow>;
  update(id: string, patch: Partial<TimeWindow>): Promise<TimeWindow>;
  delete(id: string): Promise<void>;
}

interface DoseEventRepository {
  getByDrugAndDate(drugId: string, date: string): Promise<DoseEvent[]>;
  create(event: Omit<DoseEvent, 'id'>): Promise<DoseEvent>;
  existsConfirmedForWindow(drugId: string, windowId: string, date: string): Promise<boolean>;
}
```

### Service Worker Message Protocol

Messages from SW to app client (via `postMessage`):

```typescript
// Dose confirmed via notification action
{ type: 'DOSE_CONFIRMED', drugId: string, windowId: string, timestamp: string }

// Window expired without confirmation
{ type: 'DOSE_WINDOW_EXPIRED', drugId: string, windowId: string, timestamp: string }
```

Messages from app to SW (via `postMessage`):

```typescript
// Schedule or reschedule a time window notification
{ type: 'SCHEDULE_NOTIFICATION', drugId: string, windowId: string, time: 'HH:MM', label: string, dose: number, enabled: boolean }

// Cancel a time window notification
{ type: 'CANCEL_NOTIFICATION', windowId: string }

// Schedule low-stock notification
{ type: 'SCHEDULE_LOW_STOCK', drugId: string, drugName: string, stockOutDate: string, frequency: 'DAILY' | 'EVERY_TWO_DAYS' | 'DAY_BEFORE_ONLY' }

// Cancel low-stock notifications for a drug
{ type: 'CANCEL_LOW_STOCK', drugId: string }
```

### Error Handling
- Repository errors (IndexedDB failures): caught at the repository layer, surfaced to the UI as toast notifications: "Errore nel salvataggio dei dati. Riprova."
- Notification scheduling failures: logged to console; silent fallback (notifications not delivered, no crash).
- ICS generation failures: toast notification: "Impossibile creare l'evento calendario. Riprova."
- All async operations wrapped in try/catch; no unhandled promise rejections.

### Versioning Strategy
- App version stored in `localStorage` (`app_version` key).
- On boot: compare stored version with build version. If mismatch: run migration scripts. Migrations are additive and idempotent.
- No API versioning (no external API).

---

## 9. Edge Cases & Failure Handling

| # | Scenario | Handling |
|---|---|---|
| EC-01 | Device rebooted mid-day; missed notifications | On app open, SW evaluates all past unconfirmed windows for the current day and marks as SKIPPED_IMPLICIT |
| EC-02 | App uninstalled and reinstalled | IndexedDB is cleared; all data lost. No recovery mechanism (local-only, no backup). User must re-enter drugs. |
| EC-03 | iOS notification permission denied | Persistent banner shown; all notification features degraded gracefully; core tracking via app still works |
| EC-04 | Stock goes to 0 mid-dose-cycle | Stock floored at 0; warning toast displayed; low-stock alert fires immediately |
| EC-05 | User confirms dose after already confirming (double tap) | Idempotency check on (drugId, windowId, date); second confirmation silently ignored |
| EC-06 | Time window notification fires while app is open in foreground | Notification shown as in-app modal/banner (browsers suppress notifications when app is in foreground); user can confirm inline |
| EC-07 | All time windows for a drug are disabled | `total_daily_dose = 0`; autonomy = Infinity; no low-stock alert; no notifications; stock displayed but not tracked |
| EC-08 | User changes device time/timezone | Notification times are stored in HH:MM local time; reschedule occurs on next app open |
| EC-09 | IndexedDB quota exceeded | Caught at write; toast error: "Spazio di archiviazione esaurito. Eliminare dati non necessari." |
| EC-10 | ICS file download blocked by browser | Toast: "Download bloccato. Consenti i download nelle impostazioni del browser." |
| EC-11 | Low-stock threshold changed while drug is already in low-stock | Re-evaluation triggers: if now above new threshold, alert cycle deactivated; if still below, state unchanged |

### Retry Logic
- ICS download: user can retry manually from the drug detail screen (a "Crea evento calendario" button is available while low-stock is active).
- Notification scheduling: retried once on next app open if Service Worker registration failed.

### Graceful Degradation
- Without notification permission: app functions as a manual tracking tool; all data entry and stock management work normally.
- Without Service Worker support (unlikely in modern browsers): app loads but displays warning "Il tuo browser non supporta alcune funzionalità. Usa Chrome su Android o Safari su iOS 16.4+."

---

## 10. Acceptance Criteria

### AC-001 — Drug Creation and Time Window Setup
**Given** a patient opens the app for the first time  
**When** they add a drug "Metotrexato", stock 8 compresse, with two time windows: "Mattina" at 08:00, 3 compresse; "Sera" at 20:00, 2 compresse  
**Then** the drug card shows stock: 8, autonomy: floor(8/(3+2)) = 1 day, two time windows listed

---

### AC-002 — Dose Confirmation via Notification Decrements Stock
**Given** a drug "Metotrexato" with stock 10 and a time window "Mattina" with dose 3  
**When** the notification fires at 08:00 and the patient taps "Ho preso la dose"  
**Then** stock becomes 7; a CONFIRMED DoseEvent is persisted with actual_dose=3; no second decrement occurs if the notification is tapped again

---

### AC-003 — Implicit Skip Does Not Decrement Stock
**Given** a drug "Metotrexato" with stock 10 and a time window "Mattina" at 08:00 (window ends at next window start or 23:59)  
**When** the patient does not confirm by window end  
**Then** stock remains 10; a SKIPPED_IMPLICIT DoseEvent is persisted; no notification is sent for the skip

---

### AC-004 — Low-Stock Detection at Threshold
**Given** a drug with stock 10, total daily dose 3, threshold set to 4 days (floor(10/3)=3, which is ≤ 4)  
**When** the app evaluates autonomy  
**Then** low-stock alert is activated; ICS download is triggered; low-stock notifications are scheduled per configured frequency

---

### AC-005 — Refill Deactivates Low-Stock Alert
**Given** a drug in low-stock state with stock 5, total daily dose 3 (autonomy = 1), threshold = 4  
**When** patient adds delta = 20 (new stock = 25, autonomy = floor(25/3) = 8 > 4)  
**Then** `low_stock_alert_active` = false; all scheduled low-stock notifications for this drug are cancelled

---

### AC-006 — Calendar Event Created Once Per Low-Stock Entry
**Given** a drug that just entered low-stock state  
**When** the stock is decremented twice in quick succession (e.g., two rapid confirmations)  
**Then** ICS generation is triggered only once (idempotent check on `low_stock_alert_active` flag)

---

### AC-007 — In-App Confirmation with Modified Dose
**Given** a drug "Idrossiclorochina" with planned dose 2 compresse, stock 20  
**When** patient opens the in-app confirmation and sets actual_dose = 1  
**Then** stock decremented by 1 (not 2); DoseEvent persisted with planned_dose=2, actual_dose=1, type=CONFIRMED

---

### AC-008 — Notification Toggle
**Given** a time window with notification_enabled = true  
**When** the patient disables it via the edit screen  
**Then** the notification is deregistered from the Service Worker; no further notifications fire for that window until re-enabled

---

### AC-009 — PWA Installability
**Given** the app is served via HTTPS or localhost  
**When** the patient opens it in Chrome on Android or Safari on iOS 16.4+  
**Then** the browser offers an "Add to Home Screen" prompt; after installation, the app launches as a standalone app icon without browser chrome

---

### AC-010 — Low-Stock Notification Frequency: DAY_BEFORE_ONLY
**Given** low-stock notification frequency set to DAY_BEFORE_ONLY and stock-out date = June 20  
**When** the system schedules notifications  
**Then** exactly one notification is delivered on June 19 at 09:00 and no notifications on June 17 or 18

---

## 11. Open Questions / Ambiguities

| # | Question | Impact | Status |
|---|---|---|---|
| OQ-01 | iOS PWA push notification support requires the user to add the app to Home Screen AND grant permission inside the installed app. The UX flow for this onboarding is not specified. | Medium — affects first-run UX design | Open |
| OQ-02 | What happens if the patient changes the planned `dose_per_intake` after some DoseEvents are already recorded? The historical autonomy calculation in past events will reflect the old dose, but future calculations will use the new dose. Is this acceptable? | Low — historical inconsistency, no safety impact | Assumed acceptable; document behavior in UI |
| OQ-03 | The "end of window" for implicit skip detection requires knowing when the next window starts. If the patient has only one time window per day, the window ends at 23:59. If they add a second window later, does the end-of-window retroactively change for past entries? | Low | Assumed no retroactive change; end-of-window is computed at the time of evaluation |
| OQ-04 | The `DAY_BEFORE_ONLY` low-stock notification: if stock-out date is today (autonomy = 0), the "day before" has already passed. The spec (EC-04 / FR-012) covers this with immediate fire, but the UX messaging should not say "domani finirà la scorta" if stock is already 0. Requires specific copy for this edge case. | Low | Open — copy must be defined |
| OQ-05 | Should deleted drugs' DoseEvent history be retained (e.g., for future audit) or purged? Current spec says purge (FR-003). Confirm this is acceptable. | Low | Assumed purge is acceptable per stated scope |