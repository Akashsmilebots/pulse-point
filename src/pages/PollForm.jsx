import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { getHostId, generateJoinCode } from '../utils';
import { ArrowLeft, Save } from 'lucide-react';

export default function PollForm() {
  const { id } = useParams(); // undefined if creating
  const navigate = useNavigate();
  const hostId = getHostId();
  const isEdit = !!id;

  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(isEdit);

  useEffect(() => {
    if (isEdit) {
      fetchPollData();
    }
  }, [id]);

  const fetchPollData = async () => {
    try {
      // Fetch poll details
      const { data: poll, error: pollError } = await supabase
        .from('polls')
        .select('*')
        .eq('id', id)
        .eq('host_id', hostId)
        .single();

      if (pollError || !poll) {
        console.error('Error fetching poll:', pollError);
        alert('Poll not found or unauthorized.');
        navigate('/dashboard');
        return;
      }

      setTitle(poll.title);
    } catch (err) {
      console.error(err);
      alert('Failed to load poll details.');
    } finally {
      setFetching(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!title.trim()) {
      alert('Please enter a poll title.');
      return;
    }

    setLoading(true);

    try {
      let pollId = id;

      if (!isEdit) {
        // Generate unique 6 digit code
        let uniqueCode = '';
        let exists = true;

        while (exists) {
          uniqueCode = generateJoinCode();
          const { data } = await supabase
            .from('polls')
            .select('id')
            .eq('join_code', uniqueCode)
            .maybeSingle();
          if (!data) exists = false;
        }

        const { data: newPoll, error: pollError } = await supabase
          .from('polls')
          .insert({
            title: title.trim(),
            join_code: uniqueCode,
            host_id: hostId,
            status: 'draft'
          })
          .select()
          .single();

        if (pollError) throw pollError;
        pollId = newPoll.id;
      } else {
        const { error: pollError } = await supabase
          .from('polls')
          .update({ title: title.trim() })
          .eq('id', pollId)
          .eq('host_id', hostId);

        if (pollError) throw pollError;
      }

      navigate(`/polls/${pollId}/host`);
    } catch (err) {
      console.error(err);
      alert('Error saving poll title.');
    } finally {
      setLoading(false);
    }
  };

  if (fetching) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', margin: '4rem 0' }}>
        <div className="spinner" style={{ width: '40px', height: '40px' }}></div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>
      <div className="edit-header">
        <button className="btn btn-secondary" onClick={() => navigate('/dashboard')}>
          <ArrowLeft size={16} /> Back to Dashboard
        </button>
        <h1>{isEdit ? 'Edit Poll' : 'Create Poll'}</h1>
      </div>

      <form onSubmit={handleSave} className="glass-card" style={{ padding: '2rem' }}>
        <div className="form-group">
          <label className="form-label">Poll / Event Title</label>
          <input
            type="text"
            className="form-input"
            placeholder="e.g. Weekly All-Hands Feedback, Pub Trivia"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={loading}
          />
        </div>

        <div style={{ marginTop: '2rem' }}>
          <div style={{ background: 'rgba(255,255,255,0.03)', padding: '1.5rem', borderRadius: '18px', border: '1px solid var(--border-color)', marginBottom: '1.5rem' }}>
            <h2 style={{ marginTop: 0 }}>Create the Event First</h2>
            <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
              Enter your poll or event title here. After saving, you can add questions and manage the session on the host screen.
            </p>
          </div>
        </div>

        <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '1rem' }} disabled={loading}>
          {loading ? <div className="spinner"></div> : <><Save size={18} /> {isEdit ? 'Save Title and Continue' : 'Create Event and Add Questions'}</>}
        </button>
      </form>
    </div>
  );
}
