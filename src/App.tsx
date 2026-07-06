import React, { useState, useEffect } from 'react';
import { ToastProvider, useToast } from './components/ToastContext';
import { Dashboard } from './components/Dashboard';
import { DrugForm } from './components/DrugForm';
import { TimeWindowForm } from './components/TimeWindowForm';
import { ConfirmationScreen } from './components/ConfirmationScreen';
import { Settings } from './components/Settings';
import { registerServiceWorker, getNotificationPermissionStatus, requestNotificationPermission } from './serviceWorkerRegistration';
import { notificationScheduler } from './utils/notificationScheduler';
import { 
  Home, 
  PlusCircle, 
  Settings as SettingsIcon, 
  Pill
} from 'lucide-react';

type View = 'dashboard' | 'add-drug' | 'edit-drug' | 'time-windows' | 'confirm-dose' | 'settings';

const AppContent: React.FC = () => {
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [viewParams, setViewParams] = useState<any>({});
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [tickCount, setTickCount] = useState(0); // Used to trigger refresh on scheduler ticks
  const { showToast } = useToast();

  useEffect(() => {
    // 1. Register service worker
    registerServiceWorker();

    // 2. Load current permission status
    setPermission(getNotificationPermissionStatus());

    // 3. Start local notification scheduler
    const cleanupScheduler = notificationScheduler.start(() => {
      // Trigger a state change to force refresh the active view if needed (every minute)
      setTickCount(prev => prev + 1);
    });

    // 4. Handle messages from Service Worker (e.g. background confirms)
    const handleSWMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'DOSE_CONFIRMED') {
        showToast('Dose confermata in background!', 'success');
        // Force refresh by changing tick count
        setTickCount(prev => prev + 1);
      }
    };
    navigator.serviceWorker?.addEventListener('message', handleSWMessage);

    return () => {
      cleanupScheduler();
      navigator.serviceWorker?.removeEventListener('message', handleSWMessage);
    };
  }, []);

  const handleNavigate = (view: View, params: any = {}) => {
    setCurrentView(view);
    setViewParams(params);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleRequestPermission = async () => {
    const status = await requestNotificationPermission();
    setPermission(status);
    if (status === 'granted') {
      showToast('Notifiche abilitate con successo!', 'success');
    }
  };

  return (
    <>
      {/* App Bar / Header */}
      <header className="app-header app-container" style={{ paddingBottom: 0 }}>
        <h1 className="app-title" onClick={() => handleNavigate('dashboard')} style={{ cursor: 'pointer' }}>
          <Pill className="app-title-pill" size={28} />
          Med<span style={{ fontWeight: 300, color: 'var(--text-secondary)' }}>Tracker</span>
        </h1>
        
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button 
            onClick={() => handleNavigate('settings')} 
            className={`btn btn-secondary btn-icon ${currentView === 'settings' ? 'btn-primary' : ''}`}
            style={{ width: '40px', height: '40px' }}
            title="Impostazioni"
          >
            <SettingsIcon size={18} />
          </button>
        </div>
      </header>

      {/* Main View Router */}
      <main style={{ flexGrow: 1, paddingBottom: '5rem' }}>
        {currentView === 'dashboard' && (
          <Dashboard 
            key={tickCount} // re-renders dashboard when scheduler ticks to update window countdowns
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

        {currentView === 'time-windows' && (
          <TimeWindowForm 
            drugId={viewParams.drugId}
            onBack={() => handleNavigate('dashboard')}
          />
        )}

        {currentView === 'confirm-dose' && (
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
