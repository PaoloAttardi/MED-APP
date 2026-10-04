import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'it.attapardi.medtracker',
  appName: 'MedTracker',
  webDir: 'dist',
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_medtracker',
      iconColor: '#0369a1',
    },
  },
};

export default config;
