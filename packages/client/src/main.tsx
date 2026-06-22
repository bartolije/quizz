import React from 'react'
import { createRoot } from 'react-dom/client'

const root = document.getElementById('root')
if (!root) throw new Error('No root element')

createRoot(root).render(
  <React.StrictMode>
    <h1 style={{ fontFamily: 'sans-serif', padding: '2rem' }}>LYA QUIZ — S1 OK ✓</h1>
  </React.StrictMode>,
)
