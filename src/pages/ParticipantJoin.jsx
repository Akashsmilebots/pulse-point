import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { generateUUID, getParticipantSessionId, getParticipantName, setParticipantName } from '../utils';
import { LogIn, ArrowRight } from 'lucide-react';

export default function ParticipantJoin() {
  const { code } = useParams();
  const navigate = useNavigate();
  const sessionId = getParticipantSessionId();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [poll, setPoll] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchPollDetails();
  }, [code]);

  const fetchPollDetails = async () => {
    try {
      setLoading(true);
      const { data, error: fetchError } = await supabase
        .from('polls')
        .select('*')
        .eq('join_code', code.toUpperCase())
        .single();

      if (fetchError || !data) {
        setError('Poll code is invalid. Please double check and try again.');
        return;
      }

      if (data.status === 'ended') {
        setError('This poll has already ended.');
        return;
      }

      setPoll(data);

      // Pre-fill name if they previously joined this poll
      const existingName = getParticipantName(data.id);
      if (existingName) {
        setName(existingName);
      }
    } catch (err) {
      console.error(err);
      setError('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Please enter your name.');
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

    const finalSessionId = sessionId || (() => {
      const generated = generateUUID();
      localStorage.setItem('pulsepoint_participant_session_id', generated);
      return generated;
    })();

    setSubmitting(true);
    setError('');

    try {
      const { data: existingPhone, error: phoneError } = await supabase
        .from('participants')
        .select('id, session_id')
        .eq('poll_id', poll.id)
        .eq('phone', cleanedPhone)
        .maybeSingle();

      if (phoneError) throw phoneError;
      if (existingPhone && existingPhone.session_id !== finalSessionId) {
        setError('This phone number is already registered for this event.');
        setSubmitting(false);
        return;
      }

      const { data: participant, error: pError } = await supabase
        .from('participants')
        .upsert(
          {
            poll_id: poll.id,
            name: name.trim(),
            phone: cleanedPhone,
            session_id: finalSessionId
          },
          { onConflict: 'poll_id,session_id' }
        )
        .select()
        .single();

      if (pError) throw pError;

      setParticipantName(poll.id, name.trim());
      navigate(`/poll/${code}/play`);
    } catch (err) {
      console.error(err);
      setError('Could not join event. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', margin: '6rem 0' }}>
        <div className="spinner" style={{ width: '40px', height: '40px' }}></div>
      </div>
    );
  }

  return (
    <div className="play-layout" style={{ marginTop: '2rem' }}>
      <div className="glass-card" style={{ padding: '2.5rem' }}>
        <h1 style={{ fontSize: '2rem', textAlign: 'center', marginBottom: '0.5rem' }}>Join Live Poll</h1>
        <p style={{ textAlign: 'center', marginBottom: '2rem', color: 'var(--text-secondary)' }}>
          Event Code: <strong style={{ color: 'var(--text-primary)' }}>{code.toUpperCase()}</strong>
        </p>

        {poll && <h2 style={{ fontSize: '1.25rem', textAlign: 'center', marginBottom: '2rem' }}>{poll.title}</h2>}

        {error ? (
          <div style={{ color: 'var(--color-danger)', textAlign: 'center', marginBottom: '2rem', fontSize: '0.95rem' }}>
            {error}
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div className="form-group">
              <label className="form-label">Your Display Name</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. Alice, Bob Smith"
                maxLength={40}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (error) setError('');
                }}
                disabled={submitting}
                required
                autoFocus
              />
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                Your name will be visible to the presenter. No signup or email is collected.
              </p>
            </div>

            <div className="form-group">
              <label className="form-label">Phone Number</label>
              <input
                type="tel"
                className="form-input"
                placeholder="Enter 10-digit phone number"
                value={phone}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, '');
                  setPhone(digits.slice(0, 10));
                  if (error) setError('');
                }}
                disabled={submitting}
                inputMode="numeric"
                maxLength={10}
                required
              />
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                Enter digits only, maximum 10 characters.
              </p>
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={submitting}>
              {submitting ? <div className="spinner"></div> : <>Join Event <ArrowRight size={18} /></>}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
