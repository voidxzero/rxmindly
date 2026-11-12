import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.rxmindly',
  appName: 'Rxmindly',
  webDir: 'dist',
  plugins: {
    // Route fetch() through native HTTP so the app can reach a self-hosted
    // server on any address, including plain http:// on the home network.
    CapacitorHttp: { enabled: true },
    LocalNotifications: { smallIcon: 'ic_stat_pill', iconColor: '#0E6F6A' },
  },
};

export default config;
