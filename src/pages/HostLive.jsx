import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getPollById,
  getQuestionsForPoll,
  saveDraftQuestions,
  updatePoll,
  resetPollData,
  subscribeToParticipantsCount,
  subscribeToResponsesForQuestion,
  subscribeToAllResponses,
  updateLeaderboard,
  auth,
  hasValidConfig,
  syncHostAuthUid
} from '../lib/firebase';
import { getHostId } from '../utils';
import { ArrowLeft, Play, Square, RefreshCw, Users, Copy, Check, ChevronRight, ChevronLeft, Plus, Save, Monitor, ExternalLink, FileDown } from 'lucide-react';
import jsPDF from 'jspdf';

export default function HostLive() {
  const { id } = useParams();
  const navigate = useNavigate();
  const hostId = getHostId();

  const username = localStorage.getItem('pulsepoint_host_username');
  const phone = localStorage.getItem('pulsepoint_host_phone');

  const [poll, setPoll] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [responses, setResponses] = useState([]);
  const [allResponses, setAllResponses] = useState({});
  const [participantCount, setParticipantCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [savingDraft, setSavingDraft] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [questionSearch, setQuestionSearch] = useState('');
  const [draftQuestionIndex, setDraftQuestionIndex] = useState(0);
  const [questionCountdown, setQuestionCountdown] = useState(0);
  const [completedQIds, setCompletedQIds] = useState(new Set());
  const [showQR, setShowQR] = useState(false);
  const [projectorTab, setProjectorTab] = useState('home');
  const [projectorLbRange, setProjectorLbRange] = useState(-1);
  const [qTabSelectedQ, setQTabSelectedQ] = useState(null);
  const [responseNavInput, setResponseNavInput] = useState('');
  const questionTimerRef = useRef(null);
  // Keep a ref to the active question ID for the realtime channel callback
  const activeQuestionIdRef = useRef(null);
  // Tracks the most recently *started* question; prevents a late-firing timer from
  // resetting the projector back to banner after the host has already moved on.
  const activeStartedQIdRef = useRef(null);

  async function fetchPollAndQuestions() {
    try {
      setLoading(true);

      // 1. Fetch poll details and questions in parallel immediately!
      const [pollData, qData] = await Promise.all([
        getPollById(id), // Fetch poll details without enforcing host_id during DB read
        getQuestionsForPoll(id)
      ]);

      if (!pollData) {
        setErrorMessage('Poll not found.');
        navigate('/dashboard');
        return;
      }

      // 2. Resolve Auth details without blocking Firestore reads
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

      // 3. Verify host ownership after data and auth are both loaded
      if (pollData.host_id !== effectiveHostId && pollData.host_id !== hostId) {
        setErrorMessage('Unauthorized to manage this poll.');
        navigate('/dashboard');
        return;
      }

      setPoll(pollData);
      setDraftTitle(pollData.title || '');
      setQuestions(qData || []);

      // Determine current active question
      if (pollData.status === 'active' && pollData.current_question_id) {
        const activeQ = qData.find((q) => q.id === pollData.current_question_id);
        setCurrentQuestion(activeQ || qData[0] || null);
      } else if (qData.length > 0) {
        setCurrentQuestion(qData[0]);
      }
    } catch (err) {
      console.error(err);
      setErrorMessage('Failed to load host control screen.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!username || !phone) {
      navigate('/host/login');
      return;
    }
    syncHostAuthUid(username, phone);
  }, [username, phone, navigate]);

  useEffect(() => {
    if (username && phone) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchPollAndQuestions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, username, phone]);

  useEffect(() => {
    if (poll?.status === 'draft' && questions.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraftQuestionIndex(0);
    }
  }, [poll?.status, questions.length]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraftQuestionIndex(0);
  }, [questionSearch]);

  useEffect(() => {
    if (!poll) return;

    const unsubscribe = subscribeToParticipantsCount(poll.id, (count) => {
      setParticipantCount(count);
    });

    return () => {
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poll?.id]);

  useEffect(() => {
    if (!poll?.id) return;
    const unsub = subscribeToAllResponses(poll.id, setAllResponses);
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poll?.id]);

  useEffect(() => {
    if (!currentQuestion) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResponses([]);
      return;
    }

    activeQuestionIdRef.current = currentQuestion.id;

    const unsubscribe = subscribeToResponsesForQuestion(poll.id, currentQuestion.id, (respsList) => {
      setResponses(respsList);
    });

    return () => {
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQuestion?.id]);

  const handleAddQuestion = () => {
    const updated = [
      ...questions,
      { text: '', type: 'multiple_choice', options: ['Option 1', 'Option 2', 'Option 3'] }
    ];
    setQuestions(updated);
    setDraftQuestionIndex(updated.length - 1);
  };

  const handleRemoveQuestion = (index) => {
    const updated = questions.filter((_, idx) => idx !== index);
    setQuestions(updated);
    setDraftQuestionIndex((prev) => Math.max(0, Math.min(prev, updated.length - 1)));
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
      updated[index].options = ['Option 1', 'Option 2', 'Option 3'];
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
    if (!updated[qIndex].options || !Array.isArray(updated[qIndex].options)) {
      updated[qIndex].options = ['Option 1', 'Option 2', 'Option 3'];
      setQuestions(updated);
      return;
    }
    if (updated[qIndex].options.length >= 20) {
      setErrorMessage('Multiple choice questions can have up to 20 options.');
      return;
    }
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

  // const handleMoveQuestion = (index, direction) => {
  //   if (direction === 'up' && index === 0) return;
  //   if (direction === 'down' && index === questions.length - 1) return;
  // 
  //   const updated = [...questions];
  //   const swapIndex = direction === 'up' ? index - 1 : index + 1;
  //   [updated[index], updated[swapIndex]] = [updated[swapIndex], updated[index]];
  //   setQuestions(updated);
  // };

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
      // Find the index of the currently active question in the old questions list
      const currentIdx = currentQuestion ? questions.findIndex(q => q.id === currentQuestion.id) : -1;

      // saveDraftQuestions returns the freshly saved questions — no re-fetch needed
      const savedQuestions = await saveDraftQuestions(poll.id, draftTitle.trim(), questions);
      
      let newCurrentQuestion = null;
      if (savedQuestions.length > 0) {
        if (currentIdx !== -1 && currentIdx < savedQuestions.length) {
          newCurrentQuestion = savedQuestions[currentIdx];
        } else {
          newCurrentQuestion = savedQuestions[0];
        }
      }
      
      // If the poll is active and has a current_question_id, we need to update it in Firestore with the new ID
      if (poll.status === 'active' && poll.current_question_id) {
        const activeQIdx = questions.findIndex(q => q.id === poll.current_question_id);
        if (activeQIdx !== -1 && activeQIdx < savedQuestions.length) {
          const newActiveQId = savedQuestions[activeQIdx].id;
          await updatePoll(poll.id, { current_question_id: newActiveQId });
          setPoll({ ...poll, title: draftTitle.trim(), current_question_id: newActiveQId });
        } else {
          await updatePoll(poll.id, { current_question_id: null });
          setPoll({ ...poll, title: draftTitle.trim(), current_question_id: null });
        }
      } else {
        setPoll({ ...poll, title: draftTitle.trim() });
      }

      setQuestions(savedQuestions);
      setCurrentQuestion(newCurrentQuestion);

      setSaveMessage('Draft saved successfully.');
      setTimeout(() => setSaveMessage(''), 3000);
      return true;
    } catch (err) {
      console.error(err);
      setErrorMessage('Error saving draft changes.');
      return false;
    } finally {
      setSavingDraft(false);
    }
  };

  // When current question moves and it's the 10th, 20th, etc.:
  // save leaderboard and auto-switch projector to show that range leaderboard
  useEffect(() => {
    if (!currentQuestion || questions.length === 0 || !poll) return;
    const idx = questions.findIndex(q => q.id === currentQuestion.id);
    if (idx < 0) return;
    if ((idx + 1) % 10 === 0) {
      const rangeIdx = Math.floor(idx / 10);
      const projMode = `leaderboard_range_${rangeIdx}`;
      setTimeout(async () => {
        await updateLeaderboard(poll.id);
        await updatePoll(poll.id, { projector_mode: projMode });
        setPoll(prev => prev ? { ...prev, projector_mode: projMode } : prev);
      }, 600);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQuestion?.id]);

  const handleStartPoll = async () => {
    setErrorMessage('');
    if (questions.length === 0) {
      setErrorMessage('You must add questions to your poll before launching it.');
      return;
    }

    const saved = await handleSaveDraft();
    if (!saved) return;

    try {
      // Start session — reset projector to banner so stale projector_mode from a
      // previous run never leaks through before the host clicks "Start Question".
      await updatePoll(poll.id, {
        status: 'active',
        current_question_id: null,
        projector_mode: 'banner',
      });
      setPoll({ ...poll, status: 'active', current_question_id: null, projector_mode: 'banner' });
    } catch (err) {
      console.error(err);
      setErrorMessage('Failed to start poll. Please try again.');
    }
  };

  const clearQuestionTimer = () => {
    if (questionTimerRef.current) {
      clearInterval(questionTimerRef.current);
      questionTimerRef.current = null;
    }
    setQuestionCountdown(0);
  };

  const endQuestionOnServer = async (doneQId) => {
    try {
      if (doneQId) {
        setCompletedQIds((prev) => new Set([...prev, doneQId]));
      }
      // If the host already moved to a new question, don't reset projector back to banner.
      if (activeStartedQIdRef.current && activeStartedQIdRef.current !== doneQId) return;
      await updatePoll(poll.id, { current_question_id: null, projector_mode: 'banner' });
      setPoll((p) => ({ ...p, current_question_id: null, projector_mode: 'banner' }));
    } catch (err) {
      console.error(err);
    }
  };

  // Sync top 10 responses for a question
  async function saveTop10ResponsesForQuestion() {
    await updateLeaderboard(poll.id);
  }

  // Sync overall leaderboard to Firebase
  async function saveOverallLeaderboardToDb() {
    await updateLeaderboard(poll.id);
  }

  const startQuestionTimer = (questionData, seconds = 35) => {
    clearQuestionTimer();
    setQuestionCountdown(seconds);
    questionTimerRef.current = setInterval(() => {
      setQuestionCountdown((prev) => {
        if (prev <= 1) {
          clearQuestionTimer();
          if (questionData && questionData.id) {
            saveTop10ResponsesForQuestion(questionData.id);
          }
          endQuestionOnServer(questionData?.id);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleStartQuestion = async (q) => {
    if (!poll) return;
    activeStartedQIdRef.current = q.id; // set synchronously so endQuestionOnServer sees it immediately
    try {
      await updatePoll(poll.id, {
        current_question_id: q.id,
        projector_mode: 'question',
        projector_question_id: q.id,
      });
      setPoll(p => ({ ...p, current_question_id: q.id, projector_mode: 'question', projector_question_id: q.id }));
      setCurrentQuestion(q);
      setProjectorTab('question');
      setQTabSelectedQ(q);
      startQuestionTimer(q, 38);
    } catch (err) {
      console.error('Failed to start question:', err);
      setErrorMessage('Failed to start question.');
    }
  };

  const handleEndPoll = async () => {
    try {
      // Save overall leaderboard before ending
      await saveOverallLeaderboardToDb();

      await updatePoll(poll.id, {
        status: 'ended',
        current_question_id: null,
        projector_mode: 'banner',
      });
      setPoll({ ...poll, status: 'ended', current_question_id: null, projector_mode: 'banner' });
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
      await resetPollData(poll.id);

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
      await updatePoll(poll.id, { current_question_id: q.id });

      setPoll({ ...poll, current_question_id: q.id });
      setCurrentQuestion(q);
    } catch (err) {
      console.error(err);
      setErrorMessage('Failed to change active question.');
    }
  };

  const handleNextQuestion = () => {
    if (!currentQuestion) return;
    const currentIndex = questions.findIndex(q => q.id === currentQuestion.id);
    if (currentIndex < questions.length - 1) {
      const nextQ = questions[currentIndex + 1];
      // Start next question immediately (updates server and participants)
      handleStartQuestion(nextQ);
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

  const handleSetProjectorTab = async (tab) => {
    setProjectorTab(tab);
    if (!poll) return;
    let mode;
    const extra = {};
    if (tab === 'home') {
      mode = 'banner';
    } else if (tab === 'question') {
      const initQ = currentQuestion || questions[0] || null;
      if (initQ) setQTabSelectedQ(initQ);
      // Keep projector on banner until the host explicitly starts the first question.
      // Use allResponses so the guard survives a page reload (completedQIds is local only).
      const anyAnswered = questions.some(q => allResponses[q.id]?.length > 0);
      if (!poll.current_question_id && !anyAnswered) return;
      mode = 'question';
      if (initQ) extra.projector_question_id = initQ.id;
    } else if (tab === 'results') {
      mode = 'results';
      if (currentQuestion) {
        extra.projector_question_id = currentQuestion.id;
        const existing = poll.projector_reveals || {};
        if (!existing[currentQuestion.id]) {
          extra.projector_reveals = { ...existing, [currentQuestion.id]: (currentQuestion.options || []).map(() => false) };
        }
      }
    } else if (tab === 'leaderboard') {
      mode = projectorLbRange < 0 ? 'leaderboard_overall' : `leaderboard_range_${projectorLbRange}`;
      updateLeaderboard(poll.id).catch(() => {});
    }
    setPoll(p => ({ ...p, projector_mode: mode, ...extra }));
    updatePoll(poll.id, { projector_mode: mode, ...extra }).catch(console.error);
  };

  const handleToggleReveal = async (optionIndex) => {
    if (!currentQuestion || !poll) return;
    const qId = currentQuestion.id;
    const options = currentQuestion.options || [];
    const cur = (poll.projector_reveals || {})[qId] || options.map(() => false);
    const updated = [...cur];
    updated[optionIndex] = !updated[optionIndex];
    const updatedReveals = { ...(poll.projector_reveals || {}), [qId]: updated };
    setPoll(p => ({ ...p, projector_reveals: updatedReveals }));
    updatePoll(poll.id, { projector_reveals: updatedReveals }).catch(console.error);
  };

  const handleRevealNext = async () => {
    if (!currentQuestion || !poll) return;
    const qId = currentQuestion.id;
    const options = currentQuestion.options || [];
    const tallies = {};
    options.forEach(o => { tallies[o] = 0; });
    responses.forEach(r => {
      (r.answer || '').split(',').map(s => s.trim()).filter(Boolean).forEach(a => {
        if (tallies[a] !== undefined) tallies[a]++;
      });
    });
    const sorted = options.slice().sort((a, b) => {
      const diff = (tallies[b] || 0) - (tallies[a] || 0);
      return diff !== 0 ? diff : options.indexOf(a) - options.indexOf(b);
    });
    const cur = (poll.projector_reveals || {})[qId] || options.map(() => false);
    const displayCount = Math.min(sorted.length, 10);
    for (let pos = displayCount - 1; pos >= 0; pos--) {
      const optIdx = options.indexOf(sorted[pos]);
      if (optIdx >= 0 && !cur[optIdx]) {
        const updated = [...cur];
        updated[optIdx] = true;
        const updatedReveals = { ...(poll.projector_reveals || {}), [qId]: updated };
        setPoll(p => ({ ...p, projector_reveals: updatedReveals }));
        await updatePoll(poll.id, { projector_reveals: updatedReveals });
        return;
      }
    }
  };

  const handleHideAllReveals = async () => {
    if (!currentQuestion || !poll) return;
    const qId = currentQuestion.id;
    const options = currentQuestion.options || [];
    const updatedReveals = { ...(poll.projector_reveals || {}), [qId]: options.map(() => false) };
    setPoll(p => ({ ...p, projector_reveals: updatedReveals }));
    await updatePoll(poll.id, { projector_reveals: updatedReveals });
  };

  const handleQTabSelectQuestion = (q) => {
    // Navigator is host-view only — never touches Firestore/projector.
    // The projector is driven exclusively by Start Question / Next buttons.
    setQTabSelectedQ(q);
  };

  // Helper calculation for MC Responses
  const renderMCResults = () => {
    if (!currentQuestion) return null;
    const totalVotes = responses.length;
    const options = currentQuestion.options || [];

    // Tally answers allowing multi-select responses
    const tallies = {};
    options.forEach(opt => { tallies[opt] = 0; });
    responses.forEach(r => {
      const answers = (r.answer || '').split(',').map((part) => part.trim()).filter(Boolean);
      answers.forEach((answerPart) => {
        if (tallies[answerPart] !== undefined) {
          tallies[answerPart] += 1;
        }
      });
    });

    // Sort options by votes desc; tie-break by original CSV order
    const sortedOptions = options.slice().sort((a, b) => {
      const da = tallies[a] || 0;
      const db = tallies[b] || 0;
      if (db !== da) return db - da;
      return options.indexOf(a) - options.indexOf(b);
    });

    return (
      <div className="results-container">
        {sortedOptions.map((opt, idx) => {
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

  const renderForQ = (q, resps) => {
    if (!q) return null;
    if (q.type === 'multiple_choice') {
      const opts = q.options || [];
      const tallies = {};
      opts.forEach(o => { tallies[o] = 0; });
      resps.forEach(r => {
        (r.answer || '').split(',').map(s => s.trim()).filter(Boolean).forEach(a => {
          if (tallies[a] !== undefined) tallies[a]++;
        });
      });
      const totalVotes = resps.length;
      const sortedOpts = opts.slice().sort((a, b) => {
        const diff = (tallies[b] || 0) - (tallies[a] || 0);
        return diff !== 0 ? diff : opts.indexOf(a) - opts.indexOf(b);
      });
      return (
        <div className="results-container">
          {sortedOpts.map((opt, idx) => {
            const votes = tallies[opt] || 0;
            const pct = totalVotes > 0 ? Math.round(votes / totalVotes * 100) : 0;
            return (
              <div className="result-bar-wrapper" key={idx}>
                <div className="result-bar-header">
                  <span className="result-bar-label">{opt}</span>
                  <span className="result-bar-stats">{votes} vote{votes !== 1 ? 's' : ''} ({pct}%)</span>
                </div>
                <div className="result-bar-bg">
                  <div className="result-bar-fill" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      );
    }
    if (q.type === 'rating') {
      const totalVotes = resps.length;
      let sum = 0;
      const rTallies = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      resps.forEach(r => {
        const val = parseInt(r.answer, 10);
        if (!isNaN(val)) { sum += val; rTallies[val] = (rTallies[val] || 0) + 1; }
      });
      const avg = totalVotes > 0 ? (sum / totalVotes).toFixed(1) : '0.0';
      return (
        <div className="rating-result-grid">
          <div className="rating-avg-card">
            <span className="rating-avg-number">{avg}</span>
            <span className="rating-avg-stars">{'★'.repeat(Math.round(parseFloat(avg)))}{'☆'.repeat(5 - Math.round(parseFloat(avg)))}</span>
            <p style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>Based on {totalVotes} response{totalVotes !== 1 ? 's' : ''}</p>
          </div>
          <div className="results-container" style={{ margin: 0 }}>
            {[5, 4, 3, 2, 1].map(stars => {
              const count = rTallies[stars] || 0;
              const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
              return (
                <div className="result-bar-wrapper" key={stars}>
                  <div className="result-bar-header" style={{ fontSize: '0.85rem' }}>
                    <span className="result-bar-label" style={{ color: 'var(--text-secondary)' }}>{stars} Star{stars !== 1 ? 's' : ''}</span>
                    <span className="result-bar-stats">{count} ({pct}%)</span>
                  </div>
                  <div className="result-bar-bg" style={{ height: '12px' }}>
                    <div className="result-bar-fill" style={{ width: `${pct}%`, background: 'var(--color-accent)' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
    }
    if (q.type === 'open_text') {
      if (resps.length === 0) return <div style={{ textAlign: 'center', color: 'var(--text-muted)', margin: '3rem 0' }}>Waiting for text responses...</div>;
      return (
        <div className="text-responses-grid">
          {resps.map(resp => (
            <div className="text-response-card" key={resp.id}>
              <p style={{ color: 'var(--text-primary)', fontStyle: 'italic' }}>"{resp.answer}"</p>
              <div className="text-response-author">— {resp.participants ? resp.participants.name : 'Anonymous'}</div>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  const downloadQuestionPDF = (q, resps, qNum) => {
    const doc = new jsPDF();
    const margin = 14;
    let y = 20;

    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text(poll.title || 'Pulse Point', margin, y);
    y += 10;

    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100);
    const top10Count = q.type === 'rating' ? Math.min(resps.length, 5) : Math.min(resps.length, 10);
    doc.text(`Question ${qNum}  ·  ${q.type.replace('_', ' ')}  ·  Top ${top10Count} of ${resps.length} response${resps.length !== 1 ? 's' : ''}`, margin, y);
    y += 8;

    doc.setDrawColor(200);
    doc.line(margin, y, 196, y);
    y += 8;

    doc.setFontSize(13);
    doc.setTextColor(0);
    doc.setFont('helvetica', 'bold');
    const qLines = doc.splitTextToSize(q.text || '', 180);
    doc.text(qLines, margin, y);
    y += qLines.length * 7 + 6;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);

    if (q.type === 'multiple_choice') {
      const opts = q.options || [];
      const tallies = {};
      opts.forEach(o => { tallies[o] = 0; });
      resps.forEach(r => {
        (r.answer || '').split(',').map(s => s.trim()).filter(Boolean).forEach(a => {
          if (tallies[a] !== undefined) tallies[a]++;
        });
      });
      const sorted = opts.slice().sort((a, b) => (tallies[b] || 0) - (tallies[a] || 0)).slice(0, 10);
      sorted.forEach((opt, idx) => {
        if (y > 270) { doc.addPage(); y = 20; }
        const votes = tallies[opt] || 0;
        const pct = resps.length > 0 ? Math.round(votes / resps.length * 100) : 0;
        doc.setFont('helvetica', 'bold');
        doc.text(`#${idx + 1}`, margin, y);
        doc.setFont('helvetica', 'normal');
        const optLines = doc.splitTextToSize(opt, 140);
        doc.text(optLines, margin + 12, y);
        doc.text(`${votes} (${pct}%)`, 170, y, { align: 'right' });
        y += optLines.length * 6 + 3;
      });
    } else if (q.type === 'rating') {
      let sum = 0;
      const rt = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      resps.forEach(r => { const v = parseInt(r.answer, 10); if (!isNaN(v)) { sum += v; rt[v] = (rt[v] || 0) + 1; } });
      const avg = resps.length > 0 ? (sum / resps.length).toFixed(1) : '0.0';
      doc.setFont('helvetica', 'bold');
      doc.text(`Average: ${avg} / 5`, margin, y); y += 8;
      doc.setFont('helvetica', 'normal');
      [5, 4, 3, 2, 1].forEach(stars => {
        if (y > 270) { doc.addPage(); y = 20; }
        const count = rt[stars] || 0;
        const pct = resps.length > 0 ? Math.round(count / resps.length * 100) : 0;
        doc.text(`${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}  ${count} response${count !== 1 ? 's' : ''} (${pct}%)`, margin, y);
        y += 7;
      });
    } else {
      resps.slice(0, 10).forEach((r, idx) => {
        if (y > 270) { doc.addPage(); y = 20; }
        const name = r.participants ? r.participants.name : 'Anonymous';
        doc.setFont('helvetica', 'bold');
        doc.text(`${idx + 1}.`, margin, y);
        doc.setFont('helvetica', 'normal');
        const lines = doc.splitTextToSize(`"${r.answer}"  — ${name}`, 168);
        doc.text(lines, margin + 8, y);
        y += lines.length * 6 + 3;
      });
    }

    doc.save(`Q${qNum}-responses.pdf`);
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', margin: '4rem 0' }}>
        <div className="spinner" style={{ width: '40px', height: '40px' }}></div>
      </div>
    );
  }

  if (!poll) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '4rem 0', gap: '1rem' }}>
        <p style={{ color: 'var(--text-secondary)' }}>{errorMessage || 'Poll not found or unauthorized.'}</p>
        <button className="btn btn-secondary" onClick={() => navigate('/dashboard')}>Back to Dashboard</button>
      </div>
    );
  }

  const currentIndex = questions.findIndex(q => q.id === currentQuestion?.id);
  // Always resolve effectiveQ to an object that IS in the current questions array.
  // Stale refs (e.g. after a save that re-issues Firestore IDs) would otherwise give effectiveIdx = -1.
  const effectiveQ = (() => {
    const pref = qTabSelectedQ || currentQuestion;
    if (pref?.id) {
      const matched = questions.find(q => q.id === pref.id);
      if (matched) return matched;
    }
    return questions[0] || null;
  })();
  const effectiveIdx = effectiveQ ? questions.findIndex(q => q.id === effectiveQ.id) : -1;
  const isEffectiveLive = !!(effectiveQ && poll.current_question_id === effectiveQ.id);
  const effectiveResps = isEffectiveLive ? responses : (effectiveQ ? (allResponses[effectiveQ.id] || []) : []);

  const filteredQuestions = questions
    .map((q, idx) => ({ ...q, questionNumber: idx + 1, originalIndex: idx }))
    .filter((q) => {
      const search = questionSearch.trim();
      if (!search) return true;
      
      const searchLower = search.toLowerCase();
      const optionText = (q.options || []).join(' ').toLowerCase();
      
      // Check for format like "95" where 9 = question 9, 5 = option 5
      const isNumericSearch = /^\d+$/.test(search);
      if (isNumericSearch && search.length >= 2) {
        const questionNum = parseInt(search.slice(0, -1), 10);
        const optionNum = parseInt(search.slice(-1), 10);
        
        // Match question number and option index
        const hasMatchingOption = (q.options || []).some((opt, idx) => 
          idx + 1 === optionNum && q.questionNumber === questionNum
        );
        
        if (q.questionNumber === questionNum && hasMatchingOption) {
          return true;
        }
      }
      
      // Original filter logic
      return (
        q.text?.toLowerCase().includes(searchLower) ||
        String(q.questionNumber).includes(search) ||
        optionText.includes(searchLower)
      );
    });

  // Response Navigator computed values
  const respNavNum = parseInt(responseNavInput.trim(), 10);
  const isValidRespNav = !isNaN(respNavNum) && respNavNum >= 1;
  const respNavQIdx = isValidRespNav ? Math.floor((respNavNum - 1) / 10) : -1;
  const respNavRIdx = isValidRespNav ? (respNavNum - 1) % 10 : -1;
  const respNavQ = respNavQIdx >= 0 && respNavQIdx < questions.length ? questions[respNavQIdx] : null;
  const respNavResps = respNavQ ? (allResponses[respNavQ.id] || []) : [];
  const respNavQNum = respNavQIdx + 1;

  // Build the ordered top-10 list for the response navigator
  const getRespNavRows = (q, resps) => {
    if (!q) return [];
    if (q.type === 'multiple_choice') {
      const opts = q.options || [];
      const tallies = {};
      opts.forEach(o => { tallies[o] = 0; });
      resps.forEach(r => {
        (r.answer || '').split(',').map(s => s.trim()).filter(Boolean).forEach(a => {
          if (tallies[a] !== undefined) tallies[a]++;
        });
      });
      return opts.slice().sort((a, b) => (tallies[b] || 0) - (tallies[a] || 0)).slice(0, 10).map(opt => ({
        label: opt,
        sub: `${tallies[opt] || 0} vote${tallies[opt] !== 1 ? 's' : ''}`
      }));
    }
    if (q.type === 'rating') {
      const rt = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      resps.forEach(r => { const v = parseInt(r.answer, 10); if (!isNaN(v)) rt[v] = (rt[v] || 0) + 1; });
      return [5, 4, 3, 2, 1].map(stars => ({
        label: `${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}`,
        sub: `${rt[stars] || 0} response${rt[stars] !== 1 ? 's' : ''}`
      }));
    }
    return resps.slice(0, 10).map(r => ({
      label: r.answer || '(empty)',
      sub: r.participants ? r.participants.name : 'Anonymous'
    }));
  };

  return (
    <div>
      {/* Top action bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <button className="btn btn-secondary" onClick={() => navigate('/dashboard')}>
          <ArrowLeft size={16} /> Back to Dashboard
        </button>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
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

      {/* Sticky top section — join banner + projector controls */}
      <div style={{ position: 'sticky', top: '64px', zIndex: 90, background: 'var(--bg-dark, #f1f5f9)', paddingBottom: '0.25rem' }}>

      {/* Join Info Banner + participation count */}
      <div className="join-banner" style={{ marginBottom: showQR ? '0' : '0.75rem', borderRadius: showQR ? 'var(--radius-lg) var(--radius-lg) 0 0' : undefined }}>
        <div className="join-banner-info">
          <h2>Audience Join Link</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span className="join-banner-link">{window.location.origin}/join/{poll.join_code}</span>
            <button className="btn btn-secondary btn-sm" onClick={handleCopyLink} style={{ padding: '0.4rem 0.6rem' }}>
              {copied ? <Check size={14} color="var(--color-success)" /> : <Copy size={14} />}
            </button>
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <h2>Join Code</h2>
          <span className="join-banner-code">{poll.join_code}</span>
        </div>
        <div style={{ textAlign: 'center', borderLeft: '1px solid var(--border-color)', paddingLeft: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', justifyContent: 'center', marginBottom: '0.15rem' }}>
            <Users size={13} color="var(--color-accent)" />
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Connected</span>
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 800, lineHeight: 1 }}>{participantCount}</div>
          <button className="btn btn-secondary btn-sm" style={{ marginTop: '0.4rem', fontSize: '0.7rem', padding: '0.18rem 0.55rem' }}
            onClick={() => setShowQR(v => !v)}>
            {showQR ? '✕ Hide QR' : '📱 QR'}
          </button>
        </div>
      </div>
      {showQR && (
        <div style={{ marginBottom: '0.75rem', padding: '1rem', background: 'var(--bg-card,#fff)', borderRadius: '0 0 var(--radius-lg) var(--radius-lg)', textAlign: 'center', border: '1px solid var(--border-color)', borderTop: 'none' }}>
          <img
            src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(`${window.location.origin}/join/${poll.join_code}`)}&bgcolor=ffffff&color=000000&margin=10`}
            alt="QR" style={{ width: '200px', borderRadius: '8px', border: '1px solid var(--border-color)' }}
          />
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
            Scan to join · Code: <strong style={{ color: 'var(--color-primary)' }}>{poll.join_code}</strong>
          </p>
        </div>
      )}

      {/* Projector Controls */}
      <div className="glass-card" style={{ padding: '1rem 1.25rem', marginBottom: projectorTab === 'question' ? '0.6rem' : '1.5rem' }}>
        {/* Tab bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: projectorTab !== 'home' ? '0.9rem' : 0, flexWrap: 'wrap' }}>
          <Monitor size={15} color="var(--color-accent)" style={{ flexShrink: 0 }} />
          <div style={{ display: 'flex', gap: '0.3rem', flex: 1, flexWrap: 'wrap' }}>
            {[['home','Home'],['question','Question'],['results','Results'],['leaderboard','Leaderboard']].map(([id2, label]) => (
              <button key={id2} className={`btn btn-sm ${projectorTab === id2 ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontSize: '0.8rem', padding: '0.28rem 0.7rem' }}
                onClick={() => handleSetProjectorTab(id2)}>
                {label}
              </button>
            ))}
          </div>
          <button className="btn btn-sm btn-secondary"
            onClick={() => window.open(`/polls/${id}/projector`, '_blank')}
            style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexShrink: 0, fontSize: '0.8rem' }}>
            <ExternalLink size={12} /> Open Screen
          </button>
        </div>

        {/* Question tab — numbered buttons only; detail card shown below */}
        {projectorTab === 'question' && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.28rem', alignContent: 'flex-start', maxHeight: '136px', overflowY: 'auto' }}>
            {questions.map((q, idx) => {
              const isLive = poll.current_question_id === q.id;
              const isDone = completedQIds.has(q.id);
              const isSel = effectiveQ?.id === q.id;
              const canClick = isLive || isDone;
              return (
                <button key={q.id} title={q.text}
                  onClick={() => canClick ? handleQTabSelectQuestion(q) : undefined}
                  style={{ width: '46px', height: '42px', borderRadius: '10px', padding: '2px 4px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1px', fontWeight: 700, transition: 'all 0.12s', cursor: canClick ? 'pointer' : 'default', background: isSel ? '#2B5FD9' : isLive ? 'rgba(220,42,60,0.07)' : isDone ? 'rgba(34,197,94,0.08)' : 'var(--bg-card,#fff)', color: isSel ? '#fff' : isLive ? '#DC2A3C' : isDone ? '#16A34A' : 'var(--text-muted)', border: `1.5px solid ${isSel ? '#2B5FD9' : isLive ? '#DC2A3C' : isDone ? '#16A34A' : 'var(--border-color)'}`, opacity: !canClick && !isSel ? 0.28 : 1, boxShadow: isSel ? '0 2px 8px rgba(43,95,217,0.25)' : 'none' }}>
                  <span style={{ fontSize: '0.82rem', lineHeight: 1 }}>{idx + 1}</span>
                  {isLive  && <span style={{ fontSize: '0.42rem', lineHeight: 1, letterSpacing: '0.04em' }}>LIVE</span>}
                  {isDone && !isLive && !isSel && <span style={{ fontSize: '0.42rem', lineHeight: 1 }}>DONE</span>}
                  {isSel  && !isLive && <span style={{ fontSize: '0.42rem', lineHeight: 1, opacity: 0.7 }}>SEL</span>}
                </button>
              );
            })}
          </div>
        )}

        {/* Results tab */}
        {projectorTab === 'results' && (() => {
          if (!currentQuestion) return <p style={{ fontSize: '0.83rem', color: 'var(--text-secondary)' }}>No question selected.</p>;
          if (currentQuestion.type !== 'multiple_choice') return <p style={{ fontSize: '0.83rem', color: 'var(--text-secondary)' }}>Results reveal works for multiple choice questions.</p>;
          const options = currentQuestion.options || [];
          const tallies = {};
          options.forEach(o => { tallies[o] = 0; });
          responses.forEach(r => {
            (r.answer || '').split(',').map(s => s.trim()).filter(Boolean).forEach(a => {
              if (tallies[a] !== undefined) tallies[a]++;
            });
          });
          const totalVotes = responses.length;
          const sortedOpts = options.slice().sort((a, b) => {
            const diff = (tallies[b] || 0) - (tallies[a] || 0);
            return diff !== 0 ? diff : options.indexOf(a) - options.indexOf(b);
          });
          const qId = currentQuestion.id;
          const reveals = (poll.projector_reveals || {})[qId] || options.map(() => false);
          const revealCount = reveals.filter(Boolean).length;
          return (
            <div>
              <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '0.65rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', flex: 1 }}>
                  <strong>Q{currentIndex + 1}</strong> · {revealCount}/{Math.min(sortedOpts.length, 10)} revealed
                </span>
                <button className="btn btn-sm btn-success" onClick={handleRevealNext} disabled={revealCount >= Math.min(sortedOpts.length, 10)} style={{ fontSize: '0.78rem' }}>
                  Reveal Next #{revealCount + 1}
                </button>
                <button className="btn btn-sm btn-secondary" onClick={handleHideAllReveals} disabled={revealCount === 0} style={{ fontSize: '0.78rem' }}>
                  Hide All
                </button>
              </div>
              {sortedOpts.slice(0, 10).map((opt, rankPos) => {
                const optIdx = options.indexOf(opt);
                const votes = tallies[opt] || 0;
                const pct = totalVotes > 0 ? Math.round(votes / totalVotes * 100) : 0;
                const isRevealed = reveals[optIdx] === true;
                return (
                  <div key={opt} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.38rem 0.6rem', marginBottom: '0.22rem', borderRadius: '8px', background: isRevealed ? 'rgba(34,197,94,0.05)' : 'rgba(0,0,0,0.02)', border: `1px solid ${isRevealed ? 'rgba(34,197,94,0.2)' : 'var(--border-color)'}` }}>
                    <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', width: '18px', flexShrink: 0 }}>#{rankPos + 1}</span>
                    <span style={{ flex: 1, fontSize: '0.82rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{opt}</span>
                    <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--color-accent)', flexShrink: 0 }}>{votes} ({pct}%)</span>
                    <button className={`btn btn-sm ${isRevealed ? 'btn-secondary' : 'btn-success'}`}
                      style={{ padding: '0.15rem 0.45rem', fontSize: '0.7rem', flexShrink: 0 }}
                      onClick={() => handleToggleReveal(optIdx)}>
                      {isRevealed ? 'Hide' : 'Reveal'}
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* Leaderboard tab */}
        {projectorTab === 'leaderboard' && (
          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
            <button className={`btn btn-sm ${projectorLbRange === -1 ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: '0.78rem' }}
              onClick={() => {
                setProjectorLbRange(-1);
                updateLeaderboard(poll.id).catch(() => {});
                const m = 'leaderboard_overall';
                setPoll(p => ({ ...p, projector_mode: m }));
                updatePoll(poll.id, { projector_mode: m }).catch(console.error);
              }}>Overall</button>
            {Array.from({ length: Math.ceil(questions.length / 10) }, (_, i) => (
              <button key={i} className={`btn btn-sm ${projectorLbRange === i ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: '0.78rem' }}
                onClick={() => {
                  setProjectorLbRange(i);
                  updateLeaderboard(poll.id).catch(() => {});
                  const m = `leaderboard_range_${i}`;
                  setPoll(p => ({ ...p, projector_mode: m }));
                  updatePoll(poll.id, { projector_mode: m }).catch(console.error);
                }}>
                Q{i * 10 + 1}–{Math.min((i + 1) * 10, questions.length)}
              </button>
            ))}
          </div>
        )}
      </div>
      </div>{/* /sticky wrapper */}

      {/* Home tab — status info card */}
      {projectorTab === 'home' && poll.status !== 'draft' && (
        <div className="glass-card" style={{ padding: '2rem', marginBottom: '1.5rem', textAlign: 'center' }}>
          <h3 style={{ marginBottom: '0.55rem' }}>Event banner is on screen</h3>
          <p style={{ color: 'var(--text-secondary)', maxWidth: '500px', margin: '0 auto', lineHeight: 1.6 }}>
            The projector shows the <strong>{poll.title}</strong> banner with the join link, and players see the waiting screen. Switch to <strong>Question</strong> when you&apos;re ready to play.
          </p>
        </div>
      )}

      {/* Layout Split — visible for Question tab only */}
      {projectorTab === 'question' && (
      <div className="live-layout">

        {/* Main projection pane */}
        <div className="glass-card" style={{ padding: '2.5rem' }}>
          {poll.status === 'draft' ? (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', gap: '1rem' }}>
                <div>
                  <h2 style={{ margin: 0 }}>Edit Event Title &amp; Questions</h2>
                  <p style={{ margin: '0.5rem 0 0', color: 'var(--text-secondary)' }}>
                    Add questions, then launch the live session when ready.
                  </p>
                </div>
                <button className="btn btn-success" style={{ flexShrink: 0 }} onClick={handleStartPoll} disabled={questions.length === 0 || savingDraft || loading}>
                  <Play size={16} /> Start Poll Session
                </button>
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

              {/* CSV import placed directly under Event Title for quick bulk add */}
              <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={async (e) => {
                    const f = e.target.files && e.target.files[0];
                    if (!f) return;
                    try {
                      const text = await f.text();
                      const lines = text.split(/\r?\n/).filter(Boolean);
                      const parsed = lines.map((ln) => {
                        // naive CSV split on commas (preserves all options)
                        const cols = ln.split(',').map(c => c.trim());
                        const qText = cols[0] || '';
                        const opts = cols.slice(1).map(o => o.trim()).filter(Boolean);
                        return { text: qText, type: opts.length ? 'multiple_choice' : 'open_text', options: opts.length ? opts : [] };
                      });
                      setQuestions(parsed);
                      setDraftQuestionIndex(0);
                    } catch (err) {
                      console.error('Failed to parse CSV', err);
                      setErrorMessage('Failed to parse CSV file.');
                    }
                  }} />
                  <button className="btn btn-secondary" onClick={(e) => { const input = e.currentTarget.previousSibling; input && input.click(); }}>
                    Import CSV
                  </button>
                </label>
                <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Or add questions manually below.</div>
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
              ) : filteredQuestions.length === 0 ? (
                <div style={{ padding: '1.5rem', border: '1px dashed var(--border-color)', borderRadius: '16px', color: 'var(--text-secondary)' }}>
                  No matching questions found. Try a different search term.
                </div>
              ) : (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                    <div>
                      <span className="question-number">Question {draftQuestionIndex + 1} of {filteredQuestions.length}</span>
                      <p style={{ margin: '0.25rem 0 0', color: 'var(--text-secondary)' }}>
                        Showing one question at a time for easier editing.
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setDraftQuestionIndex((prev) => Math.max(prev - 1, 0))}
                        disabled={draftQuestionIndex === 0}
                      >
                        <ChevronLeft size={14} /> Previous
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setDraftQuestionIndex((prev) => Math.min(prev + 1, filteredQuestions.length - 1))}
                        disabled={draftQuestionIndex === filteredQuestions.length - 1}
                      >
                        Next <ChevronRight size={14} />
                      </button>
                    </div>
                  </div>

                  <div className="question-card" style={{ padding: '1.5rem', borderRadius: '18px', border: '1px solid var(--border-color)', marginBottom: '1.5rem' }}>
                    {(() => {
                      const currentDraftQuestion = filteredQuestions[draftQuestionIndex];
                      if (!currentDraftQuestion) return null;
                      return (
                        <>
                          <div className="question-card-header" style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span className="question-number">Question {currentDraftQuestion.questionNumber}</span>
                            <button
                              type="button"
                              className="btn btn-danger btn-sm"
                              onClick={() => handleRemoveQuestion(currentDraftQuestion.originalIndex)}
                              disabled={savingDraft || loading}
                              style={{ padding: '0.25rem 0.5rem' }}
                            >
                              <Square size={14} /> Remove
                            </button>
                          </div>

                          <div className="form-group">
                            <label className="form-label">Question Text</label>
                            <input
                              type="text"
                              className="form-input"
                              placeholder="Enter your question"
                              value={currentDraftQuestion.text}
                              onChange={(e) => handleQuestionTextChange(currentDraftQuestion.originalIndex, e.target.value)}
                              disabled={savingDraft || loading}
                            />
                          </div>

                          <div className="form-group">
                            <label className="form-label">Question Type</label>
                            <select
                              className="form-select"
                              value={currentDraftQuestion.type}
                              onChange={(e) => handleQuestionTypeChange(currentDraftQuestion.originalIndex, e.target.value)}
                              disabled={savingDraft || loading}
                            >
                              <option value="multiple_choice">Multiple Choice</option>
                              <option value="open_text">Open Text</option>
                              <option value="rating">Rating</option>
                            </select>
                          </div>

                          {currentDraftQuestion.type === 'multiple_choice' && (
                            <div className="question-options-editor">
                              <label className="form-label" style={{ fontSize: '0.85rem' }}>Options</label>
                              {currentDraftQuestion.options.map((option, oIndex) => (
                                <div className="option-row" key={oIndex}>
                                  <input
                                    type="text"
                                    className="form-input"
                                    style={{ flex: 1, padding: '0.5rem 0.75rem', fontSize: '0.9rem' }}
                                    value={option}
                                    onChange={(e) => handleOptionChange(currentDraftQuestion.originalIndex, oIndex, e.target.value)}
                                    disabled={savingDraft || loading}
                                  />
                                  <button
                                    type="button"
                                    className="btn btn-danger btn-sm"
                                    onClick={() => handleRemoveOption(currentDraftQuestion.originalIndex, oIndex)}
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
                                onClick={() => handleAddOption(currentDraftQuestion.originalIndex)}
                                disabled={currentDraftQuestion.options.length >= 20 || savingDraft || loading}
                              >
                                <Plus size={12} /> Add Option
                              </button>
                              {currentDraftQuestion.options.length >= 20 && (
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
                                  Maximum of 20 options per question.
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>

                  <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
                    <button
                      className="btn btn-secondary"
                      onClick={() => setDraftQuestionIndex((prev) => Math.max(prev - 1, 0))}
                      disabled={draftQuestionIndex === 0}
                    >
                      <ChevronLeft size={16} /> Previous Question
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={() => setDraftQuestionIndex((prev) => Math.min(prev + 1, filteredQuestions.length - 1))}
                      disabled={draftQuestionIndex === filteredQuestions.length - 1}
                    >
                      Next Question <ChevronRight size={16} />
                    </button>
                  </div>

                  <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                      <input type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={async (e) => {
                        const f = e.target.files && e.target.files[0];
                        if (!f) return;
                        try {
                          const text = await f.text();
                          const lines = text.split(/\r?\n/).filter(Boolean);
                          const parsed = lines.map((ln) => {
                            // naive CSV split on commas
                            const cols = ln.split(',').map(c => c.trim());
                            const qText = cols[0] || '';
                            const opts = cols.slice(1).map(o => o.trim()).filter(Boolean);
                            return { text: qText, type: opts.length ? 'multiple_choice' : 'open_text', options: opts.length ? opts : [] };
                          });
                          // Replace current draft with imported CSV questions.
                          // If the existing draft contains only a placeholder empty question, it will be overwritten.
                          setQuestions(parsed);
                          setDraftQuestionIndex(0);
                          setSaveMessage(`Imported ${parsed.length} question${parsed.length !== 1 ? 's' : ''}.`);
                          setTimeout(() => setSaveMessage(''), 3000);
                        } catch (err) {
                          console.error('Failed to parse CSV', err);
                          setErrorMessage('Failed to parse CSV file.');
                        }
                      }} />
                      <button className="btn btn-secondary" onClick={(e) => { const input = e.currentTarget.previousSibling; input && input.click(); }}>
                        Import CSV
                      </button>
                    </label>
                    <button className="btn btn-secondary" onClick={handleSaveDraft} disabled={savingDraft || loading}>
                      <Save size={16} /> Save Draft
                    </button>
                  </div>

                  {saveMessage && (
                    <div style={{ marginTop: '1rem', color: 'var(--color-success)', fontWeight: 600 }}>
                      {saveMessage}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : effectiveQ ? (
            <div>
              {poll.status === 'ended' && (
                <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', borderRadius: '12px', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', color: 'var(--color-success)', fontSize: '0.88rem' }}>
                  <strong>Session ended.</strong> You can still review responses for any question.
                </div>
              )}
              {/* Top row: timer / start | responses | prev/next nav */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  {isEffectiveLive && questionCountdown > 0 && (
                    <div style={{ padding: '0.4rem 0.75rem', borderRadius: '10px', background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.2)', fontWeight: 700, fontSize: '0.9rem', color: 'var(--color-primary)' }}>
                      ⏱ {questionCountdown}s
                    </div>
                  )}
                  {/* Start Question — only for Q1, only before it has been answered */}
                  {poll.status === 'active' && !poll.current_question_id && effectiveIdx === 0 && !(allResponses[effectiveQ?.id]?.length > 0) && (
                    <button className="btn btn-success btn-sm" onClick={() => handleStartQuestion(effectiveQ)}>
                      <Play size={14} /> Start Question
                    </button>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.35rem 0.75rem', borderRadius: '20px', background: 'rgba(8,145,178,0.06)', border: '1px solid var(--border-color)', fontSize: '0.85rem', fontWeight: 600 }}>
                    <Users size={14} color="var(--color-accent)" />
                    {effectiveResps.length} response{effectiveResps.length !== 1 ? 's' : ''}
                  </div>
                  {/* Prev / Next navigation — Next actually starts the next question */}
                  <div style={{ display: 'flex', gap: '0.25rem' }}>
                    <button className="btn btn-secondary btn-sm" style={{ padding: '0.3rem 0.55rem' }}
                      onClick={() => effectiveIdx > 0 && handleQTabSelectQuestion(questions[effectiveIdx - 1])}
                      disabled={effectiveIdx <= 0} title="Previous question (view only)">
                      <ChevronLeft size={14} />
                    </button>
                    <button className="btn btn-success btn-sm"
                      onClick={() => effectiveIdx < questions.length - 1 && handleStartQuestion(questions[effectiveIdx + 1])}
                      disabled={effectiveIdx >= questions.length - 1 || poll.status !== 'active'}>
                      Next <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Question heading */}
              <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem', marginBottom: '1.5rem' }}>
                <span className="question-number">Question {effectiveIdx + 1} of {questions.length}</span>
                <h2 style={{ marginTop: '0.35rem', marginBottom: 0 }}>{effectiveQ.text}</h2>
              </div>

              {/* Results visualisation */}
              {renderForQ(effectiveQ, effectiveResps)}

            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--text-secondary)' }}>No questions yet.</div>
          )}
        </div>

        {/* Sidebar — Questions Navigator */}
        <div className="live-sidebar">
          <div className="glass-card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.85rem', flex: 1 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              <h3 style={{ fontSize: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem', margin: 0 }}>Questions Navigator</h3>
              <input
                type="search"
                className="form-input"
                placeholder="Search question…"
                value={questionSearch}
                onChange={(e) => setQuestionSearch(e.target.value)}
                style={{ width: '100%', fontSize: '0.85rem' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', overflowY: 'auto', maxHeight: '420px' }}>
              {filteredQuestions.length === 0 ? (
                <div style={{ padding: '1rem', border: '1px dashed var(--border-color)', borderRadius: '16px', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                  No matching questions found.
                </div>
              ) : (
                filteredQuestions.map((q) => {
                  const isViewing = q.id === effectiveQ?.id;
                  const isLiveQ = q.id === currentQuestion?.id && !!poll.current_question_id;
                  const hasResponses = (allResponses[q.id]?.length ?? 0) > 0;
                  const isPollInteractive = poll.status === 'active' || poll.status === 'ended';
                  return (
                    <button
                      key={q.id}
                      className={`live-nav-btn ${isViewing ? 'active' : ''}`}
                      onClick={() => handleQTabSelectQuestion(q)}
                      disabled={!isPollInteractive || !hasResponses}
                      title={!hasResponses ? 'No responses yet — start this question to enable' : ''}
                      style={{ padding: '0.65rem 0.85rem' }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', fontWeight: 700 }}>Q{q.questionNumber}</span>
                          {isLiveQ && <span style={{ fontSize: '0.6rem', fontWeight: 700, color: '#fff', background: '#DC2A3C', borderRadius: '4px', padding: '1px 5px', lineHeight: 1.4 }}>LIVE</span>}
                          {hasResponses && !isLiveQ && <span style={{ fontSize: '0.6rem', fontWeight: 700, color: '#16A34A', background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: '4px', padding: '1px 5px', lineHeight: 1.4 }}>✓</span>}
                        </div>
                        <span style={{ fontSize: '0.82rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                          {q.text}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Response Navigator */}
        <div className="live-sidebar">
          <div className="glass-card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.85rem', flex: 1 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              <h3 style={{ fontSize: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem', margin: 0 }}>Response Navigator</h3>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                Q1→1-10 · Q2→11-20 · Q3→21-30…
              </div>
              <input
                type="number"
                className="form-input"
                placeholder="Type number (e.g. 72)"
                value={responseNavInput}
                min={1}
                onChange={(e) => {
                  setResponseNavInput(e.target.value);
                  const n = parseInt(e.target.value, 10);
                  if (!isNaN(n) && n >= 1) {
                    const qIdx = Math.floor((n - 1) / 10);
                    if (qIdx >= 0 && qIdx < questions.length) {
                      handleQTabSelectQuestion(questions[qIdx]);
                    }
                  }
                }}
                style={{ width: '100%', fontSize: '0.85rem' }}
              />
            </div>

            {/* Target info */}
            {isValidRespNav && (
              <div style={{ fontSize: '0.78rem', padding: '0.45rem 0.7rem', borderRadius: '8px', background: 'rgba(43,95,217,0.06)', border: '1px solid rgba(43,95,217,0.18)', color: 'var(--color-primary)', fontWeight: 600 }}>
                {respNavQ
                  ? `Q${respNavQNum} · Response #${respNavRIdx + 1}`
                  : `Q${respNavQNum} out of range`}
              </div>
            )}

            {/* Response list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', overflowY: 'auto', maxHeight: '300px' }}>
              {respNavQ ? (() => {
                const rows = getRespNavRows(respNavQ, respNavResps);
                if (rows.length === 0) {
                  return (
                    <div style={{ padding: '0.75rem', border: '1px dashed var(--border-color)', borderRadius: '10px', color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                      No responses recorded for Q{respNavQNum} yet.
                    </div>
                  );
                }
                return rows.map((row, idx) => {
                  const globalNum = (respNavQIdx) * 10 + idx + 1;
                  const isHighlighted = idx === respNavRIdx;
                  return (
                    <div key={idx} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', padding: '0.45rem 0.6rem', borderRadius: '8px', background: isHighlighted ? 'rgba(43,95,217,0.09)' : 'var(--bg-card, #fff)', border: `1.5px solid ${isHighlighted ? 'rgba(43,95,217,0.4)' : 'var(--border-color)'}`, transition: 'all 0.15s' }}>
                      <span style={{ fontSize: '0.7rem', fontWeight: 800, color: isHighlighted ? 'var(--color-primary)' : 'var(--text-muted)', minWidth: '22px', paddingTop: '1px' }}>{globalNum}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.82rem', fontWeight: isHighlighted ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: isHighlighted ? 'var(--color-primary)' : 'var(--text-primary)' }}>{row.label}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{row.sub}</div>
                      </div>
                      {isHighlighted && <span style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--color-primary)', background: 'rgba(43,95,217,0.12)', borderRadius: '4px', padding: '2px 5px', flexShrink: 0 }}>▶</span>}
                    </div>
                  );
                });
              })() : !isValidRespNav ? (
                <div style={{ padding: '0.75rem', border: '1px dashed var(--border-color)', borderRadius: '10px', color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                  Enter a number to jump to a response.
                </div>
              ) : null}
            </div>

            {/* PDF download — per question, only if it has responses */}
            {(() => {
              const qList = questions.map((q, idx) => ({ ...q, qNum: idx + 1 }));
              const hasAnyPDF = qList.some(q => (allResponses[q.id]?.length ?? 0) > 0);
              if (!hasAnyPDF) return null;
              return (
                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.45rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Download PDF</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', maxHeight: '180px', overflowY: 'auto' }}>
                    {qList.map(q => {
                      const qResps = allResponses[q.id] || [];
                      if (qResps.length === 0) return null;
                      return (
                        <button key={q.id}
                          className="btn btn-secondary btn-sm"
                          style={{ justifyContent: 'flex-start', gap: '0.4rem', fontSize: '0.78rem', padding: '0.35rem 0.6rem' }}
                          onClick={() => downloadQuestionPDF(q, qResps, q.qNum)}
                        >
                          <FileDown size={13} />
                          Q{q.qNum} — {qResps.length} response{qResps.length !== 1 ? 's' : ''}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

          </div>
        </div>

      </div>
      )}

    </div>
  );
}

 
