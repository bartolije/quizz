import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { JoinPage } from './pages/JoinPage'
import { LobbyPage } from './pages/LobbyPage'
import { HostControlPage } from './pages/HostControlPage'
import { HostDisplayPage } from './pages/HostDisplayPage'

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<JoinPage />} />
        <Route path="/join" element={<JoinPage />} />
        <Route path="/lobby" element={<LobbyPage />} />
        <Route path="/host/control" element={<HostControlPage />} />
        <Route path="/host/display" element={<HostDisplayPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
