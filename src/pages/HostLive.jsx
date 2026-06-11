import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { getHostId } from '../utils';
import { ArrowLeft, Play, Square, RefreshCw, Users, AlertCircle, Copy, Check, ChevronRight, ChevronLeft, Plus, Save } from 'lucide-react';

export default function HostLive() {
  const { id } = useParams();
  const navigate = useNavigate();
  const hostId = getHostId();

  const [poll, setPoll] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [responses, setResponses] = useState([]);
  const [participantCount, setParticipantCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [savingDraft, setSavingDraft] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Keep a ref to the active question ID for the realtime channel callback
  const activeQuestionIdRef = useRef(null);

  useEffect(() => {
    fetchPollAndQuestions();
  }, [id]);

  useEffect(() => {
    if (!poll) return;

    // 1. Subscribe to Participant changes
    const participantChannel = supabase
      .channel(`live-participants-${poll.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'participants', filter: `poll_id=eq.${poll.id}` },
        () => {
          fetchParticipantCount();
        }
      )
      .subscribe();

    fetchParticipantCount();

    return () => {
      supabase.removeChannel(participantChannel);
    };
  }, [poll?.id]);

  useEffect(() => {
    if (!currentQuestion) {
      setResponses([]);
      return;
    }

    activeQuestionIdRef.current = currentQuestion.id;
    fetchResponses(currentQuestion.id);

    // 2. Subscribe to Response changes for the current question
    const responseChannel = supabase
      .channel(`live-responses-${currentQuestion.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'responses', filter: `question_id=eq.${currentQuestion.id}` },
        () => {
          // Re-fetch responses to get the participant joins
          if (activeQuestionIdRef.current) {
            fetchResponses(activeQuestionIdRef.current);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(responseChannel);
    };
  }, [currentQuestion?.id]);

  const fetchPollAndQuestions = async () => {
    try {
      setLoading(true);
      
      // Fetch poll details
      const { data: pollData, error: pollError } = await supabase
        .from('polls')
        .select('*')
        .eq('id', id)
        .eq('host_id', hostId)
        .single();

      if (pollError || !pollData) {
        console.error('Error fetching poll:', pollError);
        setErrorMessage('Poll not found or unauthorized.');
        navigate('/dashboard');
        return;
      }

      setPoll(pollData);
      setDraftTitle(pollData.title || '');

      // Fetch questions
      const { data: qData, error: qError } = await supabase
        .from('questions')
        .select('*')
        .eq('poll_id', id)
        .order('order_index', { ascending: true });

      if (qError) throw qError;
      setQuestions(qData || []);

      // Determine current active question
      if (pollData.status === 'active' && pollData.current_question_id) {
        const activeQ = qData.find((q) => q.id === pollData.current_question_id);
        setCurrentQuestion(activeQ || qData[0] || null);
      } else if (qData.length > 0) {
        // Default to first question (even if draft)
        setCurrentQuestion(qData[0]);
      }
    } catch (err) {
      console.error(err);
      setErrorMessage('Failed to load host control screen.');
    } finally {
      setLoading(false);
    }
  };

  const fetchParticipantCount = async () => {
    if (!poll) return;
    try {
      const { count, error } = await supabase
        .from('participants')
        .select('*', { count: 'exact', head: true })
        .eq('poll_id', poll.id);
      
      if (!error) {
        setParticipantCount(count || 0);
      }
    } catch (err) {
      console.error('Error getting participant count:', err);
    }
  };

  const handleAddQuestion = () => {
    setQuestions([
      ...questions,
      { text: '', type: 'multiple_choice', options: ['Option 1', 'Option 2'] }
    ]);
  };

  const handleRemoveQuestion = (index) => {
    setQuestions(questions.filter((_, idx) => idx !== index));
  };

  const handleQuestionTextChange = (index, value) => {
    const updated = [...questions];
    updated[index].text = value;
    setQuestions(updated);
  };

  const handleQuestionTypeChange = (index, type) => {
    const updated = [...questions];
    updated[index].type = type;
    if (type === 'multiple_choice' && (!updated[index].options || updated[index].options.length === 0)) {
      updated[index].options = ['Option 1', 'Option 2'];
    }
    if (type !== 'multiple_choice') {
      updated[index].options = [];
    }
    setQuestions(updated);
  };

  const handleOptionChange = (qIndex, oIndex, value) => {
    const updated = [...questions];
    updated[qIndex].options[oIndex] = value;
    setQuestions(updated);
  };

  const handleAddOption = (qIndex) => {
    const updated = [...questions];
    updated[qIndex].options.push(`Option ${updated[qIndex].options.length + 1}`);
    setQuestions(updated);
  };

  const handleRemoveOption = (qIndex, oIndex) => {
    const updated = [...questions];
    if (updated[qIndex].options.length <= 2) {
      setErrorMessage('Multiple choice questions need at least 2 options.');
      return;
    }
    updated[qIndex].options = updated[qIndex].options.filter((_, idx) => idx !== oIndex);
    setQuestions(updated);
  };

  const handleMoveQuestion = (index, direction) => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === questions.length - 1) return;

    const updated = [...questions];
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    [updated[index], updated[swapIndex]] = [updated[swapIndex], updated[index]];
    setQuestions(updated);
  };

  const handleSaveDraft = async () => {
    if (!poll) return false;
    setErrorMessage('');

    if (!draftTitle.trim()) {
      setErrorMessage('Please enter an event title.');
      return false;
    }

    for (let i = 0; i < questions.length; i++) {
      if (!questions[i].text.trim()) {
        setErrorMessage(`Question ${i + 1} has no text. Please fill it in.`);
        return false;
      }
      if (questions[i].type === 'multiple_choice') {
        for (let j = 0; j < questions[i].options.length; j++) {
          if (!questions[i].options[j].trim()) {
            setErrorMessage(`Option ${j + 1} in Question ${i + 1} is empty.`);
            return false;
          }
        }
      }
    }

    setSavingDraft(true);
    try {
      const { error: pollError } = await supabase
        .from('polls')
        .update({ title: draftTitle.trim() })
        .eq('id', poll.id)
        .eq('host_id', hostId);
      if (pollError) throw pollError;

      const { error: deleteError } = await supabase
        .from('questions')
        .delete()
        .eq('poll_id', poll.id);
      if (deleteError) throw deleteError;

      if (questions.length > 0) {
        const questionsToInsert = questions.map((q, idx) => ({
          poll_id: poll.id,
          text: q.text.trim(),
          type: q.type,
          options: q.type === 'multiple_choice' ? q.options.map((o) => o.trim()) : [],
          order_index: idx
        }));

        const { error: insertError } = await supabase
          .from('questions')
          .insert(questionsToInsert);

        if (insertError) throw insertError;
      }

      setPoll({ ...poll, title: draftTitle.trim() });
      setSaveMessage('Draft saved successfully.');
      setTimeout(() => setSaveMessage(''), 3000);
      await fetchPollAndQuestions();
      return true;
    } catch (err) {
      console.error(err);
      setErrorMessage('Error saving draft changes.');
      return false;
    } finally {
      setSavingDraft(false);
    }
  };

  const fetchResponses = async (qId) => {
    try {
      const { data, error } = await supabase
        .from('responses')
        .select(`
          id,
          answer,
          created_at,
          participants (
            name
          )
        `)
        .eq('question_id', qId);

      if (error) throw error;
      setResponses(data || []);
    } catch (err) {
      console.error('Error fetching responses:', err);
    }
  };

  const handleStartPoll = async () => {
    setErrorMessage('');
    if (questions.length === 0) {
      setErrorMessage('You must add questions to your poll before launching it.');
      return;
    }

    const saved = await handleSaveDraft();
    if (!saved) return;

    try {
      const { data: firstQ, error: firstQError } = await supabase
        .from('questions')
        .select('*')
        .eq('poll_id', poll.id)
        .order('order_index', { ascending: true })
        .limit(1)
        .single();

      if (firstQError || !firstQ) {
        setErrorMessage('Unable to find the first question after saving the draft.');
        return;
      }

      const { error } = await supabase
        .from('polls')
        .update({
          status: 'active',
          current_question_id: firstQ.id
        })
        .eq('id', poll.id);

      if (error) throw error;
      setPoll({ ...poll, status: 'active', current_question_id: firstQ.id });
      setCurrentQuestion(firstQ);
    } catch (err) {
      console.error(err);
      setErrorMessage('Failed to start poll. Please try again.');
    }
  };

  const handleEndPoll = async () => {
    try {
      const { error } = await supabase
        .from('polls')
        .update({
          status: 'ended',
          current_question_id: null
        })
        .eq('id', poll.id);

      if (error) throw error;
      setPoll({ ...poll, status: 'ended', current_question_id: null });
      setCurrentQuestion(currentQuestion || questions[0] || null);
    } catch (err) {
      console.error(err);
      setErrorMessage('Failed to end poll.');
    }
  };

  const handleResetPoll = async () => {
    if (!window.confirm('Are you sure you want to reset this poll? This will delete all participant registrations and answers so you can run it fresh.')) {
      return;
    }

    try {
      setLoading(true);
      // 1. Delete participants (cascades and deletes responses too)
      const { error: delPartError } = await supabase
        .from('participants')
        .delete()
        .eq('poll_id', poll.id);

      if (delPartError) throw delPartError;

      // 2. Set poll status back to draft, reset current question
      const { error: pollError } = await supabase
        .from('polls')
        .update({
          status: 'draft',
          current_question_id: null
        })
        .eq('id', poll.id);

      if (pollError) throw pollError;

      setPoll({ ...poll, status: 'draft', current_question_id: null });
      if (questions.length > 0) {
        setCurrentQuestion(questions[0]);
      }
      setParticipantCount(0);
      setResponses([]);
    } catch (err) {
      console.error(err);
      setErrorMessage('Failed to reset poll.');
    } finally {
      setLoading(false);
    }
  };

  const handleSetActiveQuestion = async (q) => {
    if (!(poll.status === 'active' || poll.status === 'ended')) return;
    try {
      const { error } = await supabase
        .from('polls')
        .update({ current_question_id: q.id })
        .eq('id', poll.id);

      if (error) throw error;
      setPoll({ ...poll, current_question_id: q.id });
      setCurrentQuestion(q);
    } catch (err) {
      console.error(err);
      setErrorMessage('Failed to change active question.');
    }
  };

  const handleNextQuestion = () => {
    const currentIndex = questions.findIndex(q => q.id === currentQuestion.id);
    if (currentIndex < questions.length - 1) {
      handleSetActiveQuestion(questions[currentIndex + 1]);
    }
  };

  const handlePrevQuestion = () => {
    if (!currentQuestion) return;
    const currentIndex = questions.findIndex(q => q.id === currentQuestion.id);
    if (currentIndex > 0) {
      handleSetActiveQuestion(questions[currentIndex - 1]);
    }
  };

  const handleCopyLink = () => {
    const link = `${window.location.origin}/join/${poll.join_code}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Helper calculation for MC Responses
  const renderMCResults = () => {
    if (!currentQuestion) return null;
    const totalVotes = responses.length;
    const options = currentQuestion.options || [];

    // Tally answers
    const tallies = {};
    options.forEach(opt => { tallies[opt] = 0; });
    responses.forEach(r => {
      if (tallies[r.answer] !== undefined) {
        tallies[r.answer]++;
      } else {
        tallies[r.answer] = 1;
      }
    });

    return (
      <div className="results-container">
        {options.map((opt, idx) => {
          const votes = tallies[opt] || 0;
          const pct = totalVotes > 0 ? Math.round((votes / totalVotes) * 100) : 0;
          return (
            <div className="result-bar-wrapper" key={idx}>
              <div className="result-bar-header">
                <span className="result-bar-label">{opt}</span>
                <span className="result-bar-stats">{votes} vote{votes !== 1 ? 's' : ''} ({pct}%)</span>
              </div>
              <div className="result-bar-bg">
                <div className="result-bar-fill" style={{ width: `${pct}%` }}></div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // Helper calculation for Ratings
  const renderRatingResults = () => {
    if (!currentQuestion) return null;
    const totalVotes = responses.length;

    // Calculate average
    let sum = 0;
    const tallies = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    responses.forEach(r => {
      const val = parseInt(r.answer, 10);
      if (!isNaN(val)) {
        sum += val;
        tallies[val] = (tallies[val] || 0) + 1;
      }
    });
    const avg = totalVotes > 0 ? (sum / totalVotes).toFixed(1) : '0.0';

    return (
      <div className="rating-result-grid">
        <div className="rating-avg-card">
          <span className="rating-avg-number">{avg}</span>
          <span className="rating-avg-stars">
            {'★'.repeat(Math.round(parseFloat(avg)))}
            {'☆'.repeat(5 - Math.round(parseFloat(avg)))}
          </span>
          <p style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>Based on {totalVotes} response{totalVotes !== 1 ? 's' : ''}</p>
        </div>
        <div className="results-container" style={{ margin: 0 }}>
          {[5, 4, 3, 2, 1].map(stars => {
            const count = tallies[stars] || 0;
            const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
            return (
              <div className="result-bar-wrapper" key={stars}>
                <div className="result-bar-header" style={{ fontSize: '0.85rem' }}>
                  <span className="result-bar-label" style={{ color: 'var(--text-secondary)' }}>{stars} Star{stars !== 1 ? 's' : ''}</span>
                  <span className="result-bar-stats">{count} ({pct}%)</span>
                </div>
                <div className="result-bar-bg" style={{ height: '12px' }}>
                  <div className="result-bar-fill" style={{ width: `${pct}%`, background: 'var(--color-accent)' }}></div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // Helper for Open Text responses
  const renderOpenTextResults = () => {
    if (responses.length === 0) {
      return (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', margin: '3rem 0' }}>
          Waiting for text responses...
        </div>
      );
    }
    return (
      <div className="text-responses-grid">
        {responses.map((resp) => (
          <div className="text-response-card" key={resp.id}>
            <p style={{ color: 'var(--text-primary)', fontStyle: 'italic' }}>"{resp.answer}"</p>
            <div className="text-response-author">
              — {resp.participants ? resp.participants.name : 'Anonymous'}
            </div>
          </div>
        ))}
      </div>
    );
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', margin: '4rem 0' }}>
        <div className="spinner" style={{ width: '40px', height: '40px' }}></div>
      </div>
    );
  }

  const currentIndex = questions.findIndex(q => q.id === currentQuestion?.id);

  return (
    <div>
      {/* Top action bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <button className="btn btn-secondary" onClick={() => navigate('/dashboard')}>
          <ArrowLeft size={16} /> Back to Dashboard
        </button>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          {poll.status === 'draft' && (
            <button className="btn btn-secondary" onClick={handleSaveDraft} disabled={savingDraft || loading}>
              <Save size={16} /> Save Draft
            </button>
          )}
          {poll.status === 'draft' && (
            <button className="btn btn-success" onClick={handleStartPoll} disabled={questions.length === 0 || savingDraft || loading}>
              <Play size={16} /> Start Poll Session
            </button>
          )}
          {poll.status === 'active' && (
            <button className="btn btn-danger" onClick={handleEndPoll}>
              <Square size={16} /> End Session
            </button>
          )}
          {(poll.status === 'active' || poll.status === 'ended') && (
            <button className="btn btn-secondary" onClick={handleResetPoll}>
              <RefreshCw size={16} /> Reset & Restart
            </button>
          )}
        </div>
      </div>

      {errorMessage && (
        <div style={{ margin: '0 0 1rem 0', padding: '1rem 1.25rem', borderRadius: '16px', background: 'rgba(248, 113, 113, 0.1)', color: 'var(--color-danger)', border: '1px solid rgba(248, 113, 113, 0.25)' }}>
          {errorMessage}
        </div>
      )}

      {/* Join Info Banner */}
      <div className="join-banner">
        <div className="join-banner-info">
          <h2>Audience Join Link</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span className="join-banner-link">{window.location.origin}/join/{poll.join_code}</span>
            <button className="btn btn-secondary btn-sm" onClick={handleCopyLink} style={{ padding: '0.4rem 0.6rem' }}>
              {copied ? <Check size={14} color="var(--color-success)" /> : <Copy size={14} />}
            </button>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <h2>Join Code</h2>
          <span className="join-banner-code">{poll.join_code}</span>
        </div>
      </div>

      {/* Layout Split */}
      <div className="live-layout">
        
        {/* Main projection pane */}
        <div className="glass-card" style={{ padding: '2.5rem' }}>
          {poll.status === 'draft' ? (
            <div>
              <div style={{ marginBottom: '1.5rem' }}>
                <h2>Edit Event Title & Questions</h2>
                <p style={{ margin: '0.5rem 0 0', color: 'var(--text-secondary)' }}>
                  Add questions now, save the draft, and start the live session when you're ready. You can edit questions individually before launch.
                </p>
              </div>

              <div className="form-group">
                <label className="form-label">Event Title</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Weekly All-Hands Feedback"
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  disabled={savingDraft || loading}
                />
              </div>

              {saveMessage && (
                <div style={{ marginBottom: '1rem', color: 'var(--color-success)', fontWeight: 600 }}>
                  {saveMessage}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '2rem 0 1rem 0' }}>
                <h3 style={{ margin: 0 }}>Questions</h3>
                <button className="btn btn-secondary btn-sm" onClick={handleAddQuestion} disabled={savingDraft || loading}>
                  <Plus size={14} /> Add Question
                </button>
              </div>

              {questions.length === 0 ? (
                <div style={{ padding: '1.5rem', border: '1px dashed var(--border-color)', borderRadius: '16px', color: 'var(--text-secondary)' }}>
                  No questions yet. Add your first question and save the draft.
                </div>
              ) : (
                <div style={{ display: 'grid', gap: '1rem' }}>
                  {questions.map((q, idx) => (
                    <div className="question-card" key={idx} style={{ padding: '1.25rem', borderRadius: '18px', border: '1px solid var(--border-color)' }}>
                      <div className="question-card-header">
                        <span className="question-number">Question {idx + 1}</span>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleMoveQuestion(idx, 'up')}
                            disabled={idx === 0 || savingDraft || loading}
                            style={{ padding: '0.25rem 0.5rem' }}
                          >
                            <ChevronLeft size={14} />
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleMoveQuestion(idx, 'down')}
                            disabled={idx === questions.length - 1 || savingDraft || loading}
                            style={{ padding: '0.25rem 0.5rem' }}
                          >
                            <ChevronRight size={14} />
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            onClick={() => handleRemoveQuestion(idx)}
                            disabled={savingDraft || loading}
                            style={{ padding: '0.25rem 0.5rem' }}
                          >
                            <Square size={14} />
                          </button>
                        </div>
                      </div>

                      <div className="form-group">
                        <label className="form-label">Question Text</label>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="Enter your question"
                          value={q.text}
                          onChange={(e) => handleQuestionTextChange(idx, e.target.value)}
                          disabled={savingDraft || loading}
                        />
                      </div>

                      <div className="form-group">
                        <label className="form-label">Question Type</label>
                        <select
                          className="form-select"
                          value={q.type}
                          onChange={(e) => handleQuestionTypeChange(idx, e.target.value)}
                          disabled={savingDraft || loading}
                        >
                          <option value="multiple_choice">Multiple Choice</option>
                          <option value="open_text">Open Text</option>
                          <option value="rating">Rating</option>
                        </select>
                      </div>

                      {q.type === 'multiple_choice' && (
                        <div className="question-options-editor">
                          <label className="form-label" style={{ fontSize: '0.85rem' }}>Options</label>
                          {q.options.map((option, oIndex) => (
                            <div className="option-row" key={oIndex}>
                              <input
                                type="text"
                                className="form-input"
                                style={{ flex: 1, padding: '0.5rem 0.75rem', fontSize: '0.9rem' }}
                                value={option}
                                onChange={(e) => handleOptionChange(idx, oIndex, e.target.value)}
                                disabled={savingDraft || loading}
                              />
                              <button
                                type="button"
                                className="btn btn-danger btn-sm"
                                onClick={() => handleRemoveOption(idx, oIndex)}
                                disabled={savingDraft || loading}
                                style={{ padding: '0.5rem' }}
                              >
                                <Square size={14} />
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            style={{ width: 'fit-content', marginTop: '0.5rem' }}
                            onClick={() => handleAddOption(idx)}
                            disabled={savingDraft || loading}
                          >
                            <Plus size={12} /> Add Option
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : currentQuestion ? (
            <div>
              {poll.status === 'ended' && (
                <div style={{ marginBottom: '1.5rem', padding: '1rem 1.25rem', borderRadius: '16px', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', color: 'var(--color-success)' }}>
                  <strong>Session ended.</strong> You can still review responses for any question below.
                </div>
              )}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem', marginBottom: '2rem' }}>
                <div>
                  <span className="question-number">Question {currentIndex + 1} of {questions.length}</span>
                  <h2 style={{ marginTop: '0.5rem', marginBottom: 0 }}>{currentQuestion.text}</h2>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(255, 255, 255, 0.03)', padding: '0.5rem 1rem', borderRadius: '30px', border: '1px solid var(--border-color)' }}>
                  <Users size={16} color="var(--color-accent)" />
                  <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>{responses.length} responses</span>
                </div>
              </div>

              {/* Show different visualization based on question type */}
              {currentQuestion.type === 'multiple_choice' && renderMCResults()}
              {currentQuestion.type === 'rating' && renderRatingResults()}
              {currentQuestion.type === 'open_text' && renderOpenTextResults()}

              {/* Back/Next Controls */}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '3rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.5rem' }}>
                <button 
                  className="btn btn-secondary" 
                  onClick={handlePrevQuestion} 
                  disabled={!currentQuestion || questions.length <= 1 || currentIndex === 0}
                >
                  <ChevronLeft size={16} /> Previous Question
                </button>
                <button 
                  className="btn btn-secondary" 
                  onClick={handleNextQuestion} 
                  disabled={!currentQuestion || questions.length <= 1 || currentIndex === questions.length - 1}
                >
                  Next Question <ChevronRight size={16} />
                </button>
              </div>
           </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '3rem 0' }}>
              <p>No questions found. Add questions by editing this poll.</p>
            </div>
          )}
        </div>

        {/* Sidebar question manager */}
        <div className="live-sidebar">
          <div className="glass-card" style={{ padding: '1.5rem' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem', fontSize: '1.1rem' }}>
              <Users size={18} color="var(--text-secondary)" />
              Participants Connected
            </h3>
            <div style={{ fontSize: '2rem', fontWeight: 800 }}>{participantCount}</div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Audience members currently in the room</p>
          </div>

          <div className="glass-card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', flex: 1 }}>
            <h3 style={{ fontSize: '1.1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>Questions Navigator</h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', overflowY: 'auto', maxHeight: '400px' }}>
              {questions.map((q, idx) => {
                const isActive = q.id === currentQuestion?.id;
                const isPollInteractive = poll.status === 'active' || poll.status === 'ended';
                return (
                  <button
                    key={q.id}
                    className={`live-nav-btn ${isActive ? 'active' : ''}`}
                    onClick={() => handleSetActiveQuestion(q)}
                    disabled={!isPollInteractive}
                    title={!isPollInteractive ? 'Start the session to navigate questions' : ''}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', fontWeight: 700 }}>Question {idx + 1}</span>
                      <span style={{ fontSize: '0.9rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                        {q.text}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
