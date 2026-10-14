import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.felo.remote',
  appName: 'Felo Remote',
  webDir: 'out/renderer',
  server: {
    androidScheme: 'https',
    cleartext: true
  }
}

export default config
