import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getPollByJoinCode } from '../lib/firebase';
import { Users, Zap, BarChart3, ArrowRight } from 'lucide-react';

export default function Home() {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleJoin = async (e) => {
    e.preventDefault();
    if (!code.trim()) return;
    setError('');
    setLoading(true);
    const formattedCode = code.trim().toUpperCase();
    try {
      const data = await getPollByJoinCode(formattedCode);
      if (!data) {
        setError('Event code not found. Please double-check and try again.');
        setLoading(false);
        return;
      }
      if (data.status === 'ended') {
        setError('This event has already ended.');
        setLoading(false);
        return;
      }
      navigate(`/join/${formattedCode}`);
    } catch (err) {
      console.error(err);
      setError('An error occurred. Please try again.');
      setLoading(false);
    }
  };

  return (
    <>
      {/* ── Desktop: two-column ── */}
      <div className="home-desktop-grid">
        <div className="home-hero">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '2rem' }}>
            <img src="/logo.png" alt="logo" style={{ height: '48px', objectFit: 'contain' }} />
          </div>
          <h1 style={{ fontSize: '2.8rem', lineHeight: 1.1, marginBottom: '1.25rem' }}>
            Engage Your Audience{' '}
            <span style={{ background: 'var(--gradient-primary)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              In Real-Time
            </span>
          </h1>
          <p style={{ fontSize: '1.1rem', color: 'var(--text-secondary)', marginBottom: '2.5rem', lineHeight: 1.6 }}>
            Create instant, live-updating polls for events. Free, frictionless, and anonymous.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {[
              { icon: <Zap size={22} color="#8b5cf6" />, bg: 'rgba(139,92,246,0.12)', title: 'Live Realtime Sync', desc: 'Audience responses update on your screen instantly.' },
              { icon: <Users size={22} color="#06b6d4" />, bg: 'rgba(6,182,212,0.12)', title: 'Zero Signups for Audience', desc: 'Join instantly via code — no emails, no friction.' },
              { icon: <BarChart3 size={22} color="#ec4899" />, bg: 'rgba(236,72,153,0.12)', title: 'Multiple Poll Types', desc: 'Multiple choice, ratings, or open-ended questions.' },
            ].map(({ icon, bg, title, desc }) => (
              <div key={title} style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                <div style={{ background: bg, padding: '0.65rem', borderRadius: '10px', flexShrink: 0 }}>{icon}</div>
                <div>
                  <h3 style={{ marginBottom: '0.2rem', fontSize: '1rem' }}>{title}</h3>
                  <p style={{ fontSize: '0.9rem' }}>{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <JoinCard code={code} setCode={setCode} loading={loading} error={error} handleJoin={handleJoin} navigate={navigate} />
      </div>

      {/* ── Mobile: single-column centered ── */}
      <div className="home-mobile">
        <div style={{ textAlign: 'center', paddingBottom: '1.5rem' }}>
          <img src="/logo.png" alt="logo" style={{ height: '60px', objectFit: 'contain', marginBottom: '0.75rem', display: 'block', margin: '0 auto 0.75rem' }} />
          <p style={{ fontSize: '0.92rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Live audience polling for events
          </p>
        </div>
        <JoinCard code={code} setCode={setCode} loading={loading} error={error} handleJoin={handleJoin} navigate={navigate} />
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap', paddingTop: '1.25rem' }}>
          {['⚡ Real-time', '👥 No signup', '📊 Multi-type'].map((label) => (
            <span key={label} style={{
              fontSize: '0.78rem', fontWeight: 600, padding: '0.35rem 0.8rem',
              background: 'rgba(124,58,237,0.07)', color: 'var(--color-primary)',
              border: '1px solid rgba(124,58,237,0.15)', borderRadius: '50px'
            }}>{label}</span>
          ))}
        </div>
      </div>
    </>
  );
}

function JoinCard({ code, setCode, loading, error, handleJoin, navigate }) {
  return (
    <div className="glass-card" style={{ borderRadius: '20px', padding: '2rem' }}>
      <h2 style={{ textAlign: 'center', marginBottom: '1.75rem', fontSize: '1.4rem' }}>Join an Event</h2>
      <form onSubmit={handleJoin} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label" style={{ textAlign: 'center', display: 'block', marginBottom: '0.5rem' }}>
            Enter 6-Digit Join Code
          </label>
          <input
            type="text"
            className="form-input join-code-input"
            placeholder="XXXXXX"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            disabled={loading}
            autoComplete="off"
            autoCapitalize="characters"
          />
        </div>
        {error && (
          <div style={{
            color: 'var(--color-danger)', fontSize: '0.875rem', textAlign: 'center',
            background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.18)',
            borderRadius: '10px', padding: '0.65rem 1rem'
          }}>
            {error}
          </div>
        )}
        <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '0.875rem', fontSize: '1rem' }} disabled={loading}>
          {loading
            ? <div className="spinner" style={{ width: '20px', height: '20px', borderWidth: '2px' }} />
            : <>Join Event <ArrowRight size={18} /></>}
        </button>
      </form>
      <div style={{ margin: '1.5rem 0 0', borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem', textAlign: 'center' }}>
        <p style={{ fontSize: '0.875rem', marginBottom: '0.85rem', color: 'var(--text-secondary)' }}>
          Are you hosting the event?
        </p>
        <button onClick={() => navigate('/dashboard')} className="btn btn-secondary" style={{ width: '100%' }}>
          Go to Host Dashboard
        </button>
      </div>
    </div>
  );
}
