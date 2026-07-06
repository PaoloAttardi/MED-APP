import React, { useState, useEffect } from 'react';
import { drugRepository } from '../db/repositories';
import type { Drug } from '../types';
import { useToast } from './ToastContext';
import { ArrowLeft, Save, AlertTriangle } from 'lucide-react';
import { stockEngine } from '../utils/stockEngine';

interface DrugFormProps {
  drugId?: string; // If present, we are in Edit mode
  onBack: () => void;
  onSaved: (drugId: string, isNew: boolean) => void;
}

export const DrugForm: React.FC<DrugFormProps> = ({ drugId, onBack, onSaved }) => {
  const [name, setName] = useState('');
  const [unitLabel, setUnitLabel] = useState('compressa/e');
  const [initialStock, setInitialStock] = useState<number>(0);
  
  // Edit mode specific states
  const [currentStock, setCurrentStock] = useState<number>(0);
  const [refillDelta, setRefillDelta] = useState<number>(0);
  const [correctedStock, setCorrectedStock] = useState<string>('');
  const [isCorrecting, setIsCorrecting] = useState(false);
  const [drug, setDrug] = useState<Drug | null>(null);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const { showToast } = useToast();

  useEffect(() => {
    if (drugId) {
      // Load existing drug
      drugRepository.getById(drugId).then(existing => {
        if (existing) {
          setDrug(existing);
          setName(existing.name);
          setUnitLabel(existing.unit_label);
          setCurrentStock(existing.current_stock);
          setCorrectedStock(existing.current_stock.toString());
        } else {
          showToast('Farmaco non trovato', 'error');
          onBack();
        }
      });
    }
  }, [drugId]);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!name.trim()) {
      newErrors.name = 'Il nome del farmaco è obbligatorio';
    } else if (name.length > 100) {
      newErrors.name = 'Il nome non può superare i 100 caratteri';
    }

    if (!unitLabel.trim()) {
      newErrors.unitLabel = 'L\'etichetta unità è obbligatoria';
    } else if (unitLabel.length > 30) {
      newErrors.unitLabel = 'L\'etichetta non può superare i 30 caratteri';
    }

    if (!drugId) {
      if (initialStock < 0 || !Number.isInteger(initialStock)) {
        newErrors.initialStock = 'Inserisci un numero intero positivo o zero';
      }
    } else {
      if (refillDelta < 0 || !Number.isInteger(refillDelta)) {
        newErrors.refillDelta = 'L\'aggiunta deve essere un numero intero positivo';
      }
      if (isCorrecting) {
        const val = parseInt(correctedStock);
        if (isNaN(val) || val < 0 || !Number.isInteger(val)) {
          newErrors.correctedStock = 'La scorta corretta deve essere un numero intero positivo o zero';
        }
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    try {
      if (!drugId) {
        // Create drug
        const created = await drugRepository.create({
          name: name.trim(),
          unit_label: unitLabel.trim(),
          current_stock: initialStock,
          low_stock_alert_active: false,
          low_stock_alert_last_ics_date: null
        });
        showToast('Farmaco creato con successo', 'success');
        onSaved(created.id, true);
      } else {
        // Update drug details (name, unit label)
        let updatedDrug = await drugRepository.update(drugId, {
          name: name.trim(),
          unit_label: unitLabel.trim()
        });

        // Process stock edits
        if (refillDelta > 0) {
          updatedDrug = await stockEngine.processRefill(drugId, refillDelta);
        }

        if (isCorrecting) {
          const absoluteVal = parseInt(correctedStock);
          updatedDrug = await stockEngine.processManualStockCorrection(drugId, absoluteVal);
        }

        showToast('Farmaco aggiornato con successo', 'success');
        onSaved(updatedDrug.id, false);
      }
    } catch (error) {
      console.error(error);
      showToast('Errore durante il salvataggio', 'error');
    }
  };

  return (
    <div className="app-container fade-in-up">
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
        <button onClick={onBack} className="btn btn-secondary btn-icon" title="Indietro">
          <ArrowLeft size={18} />
        </button>
        <h2 style={{ fontSize: '1.5rem' }}>
          {drugId ? `Modifica ${drug?.name || 'Farmaco'}` : 'Nuovo Farmaco'}
        </h2>
      </div>

      <form onSubmit={handleSave} className="glass-card">
        {/* Farmaco Name */}
        <div className="form-group">
          <label className="form-label">Nome Farmaco</label>
          <input
            type="text"
            className="form-control"
            placeholder="es. Metotrexato"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {errors.name && <div className="form-error">{errors.name}</div>}
        </div>

        {/* Unit Label */}
        <div className="form-group">
          <label className="form-label">Unità di Misura (es. compressa/e, bustina/e, gocce)</label>
          <input
            type="text"
            className="form-control"
            placeholder="es. compressa/e"
            value={unitLabel}
            onChange={(e) => setUnitLabel(e.target.value)}
          />
          {errors.unitLabel && <div className="form-error">{errors.unitLabel}</div>}
        </div>

        {!drugId ? (
          /* Initial stock (only for new drug) */
          <div className="form-group">
            <label className="form-label">Scorta Iniziale (unità)</label>
            <input
              type="number"
              className="form-control"
              placeholder="es. 30"
              value={initialStock || ''}
              onChange={(e) => setInitialStock(parseInt(e.target.value) || 0)}
              min="0"
            />
            {errors.initialStock && <div className="form-error">{errors.initialStock}</div>}
          </div>
        ) : (
          /* Stock edits (refill + override) for existing drug */
          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1.5rem', marginTop: '1.5rem' }}>
            <h4 style={{ fontSize: '1rem', marginBottom: '1rem', color: 'var(--text-secondary)' }}>Gestione Scorte</h4>
            <p className="text-muted" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
              Scorta attuale: <strong>{currentStock}</strong> {unitLabel}
            </p>

            {/* Additive Refill */}
            <div className="form-group">
              <label className="form-label">Aggiungi pasticche (Rifornimento)</label>
              <input
                type="number"
                className="form-control"
                placeholder="es. +20"
                value={refillDelta || ''}
                onChange={(e) => setRefillDelta(Math.max(0, parseInt(e.target.value) || 0))}
                min="0"
                disabled={isCorrecting}
              />
              {errors.refillDelta && <div className="form-error">{errors.refillDelta}</div>}
            </div>

            {/* Manual Correction Mode */}
            <div className="switch-container">
              <span className="text-secondary" style={{ fontSize: '0.9rem' }}>Attiva correzione manuale</span>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={isCorrecting}
                  onChange={(e) => {
                    setIsCorrecting(e.target.checked);
                    if (e.target.checked) setRefillDelta(0);
                  }}
                />
                <span className="slider"></span>
              </label>
            </div>

            {isCorrecting && (
              <div className="form-group fade-in-up" style={{ marginTop: '1rem' }}>
                <label className="form-label" style={{ color: 'var(--danger)' }}>
                  Correggi scorta (Nuovo valore assoluto)
                </label>
                <div className="banner" style={{ background: 'rgba(239, 68, 68, 0.08)', borderColor: 'rgba(239, 68, 68, 0.2)', marginBottom: '0.75rem', padding: '0.75rem' }}>
                  <AlertTriangle size={16} className="text-danger" style={{ flexShrink: 0 }} />
                  <span style={{ fontSize: '0.8rem', color: '#fca5a5' }}>
                    <strong>Attenzione:</strong> Stai sovrascrivendo la scorta attuale. Inserisci il conteggio esatto delle pillole fisiche rimaste.
                  </span>
                </div>
                <input
                  type="number"
                  className="form-control"
                  style={{ borderColor: 'var(--danger)' }}
                  placeholder="es. 15"
                  value={correctedStock}
                  onChange={(e) => setCorrectedStock(e.target.value)}
                  min="0"
                />
                {errors.correctedStock && <div className="form-error">{errors.correctedStock}</div>}
              </div>
            )}
          </div>
        )}

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
