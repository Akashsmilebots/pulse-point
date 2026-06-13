import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

// Deterministic Fisher-Yates shuffle seeded by a string (e.g. sessionId + questionId)
function seededShuffle(arr, seedStr) {
  const a = [...arr];
  let seed = 0;
  for (let i = 0; i < seedStr.length; i++) {
    seed = Math.imul(seed ^ seedStr.charCodeAt(i), 0x5bd1e995);
    seed ^= seed >>> 13;
  }
  for (let i = a.length - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    const j = Math.abs(seed) % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
import {
  getPollByJoinCode,
  getParticipant,
  getQuestionById,
  getResponseForParticipant,
  submitResponse,
  subscribeToPoll
} from '../lib/firebase';
import { getParticipantSessionId } from '../utils';
import { Check, RefreshCw, AlertTriangle } from 'lucide-react';

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
  const userResponseRef = useRef(null);
  const submittingRef = useRef(false);
  const currentQuestionIdRef = useRef(null);
  // Stable refs so async callbacks never read stale state
  const pollIdRef = useRef(null);
  const participantIdRef = useRef(null);

  const fetchQuestionRef = useRef();
  const handleSubmitAnswerRef = useRef();
  const refreshPollStateRef = useRef();
  // Set to true by the timer when it reaches 0; a useEffect triggers the actual submit
  const timerExpiredRef = useRef(false);
  // Holds question data for auto-submit even after currentQuestion state is cleared
  const currentQuestionDataRef = useRef(null);

  useEffect(() => {
    fetchInitialState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // Handle poll status and question changes in real-time
  useEffect(() => {
    if (!poll || !participant) return;

    const unsubscribe = subscribeToPoll(poll.id, async (updatedPoll) => {
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
        setUserResponse(null);
        userResponseRef.current = null;
        // Keep question visible only while timer still ticks (so auto-submit can fire).
        // If timer already stopped (submitted or expired), clear immediately.
        if (!localTimerRef.current) {
          setCurrentQuestion(null);
          currentQuestionDataRef.current = null;
        }
        return;
      }

      if (nextQuestionId !== currentQuestionIdRef.current) {
        // Clear old question immediately so stale content never shows
        currentQuestionIdRef.current = nextQuestionId;
        setCurrentQuestion(null);
        setUserResponse(null);
        userResponseRef.current = null;
        currentQuestionDataRef.current = null;
        // Stop any running timer before loading the new question
        if (localTimerRef.current) {
          clearInterval(localTimerRef.current);
          localTimerRef.current = null;
        }
        await fetchQuestionRef.current(nextQuestionId, updatedPoll.question_end_time);
      }
    });

    return () => {
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poll?.id, participant?.id]);

  useEffect(() => {
    return () => {
      if (localTimerRef.current) {
        clearInterval(localTimerRef.current);
        localTimerRef.current = null;
      }
    };
  }, []);

  // Auto-submit when countdown hits 0 — runs outside the state updater to avoid React Strict Mode double-calls
  useEffect(() => {
    if (localCountdown === 0 && timerExpiredRef.current) {
      timerExpiredRef.current = false;
      if (!userResponseRef.current && !submittingRef.current) {
        handleSubmitAnswerRef.current(null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localCountdown]);

  async function fetchInitialState() {
    try {
      setLoading(true);
      setError('');

      // 1. Fetch Poll
      const pollData = await getPollByJoinCode(code.toUpperCase());

      if (!pollData) {
        setError('Poll code is invalid.');
        setLoading(false);
        return;
      }

      setPoll(pollData);
      pollIdRef.current = pollData.id; // set ref eagerly before any async call reads it

      if (pollData.status === 'ended') {
        setLoading(false);
        return;
      }

      // 2. Fetch Participant registration (verify they entered name)
      const participantData = await getParticipant(pollData.id, sessionId);

      if (!participantData) {
        // Redirect back to join page
        navigate(`/join/${code}`);
        return;
      }

      setParticipant(participantData);
      participantIdRef.current = participantData.id; // set ref eagerly before fetchQuestion reads it

      // 3. Load active question if any
      if (pollData.current_question_id) {
        await fetchQuestion(pollData.current_question_id, pollData.question_end_time);
      }
    } catch (err) {
      console.error(err);
      setError('An error occurred loading the poll.');
    } finally {
      setLoading(false);
    }
  }

  async function fetchQuestion(qId, questionEndTime = null) {
    // Always read from stable refs — never trust stale closure state
    const pollId = pollIdRef.current;
    const pId = participantIdRef.current;

    if (!pollId) {
      console.error('fetchQuestion: pollId not available yet');
      return;
    }

    try {
      currentQuestionIdRef.current = qId;
      currentQuestionDataRef.current = null; // reset before fetch

      // Fetch Question details
      const questionData = await getQuestionById(pollId, qId);

      if (!questionData) throw new Error('Question not found');

      setCurrentQuestion(questionData);
      currentQuestionDataRef.current = questionData; // keep stable ref for auto-submit

      // Reset input fields
      setAnswerInput('');
      setSelectedOptions([]);
      setSelectionError('');
      setSelectedRating(0);

      // Start local countdown — sync to host's end time if available
      const remaining = questionEndTime ? Math.max(1, Math.round((questionEndTime - Date.now()) / 1000)) : 35;
      timerExpiredRef.current = false;
      setLocalCountdown(remaining);
      if (localTimerRef.current) {
        clearInterval(localTimerRef.current);
      }
      localTimerRef.current = setInterval(() => {
        setLocalCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(localTimerRef.current);
            localTimerRef.current = null;
            // Signal expiry — actual submit fires in the useEffect below
            timerExpiredRef.current = true;
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      // Check if participant already answered this question
      if (pId) {
        const existingResponse = await getResponseForParticipant(pollId, qId, pId);
        if (existingResponse) {
          setUserResponse(existingResponse);
          userResponseRef.current = existingResponse;
          if (localTimerRef.current) {
            clearInterval(localTimerRef.current);
            localTimerRef.current = null;
          }
        } else {
          setUserResponse(null);
          userResponseRef.current = null;
        }
      }
    } catch (err) {
      console.error('Error fetching question:', err);
    }
  }

  async function refreshPollState() {
    const pollId = pollIdRef.current;
    if (!pollId) return;
    try {
      const latestPoll = await getPollByJoinCode(code);

      if (!latestPoll) return;
      setPoll(latestPoll);

      if (latestPoll.status === 'ended') {
        setCurrentQuestion(null);
        setUserResponse(null);
        return;
      }

      if (latestPoll.current_question_id && latestPoll.current_question_id !== currentQuestionIdRef.current) {
        await fetchQuestionRef.current(latestPoll.current_question_id, latestPoll.question_end_time);
      }
    } catch (err) {
      console.error('Error refreshing poll state:', err);
    }
  }

  useEffect(() => {
    if (!poll?.id || (poll.status !== 'active' && poll.status !== 'paused')) return;

    const interval = setInterval(() => {
      refreshPollStateRef.current();
    }, 2000);

    return () => clearInterval(interval);
  }, [poll?.id, poll?.status]);

  const handleSubmitAnswer = async (e) => {
    if (e) e.preventDefault();
    // Use stable ref so submit works even if currentQuestion state was cleared
    const q = currentQuestionDataRef.current;
    if (!q || !participant) return;

    let answerText = '';
    const isAutoSubmit = e === null;

    if (q.type === 'multiple_choice') {
      answerText = selectedOptions.length > 0 ? selectedOptions.join(', ') : '';
    } else if (q.type === 'rating') {
      answerText = selectedRating > 0 ? selectedRating.toString() : '';
    } else if (q.type === 'open_text') {
      answerText = answerInput.trim();
    }

    // Only show errors if manually submitted (not auto-submit)
    if (!isAutoSubmit) {
      if (q.type === 'multiple_choice' && !selectedOptions.length) {
        setSelectionError('Please select at least one option.');
        return;
      }
      if (q.type === 'rating' && selectedRating === 0) {
        setSelectionError('Please choose a rating.');
        return;
      }
      if (q.type === 'open_text' && !answerInput.trim()) {
        setSelectionError('Please type an answer.');
        return;
      }
    }

    setSubmitting(true);
    submittingRef.current = true;

    try {
      const data = await submitResponse(pollIdRef.current, q.id, participant, answerText);

      setUserResponse(data);
      userResponseRef.current = data;
      currentQuestionDataRef.current = null;
      if (localTimerRef.current) {
        clearInterval(localTimerRef.current);
        localTimerRef.current = null;
      }
    } catch (err) {
      console.error('Error submitting response:', err);
      alert('Could not submit response. (Make sure you only vote once!)');
    } finally {
      setSubmitting(false);
      submittingRef.current = false;
    }
  };

  // Keep stable refs in sync with latest state
  useEffect(() => {
    if (poll?.id) {
      pollIdRef.current = poll.id;
    }
  }, [poll?.id]);

  useEffect(() => {
    if (participant?.id) {
      participantIdRef.current = participant.id;
    }
  }, [participant?.id]);

  useEffect(() => {
    fetchQuestionRef.current = fetchQuestion;
    handleSubmitAnswerRef.current = handleSubmitAnswer;
    refreshPollStateRef.current = refreshPollState;
  });

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

  // Reusable banner waiting screen (used for waiting + post-submit)
  const BannerWaitScreen = ({ icon, title, subtitle, extraContent }) => {
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(`${window.location.origin}/join/${poll?.join_code || ''}`)}&bgcolor=ffffff&color=000000&margin=10`;
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 10, background: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '1.25rem', gap: '0.85rem', overflow: 'auto' }}>
        {/* Logo */}
        <img src="/logo.png" alt="Logo" style={{ height: '30px', objectFit: 'contain', opacity: 0.85, flexShrink: 0 }} />
        {/* Long banner card — full image at natural aspect ratio */}
        <div style={{ position: 'relative', width: '100%', maxWidth: '480px', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 4px 20px rgba(0,0,0,0.13)', flexShrink: 0 }}>
          <img src="/banner.jpeg" alt="" style={{ width: '100%', height: 'auto', display: 'block' }} />
          {/* Light overlay — keeps banner readable */}
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.32)' }} />
        </div>
        {/* Message card */}
        <div style={{ background: '#fff', borderRadius: '12px', padding: '1rem 1.25rem', textAlign: 'center', maxWidth: '480px', width: '100%', border: '1px solid #E2E4E9', boxShadow: '0 2px 10px rgba(0,0,0,0.06)' }}>
          {icon && <div style={{ marginBottom: '0.5rem' }}>{icon}</div>}
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#16181D', margin: '0 0 0.25rem' }}>{title}</h2>
          {subtitle && <p style={{ color: '#6B7280', margin: 0, fontSize: '0.85rem' }}>{subtitle}</p>}
          {extraContent}
        </div>
        {/* QR code */}
        <div style={{ background: '#F7F8FA', borderRadius: '10px', padding: '0.65rem', textAlign: 'center', border: '1px solid #E2E4E9', flexShrink: 0 }}>
          <img src={qrUrl} alt="Join QR" style={{ width: '110px', height: '110px', display: 'block', borderRadius: '4px' }} />
          <p style={{ margin: '0.3rem 0 0', fontSize: '0.75rem', color: '#374151', fontWeight: 600 }}>Join: {poll?.join_code}</p>
        </div>
      </div>
    );
  };

  // Session paused
  if (poll?.status === 'paused') {
    return (
      <BannerWaitScreen
        icon={<span style={{ fontSize: '2.5rem', lineHeight: 1 }}>⏸</span>}
        title="Session Paused"
        subtitle="The host has paused the session. It will resume shortly — stay on this page!"
      />
    );
  }

  // Poll is waiting/not active state
  if (poll?.status === 'draft' || !currentQuestion) {
    return (
      <BannerWaitScreen
        icon={<RefreshCw className="spinner" size={40} color="#2B5FD9" style={{ animationDuration: '2s' }} />}
        title="Waiting for Host"
        subtitle={`Hey ${participant?.name || 'there'}! Get ready — the host is preparing the next question.`}
      />
    );
  }

  // Question exists, and has been submitted
  if (userResponse) {
    return (
      <BannerWaitScreen
        icon={
          <div style={{ background: 'rgba(16,185,129,0.2)', width: '64px', height: '64px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid rgba(16,185,129,0.6)', margin: '0 auto' }}>
            <Check size={36} color="#10B981" />
          </div>
        }
        title="Response Submitted!"
        subtitle="Hold tight — the host will launch the next question shortly."
      />
    );
  }

  // Active question, needs answer submission
  const timerPct = localCountdown > 0 ? Math.min(100, (localCountdown / 35) * 100) : 0;
  const timerColor = localCountdown > 18 ? 'var(--color-success)' : localCountdown > 8 ? 'var(--color-warning)' : 'var(--color-danger)';

  return (
    <div className="play-layout" style={{ marginTop: '1rem' }}>
      <div className="glass-card" style={{ padding: '2rem' }}>
        {/* Timer bar */}
        {localCountdown > 0 && (
          <div style={{ marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Time remaining</span>
              <span style={{ fontSize: '1.1rem', fontWeight: 800, color: timerColor, minWidth: '2.5rem', textAlign: 'right' }}>{localCountdown}s</span>
            </div>
            <div style={{ height: '8px', background: 'rgba(100,116,139,0.15)', borderRadius: '50px', overflow: 'hidden' }}>
              <div style={{ width: `${timerPct}%`, height: '100%', background: timerColor, borderRadius: '50px', transition: 'width 0.9s linear, background 0.3s ease' }} />
            </div>
          </div>
        )}

        <div className="question-title-play">{currentQuestion.text}</div>

        <div>
          {/* Multiple choice */}
          {currentQuestion.type === 'multiple_choice' && (
            <div style={{ marginBottom: '1rem' }}>
              <p style={{ marginBottom: '0.75rem', fontSize: '0.88rem', color: selectionError ? 'var(--color-danger)' : 'var(--text-muted)', fontWeight: selectionError ? 600 : 400 }}>
                {selectionError || (selectedOptions.length > 0
                  ? `${selectedOptions.length}/3 selected — auto-submits when timer ends`
                  : 'Select up to 3 options — auto-submits when timer ends')}
              </p>
              {seededShuffle(currentQuestion.options || [], `${sessionId}_${currentQuestion.id}`).map((option, idx) => {
                const isSelected = selectedOptions.includes(option);
                return (
                  <button
                    key={option}
                    type="button"
                    className={`mc-option-button ${isSelected ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectionError('');
                      if (isSelected) {
                        setSelectedOptions((prev) => prev.filter((v) => v !== option));
                      } else if (selectedOptions.length < 3) {
                        setSelectedOptions((prev) => [...prev, option]);
                      } else {
                        setSelectionError('You can select up to 3 options.');
                      }
                    }}
                    disabled={submitting || localCountdown === 0}
                  >
                    <span style={{ fontWeight: 500 }}>{option}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Rating */}
          {currentQuestion.type === 'rating' && (
            <div style={{ textAlign: 'center' }}>
              <div className="rating-button-row">
                {[1, 2, 3, 4, 5].map((val) => (
                  <button
                    key={val}
                    type="button"
                    className={`rating-btn ${selectedRating === val ? 'selected' : ''}`}
                    onClick={() => setSelectedRating(val)}
                    disabled={submitting}
                  >
                    {val}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1.5rem', marginTop: '-1.5rem', padding: '0 0.5rem' }}>
                <span>Not Good</span>
                <span>Excellent</span>
              </div>
              <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)' }}>
                {selectedRating > 0 ? `Rated ${selectedRating}/5 — submits when timer ends` : 'Pick a rating — auto-submits when timer ends'}
              </p>
            </div>
          )}

          {/* Open text */}
          {currentQuestion.type === 'open_text' && (
            <div className="form-group" style={{ marginBottom: '1.5rem' }}>
              <textarea
                className="form-textarea"
                rows={4}
                maxLength={200}
                placeholder="Type your response here..."
                value={answerInput}
                onChange={(e) => setAnswerInput(e.target.value)}
                disabled={submitting}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                <span>Auto-submits when timer ends</span>
                <span>{answerInput.length}/200</span>
              </div>
            </div>
          )}

          {submitting && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '0.75rem', color: 'var(--color-primary)', fontWeight: 600 }}>
              <div className="spinner" style={{ width: '18px', height: '18px' }}></div>
              Submitting...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
