import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'io.github.dofer12.moked',
  appName: 'יומן משימות מוקד',
  webDir: 'dist',
  plugins: {
    // The small icon of a reminder, in res/drawable, in the colour of the app.
    LocalNotifications: { smallIcon: 'ic_stat_moked', iconColor: '#0e6b75' },
  },
}

export default config
