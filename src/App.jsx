import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import Home from './pages/Home';
import Dashboard from './pages/Dashboard';
import PollForm from './pages/PollForm';
import HostLive from './pages/HostLive';
import ParticipantJoin from './pages/ParticipantJoin';
import ParticipantPlay from './pages/ParticipantPlay';
import { BarChart3 } from 'lucide-react';
import { hasValidConfig } from './supabaseClient';

function Navigation() {
  const location = useLocation();
  // Don't show the full navbar on participant screens to focus on the polling UX on mobile
  const isParticipantView = location.pathname.includes('/join/') || location.pathname.includes('/poll/');

  if (isParticipantView) {
    return (
      <header className="navbar" style={{ justifyContent: 'center', padding: '0.75rem 1rem' }}>
        <div className="nav-brand" style={{ fontSize: '1.25rem' }}>
          <BarChart3 size={18} /> PulsePoint
        </div>
      </header>
    );
  }

  return (
    <header className="navbar">
      <Link to="/" className="nav-brand">
        <BarChart3 size={24} /> PulsePoint
      </Link>
      <nav className="nav-links">
        <Link to="/" className="nav-link">Home</Link>
        <Link to="/dashboard" className="nav-link">Host Dashboard</Link>
      </nav>
    </header>
  );
}

function App() {
  return (
    <Router>
      <div className="app-container">
        {!hasValidConfig && (
          <div style={{
            background: 'rgba(245, 158, 11, 0.15)',
            color: '#fef3c7',
            padding: '0.75rem 1rem',
            textAlign: 'center',
            fontSize: '0.9rem',
            fontWeight: 600,
            borderBottom: '1px solid rgba(245, 158, 11, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            zIndex: 9999
          }}>
            <span>⚠️</span>
            <span>
              Supabase configuration is missing. Create a <code>.env.local</code> file in the project root with <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>.
            </span>
          </div>
        )}
        <Navigation />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/polls/create" element={<PollForm />} />
            <Route path="/polls/:id/edit" element={<PollForm />} />
            <Route path="/polls/:id/host" element={<HostLive />} />
            <Route path="/join/:code" element={<ParticipantJoin />} />
            <Route path="/poll/:code/play" element={<ParticipantPlay />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
