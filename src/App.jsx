
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import Home from './pages/Home';
import Dashboard from './pages/Dashboard';
import PollForm from './pages/PollForm';
import HostLive from './pages/HostLive';
import ParticipantJoin from './pages/ParticipantJoin';
import ParticipantPlay from './pages/ParticipantPlay';
import HostLogin from './pages/HostLogin';
import ProjectorScreen from './pages/ProjectorScreen';
import { LogOut, User } from 'lucide-react';
import { hasValidConfig } from './lib/firebase';

function Navigation() {
  const location = useLocation();
  const hostUsername = localStorage.getItem('pulsepoint_host_username');
  // Don't show the full navbar on participant screens to focus on the polling UX on mobile
  const isParticipantView = location.pathname.includes('/join/') || location.pathname.includes('/poll/');
  const isProjectorView = location.pathname.endsWith('/projector');

  if (isProjectorView) return null;

  if (isParticipantView) {
    return (
      <header className="navbar" style={{ justifyContent: 'center', padding: '0.75rem 1rem' }}>
        <div className="nav-brand">
          <img src="/logo.png" alt="logo" style={{ height: '28px', objectFit: 'contain' }} />
        </div>
      </header>
    );
  }

  const handleLogout = () => {
    localStorage.removeItem('pulsepoint_host_username');
    localStorage.removeItem('pulsepoint_host_phone');
    localStorage.removeItem('pulsepoint_host_id');
    window.location.href = '/';
  };

  return (
    <header className="navbar">
      <Link to="/" className="nav-brand">
        <img src="/logo.png" alt="logo" style={{ height: '32px', objectFit: 'contain' }} />
      </Link>
      <nav className="nav-links" style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
        <Link to="/" className="nav-link">Home</Link>
        <Link to="/dashboard" className="nav-link">Host Dashboard</Link>
        {hostUsername && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', borderLeft: '1px solid var(--border-color)', paddingLeft: '1rem' }}>
            <span style={{ fontSize: '0.9rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600 }}>
              <User size={14} color="var(--color-primary)" /> {hostUsername}
            </span>
            <button 
              onClick={handleLogout} 
              className="btn btn-sm btn-danger" 
              style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
              title="Logout Host"
            >
              <LogOut size={12} /> Logout
            </button>
          </div>
        )}
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
            background: 'rgba(245, 158, 11, 0.12)',
            color: '#92400e',
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
              Firebase configuration is missing. Create a <code>.env.local</code> file in the project root with <code>VITE_FIREBASE_API_KEY</code>, <code>VITE_FIREBASE_AUTH_DOMAIN</code>, and other variables.
            </span>
          </div>
        )}
        <Navigation />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/host/login" element={<HostLogin />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/polls/create" element={<PollForm />} />
            <Route path="/polls/:id/edit" element={<PollForm />} />
            <Route path="/polls/:id/host" element={<HostLive />} />
            <Route path="/join/:code" element={<ParticipantJoin />} />
            <Route path="/poll/:code/play" element={<ParticipantPlay />} />
            <Route path="/polls/:id/projector" element={<ProjectorScreen />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
