import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getPollById, getPollByJoinCode, createPoll, updatePoll, auth, hasValidConfig } from '../lib/firebase';
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

  const username = localStorage.getItem('pulsepoint_host_username');
  const phone = localStorage.getItem('pulsepoint_host_phone');

  useEffect(() => {
    if (!username || !phone) {
      navigate('/host/login');
      return;
    }

    const fetchPollData = async () => {
      try {
        // Fetch poll details first (without enforcing host_id inside the query)
        const poll = await getPollById(id);

        if (!poll) {
          alert('Poll not found.');
          navigate('/dashboard');
          return;
        }

        // Wait for Firebase Auth to be ready
        let currentUser = auth.currentUser;
        if (!currentUser && hasValidConfig) {
          currentUser = await new Promise((resolve) => {
            const unsubscribe = auth.onAuthStateChanged((user) => {
              unsubscribe();
              resolve(user);
            });
          });
        }

        const effectiveHostId = currentUser ? currentUser.uid : hostId;

        // Verify ownership
        if (poll.host_id !== effectiveHostId && poll.host_id !== hostId) {
          alert('Unauthorized to edit this poll.');
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

    if (isEdit) {
      fetchPollData();
    }
  }, [id, username, phone, navigate, isEdit, hostId]);

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
          const data = await getPollByJoinCode(uniqueCode);
          if (!data) exists = false;
        }

        const newPoll = await createPoll(title.trim(), hostId, uniqueCode);
        pollId = newPoll.id;
      } else {
        await updatePoll(pollId, { title: title.trim() });
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
