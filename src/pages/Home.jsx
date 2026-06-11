import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { BarChart3, Users, Zap, ArrowRight } from 'lucide-react';

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
      // Look up poll with this join code
      const { data, error: fetchError } = await supabase
        .from('polls')
        .select('id, status')
        .eq('join_code', formattedCode)
        .single();

      if (fetchError || !data) {
        setError('Event code not found. Please double-check and try again.');
        setLoading(false);
        return;
      }

      if (data.status === 'ended') {
        setError('This event has already ended.');
        setLoading(false);
        return;
      }

      // Found the poll, redirect to join screen
      navigate(`/join/${formattedCode}`);
    } catch (err) {
      console.error(err);
      setError('An error occurred. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="landing-grid">
      <div className="hero-text">
        <h1>
          Engage Your Audience <span>In Real-Time</span>
        </h1>
        <p style={{ fontSize: '1.2rem', marginBottom: '2.5rem' }}>
          Create instant, live-updating polls for volunteer events, presentations, or meetups. Free, frictionless, and anonymous.
        </p>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <div style={{ background: 'rgba(139, 92, 246, 0.15)', padding: '0.75rem', borderRadius: '12px' }}>
              <Zap size={24} color="#8b5cf6" />
            </div>
            <div>
              <h3 style={{ marginBottom: '0.25rem' }}>Live Realtime Sync</h3>
              <p style={{ fontSize: '0.95rem' }}>Audience responses update on your presentation screen instantly.</p>
            </div>
          </div>
          
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <div style={{ background: 'rgba(6, 182, 212, 0.15)', padding: '0.75rem', borderRadius: '12px' }}>
              <Users size={24} color="#06b6d4" />
            </div>
            <div>
              <h3 style={{ marginBottom: '0.25rem' }}>Zero Signups for Audience</h3>
              <p style={{ fontSize: '0.95rem' }}>Participants join instantly via code. No emails, no friction.</p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <div style={{ background: 'rgba(236, 72, 153, 0.15)', padding: '0.75rem', borderRadius: '12px' }}>
              <BarChart3 size={24} color="#ec4899" />
            </div>
            <div>
              <h3 style={{ marginBottom: '0.25rem' }}>Multiple Poll Types</h3>
              <p style={{ fontSize: '0.95rem' }}>Run multiple choice questions, rating scales, or open-ended thoughts.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="glass-card join-card">
        <h2 style={{ textAlign: 'center', marginBottom: '2rem' }}>Join an Event</h2>
        
        <form onSubmit={handleJoin} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="form-group">
            <label className="form-label" style={{ textAlign: 'center' }}>Enter 6-Digit Join Code</label>
            <input
              type="text"
              className="form-input join-code-input"
              placeholder="XXXXXX"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              disabled={loading}
              autoFocus
            />
          </div>

          {error && (
            <div style={{ color: 'var(--color-danger)', fontSize: '0.9rem', textAlign: 'center' }}>
              {error}
            </div>
          )}

          <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
            {loading ? <div className="spinner"></div> : <>Join Event <ArrowRight size={18} /></>}
          </button>
        </form>

        <div style={{ margin: '2rem 0 1rem 0', borderTop: '1px solid var(--border-color)', paddingTop: '1.5rem', textAlign: 'center' }}>
          <p style={{ fontSize: '0.9rem', marginBottom: '1rem' }}>Are you hosting the event?</p>
          <button 
            onClick={() => navigate('/dashboard')} 
            className="btn btn-secondary" 
            style={{ width: '100%' }}
          >
            Go to Host Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
