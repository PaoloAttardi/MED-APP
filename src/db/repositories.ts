import type { Drug, TimeWindow, DoseEvent } from '../types';
import { openDatabase, promisifyRequest } from './indexedDb';

export const drugRepository = {
  async getAll(): Promise<Drug[]> {
    const db = await openDatabase();
    const tx = db.transaction('drugs', 'readonly');
    const store = tx.objectStore('drugs');
    const drugs = await promisifyRequest(store.getAll());
    return drugs;
  },

  async getById(id: string): Promise<Drug | null> {
    const db = await openDatabase();
    const tx = db.transaction('drugs', 'readonly');
    const store = tx.objectStore('drugs');
    const drug = await promisifyRequest(store.get(id));
    return drug || null;
  },

  async create(drugData: Omit<Drug, 'id' | 'created_at' | 'updated_at'>): Promise<Drug> {
    const db = await openDatabase();
    const tx = db.transaction('drugs', 'readwrite');
    const store = tx.objectStore('drugs');
    
    const now = new Date().toISOString();
    const drug: Drug = {
      ...drugData,
      id: crypto.randomUUID(),
      created_at: now,
      updated_at: now
    };

    await promisifyRequest(store.add(drug));
    return drug;
  },

  async update(id: string, patch: Partial<Drug>): Promise<Drug> {
    const db = await openDatabase();
    const tx = db.transaction('drugs', 'readwrite');
    const store = tx.objectStore('drugs');
    
    const existing = await promisifyRequest<Drug>(store.get(id));
    if (!existing) {
      throw new Error(`Drug with id ${id} not found`);
    }

    const updated: Drug = {
      ...existing,
      ...patch,
      updated_at: new Date().toISOString()
    };

    await promisifyRequest(store.put(updated));
    return updated;
  },

  async delete(id: string): Promise<void> {
    const db = await openDatabase();
    
    // Begin transaction for drugs, time_windows, and dose_events to clean up everything
    const tx = db.transaction(['drugs', 'time_windows', 'dose_events'], 'readwrite');
    
    // Delete the drug
    await promisifyRequest(tx.objectStore('drugs').delete(id));

    // Delete associated time windows
    const timeWindowStore = tx.objectStore('time_windows');
    const timeWindowIndex = timeWindowStore.index('drug_id');
    const windows = await promisifyRequest<TimeWindow[]>(timeWindowIndex.getAll(id));
    for (const win of windows) {
      await promisifyRequest(timeWindowStore.delete(win.id));
    }

    // Delete associated dose events
    const doseEventStore = tx.objectStore('dose_events');
    const doseEventIndex = doseEventStore.index('drug_id');
    const events = await promisifyRequest<DoseEvent[]>(doseEventIndex.getAll(id));
    for (const ev of events) {
      await promisifyRequest(doseEventStore.delete(ev.id));
    }
  }
};

export const timeWindowRepository = {
  async getByDrugId(drugId: string): Promise<TimeWindow[]> {
    const db = await openDatabase();
    const tx = db.transaction('time_windows', 'readonly');
    const index = tx.objectStore('time_windows').index('drug_id');
    const windows = await promisifyRequest<TimeWindow[]>(index.getAll(drugId));
    // Sort by notification_time HH:MM
    return windows.sort((a, b) => a.notification_time.localeCompare(b.notification_time));
  },

  async getById(id: string): Promise<TimeWindow | null> {
    const db = await openDatabase();
    const tx = db.transaction('time_windows', 'readonly');
    const store = tx.objectStore('time_windows');
    const window = await promisifyRequest(store.get(id));
    return window || null;
  },

  async create(windowData: Omit<TimeWindow, 'id' | 'created_at'>): Promise<TimeWindow> {
    const db = await openDatabase();
    const tx = db.transaction('time_windows', 'readwrite');
    const store = tx.objectStore('time_windows');

    const window: TimeWindow = {
      ...windowData,
      id: crypto.randomUUID(),
      created_at: new Date().toISOString()
    };

    await promisifyRequest(store.add(window));
    return window;
  },

  async update(id: string, patch: Partial<TimeWindow>): Promise<TimeWindow> {
    const db = await openDatabase();
    const tx = db.transaction('time_windows', 'readwrite');
    const store = tx.objectStore('time_windows');

    const existing = await promisifyRequest<TimeWindow>(store.get(id));
    if (!existing) {
      throw new Error(`TimeWindow with id ${id} not found`);
    }

    const updated: TimeWindow = {
      ...existing,
      ...patch
    };

    await promisifyRequest(store.put(updated));
    return updated;
  },

  async delete(id: string): Promise<void> {
    const db = await openDatabase();
    
    // Begin transaction for time_windows and dose_events
    const tx = db.transaction(['time_windows', 'dose_events'], 'readwrite');
    
    // Delete the window
    await promisifyRequest(tx.objectStore('time_windows').delete(id));

    // Delete associated dose events
    const doseEventStore = tx.objectStore('dose_events');
    const doseEventIndex = doseEventStore.index('time_window_id');
    const events = await promisifyRequest<DoseEvent[]>(doseEventIndex.getAll(id));
    for (const ev of events) {
      await promisifyRequest(doseEventStore.delete(ev.id));
    }
  }
};

export const doseEventRepository = {
  async getByDrugAndDate(drugId: string, dateStr: string): Promise<DoseEvent[]> {
    const db = await openDatabase();
    const tx = db.transaction('dose_events', 'readonly');
    const index = tx.objectStore('dose_events').index('drug_id');
    const events = await promisifyRequest<DoseEvent[]>(index.getAll(drugId));
    
    // Filter events where scheduled_datetime starts with the given date (YYYY-MM-DD)
    return events.filter(e => e.scheduled_datetime.startsWith(dateStr));
  },

  async getAll(): Promise<DoseEvent[]> {
    const db = await openDatabase();
    const tx = db.transaction('dose_events', 'readonly');
    const store = tx.objectStore('dose_events');
    return promisifyRequest<DoseEvent[]>(store.getAll());
  },

  async create(eventData: Omit<DoseEvent, 'id'>): Promise<DoseEvent> {
    const db = await openDatabase();
    const tx = db.transaction('dose_events', 'readwrite');
    const store = tx.objectStore('dose_events');

    const event: DoseEvent = {
      ...eventData,
      id: crypto.randomUUID()
    };

    await promisifyRequest(store.add(event));
    return event;
  },

  async existsConfirmedForWindow(drugId: string, windowId: string, dateStr: string): Promise<boolean> {
    const db = await openDatabase();
    const tx = db.transaction('dose_events', 'readonly');
    const index = tx.objectStore('dose_events').index('time_window_id');
    const events = await promisifyRequest<DoseEvent[]>(index.getAll(windowId));

    // Check if there is any CONFIRMED or SKIPPED_VOLUNTARY event for this window on this date
    return events.some(e => 
      e.drug_id === drugId &&
      e.scheduled_datetime.startsWith(dateStr) &&
      (e.event_type === 'CONFIRMED' || e.event_type === 'SKIPPED_VOLUNTARY')
    );
  }
};
export type DrugRepository = typeof drugRepository;
export type TimeWindowRepository = typeof timeWindowRepository;
export type DoseEventRepository = typeof doseEventRepository;
