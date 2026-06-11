import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { getHostId } from '../utils';
import { Plus, BarChart2, Edit3, Trash2, Copy, Play, Check, Eye } from 'lucide-react';

export default function Dashboard() {
  const [polls, setPolls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState(null);
  const navigate = useNavigate();
  const hostId = getHostId();

  useEffect(() => {
    fetchPolls();
  }, []);

  const fetchPolls = async () => {
    try {
      setLoading(true);
      // Fetch polls with question details for this host
      const { data, error } = await supabase
        .from('polls')
        .select(`
          id,
          title,
          join_code,
          status,
          created_at,
          questions:questions!questions_poll_id_fkey (
            id
          )
        `)
        .eq('host_id', hostId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setPolls(data || []);
    } catch (err) {
      console.error('Error fetching polls:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this poll and all its responses? This cannot be undone.')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('polls')
        .delete()
        .eq('id', id);

      if (error) throw error;
      setPolls(polls.filter(p => p.id !== id));
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

  // Helper to count active and total polls
  const totalPolls = polls.length;
  const activePollsCount = polls.filter(p => p.status === 'active').length;

  return (
    <div>
      <div className="dashboard-header">
        <div>
          <h1>Host Dashboard</h1>
          <p>Create and manage your live polls. Everything is stored locally in this browser.</p>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/polls/create')}>
          <Plus size={18} /> Create New Poll
        </button>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2.5rem' }}>
        <div className="glass-card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>Total Polls</span>
          <span style={{ fontSize: '2.5rem', fontWeight: 800, background: 'var(--gradient-primary)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{totalPolls}</span>
        </div>
        <div className="glass-card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>Active Events</span>
          <span style={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--color-success)' }}>{activePollsCount}</span>
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
            const questionCount = poll.questions ? poll.questions.length : 0;
            return (
              <div className="glass-card poll-card" key={poll.id}>
                <div className="poll-card-header">
                  <div>
                    <h3 className="poll-card-title">{poll.title}</h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
                      <span className="join-banner-code" style={{ fontSize: '1rem', fontWeight: 700 }}>
                        Code: {poll.join_code}
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
                  <button 
                    className="btn btn-sm btn-secondary" 
                    onClick={() => navigate(`/polls/${poll.id}/edit`)}
                    title="Edit Poll"
                  >
                    <Edit3 size={14} />
                  </button>
                  <button 
                    className="btn btn-sm btn-secondary"
                    onClick={() => handleCopyLink(poll.join_code, poll.id)}
                    title="Copy Join Link"
                  >
                    {copiedId === poll.id ? <Check size={14} color="var(--color-success)" /> : <Copy size={14} />}
                  </button>
                  <button 
                    className="btn btn-sm btn-danger" 
                    onClick={() => handleDelete(poll.id)}
                    title="Delete Poll"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
