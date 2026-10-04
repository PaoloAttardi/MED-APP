import React, { useState, useEffect } from 'react';
import type { View, NavParams } from './types';
import { ToastProvider, useToast } from './components/ToastContext';
import { Dashboard } from './components/Dashboard';
import { DrugForm } from './components/DrugForm';
import { TimeWindowForm } from './components/TimeWindowForm';
import { ConfirmationScreen } from './components/ConfirmationScreen';
import { Settings } from './components/Settings';
import { StockCalendar } from './components/StockCalendar';
import { LocalNotifications } from '@capacitor/local-notifications';
import { notificationScheduler } from './utils/notificationScheduler';
import {
  Home,
  PlusCircle,
  CalendarDays,
  Settings as SettingsIcon,
  Pill
} from 'lucide-react';

const AppContent: React.FC = () => {
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [viewParams, setViewParams] = useState<NavParams>({});
  const [permission, setPermission] = useState<string>('default');
  // tick only re-renders; reloadKey remounts data-reading views after a write.
  const [, setTick] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const { showToast } = useToast();

  useEffect(() => {
    // 1. Arm the native alarms, catch up missed windows, log implicit skips
    notificationScheduler.start().catch(err => {
      console.error('Notification scheduler failed to start:', err);
    });

    // 2. Load current permission status
    notificationScheduler.getPermissionStatus().then(setPermission).catch(() => {
      setPermission('denied');
    });

    // 3. "Ho preso la dose" on the notification itself. Tapping a notification
    //    action launches the app, so this listener is always attached in time.
    let listener: { remove: () => Promise<void> } | undefined;
    LocalNotifications.addListener('localNotificationActionPerformed', event => {
      if (event.actionId !== 'confirm') return;
      notificationScheduler.confirmDose(event.notification.extra).then(() => {
        showToast('Dose confermata!', 'success');
        setReloadKey(prev => prev + 1);
      });
    }).then(handle => { listener = handle; });

    return () => { listener?.remove(); };
  }, []);

  // Window status and countdowns are derived from `new Date()` at render time,
  // so a dashboard left open across a boundary would keep showing stale state.
  useEffect(() => {
    const id = setInterval(() => setTick(prev => prev + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const handleNavigate = (view: View, params: NavParams = {}) => {
    setCurrentView(view);
    setViewParams(params);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleRequestPermission = async () => {
    const status = await notificationScheduler.requestPermission();
    setPermission(status);
    if (status === 'granted') {
      showToast('Notifiche abilitate con successo!', 'success');
      // Alarms were never armed while the permission was missing.
      await notificationScheduler.refresh();
    }
  };

  return (
    <>
      {/* App Bar / Header */}
      <header className="app-header app-container" style={{ paddingBottom: 0 }}>
        <h1 className="app-title" onClick={() => handleNavigate('dashboard')} style={{ cursor: 'pointer' }}>
          <Pill className="app-title-pill" size={28} />
          <span>Med<span className="app-title-thin">Tracker</span></span>
        </h1>
      </header>

      {/* Main View Router */}
      <main style={{ flexGrow: 1, paddingBottom: '5rem' }}>
        {currentView === 'dashboard' && (
          <Dashboard
            key={reloadKey}
            onNavigate={handleNavigate}
            notificationPermission={permission}
            onRequestPermission={handleRequestPermission}
          />
        )}

        {currentView === 'add-drug' && (
          <DrugForm 
            onBack={() => handleNavigate('dashboard')}
            onSaved={(drugId) => handleNavigate('time-windows', { drugId })}
          />
        )}

        {currentView === 'edit-drug' && (
          <DrugForm 
            drugId={viewParams.drugId}
            onBack={() => handleNavigate('dashboard')}
            onSaved={() => handleNavigate('dashboard')}
          />
        )}

        {/* Both forms need a drug; rendering them without one would show an empty
            shell, so the guard also keeps the prop types honest. */}
        {currentView === 'time-windows' && viewParams.drugId && (
          <TimeWindowForm
            drugId={viewParams.drugId}
            onBack={() => handleNavigate('dashboard')}
          />
        )}

        {currentView === 'confirm-dose' && viewParams.drugId && viewParams.windowId && (
          <ConfirmationScreen
            drugId={viewParams.drugId}
            windowId={viewParams.windowId}
            onBack={() => handleNavigate('dashboard')}
          />
        )}

        {currentView === 'settings' && (
          <Settings 
            onBack={() => handleNavigate('dashboard')}
            onPermissionChanged={(status) => setPermission(status)}
          />
        )}

        {currentView === 'calendar' && (
          <StockCalendar onNavigate={handleNavigate} />
        )}
      </main>

      {/* Bottom Sticky Navigation */}
      <nav className="bottom-nav">
        <button 
          onClick={() => handleNavigate('dashboard')} 
          className={`nav-item ${currentView === 'dashboard' ? 'nav-item-active' : ''}`}
        >
          <Home size={22} />
          <span>Dashboard</span>
        </button>

        <button 
          onClick={() => handleNavigate('calendar')} 
          className={`nav-item ${currentView === 'calendar' ? 'nav-item-active' : ''}`}
        >
          <CalendarDays size={22} />
          <span>Calendario</span>
        </button>

        <button 
          onClick={() => handleNavigate('add-drug')} 
          className={`nav-item ${currentView === 'add-drug' ? 'nav-item-active' : ''}`}
        >
          <PlusCircle size={22} />
          <span>Aggiungi</span>
        </button>

        <button 
          onClick={() => handleNavigate('settings')} 
          className={`nav-item ${currentView === 'settings' ? 'nav-item-active' : ''}`}
        >
          <SettingsIcon size={22} />
          <span>Impostazioni</span>
        </button>
      </nav>
    </>
  );
};

function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
}

export default App;
