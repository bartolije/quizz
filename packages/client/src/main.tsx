import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { installErrorReporting } from './error-reporting'
import './index.css'

installErrorReporting()

const root = document.getElementById('root')
if (!root) throw new Error('No root element')

createRoot(root).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
