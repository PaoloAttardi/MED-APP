import React, { useState, useEffect, useMemo } from 'react';
import type { TimeWindow, View, NavParams } from '../types';
import { drugRepository, timeWindowRepository } from '../db/repositories';
import { evaluateStockStatus } from '../utils/stockEngine';
import { getSettings } from '../utils/settings';
import {
  toDateKey,
  addMonths,
  buildMonthGrid,
  WEEKDAYS_IT,
  formatMonthLabel,
  formatDayLabel
} from '../utils/calendarGrid';
import {
  ChevronLeft,
  ChevronRight,
  PackageX,
  CalendarDays,
  AlertTriangle,
  Clock3
} from 'lucide-react';

type Severity = 'danger' | 'warning' | 'safe';

interface StockEvent {
  drugId: string;
  name: string;
  unitLabel: string;
  autonomy: number;
  daysLeft: number;
  /** Local YYYY-MM-DD the stock runs out. Derived from stockOutDate once, so
   *  re-adding daysLeft as milliseconds cannot drift across a DST boundary. */
  dateKey: string;
  severity: Severity;
}

interface StockCalendarProps {
  onNavigate: (view: View, params?: NavParams) => void;
}

export const StockCalendar: React.FC<StockCalendarProps> = ({ onNavigate }) => {
  const today = useMemo(() => new Date(), []);
  const todayKey = toDateKey(today);
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [events, setEvents] = useState<StockEvent[]>([]);
  const [selectedKey, setSelectedKey] = useState(todayKey);
  const [loading, setLoading] = useState(true);

  const settings = getSettings();

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const drugs = await drugRepository.getAll();
        const collected: StockEvent[] = [];

        for (const drug of drugs) {
          const windows: TimeWindow[] = await timeWindowRepository.getByDrugId(drug.id);
          const status = evaluateStockStatus(drug, windows, settings.low_stock_threshold_days);

          // Infinity means no daily dose configured, so there is no end date to show.
          if (!status.stockOutDate || status.autonomy === Infinity) continue;

          const daysLeft = Math.max(0, Math.round(
            (status.stockOutDate.getTime() - today.getTime()) / 86400000
          ));
          const severity: Severity =
            status.autonomy <= settings.low_stock_threshold_days ? 'danger'
              : status.autonomy <= settings.low_stock_threshold_days + 3 ? 'warning'
                : 'safe';

          collected.push({
            drugId: drug.id,
            name: drug.name,
            unitLabel: drug.unit_label,
            autonomy: status.autonomy,
            daysLeft,
            dateKey: toDateKey(status.stockOutDate),
            severity
          });
        }

        collected.sort((a, b) => a.daysLeft - b.daysLeft);
        setEvents(collected);
      } catch (error) {
        console.error('Error loading stock calendar:', error);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [settings.low_stock_threshold_days, today]);

  const cells = useMemo(
    () => buildMonthGrid(cursor.year, cursor.month, today),
    [cursor.year, cursor.month, today]
  );

  const eventsByDay = useMemo(() => {
    const map = new Map<string, StockEvent[]>();
    for (const e of events) {
      const list = map.get(e.dateKey) ?? [];
      list.push(e);
      map.set(e.dateKey, list);
    }
    return map;
  }, [events]);

  const selectedEvents = eventsByDay.get(selectedKey) ?? [];
  // Already sorted ascending by daysLeft when collected.
  const upcoming = events.slice(0, 8);

  const goToMonth = (delta: number) => {
    setCursor(addMonths(cursor.year, cursor.month, delta));
  };

  const goToToday = () => {
    setCursor({ year: today.getFullYear(), month: today.getMonth() });
    setSelectedKey(todayKey);
  };

  const severityWord = (e: StockEvent) =>
    e.severity === 'danger' ? 'Scorta esaurita' : e.severity === 'warning' ? 'In esaurimento' : 'Da monitorare';

  return (
    <div className="app-container fade-in-up">
      <div className="glass-card calendar-card">
        <div className="calendar-head">
          <button
            onClick={goToToday}
            className="btn btn-secondary btn-small"
            style={{ paddingLeft: '0.7rem', paddingRight: '0.7rem' }}
          >
            <CalendarDays size={16} /> Oggi
          </button>

          <div className="calendar-month-label">{formatMonthLabel(cursor.year, cursor.month)}</div>

          <div className="calendar-nav">
            <button onClick={() => goToMonth(-1)} className="btn btn-secondary btn-icon btn-small" aria-label="Mese precedente">
              <ChevronLeft size={18} />
            </button>
            <button onClick={() => goToMonth(1)} className="btn btn-secondary btn-icon btn-small" aria-label="Mese successivo">
              <ChevronRight size={18} />
            </button>
          </div>
        </div>

        <div className="calendar-grid" aria-label="Calendario delle scorte">
          {WEEKDAYS_IT.map(d => (
            <div key={d} className="calendar-weekday">{d}</div>
          ))}

          {cells.map(cell => {
            const dayEvents = eventsByDay.get(cell.key) ?? [];
            const className = [
              'calendar-day',
              !cell.inMonth && 'calendar-day-outside',
              cell.isToday && 'calendar-day-today',
              cell.key === selectedKey && 'calendar-day-selected'
            ].filter(Boolean).join(' ');

            return (
              <button
                key={cell.key}
                className={className}
                onClick={() => setSelectedKey(cell.key)}
                aria-label={`${formatDayLabel(cell.date)}${dayEvents.length ? `, ${dayEvents.length} scorte in esaurimento` : ''}`}
                aria-pressed={cell.key === selectedKey}
              >
                <span>{cell.date.getDate()}</span>
                <span className="calendar-dots">
                  {dayEvents.slice(0, 3).map(e => (
                    <span key={e.drugId} className={`calendar-dot calendar-dot-${e.severity}`} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>

        <div className="calendar-legend">
          <span className="calendar-legend-item">
            <span className="calendar-dot calendar-dot-danger" /> Scorta esaurita
          </span>
          <span className="calendar-legend-item">
            <span className="calendar-dot calendar-dot-warning" /> In esaurimento
          </span>
          <span className="calendar-legend-item">
            <span className="calendar-dot calendar-dot-safe" /> Da monitorare
          </span>
        </div>
      </div>

      {/* Selected day detail */}
      <div className="calendar-agenda">
        <h3 className="calendar-agenda-title">
          {selectedKey === todayKey ? 'Oggi' : formatDayLabel(cells.find(c => c.key === selectedKey)?.date ?? today)}
        </h3>

        {selectedEvents.length === 0 ? (
          <p className="text-muted" style={{ fontSize: '0.85rem' }}>
            Nessuna scorta in esaurimento in questa data.
          </p>
        ) : (
          selectedEvents.map(e => (
            <button key={e.drugId} className="calendar-event" onClick={() => onNavigate('edit-drug', { drugId: e.drugId })}>
              <span className={`calendar-event-bar calendar-event-bar-${e.severity}`} />
              <span style={{ flexGrow: 1 }}>
                <span className="calendar-event-name">{e.name}</span>
                <span className="calendar-event-meta" style={{ display: 'block' }}>
                  {severityWord(e)} — autonomy {e.autonomy} gg · {e.daysLeft === 0 ? 'si esaurisce oggi' : `fra ${e.daysLeft} gg`}
                </span>
              </span>
              {e.severity === 'danger' && <AlertTriangle size={18} color="var(--danger)" />}
            </button>
          ))
        )}
      </div>

      {/* Upcoming list: keeps the month grid from hiding anything out of view */}
      <div className="calendar-agenda">
        <h3 className="calendar-agenda-title">Prossimi esaurimenti</h3>

        {loading ? (
          <p className="text-muted" style={{ fontSize: '0.85rem' }}>Caricamento in corso...</p>
        ) : upcoming.length === 0 ? (
          <div className="glass-card empty-state" style={{ padding: '2rem 1.25rem' }}>
            <PackageX size={40} className="empty-state-icon" />
            <h3 style={{ fontSize: '1rem' }}>Nessuna scorta in esaurimento</h3>
            <p className="text-secondary" style={{ fontSize: '0.85rem' }}>
              {events.length === 0
                ? 'Configura le fasce orarie di un farmaco per poterne stimare la data di esaurimento.'
                : 'Tutte le scorte hanno abbondante margine.'}
            </p>
            <button onClick={() => onNavigate('dashboard')} className="btn btn-secondary btn-small">
              <Clock3 size={14} /> Vai alla Dashboard
            </button>
          </div>
        ) : (
          upcoming.map(e => (
            <button key={e.drugId} className="calendar-event" onClick={() => onNavigate('edit-drug', { drugId: e.drugId })}>
              <span className={`calendar-event-bar calendar-event-bar-${e.severity}`} />
              <span style={{ flexGrow: 1 }}>
                <span className="calendar-event-name">{e.name}</span>
                <span className="calendar-event-meta" style={{ display: 'block' }}>
                  {e.daysLeft === 0
                    ? 'Si esaurisce oggi'
                    : `Si esaurisce fra ${e.daysLeft} ${e.daysLeft === 1 ? 'giorno' : 'giorni'}`}
                  {' · '}{e.autonomy} {e.unitLabel} di scorta
                </span>
              </span>
              <span className={`badge badge-${e.severity === 'danger' ? 'danger' : e.severity === 'warning' ? 'warning' : 'success'}`}>
                {e.severity === 'danger' ? 'Critica' : e.severity === 'warning' ? 'Media' : 'Ok'}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
};
