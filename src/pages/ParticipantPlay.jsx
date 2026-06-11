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
  const [selectedOption, setSelectedOption] = useState(''); // MC answer
  const [selectedRating, setSelectedRating] = useState(0); // Rating answer
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

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
          setPoll(updatedPoll);
          
          if (updatedPoll.status === 'ended') {
            setCurrentQuestion(null);
            setUserResponse(null);
          } else if (updatedPoll.current_question_id !== currentQuestionIdRef.current) {
            // Host changed question!
            if (updatedPoll.current_question_id) {
              fetchQuestion(updatedPoll.current_question_id);
            } else {
              setCurrentQuestion(null);
              setUserResponse(null);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(pollChannel);
    };
  }, [poll?.id]);

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
      setSelectedOption('');
      setSelectedRating(0);

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
    }, 8000);

    return () => clearInterval(interval);
  }, [poll?.id, poll?.status]);

  const handleSubmitAnswer = async (e) => {
    if (e) e.preventDefault();
    if (!currentQuestion || !participant) return;

    let answerText = '';
    if (currentQuestion.type === 'multiple_choice') {
      if (!selectedOption) {
        alert('Please select an option.');
        return;
      }
      answerText = selectedOption;
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
          <button className="btn btn-secondary" onClick={refreshPollState} style={{ marginTop: '1rem' }}>
            Refresh Now
          </button>
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
          <button className="btn btn-secondary" onClick={refreshPollState} style={{ marginTop: '1rem' }}>
            Check for Next Question
          </button>
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
            <div style={{ marginBottom: '2rem' }}>
              {(currentQuestion.options || []).map((option, idx) => {
                const letter = String.fromCharCode(65 + idx); // A, B, C, D...
                const isSelected = selectedOption === option;
                return (
                  <button
                    key={idx}
                    type="button"
                    className={`mc-option-button ${isSelected ? 'selected' : ''}`}
                    onClick={() => setSelectedOption(option)}
                    disabled={submitting}
                  >
                    <span style={{ fontWeight: 500 }}>{option}</span>
                    <span className="option-letter">{letter}</span>
                  </button>
                );
              })}
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
