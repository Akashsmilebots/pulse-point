import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getPollById,
  getQuestionsForPoll,
  saveDraftQuestions,
  updatePoll,
  updateQuestion,
  resetPollData,
  subscribeToParticipantsCount,
  subscribeToResponsesForQuestion,
  subscribeToAllResponses,
  updateLeaderboard,
  subscribeToLeaderboard,
  auth,
  hasValidConfig,
  syncHostAuthUid
} from '../lib/firebase';
import { getHostId } from '../utils';
import { ArrowLeft, Play, Square, RefreshCw, Users, Copy, Check, ChevronRight, ChevronLeft, Plus, Save, Monitor, ExternalLink, FileDown } from 'lucide-react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

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
  const [projectorLbRange, setProjectorLbRange] = useState(null);
  const [qTabSelectedQ, setQTabSelectedQ] = useState(null);
  const [responseNavInput, setResponseNavInput] = useState('');
  const [resultTabQ, setResultTabQ] = useState(null);
  const [resultTabSearch, setResultTabSearch] = useState('');
  const [liveEditQ, setLiveEditQ] = useState(null);
  const [liveEditText, setLiveEditText] = useState('');
  const [liveEditOptions, setLiveEditOptions] = useState([]);
  const [liveEditSaving, setLiveEditSaving] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');
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
      const endTime = Date.now() + 35000;
      await updatePoll(poll.id, {
        current_question_id: q.id,
        projector_mode: 'question',
        projector_question_id: q.id,
        question_end_time: endTime,
      });
      setPoll(p => ({ ...p, current_question_id: q.id, projector_mode: 'question', projector_question_id: q.id, question_end_time: endTime }));
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
    try {
      setLoading(true);
      setShowResetDialog(false);
      setResetConfirmText('');
      await resetPollData(poll.id);
      setPoll({ ...poll, status: 'draft', current_question_id: null });
      if (questions.length > 0) setCurrentQuestion(questions[0]);
      setParticipantCount(0);
      setResponses([]);
    } catch (err) {
      console.error(err);
      setErrorMessage('Failed to reset poll.');
    } finally {
      setLoading(false);
    }
  };

  const handlePauseSession = async () => {
    try {
      await updatePoll(poll.id, { status: 'paused' });
      setPoll(p => ({ ...p, status: 'paused' }));
    } catch (err) { console.error(err); }
  };

  const handleResumeSession = async () => {
    try {
      await updatePoll(poll.id, { status: 'active' });
      setPoll(p => ({ ...p, status: 'active' }));
    } catch (err) { console.error(err); }
  };

  // Auto-pause when host closes/navigates away from the tab
  useEffect(() => {
    if (!poll?.id || poll?.status !== 'active') return;
    const autoPause = () => { updatePoll(poll.id, { status: 'paused' }).catch(() => {}); };
    window.addEventListener('beforeunload', autoPause);
    return () => window.removeEventListener('beforeunload', autoPause);
  }, [poll?.id, poll?.status]);

  const handleSetActiveQuestion = async (q) => {
    if (!(poll.status === 'active' || poll.status === 'ended' || poll.status === 'paused')) return;
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
    // Always revert to banner when switching tabs — each tab requires an explicit "Show on Screen" action
    if (tab === 'question') {
      // Pre-select last completed question in UI but do NOT push to projector yet
      const answeredQs = questions.filter(q => (allResponses[q.id]?.length ?? 0) > 0);
      const initQ = (currentQuestion && (allResponses[currentQuestion.id]?.length ?? 0) > 0)
        ? currentQuestion
        : answeredQs[answeredQs.length - 1] || null;
      setQTabSelectedQ(initQ);
    } else if (tab === 'results') {
      const answeredQs = questions.filter(q => (allResponses[q.id]?.length ?? 0) > 0);
      const initQ = (currentQuestion && (allResponses[currentQuestion.id]?.length ?? 0) > 0)
        ? currentQuestion
        : answeredQs[answeredQs.length - 1] || null;
      if (initQ) {
        setResultTabQ(initQ);
        const existing = poll.projector_reveals || {};
        if (!existing[initQ.id]) {
          const reveals = { ...existing, [initQ.id]: (initQ.options || []).map(() => false) };
          setPoll(p => ({ ...p, projector_reveals: reveals }));
          updatePoll(poll.id, { projector_reveals: reveals }).catch(console.error);
        }
      }
      setResultTabSearch('');
    }
    setPoll(p => ({ ...p, projector_mode: 'banner' }));
    updatePoll(poll.id, { projector_mode: 'banner' }).catch(console.error);
  };

  const handleResultTabSelectQ = (q) => {
    if (!q || !poll) return;
    setResultTabQ(q);
    // Init reveals for this question if not already set — no projector change yet
    const existing = poll.projector_reveals || {};
    if (!existing[q.id]) {
      const reveals = { ...existing, [q.id]: (q.options || []).map(() => false) };
      setPoll(p => ({ ...p, projector_reveals: reveals }));
      updatePoll(poll.id, { projector_reveals: reveals }).catch(console.error);
    }
  };

  const handleShowQuestionOnScreen = (q) => {
    if (!q || !poll) return;
    const extra = { projector_mode: 'question', projector_question_id: q.id };
    setPoll(p => ({ ...p, ...extra }));
    updatePoll(poll.id, extra).catch(console.error);
  };

  const handleShowResultOnScreen = (q) => {
    if (!q || !poll) return;
    const extra = { projector_mode: 'results', projector_question_id: q.id };
    setPoll(p => ({ ...p, ...extra }));
    updatePoll(poll.id, extra).catch(console.error);
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
    setQTabSelectedQ(q);
    // In draft mode: sync the draft question form to the selected question
    if (poll.status === 'draft') {
      const idx = questions.findIndex(qx => qx === q || (q.id && qx.id === q.id));
      if (idx >= 0) setDraftQuestionIndex(idx);
    }
    // If question has no responses and session is active, open inline edit
    if (q && poll.status === 'active' && !(allResponses[q.id]?.length > 0)) {
      setLiveEditQ(q);
      setLiveEditText(q.text || '');
      setLiveEditOptions([...(q.options || [])]);
    } else {
      setLiveEditQ(null);
    }
  };

  const handleSaveLiveEdit = async () => {
    if (!liveEditQ || !poll) return;
    setLiveEditSaving(true);
    try {
      const updates = {
        text: liveEditText.trim(),
        options: liveEditQ.type === 'multiple_choice' ? liveEditOptions.map(o => o.trim()).filter(Boolean) : []
      };
      await updateQuestion(poll.id, liveEditQ.id, updates);
      setQuestions(prev => prev.map(q => q.id === liveEditQ.id ? { ...q, ...updates } : q));
      setLiveEditQ(null);
    } catch (err) {
      console.error('Failed to save question edit', err);
    } finally {
      setLiveEditSaving(false);
    }
  };

  // Helper calculation for MC Responses — accepts optional (q, resps) for reuse in main panel
  const renderMCResults = (qParam, respsParam) => {
    const q = qParam || currentQuestion;
    const resps = respsParam || responses;
    if (!q) return null;
    const totalVotes = resps.length;
    const options = q.options || [];

    const tallies = {};
    options.forEach(opt => { tallies[opt] = 0; });
    resps.forEach(r => {
      const answers = (r.answer || '').split(',').map((part) => part.trim()).filter(Boolean);
      answers.forEach((answerPart) => {
        if (tallies[answerPart] !== undefined) {
          tallies[answerPart] += 1;
        }
      });
    });

    const sortedOptions = options.slice().sort((a, b) => {
      const da = tallies[a] || 0;
      const db = tallies[b] || 0;
      if (db !== da) return db - da;
      return options.indexOf(a) - options.indexOf(b);
    });

    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.5rem' }}>
        {sortedOptions.map((opt, idx) => {
          const rawVotes = tallies[opt] || 0;
          const pct = totalVotes > 0 ? Math.round((rawVotes / totalVotes) * 100) : 0;
          const isTop = idx === 0 && rawVotes > 0;
          return (
            <div key={idx} style={{ padding: '0.6rem 0.75rem', borderRadius: '10px', border: `1.5px solid ${isTop ? 'rgba(43,95,217,0.35)' : 'var(--border-color)'}`, background: isTop ? 'rgba(43,95,217,0.04)' : 'var(--bg-card,#fff)', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 600, lineHeight: 1.35, color: 'var(--text-primary)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{opt}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.1rem' }}>
                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: isTop ? 'var(--color-primary)' : 'var(--text-secondary)' }}>{rawVotes} vote{rawVotes !== 1 ? 's' : ''}</span>
                <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{pct}%</span>
              </div>
              <div style={{ height: '3px', borderRadius: '2px', background: 'var(--border-color)', overflow: 'hidden' }}>
                <div style={{ height: '100%', background: isTop ? 'var(--color-primary)' : 'var(--color-accent)', width: `${pct}%`, transition: 'width 0.4s ease' }} />
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
            const rawCount = tallies[stars] || 0;
            const count = Math.max(1, rawCount);
            const pct = totalVotes > 0 ? Math.round((rawCount / totalVotes) * 100) : 0;
            return (
              <div className="result-bar-wrapper" key={stars}>
                <div className="result-bar-header" style={{ fontSize: '0.85rem' }}>
                  <span className="result-bar-label" style={{ color: 'var(--text-secondary)' }}>{stars} Star{stars !== 1 ? 's' : ''}</span>
                  <span className="result-bar-stats">{count} response{count !== 1 ? 's' : ''}</span>
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
            const votes = Math.max(1, tallies[opt] || 0);
            const pct = totalVotes > 0 ? Math.round((tallies[opt] || 0) / totalVotes * 100) : 0;
            return (
              <div className="result-bar-wrapper" key={idx}>
                <div className="result-bar-header">
                  <span className="result-bar-label">{opt}</span>
                  <span className="result-bar-stats">{votes} vote{votes !== 1 ? 's' : ''}</span>
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
              const count = Math.max(1, rTallies[stars] || 0);
              const pct = totalVotes > 0 ? Math.round((rTallies[stars] || 0) / totalVotes * 100) : 0;
              return (
                <div className="result-bar-wrapper" key={stars}>
                  <div className="result-bar-header" style={{ fontSize: '0.85rem' }}>
                    <span className="result-bar-label" style={{ color: 'var(--text-secondary)' }}>{stars} Star{stars !== 1 ? 's' : ''}</span>
                    <span className="result-bar-stats">{count} response{count !== 1 ? 's' : ''}</span>
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

  const downloadQuestionPDF = (q, resps, qNum) => buildQuestionPDF(q, resps, qNum, false);

  const _escHtml = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const _renderHtmlToPdf = async (htmlContent, filename, printMode = false) => {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:fixed;left:-9999px;top:0;width:794px;background:#fff;font-family:"Noto Sans","Noto Sans Devanagari",sans-serif;color:#000;';
    wrapper.innerHTML = htmlContent;
    document.body.appendChild(wrapper);
    try { await document.fonts.ready; } catch (e) {}
    const canvas = await html2canvas(wrapper, { scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff' });
    document.body.removeChild(wrapper);
    const pageW = 210, pageH = 297;
    const pixPerMm = canvas.width / pageW;
    const pagePixH = pageH * pixPerMm;
    const doc = new jsPDF({ format: 'a4', unit: 'mm' });
    let y = 0;
    while (y < canvas.height) {
      if (y > 0) doc.addPage();
      const sliceH = Math.min(pagePixH, canvas.height - y);
      const sliceCanvas = document.createElement('canvas');
      sliceCanvas.width = canvas.width;
      sliceCanvas.height = Math.ceil(sliceH);
      const ctx = sliceCanvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
      ctx.drawImage(canvas, 0, -y);
      const imgData = sliceCanvas.toDataURL('image/jpeg', 0.93);
      doc.addImage(imgData, 'JPEG', 0, 0, pageW, sliceH / pixPerMm);
      y += sliceH;
    }
    if (printMode) { doc.autoPrint(); doc.output('dataurlnewwindow'); }
    else { doc.save(filename); }
  };

  const buildLeaderboardPDF = async (docId, title, printMode = false) => {
    await updateLeaderboard(poll.id).catch(() => {});
    const data = await new Promise(resolve => {
      const unsub = subscribeToLeaderboard(poll.id, docId, d => { unsub(); resolve(d); });
    });
    const rows = (data?.leaderboard_data || []).slice(0, 10);
    const rowsHtml = rows.map((p, idx) => `
      <div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid #f0f0f0;">
        <span style="font-weight:700;color:#6B7280;width:22px;flex-shrink:0;font-size:11px;">${idx + 1}.</span>
        <span style="flex:1;font-size:12px;">${_escHtml(p.name || 'Anonymous')}${p.phone ? `<span style="color:#9CA3AF;font-size:10px;"> — ${_escHtml(p.phone)}</span>` : ''}</span>
        <span style="font-weight:700;color:#2B5FD9;font-size:12px;white-space:nowrap;">${p.points ?? 0} pts</span>
      </div>`).join('');
    const html = `<div style="padding:30px 36px;background:#fff;">
      <h2 style="margin:0 0 3px;font-size:17px;font-weight:700;">${_escHtml(poll.title || 'Pulse Point')}</h2>
      <p style="margin:0 0 10px;color:#888;font-size:11px;">${_escHtml(title)}</p>
      <div style="height:1px;background:#ddd;margin-bottom:14px;"></div>
      ${rows.length === 0 ? '<p style="color:#aaa;font-size:11px;">No leaderboard data yet.</p>' : rowsHtml}
    </div>`;
    await _renderHtmlToPdf(html, `leaderboard-${docId}.pdf`, printMode);
  };

  const handleDownloadQR = async () => {
    const url = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(`${window.location.origin}/join/${poll.join_code}`)}&bgcolor=ffffff&color=000000&margin=10`;
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `qr-${poll.join_code}.png`;
      a.click();
      URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(url, '_blank');
    }
  };

  const buildOptionsPDF = async (printMode = false) => {
    const allEntries = [];
    let num = 1;
    questions.forEach((q) => {
      const opts = q.options || [];
      if (!opts.length) return;
      const resps = allResponses[q.id] || [];
      if (!resps.length) return;
      const tallies = {};
      opts.forEach(o => { tallies[o] = 0; });
      resps.forEach(r => {
        (r.answer || '').split(',').map(s => s.trim()).filter(Boolean).forEach(a => {
          if (tallies[a] !== undefined) tallies[a]++;
        });
      });
      // Top 10 per question sorted by votes
      opts.slice().sort((a, b) => (tallies[b] || 0) - (tallies[a] || 0)).slice(0, 10).forEach(opt => {
        allEntries.push({ num: num++, text: opt });
      });
    });

    const eHtml = e => `<div style="display:flex;align-items:flex-start;gap:6px;padding:5px 0;border-bottom:1px solid #f3f3f3;"><span style="font-weight:700;color:#2B5FD9;min-width:24px;font-size:11.5px;flex-shrink:0;">${e.num}.</span><span style="font-size:11.5px;line-height:1.45;">${_escHtml(e.text)}</span></div>`;

    if (allEntries.length === 0) {
      const html = `<div style="padding:30px 36px;background:#fff;"><h2 style="margin:0 0 3px;font-size:17px;font-weight:700;">${_escHtml(poll.title || 'Pulse Point')}</h2><p style="margin:0 0 10px;color:#888;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">Options List</p><div style="height:1px;background:#ddd;margin-bottom:14px;"></div><p style="color:#aaa;font-size:11px;">No questions with responses recorded yet.</p></div>`;
      await _renderHtmlToPdf(html, `${poll.join_code || 'options'}-options.pdf`, printMode);
      return;
    }

    // 35 per column × 2 columns = 70 per page; each section sized to one A4 page (1124 CSS px)
    const pages = [];
    for (let i = 0; i < allEntries.length; i += 70) pages.push(allEntries.slice(i, i + 70));

    const sectionsHtml = pages.map((pg, pi) => {
      const left = pg.slice(0, 35);
      const right = pg.slice(35);
      const isFirst = pi === 0;
      const header = isFirst
        ? `<h2 style="margin:0 0 3px;font-size:17px;font-weight:700;">${_escHtml(poll.title || 'Pulse Point')}</h2><p style="margin:0 0 10px;color:#888;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">Options List</p><div style="height:1px;background:#ddd;margin-bottom:14px;"></div>`
        : `<div style="height:1px;background:#ddd;margin-bottom:14px;"></div>`;
      return `<div style="height:1124px;box-sizing:border-box;padding:30px 36px;">${header}<div style="display:flex;gap:28px;"><div style="flex:1;">${left.map(eHtml).join('')}</div><div style="flex:1;">${right.map(eHtml).join('')}</div></div></div>`;
    }).join('');

    await _renderHtmlToPdf(`<div style="background:#fff;">${sectionsHtml}</div>`, `${poll.join_code || 'options'}-options.pdf`, printMode);
  };

  const buildQuestionPDF = async (q, resps, qNum, printMode = false) => {
    const top10Count = q.type === 'rating' ? Math.min(resps.length, 5) : Math.min(resps.length, 10);
    let contentHtml = '';
    if (q.type === 'multiple_choice') {
      const opts = q.options || [];
      const tallies = {};
      opts.forEach(o => { tallies[o] = 0; });
      resps.forEach(r => {
        (r.answer || '').split(',').map(s => s.trim()).filter(Boolean).forEach(a => {
          if (tallies[a] !== undefined) tallies[a]++;
        });
      });
      contentHtml = opts.slice().sort((a, b) => (tallies[b] || 0) - (tallies[a] || 0)).slice(0, 10).map((opt, idx) => {
        const votes = Math.max(1, tallies[opt] || 0);
        return `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid #f0f0f0;">
          <span style="font-weight:700;color:#6B7280;width:28px;flex-shrink:0;font-size:11px;">#${idx + 1}</span>
          <span style="flex:1;font-size:12px;line-height:1.4;">${_escHtml(opt)}</span>
          <span style="font-size:11px;color:#2B5FD9;font-weight:700;white-space:nowrap;">${votes} vote${votes !== 1 ? 's' : ''}</span>
        </div>`;
      }).join('');
    } else if (q.type === 'rating') {
      let sum = 0;
      const rt = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      resps.forEach(r => { const v = parseInt(r.answer, 10); if (!isNaN(v)) { sum += v; rt[v] = (rt[v] || 0) + 1; } });
      const avg = resps.length > 0 ? (sum / resps.length).toFixed(1) : '0.0';
      contentHtml = `<div style="font-size:14px;font-weight:700;margin-bottom:10px;">Average: ${avg} / 5</div>`;
      contentHtml += [5, 4, 3, 2, 1].map(stars => {
        const count = rt[stars] || 0;
        return `<div style="padding:4px 0;font-size:12px;">
          <span style="color:#F59E0B;">${'★'.repeat(stars)}</span><span style="color:#D1D5DB;">${'☆'.repeat(5 - stars)}</span>
          <span style="margin-left:8px;color:#6B7280;">${Math.max(1, count)} response${count !== 1 ? 's' : ''}</span>
        </div>`;
      }).join('');
    } else {
      contentHtml = resps.slice(0, 10).map((r, idx) => {
        const name = r.participants ? r.participants.name : 'Anonymous';
        return `<div style="padding:6px 0;border-bottom:1px solid #f0f0f0;">
          <span style="font-weight:700;color:#6B7280;font-size:11px;margin-right:6px;">${idx + 1}.</span>
          <span style="font-size:12px;font-style:italic;">"${_escHtml(r.answer)}"</span>
          <span style="color:#9CA3AF;font-size:10px;margin-left:6px;">— ${_escHtml(name)}</span>
        </div>`;
      }).join('');
    }
    const html = `<div style="padding:30px 36px;background:#fff;">
      <h2 style="margin:0 0 3px;font-size:17px;font-weight:700;">${_escHtml(poll.title || 'Pulse Point')}</h2>
      <p style="margin:0 0 10px;color:#888;font-size:10px;">Question ${qNum} · ${q.type.replace('_', ' ')} · Top ${top10Count} of ${resps.length} response${resps.length !== 1 ? 's' : ''}</p>
      <div style="height:1px;background:#ddd;margin-bottom:12px;"></div>
      <div style="font-size:14px;font-weight:700;margin-bottom:14px;line-height:1.4;">${_escHtml(q.text || '')}</div>
      ${contentHtml}
    </div>`;
    await _renderHtmlToPdf(html, `Q${qNum}-responses.pdf`, printMode);
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

  const respNavRows = respNavQ ? getRespNavRows(respNavQ, respNavResps) : [];
  const respNavHighlightedRow = respNavRows[respNavRIdx] || null;
  const respNavHighlightedOption = respNavHighlightedRow?.label || '';

  const allQuestionsAnswered = questions.length > 0 && questions.every(q => (allResponses[q.id]?.length ?? 0) > 0);
  const lastRecordedQIdx = questions.reduce((last, q, idx) => ((allResponses[q.id]?.length ?? 0) > 0 ? idx : last), -1);

  return (
    <div>
      {/* Top action bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <button className="btn btn-secondary" onClick={() => navigate('/dashboard')}>
          <ArrowLeft size={16} /> Back to Dashboard
        </button>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          {poll.status === 'active' && (
            <button className="btn btn-secondary" onClick={handlePauseSession}>
              ⏸ Pause Session
            </button>
          )}
          {poll.status === 'paused' && (
            <button className="btn btn-success" onClick={handleResumeSession}>
              ▶ Resume Session
            </button>
          )}
          {(poll.status === 'active' || poll.status === 'paused') && allQuestionsAnswered && (
            <button className="btn btn-danger" onClick={handleEndPoll}>
              <Square size={16} /> End Session
            </button>
          )}
          {(poll.status === 'active' || poll.status === 'paused' || poll.status === 'ended') && (
            <button className="btn btn-secondary" onClick={() => { setResetConfirmText(''); setShowResetDialog(true); }}>
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
          <button className="btn btn-secondary btn-sm" style={{ marginTop: '0.4rem', fontSize: '0.72rem' }} onClick={handleDownloadQR}>
            ⬇ Download QR
          </button>
        </div>
      )}

      {/* Projector Controls + Status side-by-side */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: 0, alignItems: 'flex-start' }}>
      <div className="glass-card" style={{ flex: 1, padding: '1rem 1.25rem' }}>
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

        {/* Question tab — only completed questions; explicit Show on Screen required */}
        {projectorTab === 'question' && (() => {
          const selQ = qTabSelectedQ;
          const selHasResp = selQ && (allResponses[selQ.id]?.length ?? 0) > 0;
          const projShowingThisQ = poll.projector_mode === 'question' && poll.projector_question_id === selQ?.id;
          return (
            <div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.28rem', alignContent: 'flex-start', maxHeight: '120px', overflowY: 'auto', marginBottom: '0.65rem' }}>
                {questions.map((q, idx) => {
                  const isDone = (allResponses[q.id]?.length ?? 0) > 0;
                  const isSel = selQ?.id === q.id;
                  return (
                    <button key={q.id} title={q.text} disabled={!isDone}
                      onClick={() => isDone && setQTabSelectedQ(q)}
                      style={{ width: '46px', height: '42px', borderRadius: '10px', padding: '2px 4px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1px', fontWeight: 700, transition: 'all 0.12s', cursor: isDone ? 'pointer' : 'default', background: isSel ? '#2B5FD9' : isDone ? 'rgba(34,197,94,0.08)' : 'var(--bg-card,#fff)', color: isSel ? '#fff' : isDone ? '#16A34A' : 'var(--text-muted)', border: `1.5px solid ${isSel ? '#2B5FD9' : isDone ? '#16A34A' : 'var(--border-color)'}`, opacity: !isDone ? 0.25 : 1, boxShadow: isSel ? '0 2px 8px rgba(43,95,217,0.25)' : 'none' }}>
                      <span style={{ fontSize: '0.82rem', lineHeight: 1 }}>{idx + 1}</span>
                      {isDone && !isSel && <span style={{ fontSize: '0.42rem', lineHeight: 1 }}>DONE</span>}
                      {isSel && <span style={{ fontSize: '0.42rem', lineHeight: 1, opacity: 0.75 }}>SEL</span>}
                    </button>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                {selQ && selHasResp && (
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    Q{questions.indexOf(selQ) + 1}: {selQ.text}
                  </span>
                )}
                {!selHasResp && (
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', flex: 1 }}>Select a completed question above</span>
                )}
                <button className="btn btn-sm btn-primary"
                  disabled={!selHasResp || projShowingThisQ || poll.status === 'ended'}
                  onClick={() => selQ && handleShowQuestionOnScreen(selQ)}
                  style={{ flexShrink: 0, fontSize: '0.78rem', padding: '0.3rem 0.75rem', opacity: poll.status === 'ended' ? 0.4 : 1 }}>
                  {poll.status === 'ended' ? '🔒 Session Ended' : projShowingThisQ ? '✅ On Screen' : '📽 Show on Screen'}
                </button>
              </div>
            </div>
          );
        })()}

        {/* Results tab */}
        {projectorTab === 'results' && (() => {
          const rq = resultTabQ || currentQuestion;
          const rqIdx = rq ? questions.findIndex(q => q.id === rq.id) : -1;
          const projShowingResults = poll.projector_mode === 'results' && poll.projector_question_id === rq?.id;
          const projShowingQuestion = poll.projector_mode === 'question' && poll.projector_question_id === rq?.id;

          // Question number grid
          const resultQGrid = (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.28rem', alignContent: 'flex-start', marginBottom: '0.55rem' }}>
              {questions.map((q, idx) => {
                const hasResp = (allResponses[q.id]?.length ?? 0) > 0;
                const isSel = rq?.id === q.id;
                return (
                  <button key={q.id || idx} title={q.text} disabled={!hasResp}
                    onClick={() => hasResp && handleResultTabSelectQ(q)}
                    style={{ width: '40px', height: '36px', borderRadius: '9px', padding: '2px 3px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.8rem', transition: 'all 0.12s', cursor: hasResp ? 'pointer' : 'default', background: isSel ? '#2B5FD9' : hasResp ? 'rgba(34,197,94,0.08)' : 'var(--bg-card,#fff)', color: isSel ? '#fff' : hasResp ? '#16A34A' : 'var(--text-muted)', border: `1.5px solid ${isSel ? '#2B5FD9' : hasResp ? '#16A34A' : 'var(--border-color)'}`, opacity: !hasResp ? 0.3 : 1, boxShadow: isSel ? '0 2px 8px rgba(43,95,217,0.25)' : 'none' }}>
                    {idx + 1}
                  </button>
                );
              })}
            </div>
          );

          // Unified search: number (72→Q8) OR option text ("Red"→first Q with Red in top 10)
          const resultSearch = (
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '0.55rem' }}>
              <input
                type="text"
                className="form-input"
                placeholder="Number (72→Q8) or option text (Red)"
                value={resultTabSearch}
                onChange={(e) => {
                  const val = e.target.value;
                  setResultTabSearch(val);
                  const trimmed = val.trim();
                  if (!trimmed) return;
                  if (/^\d+$/.test(trimmed)) {
                    // Number navigation
                    const n = parseInt(trimmed, 10);
                    const qi = Math.floor((n - 1) / 10);
                    if (qi >= 0 && qi < questions.length) {
                      const target = questions[qi];
                      if ((allResponses[target.id]?.length ?? 0) > 0) handleResultTabSelectQ(target);
                    }
                  } else {
                    // Text search — find first question where top-10 options contain the text
                    const lower = trimmed.toLowerCase();
                    const found = questions.find(q => {
                      if ((allResponses[q.id]?.length ?? 0) === 0) return false;
                      const opts = q.options || [];
                      const t = {};
                      opts.forEach(o => { t[o] = 0; });
                      (allResponses[q.id] || []).forEach(r => {
                        (r.answer || '').split(',').map(s => s.trim()).filter(Boolean).forEach(a => { if (t[a] !== undefined) t[a]++; });
                      });
                      const top10 = opts.slice().sort((a, b) => (t[b] || 0) - (t[a] || 0)).slice(0, 10);
                      return top10.some(o => o.toLowerCase().includes(lower));
                    });
                    if (found) handleResultTabSelectQ(found);
                  }
                }}
                style={{ fontSize: '0.82rem', flex: 1 }}
              />
              {rq && <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--color-primary)', whiteSpace: 'nowrap' }}>Q{rqIdx + 1}</span>}
            </div>
          );

          if (!rq) return <div>{resultQGrid}{resultSearch}<p style={{ fontSize: '0.83rem', color: 'var(--text-secondary)' }}>No completed question yet.</p></div>;
          if (rq.type !== 'multiple_choice') return <div>{resultQGrid}{resultSearch}<p style={{ fontSize: '0.83rem', color: 'var(--text-secondary)' }}>Results reveal works for multiple choice questions.</p></div>;

          const options = rq.options || [];
          const tallies = {};
          options.forEach(o => { tallies[o] = 0; });
          const rqResps = allResponses[rq.id] || [];
          rqResps.forEach(r => {
            (r.answer || '').split(',').map(s => s.trim()).filter(Boolean).forEach(a => {
              if (tallies[a] !== undefined) tallies[a]++;
            });
          });
          const totalVotes = rqResps.length;
          const sortedOpts = options.slice().sort((a, b) => {
            const diff = (tallies[b] || 0) - (tallies[a] || 0);
            return diff !== 0 ? diff : options.indexOf(a) - options.indexOf(b);
          });
          const reveals = (poll.projector_reveals || {})[rq.id] || options.map(() => false);
          const revealCount = reveals.filter(Boolean).length;

          return (
            <div>
              {resultQGrid}
              {resultSearch}

              {/* Question text */}
              <div style={{ padding: '0.55rem 0.75rem', borderRadius: '10px', background: 'rgba(43,95,217,0.04)', border: '1px solid rgba(43,95,217,0.14)', marginBottom: '0.55rem' }}>
                <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.18rem' }}>Q{rqIdx + 1}</div>
                <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.35 }}>{rq.text}</div>
              </div>

              {/* Show on Screen + Reveal controls */}
              <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.45rem' }}>
                <button className={`btn btn-sm ${projShowingResults ? 'btn-secondary' : 'btn-primary'}`}
                  style={{ fontSize: '0.78rem', padding: '0.3rem 0.75rem' }}
                  onClick={() => handleShowResultOnScreen(rq)}
                  disabled={projShowingResults}>
                  {projShowingResults ? '✅ Showing on Screen' : '📽 Show on Screen'}
                </button>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', flex: 1, textAlign: 'right' }}>
                  {revealCount}/{Math.min(sortedOpts.length, 10)} revealed · {totalVotes} resp.
                </span>
              </div>
              <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                <button className="btn btn-sm btn-success"
                  onClick={() => {
                    const updated = options.map(() => true);
                    const updatedReveals = { ...(poll.projector_reveals || {}), [rq.id]: updated };
                    setPoll(p => ({ ...p, projector_reveals: updatedReveals }));
                    // Also activate projector for this result
                    const extra = { projector_reveals: updatedReveals, projector_mode: 'results', projector_question_id: rq.id };
                    updatePoll(poll.id, extra).catch(console.error);
                    setPoll(p => ({ ...p, projector_mode: 'results', projector_question_id: rq.id }));
                  }}
                  disabled={revealCount >= Math.min(sortedOpts.length, 10)} style={{ fontSize: '0.75rem', flex: 1 }}>
                  Reveal All &amp; Show
                </button>
                <button className="btn btn-sm btn-secondary"
                  onClick={() => {
                    const updated = options.map(() => false);
                    const updatedReveals = { ...(poll.projector_reveals || {}), [rq.id]: updated };
                    setPoll(p => ({ ...p, projector_reveals: updatedReveals }));
                    updatePoll(poll.id, { projector_reveals: updatedReveals }).catch(console.error);
                  }}
                  disabled={revealCount === 0} style={{ fontSize: '0.75rem' }}>
                  Hide All
                </button>
              </div>
            </div>
          );
        })()}

        {/* Leaderboard tab */}
        {projectorTab === 'leaderboard' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.55rem' }}>
            {/* Overall card */}
            {(() => {
              const isSel = projectorLbRange === 'overall' && poll.projector_mode === 'leaderboard_overall';
              const showLbOnScreen = (mode) => { setProjectorLbRange('overall'); updateLeaderboard(poll.id).catch(() => {}); setPoll(p => ({ ...p, projector_mode: mode })); updatePoll(poll.id, { projector_mode: mode }).catch(console.error); };
              return (
                <div key="overall"
                  style={{ border: `2px solid ${isSel ? 'var(--color-primary)' : 'var(--border-color)'}`, borderRadius: '12px', padding: '0.75rem 0.5rem', background: isSel ? 'rgba(43,95,217,0.07)' : 'var(--bg-card)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.88rem', fontWeight: 800, color: isSel ? 'var(--color-primary)' : 'var(--text-primary)', lineHeight: 1.2 }}>Overall</div>
                  <button className={`btn btn-sm ${isSel ? 'btn-secondary' : 'btn-primary'}`} style={{ fontSize: '0.72rem', padding: '0.3rem 0.55rem', width: '100%' }}
                    onClick={() => showLbOnScreen('leaderboard_overall')} disabled={isSel}>
                    {isSel ? '✅ On Screen' : '📽 Show on Screen'}
                  </button>
                  <div style={{ display: 'flex', gap: '0.3rem' }}>
                    <button className="btn btn-secondary" style={{ padding: '0.4rem 0.5rem', lineHeight: 1 }} onClick={e => { e.stopPropagation(); buildLeaderboardPDF('overall', 'Overall Leaderboard', false); }}><FileDown size={16} /></button>
                    <button className="btn btn-secondary" style={{ padding: '0.4rem 0.5rem', fontSize: '0.95rem', lineHeight: 1 }} onClick={e => { e.stopPropagation(); buildLeaderboardPDF('overall', 'Overall Leaderboard', true); }}>🖨</button>
                  </div>
                </div>
              );
            })()}
            {Array.from({ length: Math.ceil(questions.length / 10) }, (_, i) => {
              const docId = `range_${i}`;
              const rangeLabel = `Q${i * 10 + 1}–${Math.min((i + 1) * 10, questions.length)}`;
              const isSel = projectorLbRange === i && poll.projector_mode === `leaderboard_range_${i}`;
              return (
                <div key={i}
                  style={{ border: `2px solid ${isSel ? 'var(--color-primary)' : 'var(--border-color)'}`, borderRadius: '12px', padding: '0.75rem 0.5rem', background: isSel ? 'rgba(43,95,217,0.07)' : 'var(--bg-card)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 800, color: isSel ? 'var(--color-primary)' : 'var(--text-primary)', lineHeight: 1.2 }}>{rangeLabel}</div>
                  <button className={`btn btn-sm ${isSel ? 'btn-secondary' : 'btn-primary'}`} style={{ fontSize: '0.72rem', padding: '0.3rem 0.55rem', width: '100%' }}
                    onClick={() => { setProjectorLbRange(i); updateLeaderboard(poll.id).catch(() => {}); const mm = `leaderboard_range_${i}`; setPoll(p => ({ ...p, projector_mode: mm })); updatePoll(poll.id, { projector_mode: mm }).catch(console.error); }}
                    disabled={isSel}>
                    {isSel ? '✅ On Screen' : '📽 Show on Screen'}
                  </button>
                  <div style={{ display: 'flex', gap: '0.3rem' }}>
                    <button className="btn btn-secondary" style={{ padding: '0.4rem 0.5rem', lineHeight: 1 }} onClick={e => { e.stopPropagation(); buildLeaderboardPDF(docId, `${rangeLabel} Leaderboard`, false); }}><FileDown size={16} /></button>
                    <button className="btn btn-secondary" style={{ padding: '0.4rem 0.5rem', fontSize: '0.95rem', lineHeight: 1 }} onClick={e => { e.stopPropagation(); buildLeaderboardPDF(docId, `${rangeLabel} Leaderboard`, true); }}>🖨</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {/* Projector Displaying status card */}
      {(() => {
        const m = poll.status === 'draft' ? 'banner' : (poll.projector_mode || 'banner');
        let label, color;
        if (m === 'banner') {
          label = 'Banner'; color = '#16A34A';
        } else if (m === 'question') {
          const pq = questions.find(q => q.id === poll.projector_question_id);
          const n = pq ? questions.indexOf(pq) + 1 : '?';
          label = `Question ${n}`; color = '#DC2A3C';
        } else if (m === 'question_single') {
          const pq = questions.find(q => q.id === poll.projector_question_id);
          const n = pq ? questions.indexOf(pq) + 1 : '?';
          label = `Q${n} Option`; color = '#7C3AED';
        } else if (m === 'results') {
          const pq = questions.find(q => q.id === poll.projector_question_id);
          const n = pq ? questions.indexOf(pq) + 1 : '?';
          label = `Results Q${n}`; color = '#16A34A';
        } else if (m === 'leaderboard_overall') {
          label = 'Leaderboard'; color = '#D97706';
        } else if (m.startsWith('leaderboard_range_')) {
          const i = parseInt(m.replace('leaderboard_range_', ''), 10);
          label = `LB Q${i*10+1}–${Math.min((i+1)*10, questions.length)}`; color = '#D97706';
        } else {
          label = 'Banner'; color = '#6B7280';
        }
        const isLiveMode = m !== 'banner';
        return (
          <div className="glass-card" style={{ width: '160px', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '1rem 0.85rem', textAlign: 'center', gap: '0.45rem', alignSelf: 'stretch' }}>
            <style>{`@keyframes liveRingPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.45;transform:scale(0.9)}}@keyframes liveDotBlink{0%,100%{opacity:1}50%{opacity:0.15}}`}</style>
            <div style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.09em' }}>Displaying</div>
            <div style={{ position: 'relative', width: 46, height: 46, flexShrink: 0 }}>
              <svg width="46" height="46" viewBox="0 0 46 46" style={{ animation: isLiveMode ? 'liveRingPulse 1.6s ease-in-out infinite' : 'none' }}>
                <circle cx="23" cy="23" r="19" fill="none" stroke={color} strokeWidth="2" strokeDasharray={isLiveMode ? '7 4' : '0'} opacity="0.35" />
                <circle cx="23" cy="23" r="13" fill="none" stroke={color} strokeWidth="2.5" opacity="0.7" />
              </svg>
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: color, boxShadow: `0 0 7px ${color}99`, display: 'block', animation: isLiveMode ? 'liveDotBlink 1.2s ease-in-out infinite' : 'none' }} />
              </div>
            </div>
            <div style={{ fontSize: '0.88rem', fontWeight: 800, color, lineHeight: 1.3, wordBreak: 'break-word' }}>{label}</div>
            {isLiveMode && <div style={{ fontSize: '0.62rem', fontWeight: 800, color, letterSpacing: '0.14em', animation: 'liveDotBlink 1.2s ease-in-out infinite' }}>● LIVE</div>}
          </div>
        );
      })()}
      </div>{/* /flex projector row */}
      </div>{/* /sticky wrapper */}

      {/* Results tab — ranked options list (non-sticky, scrollable) */}
      {projectorTab === 'results' && (() => {
        const rq2 = resultTabQ || currentQuestion;
        if (!rq2 || rq2.type !== 'multiple_choice') return null;
        const options2 = rq2.options || [];
        const tallies2 = {};
        options2.forEach(o => { tallies2[o] = 0; });
        const rqResps2 = allResponses[rq2.id] || [];
        rqResps2.forEach(r => {
          (r.answer || '').split(',').map(s => s.trim()).filter(Boolean).forEach(a => {
            if (tallies2[a] !== undefined) tallies2[a]++;
          });
        });
        const sorted2 = options2.slice().sort((a, b) => {
          const diff = (tallies2[b] || 0) - (tallies2[a] || 0);
          return diff !== 0 ? diff : options2.indexOf(a) - options2.indexOf(b);
        });
        const reveals2 = (poll.projector_reveals || {})[rq2.id] || options2.map(() => false);
        return (
          <div className="glass-card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.65rem' }}>
              Results — Q{questions.indexOf(rq2) + 1} · {rqResps2.length} response{rqResps2.length !== 1 ? 's' : ''}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              {sorted2.slice(0, 10).map((opt, rankPos) => {
                const optIdx = options2.indexOf(opt);
                const votes = Math.max(1, tallies2[opt] || 0);
                const isRevealed = reveals2[optIdx] === true;
                return (
                  <div key={opt} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.7rem', borderRadius: '9px', background: isRevealed ? 'rgba(34,197,94,0.06)' : 'rgba(0,0,0,0.02)', border: `1px solid ${isRevealed ? 'rgba(34,197,94,0.22)' : 'var(--border-color)'}` }}>
                    <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', width: '20px', flexShrink: 0 }}>#{rankPos + 1}</span>
                    <span style={{ flex: 1, fontSize: '0.85rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{opt}</span>
                    <span style={{ fontSize: '0.78rem', fontWeight: 700, color: isRevealed ? 'var(--color-success)' : 'var(--text-muted)', flexShrink: 0 }}>
                      {isRevealed ? `${votes} vote${votes !== 1 ? 's' : ''}` : '—'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Home tab — status info card (always shown on Home tab) */}
      {projectorTab === 'home' && (
        <div className="glass-card" style={{ padding: '2rem', marginBottom: '1.5rem', textAlign: 'center' }}>
          <h3 style={{ marginBottom: '0.55rem' }}>Event banner is on screen</h3>
          <p style={{ color: 'var(--text-secondary)', maxWidth: '500px', margin: '0 auto', lineHeight: 1.6 }}>
            The projector shows the <strong>{poll.title}</strong> banner with the join link, and players see the waiting screen.
            {poll.status === 'draft' ? ' Start the session when you\'re ready.' : ' Switch to Question when you\'re ready to play.'}
          </p>
        </div>
      )}

      {/* Layout Split — always visible for active/ended/draft polls */}
      <div className="live-layout">

        {/* Main projection pane */}
        <div className="glass-card" style={{ padding: '2.5rem' }}>
          {poll.status === 'draft' ? (
            <div>
              {(() => {
                const questionsAreSaved = questions.length > 0 && questions.every(q => !!q.id);
                return (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', gap: '1rem' }}>
                    <div>
                      <h2 style={{ margin: 0 }}>Edit Event Title &amp; Questions</h2>
                      <p style={{ margin: '0.5rem 0 0', color: 'var(--text-secondary)' }}>
                        {questionsAreSaved ? 'Launch when ready, or keep editing.' : 'Save Poll first, then launch the live session.'}
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                      <button className="btn btn-secondary" onClick={handleSaveDraft} disabled={savingDraft || loading}>
                        <Save size={16} /> Save Poll
                      </button>
                      {questionsAreSaved && (
                        <button className="btn btn-success" onClick={handleStartPoll} disabled={savingDraft || loading}>
                          <Play size={16} /> Start Poll Session
                        </button>
                      )}
                    </div>
                  </div>
                );
              })()}

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
                      <Save size={16} /> Save Poll
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
                  {/* Show Question button — available for any unanswered question during active session */}
                  {poll.status === 'active' && effectiveResps.length === 0 && !isEffectiveLive && (
                    <button className="btn btn-success btn-sm" onClick={() => handleStartQuestion(effectiveQ)}>
                      <Play size={14} /> Show Question
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
                    {effectiveIdx === lastRecordedQIdx && effectiveIdx < questions.length - 1 && (
                      <button className="btn btn-success btn-sm"
                        onClick={() => handleStartQuestion(questions[effectiveIdx + 1])}
                        disabled={poll.status !== 'active'}>
                        Next <ChevronRight size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Question heading */}
              <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem', marginBottom: '1.5rem' }}>
                <span className="question-number">Question {effectiveIdx + 1} of {questions.length}</span>
                <h2 style={{ marginTop: '0.35rem', marginBottom: 0 }}>{effectiveQ.text}</h2>
              </div>

              {/* Results visualisation — only after responses recorded */}
              {effectiveResps.length > 0
                ? (effectiveQ.type === 'multiple_choice' ? renderMCResults(effectiveQ, effectiveResps) : renderForQ(effectiveQ, effectiveResps))
                : (
                  <div>
                    {/* Question preview — always show options */}
                    {effectiveQ.type === 'multiple_choice' && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.4rem', marginBottom: '1.25rem' }}>
                        {(liveEditQ?.id === effectiveQ.id ? liveEditOptions : effectiveQ.options || []).map((opt, i) => (
                          <div key={i} style={{ padding: '0.6rem 0.85rem', borderRadius: '10px', border: '1px solid var(--border-color)', background: 'var(--bg-card,#fff)', fontSize: '0.88rem', color: 'var(--text-primary)', fontWeight: 500 }}>
                            {opt}
                          </div>
                        ))}
                      </div>
                    )}
                    {effectiveQ.type === 'rating' && (
                      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}>
                        {[1,2,3,4,5].map(s => (
                          <div key={s} style={{ flex: 1, padding: '0.7rem', borderRadius: '10px', border: '1px solid var(--border-color)', background: 'var(--bg-card,#fff)', textAlign: 'center', fontSize: '1.2rem' }}>
                            {'★'.repeat(s)}
                          </div>
                        ))}
                      </div>
                    )}
                    {effectiveQ.type === 'open_text' && (
                      <div style={{ padding: '0.75rem 1rem', borderRadius: '10px', border: '1px dashed var(--border-color)', background: 'var(--bg-card,#fff)', color: 'var(--text-secondary)', fontStyle: 'italic', marginBottom: '1.25rem' }}>
                        Open text response field
                      </div>
                    )}

                    {/* Response count badge */}
                    <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                      {isEffectiveLive ? '⏳ Waiting for responses…' : '0 responses recorded'}
                    </div>

                    {/* Inline edit — only during active session for unanswered, non-live questions */}
                    {poll.status === 'active' && !isEffectiveLive && (
                      liveEditQ?.id === effectiveQ.id ? (
                        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Editing Q{effectiveIdx + 1} — saves without going live
                          </div>
                          <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label" style={{ fontSize: '0.8rem' }}>Question Text</label>
                            <input type="text" className="form-input" value={liveEditText}
                              onChange={e => setLiveEditText(e.target.value)} style={{ fontSize: '0.9rem' }} />
                          </div>
                          {effectiveQ.type === 'multiple_choice' && (
                            <div className="form-group" style={{ margin: 0 }}>
                              <label className="form-label" style={{ fontSize: '0.8rem' }}>Options</label>
                              {liveEditOptions.map((opt, oi) => (
                                <div key={oi} style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.35rem' }}>
                                  <input type="text" className="form-input" value={opt}
                                    onChange={e => setLiveEditOptions(prev => { const n=[...prev]; n[oi]=e.target.value; return n; })}
                                    style={{ flex: 1, fontSize: '0.85rem' }} />
                                  <button className="btn btn-danger btn-sm" style={{ padding: '0.3rem 0.5rem' }}
                                    onClick={() => setLiveEditOptions(prev => prev.filter((_,i2)=>i2!==oi))}
                                    disabled={liveEditOptions.length <= 2}>
                                    <Square size={12} />
                                  </button>
                                </div>
                              ))}
                              {liveEditOptions.length < 20 && (
                                <button className="btn btn-secondary btn-sm"
                                  onClick={() => setLiveEditOptions(prev => [...prev, `Option ${prev.length + 1}`])}>
                                  <Plus size={12} /> Add Option
                                </button>
                              )}
                            </div>
                          )}
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button className="btn btn-success btn-sm" onClick={handleSaveLiveEdit} disabled={liveEditSaving}>
                              <Save size={13} /> {liveEditSaving ? 'Saving…' : 'Save Changes'}
                            </button>
                            <button className="btn btn-secondary btn-sm" onClick={() => setLiveEditQ(null)}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <button className="btn btn-secondary btn-sm"
                          onClick={() => { setLiveEditQ(effectiveQ); setLiveEditText(effectiveQ.text || ''); setLiveEditOptions([...(effectiveQ.options||[])]); }}>
                          ✏️ Edit Question
                        </button>
                      )
                    )}
                  </div>
                )
              }

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
                }}
                style={{ width: '100%', fontSize: '0.85rem' }}
              />
            </div>

            {/* Target info + Show on Projector */}
            {isValidRespNav && (
              <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                <div style={{ flex: 1, fontSize: '0.78rem', padding: '0.45rem 0.7rem', borderRadius: '8px', background: 'rgba(43,95,217,0.06)', border: '1px solid rgba(43,95,217,0.18)', color: 'var(--color-primary)', fontWeight: 600 }}>
                  {respNavQ
                    ? `Q${respNavQNum} · Response #${respNavRIdx + 1}`
                    : `Q${respNavQNum} out of range`}
                </div>
                {respNavQ && (() => {
                  const isSpotlit = poll.projector_mode === 'question_single'
                    && poll.projector_question_id === respNavQ.id
                    && poll.projector_single_option === respNavHighlightedOption
                    && !!respNavHighlightedOption;
                  return (
                    <button className={`btn btn-sm ${isSpotlit ? 'btn-secondary' : 'btn-success'}`}
                      style={{ fontSize: '0.72rem', padding: '0.25rem 0.55rem', flexShrink: 0 }}
                      onClick={() => {
                        if (isSpotlit) {
                          const extra = { projector_mode: 'banner' };
                          setPoll(p => ({ ...p, ...extra }));
                          updatePoll(poll.id, extra).catch(console.error);
                        } else {
                          const extra = { projector_mode: 'question_single', projector_question_id: respNavQ.id, projector_single_option: respNavHighlightedOption };
                          setPoll(p => ({ ...p, ...extra }));
                          updatePoll(poll.id, extra).catch(console.error);
                        }
                      }}>
                      {isSpotlit ? '🚫 Hide' : '📽 Show'}
                    </button>
                  );
                })()}
              </div>
            )}

            {/* Response list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', overflowY: 'auto', maxHeight: '300px' }}>
              {respNavQ ? (() => {
                const rows = respNavRows;
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

            {/* PDF downloads */}
            {(() => {
              const qList = questions.map((q, idx) => ({ ...q, qNum: idx + 1 }));
              const hasAnyPDF = qList.some(q => (allResponses[q.id]?.length ?? 0) > 0);
              const hasOptions = qList.some(q => (q.options || []).length > 0);
              if (!hasAnyPDF && !hasOptions) return null;
              return (
                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>PDF</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
                    {/* All Options card */}
                    {hasOptions && (
                      <div style={{ border: '1.5px solid var(--border-color)', borderRadius: '12px', padding: '0.7rem 0.4rem', background: 'var(--bg-card)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.45rem', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>All Options</div>
                        <div style={{ display: 'flex', gap: '0.3rem' }}>
                          <button className="btn btn-secondary" style={{ padding: '0.38rem 0.45rem', lineHeight: 1 }} onClick={() => buildOptionsPDF(false)}><FileDown size={16} /></button>
                          <button className="btn btn-secondary" style={{ padding: '0.38rem 0.45rem', fontSize: '0.9rem', lineHeight: 1 }} onClick={() => buildOptionsPDF(true)}>🖨</button>
                        </div>
                      </div>
                    )}
                    {/* Per-question cards */}
                    {qList.map(q => {
                      const qResps = allResponses[q.id] || [];
                      if (qResps.length === 0) return null;
                      return (
                        <div key={q.id} style={{ border: '1.5px solid var(--border-color)', borderRadius: '12px', padding: '0.7rem 0.4rem', background: 'var(--bg-card)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.45rem', textAlign: 'center' }}>
                          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>Q{q.qNum}</div>
                          <div style={{ display: 'flex', gap: '0.3rem' }}>
                            <button className="btn btn-secondary" style={{ padding: '0.38rem 0.45rem', lineHeight: 1 }} onClick={() => buildQuestionPDF(q, qResps, q.qNum, false)}><FileDown size={16} /></button>
                            <button className="btn btn-secondary" style={{ padding: '0.38rem 0.45rem', fontSize: '0.9rem', lineHeight: 1 }} onClick={() => buildQuestionPDF(q, qResps, q.qNum, true)}>🖨</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

          </div>
        </div>

      </div>

      {/* Reset & Restart confirmation dialog */}
      {showResetDialog && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div className="glass-card" style={{ padding: '1.75rem', maxWidth: '440px', width: '100%', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <h3 style={{ margin: '0 0 0.35rem', fontSize: '1.05rem', fontWeight: 700, color: 'var(--color-danger)' }}>Reset &amp; Restart Session</h3>
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                This will <strong>permanently delete</strong> all participant registrations and responses. To confirm, type the event name exactly:
              </p>
            </div>
            <div style={{ padding: '0.6rem 0.85rem', borderRadius: '10px', background: 'rgba(220,42,60,0.07)', border: '1px solid rgba(220,42,60,0.2)', fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-danger)', textAlign: 'center', wordBreak: 'break-word' }}>
              {poll.title}
            </div>
            <input
              type="text"
              className="form-input"
              placeholder="Type event name to confirm"
              value={resetConfirmText}
              onChange={e => setResetConfirmText(e.target.value)}
              autoFocus
              style={{ fontSize: '0.92rem' }}
            />
            <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => { setShowResetDialog(false); setResetConfirmText(''); }}>
                Cancel
              </button>
              <button className="btn btn-danger"
                disabled={resetConfirmText !== poll.title}
                onClick={handleResetPoll}
                style={{ opacity: resetConfirmText !== poll.title ? 0.4 : 1 }}>
                <RefreshCw size={14} /> Delete &amp; Restart
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

 
