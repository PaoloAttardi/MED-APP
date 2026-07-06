import React, { useState, useEffect } from 'react';
import { drugRepository, timeWindowRepository, doseEventRepository } from '../db/repositories';
import type { Drug, TimeWindow, DoseEvent } from '../types';
import { useToast } from './ToastContext';
import { ArrowLeft, Check, X, Calendar, AlertTriangle } from 'lucide-react';
import { stockEngine, evaluateStockStatus } from '../utils/stockEngine';
import { getLocalDateString } from '../utils/notificationScheduler';
import { downloadICSFile } from '../utils/icsGenerator';
import { getSettings } from '../utils/settings';

interface ConfirmationScreenProps {
  drugId: string;
  windowId: string;
  onBack: () => void;
}

export const ConfirmationScreen: React.FC<ConfirmationScreenProps> = ({ drugId, windowId, onBack }) => {
  const [drug, setDrug] = useState<Drug | null>(null);
  const [window, setWindow] = useState<TimeWindow | null>(null);
  const [actualDose, setActualDose] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [existingEvent, setExistingEvent] = useState<DoseEvent | null>(null);
  
  // State for low stock alert modal shown after save
  const [lowStockAlertInfo, setLowStockAlertInfo] = useState<{ active: boolean; autonomy: number; stockOutDate: Date | null } | null>(null);

  const [error, setError] = useState('');
  const { showToast } = useToast();
  
  const todayStr = getLocalDateString();
  const scheduledDateTime = `${todayStr}T${window?.notification_time || '00:00'}:00`;

  useEffect(() => {
    const loadInfo = async () => {
      try {
        setLoading(true);
        const d = await drugRepository.getById(drugId);
        const w = await timeWindowRepository.getById(windowId);
        
        if (!d || !w) {
          showToast('Farmaco o fascia oraria non trovati', 'error');
          onBack();
          return;
        }

        setDrug(d);
        setWindow(w);

        // Check if there is already an event logged for today
        const events = await doseEventRepository.getByDrugAndDate(drugId, todayStr);
        const matched = events.find(e => e.time_window_id === windowId && (e.event_type === 'CONFIRMED' || e.event_type === 'SKIPPED_VOLUNTARY'));
        
        if (matched) {
          setExistingEvent(matched);
          setActualDose(matched.actual_dose);
        } else {
          setActualDose(w.dose_per_intake);
        }
      } catch (err) {
        console.error(err);
        showToast('Errore nel caricamento', 'error');
      } finally {
        setLoading(false);
      }
    };
    loadInfo();
  }, [drugId, windowId]);

  const handleConfirm = async () => {
    if (actualDose < 0 || !Number.isInteger(actualDose)) {
      setError('La dose deve essere un intero positivo o zero');
      return;
    }

    try {
      const { drug: updatedDrug, lowStockEntered } = await stockEngine.processDoseConfirmation(
        drugId,
        windowId,
        actualDose,
        scheduledDateTime
      );

      // Check if low stock is active or entered
      const windows = await timeWindowRepository.getByDrugId(drugId);
      const settings = getSettings();
      const status = evaluateStockStatus(updatedDrug, windows, settings.low_stock_threshold_days);

      if (lowStockEntered && status.stockOutDate) {
        setLowStockAlertInfo({
          active: true,
          autonomy: status.autonomy,
          stockOutDate: status.stockOutDate
        });
        showToast('Scorta bassa rilevata!', 'warning');
      } else {
        showToast(actualDose === 0 ? 'Assunzione saltata registrata' : 'Assunzione registrata con successo', 'success');
        onBack();
      }
    } catch (err) {
      console.error(err);
      showToast('Errore durante la registrazione', 'error');
    }
  };

  const handleDownloadICS = () => {
    if (drug && lowStockAlertInfo && lowStockAlertInfo.stockOutDate) {
      downloadICSFile(drug.name, lowStockAlertInfo.stockOutDate);
      showToast('File calendario generato!', 'success');
      setLowStockAlertInfo(null);
      onBack();
    }
  };

  if (loading) {
    return (
      <div className="app-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
        <p className="text-secondary">Caricamento in corso...</p>
      </div>
    );
  }

  // Modal alert for low stock
  if (lowStockAlertInfo?.active) {
    return (
      <div className="modal-overlay">
        <div className="glass-card modal-content fade-in-up" style={{ textAlign: 'center' }}>
          <AlertTriangle size={48} className="text-danger" style={{ margin: '0 auto 1rem', display: 'block' }} />
          <h3 style={{ fontSize: '1.25rem', marginBottom: '0.75rem' }}>⚠️ Scorta Quasi Esaurita!</h3>
          <p className="text-secondary" style={{ fontSize: '0.95rem', marginBottom: '1.5rem' }}>
            La scorta di <strong>{drug?.name}</strong> sta terminando.
            <br />
            Autonomia stimata: <strong>{lowStockAlertInfo.autonomy} giorni</strong>.
            <br />
            Data di esaurimento prevista: <strong>{lowStockAlertInfo.stockOutDate?.toLocaleDateString('it-IT')}</strong>.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <button onClick={handleDownloadICS} className="btn btn-primary">
              <Calendar size={18} /> Aggiungi al Calendario
            </button>
            <button 
              onClick={() => {
                setLowStockAlertInfo(null);
                onBack();
              }} 
              className="btn btn-secondary"
            >
              Fatto
            </button>
          </div>
        </div>
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
          <h2 style={{ fontSize: '1.5rem' }}>Registra Assunzione</h2>
          <p className="text-secondary" style={{ fontSize: '0.9rem' }}>{drug?.name} — {window?.label}</p>
        </div>
      </div>

      <div className="glass-card">
        {existingEvent ? (
          <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
            <div style={{ 
              width: '64px', 
              height: '64px', 
              borderRadius: '50%', 
              background: existingEvent.event_type === 'CONFIRMED' ? 'var(--primary-light)' : 'rgba(255,255,255,0.05)', 
              color: existingEvent.event_type === 'CONFIRMED' ? 'var(--primary)' : 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 1.25rem'
            }}>
              {existingEvent.event_type === 'CONFIRMED' ? <Check size={32} /> : <X size={32} />}
            </div>
            
            <h3 style={{ fontSize: '1.2rem', marginBottom: '0.5rem' }}>
              Dose {existingEvent.event_type === 'CONFIRMED' ? 'Registrata' : 'Saltata'}
            </h3>
            
            <p className="text-secondary" style={{ fontSize: '0.9rem', marginBottom: '1.5rem' }}>
              Già confermata alle{' '}
              <strong>
                {new Date(existingEvent.confirmed_at!).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
              </strong>
            </p>

            <div className="drug-stock-row" style={{ justifyContent: 'center', gap: '2rem', marginBottom: '1.5rem' }}>
              <span>Dose presa: <strong>{existingEvent.actual_dose}</strong> {drug?.unit_label}</span>
              <span>Dose prevista: <strong>{existingEvent.planned_dose}</strong></span>
            </div>

            <button onClick={onBack} className="btn btn-secondary" style={{ width: '100%' }}>
              Torna alla Dashboard
            </button>
          </div>
        ) : (
          <div>
            <div className="drug-stock-row" style={{ marginBottom: '1.5rem' }}>
              <span>Dose programmata: <strong>{window?.dose_per_intake}</strong> {drug?.unit_label}</span>
              <span>Scorta attuale: <strong>{drug?.current_stock}</strong> {drug?.unit_label}</span>
            </div>

            {/* Editable Intake Quantity */}
            <div className="form-group">
              <label className="form-label">Dose effettivamente assunta</label>
              <input
                type="number"
                className="form-control"
                style={{ fontSize: '1.25rem', textAlign: 'center' }}
                value={actualDose || ''}
                onChange={(e) => {
                  setError('');
                  setActualDose(Math.max(0, parseInt(e.target.value) || 0));
                }}
                min="0"
              />
              {error && <div className="form-error">{error}</div>}
              
              <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                <button 
                  type="button" 
                  onClick={() => setActualDose(0)}
                  className="btn btn-secondary btn-small"
                  style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }}
                >
                  Salta dose (0)
                </button>
                <button 
                  type="button" 
                  onClick={() => setActualDose(window?.dose_per_intake || 1)}
                  className="btn btn-secondary btn-small"
                  style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }}
                >
                  Ripristina prevista ({window?.dose_per_intake})
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
              <button onClick={onBack} className="btn btn-secondary" style={{ flex: 1 }}>
                Annulla
              </button>
              
              <button 
                onClick={handleConfirm} 
                className="btn btn-primary" 
                style={{ flex: 1 }}
              >
                {actualDose === 0 ? <X size={18} /> : <Check size={18} />}
                {actualDose === 0 ? 'Salta Dose' : 'Conferma'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
