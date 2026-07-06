export interface Drug {
  id: string;
  name: string;
  unit_label: string;
  current_stock: number;
  low_stock_alert_active: boolean;
  low_stock_alert_last_ics_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface TimeWindow {
  id: string;
  drug_id: string;
  label: string;
  notification_time: string; // HH:MM
  dose_per_intake: number;
  notification_enabled: boolean;
  created_at: string;
}

export type DoseEventType = 'CONFIRMED' | 'SKIPPED_IMPLICIT' | 'SKIPPED_VOLUNTARY';

export interface DoseEvent {
  id: string;
  drug_id: string;
  time_window_id: string;
  event_type: DoseEventType;
  planned_dose: number;
  actual_dose: number;
  scheduled_datetime: string; // ISO datetime
  confirmed_at: string | null; // ISO datetime or null
  stock_after: number;
}

export interface Settings {
  low_stock_threshold_days: number;
  low_stock_notification_frequency: 'DAILY' | 'EVERY_TWO_DAYS' | 'DAY_BEFORE_ONLY';
}
