import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { installProjectStorageDevtools } from './lib/project-storage-devtools'
import { initTheme } from './lib/theme'
import { hydrateProjectStorage } from './lib/project-storage'
import { registerBundledFonts } from './lib/bundled-fonts'
import './index.css'

installProjectStorageDevtools()
// Apply the saved color palette before first paint.
initTheme()
// Text-overlay display fonts shipped with the app (public/fonts).
registerBundledFonts()

// Projects live on disk; load them into memory before anything reads the project list.
void hydrateProjectStorage().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
})
