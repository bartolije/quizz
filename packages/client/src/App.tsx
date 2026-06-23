import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { JoinPage } from './pages/JoinPage'
import { ParticipantApp } from './pages/ParticipantApp'
import { HostControlPage } from './pages/HostControlPage'
import { HostDisplayPage } from './pages/HostDisplayPage'
import { AdminPage } from './pages/AdminPage'

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<JoinPage />} />
        <Route path="/join" element={<JoinPage />} />
        <Route path="/lobby" element={<ParticipantApp />} />
        <Route path="/host/control" element={<HostControlPage />} />
        <Route path="/host/display" element={<HostDisplayPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
