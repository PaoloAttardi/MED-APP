import React, { useState, useEffect } from 'react';
import type { Drug, TimeWindow, DoseEvent } from '../types';
import { drugRepository, timeWindowRepository, doseEventRepository } from '../db/repositories';
import { evaluateStockStatus } from '../utils/stockEngine';
import { getSettings } from '../utils/settings';
import { getLocalDateString, getWindowActiveRange } from '../utils/notificationScheduler';
import { downloadICSFile } from '../utils/icsGenerator';
import { useToast } from './ToastContext';
import { 
  Plus, 
  Calendar, 
  Trash2, 
  Check, 
  AlertTriangle,
  Clock,
  Edit2,
  Package
} from 'lucide-react';

interface DashboardProps {
  onNavigate: (view: 'dashboard' | 'add-drug' | 'edit-drug' | 'confirm-dose' | 'settings', params?: any) => void;
  notificationPermission: NotificationPermission;
  onRequestPermission: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ 
  onNavigate, 
  notificationPermission,
  onRequestPermission
}) => {
  const [drugs, setDrugs] = useState<Drug[]>([]);
  const [timeWindows, setTimeWindows] = useState<Record<string, TimeWindow[]>>({});
  const [todayEvents, setTodayEvents] = useState<Record<string, DoseEvent[]>>({});
  const [refillDeltas, setRefillDeltas] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const { showToast } = useToast();
  
  const settings = getSettings();
  const todayStr = getLocalDateString();

  const loadData = async () => {
    try {
      setLoading(true);
      const allDrugs = await drugRepository.getAll();
      const windowsMap: Record<string, TimeWindow[]> = {};
      const eventsMap: Record<string, DoseEvent[]> = {};

      for (const d of allDrugs) {
        const windows = await timeWindowRepository.getByDrugId(d.id);
        windowsMap[d.id] = windows;

        const events = await doseEventRepository.getByDrugAndDate(d.id, todayStr);
        eventsMap[d.id] = events;
      }

      // Sort: low stock first, then alphabetically
      const sortedDrugs = [...allDrugs].sort((a, b) => {
        const statusA = evaluateStockStatus(a, windowsMap[a.id] || [], settings.low_stock_threshold_days);
        const statusB = evaluateStockStatus(b, windowsMap[b.id] || [], settings.low_stock_threshold_days);

        if (statusA.isLowStock && !statusB.isLowStock) return -1;
        if (!statusA.isLowStock && statusB.isLowStock) return 1;
        return a.name.localeCompare(b.name);
      });

      setDrugs(sortedDrugs);
      setTimeWindows(windowsMap);
      setTodayEvents(eventsMap);
    } catch (error) {
      console.error('Error loading dashboard data:', error);
      showToast('Errore nel caricamento dei farmaci', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    
    // Add event listener to refresh on sw messages
    const handleSWMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'DOSE_CONFIRMED') {
        loadData();
      }
    };
    navigator.serviceWorker.addEventListener('message', handleSWMessage);
    return () => {
      navigator.serviceWorker.removeEventListener('message', handleSWMessage);
    };
  }, []);

  const handleQuickRefill = async (drugId: string, name: string) => {
    const delta = refillDeltas[drugId] || 0;
    if (delta <= 0) {
      showToast('Inserisci un valore maggiore di 0', 'warning');
      return;
    }

    try {
      const drug = await drugRepository.getById(drugId);
      if (!drug) return;

      const updatedStock = drug.current_stock + delta;
      
      // Calculate updated stock status
      const windows = timeWindows[drugId] || [];
      const status = evaluateStockStatus({ ...drug, current_stock: updatedStock }, windows, settings.low_stock_threshold_days);

      const patch: Partial<Drug> = { current_stock: updatedStock };
      if (!status.isLowStock) {
        patch.low_stock_alert_active = false;
      }

      await drugRepository.update(drugId, patch);
      showToast(`Scorta aggiornata per ${name} (+${delta})`, 'success');
      setRefillDeltas(prev => ({ ...prev, [drugId]: 0 }));
      loadData();
    } catch (error) {
      console.error(error);
      showToast('Errore durante il rifornimento', 'error');
    }
  };

  const handleDownloadICS = (drug: Drug, stockOutDate: Date | null) => {
    if (!stockOutDate) return;
    downloadICSFile(drug.name, stockOutDate);
    showToast('File calendario generato!', 'success');
  };

  const handleDeleteDrug = async (drugId: string, name: string) => {
    if (confirm(`Eliminare ${name} e tutti i dati associati? Questa azione non è reversibile.`)) {
      try {
        await drugRepository.delete(drugId);
        showToast('Farmaco rimosso', 'success');
        loadData();
      } catch (error) {
        console.error(error);
        showToast('Errore nella cancellazione', 'error');
      }
    }
  };

  const getWindowStatus = (drugId: string, win: TimeWindow) => {
    const events = todayEvents[drugId] || [];
    const event = events.find(e => e.time_window_id === win.id);
    
    if (event) {
      return {
        label: event.event_type === 'CONFIRMED' ? 'Preso' : 'Saltato',
        type: event.event_type
      };
    }

    // Check if it's currently pending/active
    const sorted = timeWindows[drugId] || [];
    const { start, end } = getWindowActiveRange(win, sorted, todayStr);
    const now = new Date();

    if (now >= start && now <= end) {
      return { label: 'Da confermare', type: 'PENDING' };
    } else if (now > end) {
      return { label: 'Mancato', type: 'SKIPPED_IMPLICIT' };
    }

    return { label: 'Non ancora attivo', type: 'FUTURE' };
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
      {/* Persistant notification warning banner */}
      {notificationPermission === 'denied' && (
        <div className="banner">
          <AlertTriangle size={20} style={{ flexShrink: 0 }} />
          <div>
            <strong>Le notifiche sono disabilitate.</strong>
            <p style={{ marginTop: '0.2rem', fontSize: '0.8rem', opacity: 0.9 }}>
              Abilitale nelle impostazioni del dispositivo per ricevere i reminder dei farmaci.
            </p>
            <button 
              onClick={onRequestPermission} 
              className="btn btn-secondary btn-small"
              style={{ marginTop: '0.5rem', background: 'rgba(255,255,255,0.1)' }}
            >
              Richiedi Permesso
            </button>
          </div>
        </div>
      )}

      {drugs.length === 0 ? (
        <div className="empty-state glass-card">
          <Package size={48} className="empty-state-icon" />
          <h3>Nessun farmaco configurato</h3>
          <p className="text-secondary">
            Inizia aggiungendo il tuo primo farmaco per monitorare le scorte e registrare le assunzioni.
          </p>
          <button onClick={() => onNavigate('add-drug')} className="btn btn-primary" style={{ marginTop: '0.5rem' }}>
            <Plus size={18} /> Aggiungi Farmaco
          </button>
        </div>
      ) : (
        <div className="drug-list">
          {drugs.map(drug => {
            const windows = timeWindows[drug.id] || [];
            const status = evaluateStockStatus(drug, windows, settings.low_stock_threshold_days);
            
            return (
              <div key={drug.id} className="glass-card drug-card fade-in-up">
                
                {/* Header */}
                <div className="drug-card-header">
                  <div>
                    <h3 className="drug-card-name">{drug.name}</h3>
                    {windows.length === 0 ? (
                      <span className="badge badge-warning" style={{ marginTop: '0.25rem', fontSize: '0.7rem' }}>
                        Nessuna fascia oraria
                      </span>
                    ) : status.isLowStock && status.dailyDose > 0 ? (
                      <span className="badge badge-danger" style={{ marginTop: '0.25rem' }}>
                        Scorta Quasi Esaurita
                      </span>
                    ) : (
                      <span className="badge badge-success" style={{ marginTop: '0.25rem' }}>
                        In Regola
                      </span>
                    )}
                  </div>

                  <div className="drug-actions">
                    <button 
                      onClick={() => onNavigate('edit-drug', { drugId: drug.id })} 
                      className="btn btn-secondary btn-icon btn-small"
                      title="Modifica Farmaco"
                    >
                      <Edit2 size={16} />
                    </button>
                    <button 
                      onClick={() => handleDeleteDrug(drug.id, drug.name)} 
                      className="btn btn-secondary btn-icon btn-small text-danger"
                      title="Elimina Farmaco"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                {/* Stock stats */}
                <div className="drug-stock-row">
                  <div>
                    Scorta: <strong className="drug-autonomy-val">{drug.current_stock}</strong> {drug.unit_label}
                  </div>
                  <div>
                    Autonomia:{' '}
                    <strong className="drug-autonomy-val">
                      {status.autonomy === Infinity ? '∞' : `${status.autonomy} gg`}
                    </strong>
                  </div>
                </div>

                {/* ICS Download for Low Stock */}
                {status.isLowStock && status.dailyDose > 0 && status.stockOutDate && (
                  <div style={{ marginBottom: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <p style={{ fontSize: '0.85rem', color: '#fca5a5', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                      <AlertTriangle size={14} /> Esaurimento previsto: {status.stockOutDate.toLocaleDateString('it-IT')}
                    </p>
                    <button 
                      onClick={() => handleDownloadICS(drug, status.stockOutDate)}
                      className="btn btn-secondary btn-small"
                      style={{ background: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', borderColor: 'rgba(245,158,11,0.2)', width: '100%' }}
                    >
                      <Calendar size={14} /> Salva evento nel calendario
                    </button>
                  </div>
                )}

                {/* Time Windows / Intake Status */}
                <div className="drug-windows-section">
                  <h4 className="drug-windows-title">Fasce Orarie Oggi</h4>
                  
                  {windows.length === 0 ? (
                    <p className="text-muted" style={{ fontSize: '0.85rem', fontStyle: 'italic' }}>
                      Nessuna fascia oraria configurata. Clicca su modifica per aggiungerle.
                    </p>
                  ) : (
                    <div className="windows-grid">
                      {windows.map(win => {
                        const winStatus = getWindowStatus(drug.id, win);
                        const isPending = winStatus.type === 'PENDING';
                        const isConfirmed = winStatus.type === 'CONFIRMED';
                        const isDisabled = !win.notification_enabled;

                        let pillClass = 'window-pill-skipped';
                        if (isDisabled) pillClass = 'window-pill-disabled';
                        else if (isPending) pillClass = 'window-pill-pending';
                        else if (isConfirmed) pillClass = 'window-pill-confirmed';

                        return (
                          <div
                            key={win.id}
                            className={`window-pill ${pillClass}`}
                            onClick={() => {
                              if (!isDisabled) {
                                onNavigate('confirm-dose', { 
                                  drugId: drug.id, 
                                  windowId: win.id,
                                  label: win.label,
                                  plannedDose: win.dose_per_intake,
                                  unitLabel: drug.unit_label
                                });
                              }
                            }}
                          >
                            <Clock size={12} />
                            <span>
                              {win.label} ({win.notification_time})
                            </span>
                            <span style={{ fontSize: '0.75rem', opacity: 0.8, marginLeft: '0.2rem' }}>
                              [{win.dose_per_intake}]
                            </span>
                            {isConfirmed && <Check size={12} style={{ marginLeft: '0.2rem' }} />}
                            {isPending && (
                              <span className="badge badge-warning" style={{ fontSize: '0.65rem', padding: '0.1rem 0.3rem', marginLeft: '0.2rem' }}>
                                Da Conf.
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Inline Refill Quick Access */}
                <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <input
                    type="number"
                    className="form-control"
                    placeholder="Aggiungi scorta (+)"
                    style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
                    value={refillDeltas[drug.id] || ''}
                    min="1"
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 0;
                      setRefillDeltas(prev => ({ ...prev, [drug.id]: val }));
                    }}
                  />
                  <button
                    onClick={() => handleQuickRefill(drug.id, drug.name)}
                    className="btn btn-primary btn-small"
                    style={{ height: '34px', padding: '0 0.8rem' }}
                  >
                    <Plus size={16} /> Aggiungi
                  </button>
                </div>

              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
