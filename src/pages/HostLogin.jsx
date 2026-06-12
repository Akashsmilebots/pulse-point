import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { registerHost, authenticateHost } from '../lib/firebase';
import { LogIn, User, Phone, ShieldCheck, Lock } from 'lucide-react';

export default function HostLogin() {
  const [isRegister, setIsRegister] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (isRegister) {
      if (!username.trim()) {
        setError('Please enter your display name.');
        return;
      }
      const cleanedPhone = phone.replace(/\D/g, '');
      if (!cleanedPhone) {
        setError('Please enter your phone number.');
        return;
      }
      if (cleanedPhone.length !== 10) {
        setError('Phone number must be exactly 10 digits.');
        return;
      }
      if (!password) {
        setError('Please enter a password.');
        return;
      }

      setLoading(true);
      try {
        const hostData = await registerHost(username, cleanedPhone, password);
        
        // Save host credentials in localStorage
        localStorage.setItem('pulsepoint_host_username', hostData.username);
        localStorage.setItem('pulsepoint_host_phone', hostData.phone);
        localStorage.setItem('pulsepoint_host_id', hostData.phone);

        navigate('/dashboard');
        window.location.reload();
      } catch (err) {
        console.error('Host registration error:', err);
        setError(err.message || 'Failed to register. Please try again.');
      } finally {
        setLoading(false);
      }
    } else {
      if (!identifier.trim()) {
        setError('Please enter your phone number or username.');
        return;
      }
      if (!password) {
        setError('Please enter your password.');
        return;
      }

      setLoading(true);
      try {
        const hostData = await authenticateHost(identifier, password);
        
        // Save host credentials in localStorage
        localStorage.setItem('pulsepoint_host_username', hostData.username);
        localStorage.setItem('pulsepoint_host_phone', hostData.phone);
        localStorage.setItem('pulsepoint_host_id', hostData.phone);

        navigate('/dashboard');
        window.location.reload();
      } catch (err) {
        console.error('Host login error:', err);
        setError(err.message || 'Incorrect phone number/username or password.');
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className="play-layout" style={{ marginTop: '3rem' }}>
      <div className="glass-card" style={{ padding: '2.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.5rem' }}>
          <div style={{ background: 'rgba(139, 92, 246, 0.15)', padding: '1rem', borderRadius: '50%', border: '1px solid rgba(139, 92, 246, 0.3)' }}>
            <ShieldCheck size={36} color="var(--color-primary)" />
          </div>
        </div>

        <h1 style={{ fontSize: '2rem', textAlign: 'center', marginBottom: '0.5rem' }}>Host Authentication</h1>
        <p style={{ textAlign: 'center', marginBottom: '2rem', color: 'var(--text-secondary)' }}>
          Access, edit, and host live real-time audience polling sessions.
        </p>

        {/* Tab selection */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem', borderBottom: '1px solid rgba(255, 255, 255, 0.1)', paddingBottom: '0.5rem' }}>
          <button
            type="button"
            onClick={() => { setIsRegister(false); setError(''); }}
            style={{
              flex: 1,
              padding: '0.75rem',
              background: 'none',
              border: 'none',
              color: !isRegister ? 'var(--color-primary)' : 'var(--text-secondary)',
              borderBottom: !isRegister ? '2px solid var(--color-primary)' : '2px solid transparent',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '1rem',
              transition: 'all 0.2s ease'
            }}
          >
            Log In
          </button>
          <button
            type="button"
            onClick={() => { setIsRegister(true); setError(''); }}
            style={{
              flex: 1,
              padding: '0.75rem',
              background: 'none',
              border: 'none',
              color: isRegister ? 'var(--color-primary)' : 'var(--text-secondary)',
              borderBottom: isRegister ? '2px solid var(--color-primary)' : '2px solid transparent',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '1rem',
              transition: 'all 0.2s ease'
            }}
          >
            Register
          </button>
        </div>

        {error && (
          <div style={{ color: 'var(--color-danger)', textAlign: 'center', marginBottom: '1.5rem', fontSize: '0.95rem', background: 'rgba(239, 68, 68, 0.1)', padding: '0.75rem', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {!isRegister ? (
            /* Log In Fields */
            <>
              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <User size={16} color="var(--text-secondary)" /> Phone Number or Username
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Enter registered phone or username"
                  value={identifier}
                  onChange={(e) => {
                    setIdentifier(e.target.value);
                    if (error) setError('');
                  }}
                  disabled={loading}
                  required
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Lock size={16} color="var(--text-secondary)" /> Password
                </label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (error) setError('');
                  }}
                  disabled={loading}
                  required
                />
              </div>
            </>
          ) : (
            /* Register Fields */
            <>
              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <User size={16} color="var(--text-secondary)" /> Host Display Name
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Organizer Name"
                  maxLength={40}
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    if (error) setError('');
                  }}
                  disabled={loading}
                  required
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Phone size={16} color="var(--text-secondary)" /> Phone Number
                </label>
                <input
                  type="tel"
                  className="form-input"
                  placeholder="10-digit phone number"
                  value={phone}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, '');
                    setPhone(digits.slice(0, 10));
                    if (error) setError('');
                  }}
                  disabled={loading}
                  inputMode="numeric"
                  maxLength={10}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Lock size={16} color="var(--text-secondary)" /> Password
                </label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="Create password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (error) setError('');
                  }}
                  disabled={loading}
                  required
                />
              </div>
            </>
          )}

          <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '1rem' }} disabled={loading}>
            {loading ? (
              <div className="spinner"></div>
            ) : (
              <>
                {isRegister ? 'Register & Authenticate' : 'Authenticate Host'} <LogIn size={18} />
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
