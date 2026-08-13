import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import 'bootstrap/dist/css/bootstrap.min.css'
import 'bootstrap-icons/font/bootstrap-icons.css'
import 'bootstrap/dist/js/bootstrap.bundle.min.js'
import 'leaflet/dist/leaflet.css'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './hooks/useAuth.tsx'
import { EngineeringModeProvider } from './hooks/useEngineeringMode.tsx'

// HashRouter, not BrowserRouter: GitHub Pages has no server-side rewrite, so a
// refresh on a deep link (e.g. /supply-items) would 404 under BrowserRouter.
// See migration plan §七.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <EngineeringModeProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </EngineeringModeProvider>
    </HashRouter>
  </StrictMode>,
)
