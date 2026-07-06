import type { Settings } from '../types';

const SETTINGS_KEY = 'medtracker_settings';

const DEFAULT_SETTINGS: Settings = {
  low_stock_threshold_days: 4,
  low_stock_notification_frequency: 'DAILY'
};

export function getSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      low_stock_threshold_days: Number(parsed.low_stock_threshold_days) || 4,
      low_stock_notification_frequency: parsed.low_stock_notification_frequency || 'DAILY'
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Partial<Settings>): Settings {
  const current = getSettings();
  const updated = { ...current, ...settings };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
  return updated;
}
