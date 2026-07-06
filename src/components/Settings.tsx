import React, { useState, useEffect } from 'react';
import { getSettings, saveSettings } from '../utils/settings';
import { stockEngine } from '../utils/stockEngine';
import { useToast } from './ToastContext';
import { Save, Bell, BellOff, Info, RefreshCw } from 'lucide-react';
import { requestNotificationPermission, getNotificationPermissionStatus } from '../serviceWorkerRegistration';
import { notificationScheduler } from '../utils/notificationScheduler';

interface SettingsProps {
  onBack: () => void;
  onPermissionChanged: (status: NotificationPermission) => void;
}

export const Settings: React.FC<SettingsProps> = ({ onBack, onPermissionChanged }) => {
  const [threshold, setThreshold] = useState<number>(4);
  const [frequency, setFrequency] = useState<'DAILY' | 'EVERY_TWO_DAYS' | 'DAY_BEFORE_ONLY'>('DAILY');
  const [permission, setPermission] = useState<NotificationPermission>('default');

  const [errors, setErrors] = useState<Record<string, string>>({});
  const { showToast } = useToast();

  useEffect(() => {
    const s = getSettings();
    setThreshold(s.low_stock_threshold_days);
    setFrequency(s.low_stock_notification_frequency);
    setPermission(getNotificationPermissionStatus());
  }, []);

  const handleRequestPermission = async () => {
    const status = await requestNotificationPermission();
    setPermission(status);
    onPermissionChanged(status);
    
    if (status === 'granted') {
      showToast('Notifiche abilitate con successo!', 'success');
    } else {
      showToast('Permesso notifiche negato o chiuso.', 'warning');
    }
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (threshold < 1 || !Number.isInteger(threshold)) {
      newErrors.threshold = 'Il valore minimo è 1 giorno.';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    try {
      saveSettings({
        low_stock_threshold_days: threshold,
        low_stock_notification_frequency: frequency
      });

      // Re-evaluate all drugs immediately with new settings
      await stockEngine.reevaluateAllDrugsStockStatus();

      showToast('Impostazioni salvate con successo', 'success');
      onBack();
    } catch (error) {
      console.error(error);
      showToast('Errore durante il salvataggio', 'error');
    }
  };

  const handleTriggerSimulateSkips = async () => {
    try {
      await notificationScheduler.checkAndLogImplicitSkips();
      showToast('Controllo assunzioni mancate completato', 'success');
    } catch (err) {
      console.error(err);
      showToast('Errore durante il controllo manuale', 'error');
    }
  };

  return (
    <div className="app-container fade-in-up">
      <h2 style={{ fontSize: '1.5rem', marginBottom: '2rem' }}>Impostazioni Globali</h2>

      <form onSubmit={handleSave} className="glass-card">
        
        {/* Notification Permission Card */}
        <div className="settings-section">
          <h3 className="settings-section-title">Permessi Notifiche</h3>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              {permission === 'granted' ? (
                <Bell size={24} className="text-primary" />
              ) : (
                <BellOff size={24} className="text-danger" />
              )}
              <div>
                <strong style={{ fontSize: '0.95rem' }}>
                  Stato:{' '}
                  {permission === 'granted'
                    ? 'Abilitate'
                    : permission === 'denied'
                    ? 'Disabilitate'
                    : 'Non Richieste'}
                </strong>
                <p className="text-muted" style={{ fontSize: '0.8rem', marginTop: '0.1rem' }}>
                  {permission === 'granted'
                    ? 'Riceverai i reminder e gli avvisi scorte'
                    : 'Modifica i permessi del browser per attivare'}
                </p>
              </div>
            </div>

            {permission !== 'granted' && (
              <button 
                type="button" 
                onClick={handleRequestPermission} 
                className="btn btn-primary btn-small"
              >
                Abilita
              </button>
            )}
          </div>
        </div>

        {/* Low Stock Alerts Setup */}
        <div className="settings-section">
          <h3 className="settings-section-title">Avviso Scorte Basse</h3>

          {/* Threshold Input */}
          <div className="form-group">
            <label className="form-label">Soglia Scorta Bassa (giorni di autonomia)</label>
            <div className="banner" style={{ background: 'rgba(99, 102, 241, 0.04)', borderColor: 'rgba(99, 102, 241, 0.1)', marginBottom: '0.75rem', padding: '0.75rem' }}>
              <Info size={16} className="text-accent" style={{ flexShrink: 0 }} />
              <span style={{ fontSize: '0.8rem', color: '#c7d2fe' }}>
                Verrai avvisato quando l'autonomia stimata scende a o sotto questo valore.
              </span>
            </div>
            <input
              type="number"
              className="form-control"
              value={threshold}
              onChange={(e) => setThreshold(parseInt(e.target.value) || 0)}
              min="1"
            />
            {errors.threshold && <div className="form-error">{errors.threshold}</div>}
          </div>

          {/* Frequency Dropdown */}
          <div className="form-group">
            <label className="form-label">Frequenza Notifiche Scorta Bassa</label>
            <select
              className="form-control form-select"
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as any)}
            >
              <option value="DAILY">Ogni Giorno (Giornaliera)</option>
              <option value="EVERY_TWO_DAYS">Ogni 2 Giorni</option>
              <option value="DAY_BEFORE_ONLY">Solo il Giorno Prima dell'Esaurimento</option>
            </select>
          </div>
        </div>

        {/* Developer / Testing Panel */}
        <div className="settings-section" style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1.5rem' }}>
          <h3 className="settings-section-title">Manutenzione Dati</h3>
          <p className="text-muted" style={{ fontSize: '0.8rem', marginBottom: '1rem' }}>
            Forza il controllo delle fasce orarie passate per registrare eventuali dosi mancate (implicit skip) non elaborate in precedenza.
          </p>
          <button 
            type="button" 
            onClick={handleTriggerSimulateSkips} 
            className="btn btn-secondary" 
            style={{ width: '100%', gap: '0.5rem', fontSize: '0.85rem', padding: '0.6rem' }}
          >
            <RefreshCw size={14} /> Controlla Assunzioni Mancate
          </button>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
          <button type="button" onClick={onBack} className="btn btn-secondary" style={{ flex: 1 }}>
            Annulla
          </button>
          <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
            <Save size={18} /> Salva
          </button>
        </div>

      </form>
    </div>
  );
};
