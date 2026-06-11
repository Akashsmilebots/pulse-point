import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { getParticipantSessionId } from '../utils';
import { Check, Star, RefreshCw, Send, AlertTriangle } from 'lucide-react';

export default function ParticipantPlay() {
  const { code } = useParams();
  const navigate = useNavigate();
  const sessionId = getParticipantSessionId();

  const [poll, setPoll] = useState(null);
  const [participant, setParticipant] = useState(null);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [userResponse, setUserResponse] = useState(null); // existing answer if submitted
  const [answerInput, setAnswerInput] = useState(''); // text answer
  const [selectedOptions, setSelectedOptions] = useState([]); // MC answers
  const [selectedRating, setSelectedRating] = useState(0); // Rating answer
  const [selectionError, setSelectionError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [localCountdown, setLocalCountdown] = useState(0);
  const localTimerRef = useRef(null);

  const currentQuestionIdRef = useRef(null);

  useEffect(() => {
    fetchInitialState();
  }, [code]);

  // Handle poll status and question changes in real-time
  useEffect(() => {
    if (!poll) return;

    const pollChannel = supabase
      .channel(`play-poll-${poll.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'polls', filter: `id=eq.${poll.id}` },
        async (payload) => {
          const updatedPoll = payload.new;
          if (!updatedPoll) return;

          setPoll(updatedPoll);

          if (updatedPoll.status === 'ended') {
            currentQuestionIdRef.current = null;
            setCurrentQuestion(null);
            setUserResponse(null);
            return;
          }

          const nextQuestionId = updatedPoll.current_question_id;
          if (!nextQuestionId) {
            currentQuestionIdRef.current = null;
            setCurrentQuestion(null);
            setUserResponse(null);
            if (localTimerRef.current) {
              clearInterval(localTimerRef.current);
              localTimerRef.current = null;
            }
            return;
          }

          if (nextQuestionId !== currentQuestionIdRef.current) {
            currentQuestionIdRef.current = nextQuestionId;
            setCurrentQuestion(null);
            setUserResponse(null);
            await fetchQuestion(nextQuestionId);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(pollChannel);
    };
  }, [poll?.id]);

  useEffect(() => {
    return () => {
      if (localTimerRef.current) {
        clearInterval(localTimerRef.current);
        localTimerRef.current = null;
      }
    };
  }, []);

  const fetchInitialState = async () => {
    try {
      setLoading(true);
      setError('');

      // 1. Fetch Poll
      const { data: pollData, error: pollError } = await supabase
        .from('polls')
        .select('*')
        .eq('join_code', code.toUpperCase())
        .single();

      if (pollError || !pollData) {
        setError('Poll code is invalid.');
        setLoading(false);
        return;
      }

      setPoll(pollData);

      if (pollData.status === 'ended') {
        setLoading(false);
        return;
      }

      // 2. Fetch Participant registration (verify they entered name)
      const { data: participantData, error: pError } = await supabase
        .from('participants')
        .select('*')
        .eq('poll_id', pollData.id)
        .eq('session_id', sessionId)
        .maybeSingle();

      if (pError || !participantData) {
        // Redirect back to join page
        navigate(`/join/${code}`);
        return;
      }

      setParticipant(participantData);

      // 3. Load active question if any
      if (pollData.current_question_id) {
        await fetchQuestion(pollData.current_question_id, participantData.id);
      }
    } catch (err) {
      console.error(err);
      setError('An error occurred loading the poll.');
    } finally {
      setLoading(false);
    }
  };

  const fetchQuestion = async (qId, pId = participant?.id) => {
    try {
      currentQuestionIdRef.current = qId;
      
      // Fetch Question details
      const { data: questionData, error: qError } = await supabase
        .from('questions')
        .select('*')
        .eq('id', qId)
        .single();

      if (qError) throw qError;

      setCurrentQuestion(questionData);
      
      // Reset input fields
      setAnswerInput('');
      setSelectedOptions([]);
      setSelectionError('');
      setSelectedRating(0);

      // Start local countdown for this question (20s)
      setLocalCountdown(20);
      if (localTimerRef.current) {
        clearInterval(localTimerRef.current);
      }
      localTimerRef.current = setInterval(() => {
        setLocalCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(localTimerRef.current);
            localTimerRef.current = null;
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      // Check if participant already answered this question
      if (pId) {
        const { data: existingResponse, error: rError } = await supabase
          .from('responses')
          .select('*')
          .eq('question_id', qId)
          .eq('participant_id', pId)
          .maybeSingle();

        if (!rError && existingResponse) {
          setUserResponse(existingResponse);
        } else {
          setUserResponse(null);
        }
      }
    } catch (err) {
      console.error('Error fetching question:', err);
    }
  };

  const refreshPollState = async () => {
    if (!poll?.id) return;
    try {
      const { data: latestPoll, error: pollError } = await supabase
        .from('polls')
        .select('*')
        .eq('id', poll.id)
        .single();

      if (pollError || !latestPoll) return;
      setPoll(latestPoll);

      if (latestPoll.status === 'ended') {
        setCurrentQuestion(null);
        setUserResponse(null);
        return;
      }

      if (latestPoll.current_question_id && latestPoll.current_question_id !== currentQuestionIdRef.current) {
        await fetchQuestion(latestPoll.current_question_id);
      }
    } catch (err) {
      console.error('Error refreshing poll state:', err);
    }
  };

  useEffect(() => {
    if (!poll?.id || poll.status !== 'active') return;

    const interval = setInterval(() => {
      refreshPollState();
    }, 2000);

    return () => clearInterval(interval);
  }, [poll?.id, poll?.status]);

  const handleSubmitAnswer = async (e) => {
    if (e) e.preventDefault();
    if (!currentQuestion || !participant) return;

    if (localCountdown === 0) {
      setSelectionError('Time is up for this question.');
      return;
    }

    let answerText = '';
    if (currentQuestion.type === 'multiple_choice') {
      if (!selectedOptions.length) {
        setSelectionError('Please select at least one option.');
        return;
      }
      answerText = selectedOptions.join(', ');
    } else if (currentQuestion.type === 'rating') {
      if (selectedRating === 0) {
        alert('Please choose a rating.');
        return;
      }
      answerText = selectedRating.toString();
    } else if (currentQuestion.type === 'open_text') {
      if (!answerInput.trim()) {
        alert('Please type an answer.');
        return;
      }
      answerText = answerInput.trim();
    }

    setSubmitting(true);

    try {
      // Insert response into Supabase
      const { data, error } = await supabase
        .from('responses')
        .insert({
          question_id: currentQuestion.id,
          participant_id: participant.id,
          answer: answerText
        })
        .select()
        .single();

      if (error) throw error;

      setUserResponse(data);
    } catch (err) {
      console.error('Error submitting response:', err);
      alert('Could not submit response. (Make sure you only vote once!)');
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

  if (error) {
    return (
      <div className="play-layout" style={{ marginTop: '2rem' }}>
        <div className="glass-card" style={{ padding: '2.5rem', textAlign: 'center' }}>
          <AlertTriangle size={48} color="var(--color-danger)" style={{ marginBottom: '1.5rem' }} />
          <h2>Error</h2>
          <p style={{ margin: '1rem 0' }}>{error}</p>
          <button className="btn btn-secondary" onClick={() => navigate('/')}>
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  // Poll finished state
  if (poll?.status === 'ended') {
    return (
      <div className="play-layout" style={{ marginTop: '2rem' }}>
        <div className="glass-card" style={{ padding: '2.5rem', textAlign: 'center' }}>
          <Check size={48} color="var(--color-success)" style={{ marginBottom: '1.5rem' }} />
          <h2>Poll Completed</h2>
          <p style={{ margin: '1rem 0 2rem 0' }}>
            Thank you for participating, <strong>{participant?.name}</strong>! The host has ended this live poll session.
          </p>
          <button className="btn btn-secondary" onClick={() => navigate('/')}>
            Exit Poll
          </button>
        </div>
      </div>
    );
  }

  // Poll is waiting/not active state
  if (poll?.status === 'draft' || !currentQuestion) {
    return (
      <div className="play-layout" style={{ marginTop: '2rem' }}>
        <div className="glass-card" style={{ padding: '2.5rem', textAlign: 'center' }}>
          <RefreshCw className="spinner" size={48} style={{ animationDuration: '3s', marginBottom: '1.5rem', color: 'var(--color-primary)' }} />
          <h2>Waiting for Host</h2>
          <p style={{ margin: '1rem 0' }}>
            Hey <strong>{participant?.name}</strong>! Get ready, the host is preparing to launch the live poll question.
          </p>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            This screen will update automatically.
          </p>
        </div>
      </div>
    );
  }

  // Question exists, and has been submitted
  if (userResponse) {
    return (
      <div className="play-layout" style={{ marginTop: '2rem' }}>
        <div className="glass-card" style={{ padding: '2.5rem', textAlign: 'center' }}>
          <div style={{ background: 'rgba(16, 185, 129, 0.1)', width: '60px', height: '60px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifySelf: 'center', justifyContent: 'center', marginBottom: '1.5rem', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
            <Check size={32} color="var(--color-success)" />
          </div>
          <h2>Response Submitted!</h2>
          <p style={{ margin: '1rem 0 2rem 0' }}>
            Your answer: <strong style={{ color: 'var(--text-primary)' }}>{userResponse.answer}</strong> has been cast.
          </p>
          <div style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Hold tight. The host will switch to the next question shortly!
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Active question, needs answer submission
  return (
    <div className="play-layout" style={{ marginTop: '1rem' }}>
      <div className="glass-card" style={{ padding: '2rem' }}>
        <div className="question-title-play">{currentQuestion.text}</div>

        <form onSubmit={handleSubmitAnswer}>
          {/* Render inputs depending on type */}
          {currentQuestion.type === 'multiple_choice' && (
            <div style={{ marginBottom: '1rem' }}>
              {localCountdown > 0 && (
                <div style={{ marginBottom: '0.5rem', fontWeight: 600, color: 'var(--color-accent)' }}>
                  Time remaining: {localCountdown}s
                </div>
              )}
              {(currentQuestion.options || []).map((option, idx) => {
                const number = idx + 1;
                const isSelected = selectedOptions.includes(option);
                return (
                  <button
                    key={idx}
                    type="button"
                    className={`mc-option-button ${isSelected ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectionError('');
                      if (isSelected) {
                        setSelectedOptions((prev) => prev.filter((value) => value !== option));
                      } else if (selectedOptions.length < 3) {
                        setSelectedOptions((prev) => [...prev, option]);
                      } else {
                        setSelectionError('You can select up to 3 options.');
                      }
                    }}
                    disabled={submitting || localCountdown === 0}
                  >
                    <span style={{ fontWeight: 500 }}>{option}</span>
                    <span className="option-letter">{number}</span>
                  </button>
                );
              })}
              <p style={{ marginTop: '0.75rem', fontSize: '0.95rem', color: selectionError ? 'var(--color-danger)' : 'var(--text-muted)' }}>
                {selectionError || `Selected ${selectedOptions.length}/3 options.`}
              </p>
            </div>
          )}

          {currentQuestion.type === 'rating' && (
            <div style={{ textAlign: 'center' }}>
              <div className="rating-button-row">
                {[1, 2, 3, 4, 5].map((val) => {
                  const isSelected = selectedRating === val;
                  return (
                    <button
                      key={val}
                      type="button"
                      className={`rating-btn ${isSelected ? 'selected' : ''}`}
                      onClick={() => setSelectedRating(val)}
                      disabled={submitting}
                    >
                      {val}
                    </button>
                  );
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '2rem', marginTop: '-1.5rem', padding: '0 0.5rem' }}>
                <span>Not Good</span>
                <span>Excellent</span>
              </div>
            </div>
          )}

          {currentQuestion.type === 'open_text' && (
            <div className="form-group" style={{ marginBottom: '2rem' }}>
              <textarea
                className="form-textarea"
                rows={4}
                maxLength={200}
                placeholder="Type your response here..."
                value={answerInput}
                onChange={(e) => setAnswerInput(e.target.value)}
                disabled={submitting}
                required
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {answerInput.length}/200 characters
              </div>
            </div>
          )}

          <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={submitting}>
            {submitting ? <div className="spinner"></div> : <><Send size={16} /> Submit Answer</>}
          </button>
        </form>
      </div>
    </div>
  );
}
