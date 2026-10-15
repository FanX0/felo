import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import { installWebApi } from './lib/webApi'
import { registerServiceWorker } from './lib/registerServiceWorker'

import { HashRouter } from 'react-router-dom'
import { ThemeProvider, initTheme } from './components/Theme/ThemeProvider'

initTheme()
installWebApi()
void registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <ThemeProvider>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </ThemeProvider>
    </HashRouter>
  </StrictMode>
)
