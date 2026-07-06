import React, { useState, useEffect } from 'react';
import type { Drug, TimeWindow } from '../types';
import { drugRepository, timeWindowRepository } from '../db/repositories';
import { useToast } from './ToastContext';
import { ArrowLeft, Plus, Trash2, Clock, AlertCircle } from 'lucide-react';
import { stockEngine } from '../utils/stockEngine';

interface TimeWindowFormProps {
  drugId: string;
  onBack: () => void;
}

export const TimeWindowForm: React.FC<TimeWindowFormProps> = ({ drugId, onBack }) => {
  const [drug, setDrug] = useState<Drug | null>(null);
  const [windows, setWindows] = useState<TimeWindow[]>([]);
  const [loading, setLoading] = useState(true);

  // New time window form fields
  const [label, setLabel] = useState('');
  const [time, setTime] = useState('');
  const [dose, setDose] = useState<number>(1);
  const [notifEnabled, setNotifEnabled] = useState(true);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const { showToast } = useToast();

  const loadData = async () => {
    try {
      setLoading(true);
      const d = await drugRepository.getById(drugId);
      if (!d) {
        showToast('Farmaco non trovato', 'error');
        onBack();
        return;
      }
      setDrug(d);
      const winList = await timeWindowRepository.getByDrugId(drugId);
      setWindows(winList);
    } catch (error) {
      console.error(error);
      showToast('Errore nel caricamento dei dati', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [drugId]);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!label.trim()) {
      newErrors.label = 'L\'etichetta è obbligatoria';
    } else if (label.length > 30) {
      newErrors.label = 'L\'etichetta non può superare i 30 caratteri';
    }

    if (!time) {
      newErrors.time = 'L\'orario è obbligatorio';
    } else if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      newErrors.time = 'Orario non valido (formato HH:MM)';
    }

    if (dose < 1 || !Number.isInteger(dose)) {
      newErrors.dose = 'La dose deve essere un intero maggiore o uguale a 1';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleAddWindow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    if (windows.length >= 6) {
      showToast('Limite raggiunto: massimo 6 fasce orarie per farmaco', 'warning');
      return;
    }

    // Check duplicate HH:MM warning
    const hasDuplicateTime = windows.some(w => w.notification_time === time);
    if (hasDuplicateTime) {
      if (!confirm(`Esiste già una fascia oraria impostata alle ${time} per questo farmaco. Vuoi continuare?`)) {
        return;
      }
    }

    try {
      await timeWindowRepository.create({
        drug_id: drugId,
        label: label.trim(),
        notification_time: time,
        dose_per_intake: dose,
        notification_enabled: notifEnabled
      });

      showToast('Fascia oraria aggiunta', 'success');
      
      // Clear form
      setLabel('');
      setTime('');
      setDose(1);
      setNotifEnabled(true);
      
      // Re-evaluate stock status to trigger low-stock if necessary
      await stockEngine.reevaluateAllDrugsStockStatus();

      // Refresh list
      loadData();
    } catch (error) {
      console.error(error);
      showToast('Errore durante il salvataggio', 'error');
    }
  };

  const handleDeleteWindow = async (windowId: string, label: string) => {
    if (confirm(`Eliminare la fascia oraria "${label}"? I relativi reminder verranno disattivati.`)) {
      try {
        await timeWindowRepository.delete(windowId);
        showToast('Fascia oraria eliminata', 'success');
        
        // Re-evaluate stock status
        await stockEngine.reevaluateAllDrugsStockStatus();

        loadData();
      } catch (error) {
        console.error(error);
        showToast('Errore durante la rimozione', 'error');
      }
    }
  };

  const handleToggleNotification = async (win: TimeWindow, enabled: boolean) => {
    try {
      await timeWindowRepository.update(win.id, { notification_enabled: enabled });
      showToast(enabled ? 'Reminder attivato' : 'Reminder disattivato', 'success');
      
      // Re-evaluate stock status
      await stockEngine.reevaluateAllDrugsStockStatus();

      loadData();
    } catch (error) {
      console.error(error);
      showToast('Errore durante la modifica del reminder', 'error');
    }
  };

  if (loading) {
    return (
      <div className="app-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
        <p className="text-secondary">Caricamento in corso...</p>
      </div>
    );
  }

  return (
    <div className="app-container fade-in-up">
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
        <button onClick={onBack} className="btn btn-secondary btn-icon" title="Indietro">
          <ArrowLeft size={18} />
        </button>
        <div>
          <h2 style={{ fontSize: '1.5rem' }}>Configura Fasce Orarie</h2>
          <p className="text-secondary" style={{ fontSize: '0.9rem' }}>{drug?.name}</p>
        </div>
      </div>

      {/* Existing Windows List */}
      <div className="glass-card" style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', color: 'var(--text-secondary)' }}>
          Fasce Orarie Configurate ({windows.length}/6)
        </h3>

        {windows.length === 0 ? (
          <p className="text-muted" style={{ fontStyle: 'italic', fontSize: '0.9rem' }}>
            Nessuna fascia oraria configurata per questo farmaco. Il sistema non invierà notifiche di reminder.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {windows.map(win => (
              <div 
                key={win.id} 
                className="glass-card" 
                style={{ 
                  padding: '0.8rem 1rem', 
                  background: 'rgba(255,255,255,0.01)', 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center' 
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <Clock size={16} className="text-secondary" />
                  <div>
                    <strong style={{ fontSize: '0.95rem' }}>{win.label}</strong>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      Ore {win.notification_time} — Dose: {win.dose_per_intake} {drug?.unit_label}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  {/* Toggle Notification */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>Notifiche</span>
                    <label className="switch" style={{ width: '40px', height: '22px' }}>
                      <input
                        type="checkbox"
                        checked={win.notification_enabled}
                        onChange={(e) => handleToggleNotification(win, e.target.checked)}
                      />
                      <span className="slider" style={{ borderRadius: '11px' }}></span>
                    </label>
                  </div>

                  <button 
                    onClick={() => handleDeleteWindow(win.id, win.label)} 
                    className="btn btn-secondary btn-icon btn-small text-danger" 
                    style={{ width: '32px', height: '32px' }}
                    title="Elimina"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add New Window Form */}
      {windows.length < 6 && (
        <form onSubmit={handleAddWindow} className="glass-card">
          <h3 style={{ fontSize: '1.1rem', marginBottom: '1.25rem', color: 'var(--text-secondary)' }}>
            Aggiungi Nuova Fascia
          </h3>

          {/* Label */}
          <div className="form-group">
            <label className="form-label">Etichetta Fascia Oraria</label>
            <input
              type="text"
              className="form-control"
              placeholder="es. Mattina, Dopo pranzo, Sera"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            {errors.label && <div className="form-error">{errors.label}</div>}
          </div>

          <div style={{ display: 'flex', gap: '1rem' }}>
            {/* Notification Time */}
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Orario Reminder (HH:MM)</label>
              <input
                type="time"
                className="form-control"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
              {errors.time && <div className="form-error">{errors.time}</div>}
            </div>

            {/* Dose quantity */}
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Dose ({drug?.unit_label})</label>
              <input
                type="number"
                className="form-control"
                value={dose}
                onChange={(e) => setDose(parseInt(e.target.value))}
                min="1"
              />
              {errors.dose && <div className="form-error">{errors.dose}</div>}
            </div>
          </div>

          {/* Enabled Checkbox */}
          <div className="switch-container" style={{ marginBottom: '1.5rem' }}>
            <span className="text-secondary" style={{ fontSize: '0.9rem' }}>Attiva reminder notifica</span>
            <label className="switch">
              <input
                type="checkbox"
                checked={notifEnabled}
                onChange={(e) => setNotifEnabled(e.target.checked)}
              />
              <span className="slider"></span>
            </label>
          </div>

          <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
            <Plus size={16} /> Aggiungi Fascia Oraria
          </button>
        </form>
      )}

      {windows.length >= 6 && (
        <div className="banner" style={{ background: 'rgba(99, 102, 241, 0.1)', borderColor: 'rgba(99,102,241,0.2)' }}>
          <AlertCircle size={18} className="text-accent" style={{ flexShrink: 0 }} />
          <span style={{ fontSize: '0.85rem', color: '#c7d2fe' }}>
            Hai raggiunto il numero massimo consigliato di fasce orarie per questo farmaco (6).
          </span>
        </div>
      )}

      <button onClick={onBack} className="btn btn-secondary" style={{ width: '100%', marginTop: '1rem' }}>
        Fatto
      </button>
    </div>
  );
};
