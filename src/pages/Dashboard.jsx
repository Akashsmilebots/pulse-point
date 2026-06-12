import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getPollsForHost, deletePoll, auth, syncHostAuthUid } from '../lib/firebase';
import { getHostId } from '../utils';
import { Plus, Edit3, Trash2, Copy, Play, Check } from 'lucide-react';

export default function Dashboard() {
  const [polls, setPolls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState(null);
  const navigate = useNavigate();
  const hostId = getHostId();

  const username = localStorage.getItem('pulsepoint_host_username');
  const phone = localStorage.getItem('pulsepoint_host_phone');

  async function fetchPolls() {
    try {
      setLoading(true);
      const anonUid = auth.currentUser ? auth.currentUser.uid : null;
      const data = await getPollsForHost(hostId, anonUid);
      setPolls(data || []);
    } catch (err) {
      console.error('Error fetching polls:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!username || !phone) {
      navigate('/host/login');
      return;
    }
    // Sync the host anonymous auth UID to their phone identifier
    syncHostAuthUid(username, phone);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchPolls();
  }, [username, phone, navigate]);

  const handleDelete = async (poll) => {
    const isMyPoll = poll.host_id === (auth.currentUser ? auth.currentUser.uid : null) || poll.host_id === hostId;
    if (!isMyPoll) {
      alert('You can only delete polls you created.');
      return;
    }
    if (!window.confirm('Are you sure you want to delete this poll and all its responses? This cannot be undone.')) {
      return;
    }
    try {
      await deletePoll(poll.id);
      setPolls(polls.filter(p => p.id !== poll.id));
    } catch (err) {
      console.error('Error deleting poll:', err);
      alert('Failed to delete poll.');
    }
  };

  const handleCopyLink = (code, id) => {
    const link = `${window.location.origin}/join/${code}`;
    navigator.clipboard.writeText(link);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const totalPolls = polls.length;
  const activePollsCount = polls.filter(p => p.status === 'active').length;
  const myPollsCount = polls.filter(p => p.host_id === hostId || p.host_id === (auth.currentUser ? auth.currentUser.uid : null)).length;

  return (
    <div>
      <div className="dashboard-header">
        <div>
          <h1>Host Dashboard</h1>
          <p>All events across every device and environment are listed here.</p>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/polls/create')}>
          <Plus size={18} /> Create New Poll
        </button>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '2.5rem' }}>
        <div className="glass-card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>Total Events</span>
          <span style={{ fontSize: '2.5rem', fontWeight: 800, background: 'var(--gradient-primary)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{totalPolls}</span>
        </div>
        <div className="glass-card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>Active Now</span>
          <span style={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--color-success)' }}>{activePollsCount}</span>
        </div>
        <div className="glass-card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>Created by Me</span>
          <span style={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--color-accent)' }}>{myPollsCount}</span>
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', margin: '4rem 0' }}>
          <div className="spinner" style={{ width: '40px', height: '40px' }}></div>
        </div>
      ) : polls.length === 0 ? (
        <div className="glass-card" style={{ textAlign: 'center', padding: '4rem 2rem' }}>
          <h2 style={{ marginBottom: '1rem' }}>No polls created yet</h2>
          <p style={{ marginBottom: '2rem' }}>Get started by creating your first interactive audience poll.</p>
          <button className="btn btn-primary" onClick={() => navigate('/polls/create')}>
            <Plus size={18} /> Create First Poll
          </button>
        </div>
      ) : (
        <div className="polls-grid">
          {polls.map((poll) => {
            const questionCount = poll.question_count ?? (poll.questions ? poll.questions.length : 0);
            const isMyPoll = poll.host_id === hostId || poll.host_id === (auth.currentUser ? auth.currentUser.uid : null);
            return (
              <div className="glass-card poll-card" key={poll.id}>
                <div className="poll-card-header">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem', flexWrap: 'wrap' }}>
                      <h3 className="poll-card-title" style={{ marginBottom: 0 }}>{poll.title}</h3>
                      {isMyPoll && (
                        <span style={{
                          fontSize: '0.65rem',
                          fontWeight: 700,
                          padding: '0.15rem 0.5rem',
                          background: 'rgba(6, 182, 212, 0.15)',
                          color: 'var(--color-accent)',
                          border: '1px solid rgba(6, 182, 212, 0.3)',
                          borderRadius: '50px',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          whiteSpace: 'nowrap',
                        }}>
                          Mine
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className="join-banner-code" style={{ fontSize: '1rem', fontWeight: 700 }}>
                        {poll.join_code}
                      </span>
                    </div>
                  </div>
                  <span className={`badge badge-${poll.status}`}>
                    {poll.status}
                  </span>
                </div>

                <div className="poll-card-meta">
                  <span>{questionCount} Question{questionCount !== 1 ? 's' : ''}</span>
                  <span>•</span>
                  <span>{new Date(poll.created_at).toLocaleDateString()}</span>
                </div>

                <div className="poll-card-actions">
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => navigate(`/polls/${poll.id}/host`)}
                    style={{ flex: 1 }}
                  >
                    <Play size={14} /> Go Live
                  </button>
                  {isMyPoll && (
                    <button
                      className="btn btn-sm btn-secondary"
                      onClick={() => navigate(`/polls/${poll.id}/host`)}
                      title="Edit Event"
                    >
                      <Edit3 size={14} />
                    </button>
                  )}
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => handleCopyLink(poll.join_code, poll.id)}
                    title="Copy Join Link"
                  >
                    {copiedId === poll.id ? <Check size={14} color="var(--color-success)" /> : <Copy size={14} />}
                  </button>
                  {isMyPoll && (
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => handleDelete(poll)}
                      title="Delete Poll"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
