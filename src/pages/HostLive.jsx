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
  const [questionSearch, setQuestionSearch] = useState('');
  const [draftQuestionIndex, setDraftQuestionIndex] = useState(0);
  const [questionCountdown, setQuestionCountdown] = useState(0);
  const questionTimerRef = useRef(null);
  const [rangeLeaderboard, setRangeLeaderboard] = useState([]);
  const [overallLeaderboard, setOverallLeaderboard] = useState([]);
  const [showRangeLeaderboard, setShowRangeLeaderboard] = useState(false);
  const [showOverallLeaderboard, setShowOverallLeaderboard] = useState(false);

  // Keep a ref to the active question ID for the realtime channel callback
  const activeQuestionIdRef = useRef(null);

  useEffect(() => {
    fetchPollAndQuestions();
  }, [id]);

  useEffect(() => {
    if (poll?.status === 'draft' && questions.length > 0) {
      setDraftQuestionIndex(0);
    }
  }, [poll?.status, questions.length]);

  useEffect(() => {
    setDraftQuestionIndex(0);
  }, [questionSearch]);

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

  // Compute leaderboard for an array of question IDs
  const computeLeaderboard = async (questionIds) => {
    try {
      if (!questionIds || questionIds.length === 0) return [];
      const { data, error } = await supabase
        .from('responses')
        .select(`id, answer, question_id, participant_id, participants (id, name, phone)`)
        .in('question_id', questionIds);

      if (error) throw error;

      // Group responses by question
      const responsesByQuestion = {};
      data.forEach((r) => {
        responsesByQuestion[r.question_id] = responsesByQuestion[r.question_id] || [];
        responsesByQuestion[r.question_id].push(r);
      });

      const pointsByParticipant = {};

      // For each question, compute top-10 options and award points per selection
      for (const qId of questionIds) {
        const q = questions.find((qq) => qq.id === qId);
        if (!q) continue;
        const resps = responsesByQuestion[qId] || [];

        // Tally votes per option
        const tallies = {};
        (q.options || []).forEach((opt) => { tallies[opt] = 0; });
        resps.forEach((r) => {
          const parts = (r.answer || '').split(',').map((s) => s.trim()).filter(Boolean);
          parts.forEach((p) => {
            if (tallies[p] !== undefined) tallies[p]++;
          });
        });

        // Determine top-10 options
        const sortedOpts = Object.keys(tallies).sort((a, b) => tallies[b] - tallies[a]);
        const top10 = sortedOpts.slice(0, 10);
        const rankMap = {};
        top10.forEach((opt, idx) => { rankMap[opt] = idx + 1; });

        // Award points to participants based on their selected options
        resps.forEach((r) => {
          const pid = r.participant_id;
          if (!pointsByParticipant[pid]) {
            pointsByParticipant[pid] = { name: r.participants?.name || 'Anonymous', phone: r.participants?.phone || '', points: 0 };
          }
          const parts = (r.answer || '').split(',').map((s) => s.trim()).filter(Boolean);
          parts.forEach((p) => {
            const rank = rankMap[p];
            if (rank) {
              pointsByParticipant[pid].points += (11 - rank);
            }
          });
        });
      }

      const arr = Object.keys(pointsByParticipant).map((pid) => ({ participant_id: pid, name: pointsByParticipant[pid].name, phone: pointsByParticipant[pid].phone, points: pointsByParticipant[pid].points }));
      arr.sort((a, b) => b.points - a.points);
      return arr;
    } catch (err) {
      console.error('Error computing leaderboard:', err);
      return [];
    }
  };

  const showLeaderboardForRange = async (startIndexInclusive) => {
    const slice = questions.slice(startIndexInclusive, startIndexInclusive + 10);
    const qIds = slice.map(q => q.id).filter(Boolean);
    const lb = await computeLeaderboard(qIds);
    setRangeLeaderboard(lb);
    setShowRangeLeaderboard(true);
  };

  const showOverall = async () => {
    const qIds = questions.map(q => q.id).filter(Boolean);
    const lb = await computeLeaderboard(qIds);
    setOverallLeaderboard(lb);
    setShowOverallLeaderboard(true);
  };

  // When current question moves and it's the 10th, 20th, etc., show range leaderboard and save it
  useEffect(() => {
    if (!currentQuestion || questions.length === 0) return;
    const idx = questions.findIndex(q => q.id === currentQuestion.id);
    if (idx < 0) return;
    const qNumber = idx + 1;
    if (qNumber % 10 === 0) {
      const start = Math.floor(idx / 10) * 10;
      showLeaderboardForRange(start);
      // Save this range leaderboard to Supabase
      saveLeaderboardRange(start, start + 10);
    }
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
      // Start session but do not start the first question automatically.
      const { error } = await supabase
        .from('polls')
        .update({
          status: 'active',
          current_question_id: null
        })
        .eq('id', poll.id);

      if (error) throw error;
      setPoll({ ...poll, status: 'active', current_question_id: null });
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

  const endQuestionOnServer = async () => {
    try {
      const { error } = await supabase
        .from('polls')
        .update({ current_question_id: null })
        .eq('id', poll.id);
      if (error) console.error('Error clearing current_question_id:', error);
      setPoll((p) => ({ ...p, current_question_id: null }));
    } catch (err) {
      console.error(err);
    }
  };

  // Save top 10 responses for a question to Supabase
  const saveTop10ResponsesForQuestion = async (questionId) => {
    try {
      const { data, error } = await supabase
        .from('responses')
        .select(`id, answer, question_id, participant_id, participants (id, name, phone)`)
        .eq('question_id', questionId);

      if (error) throw error;

      const question = questions.find(q => q.id === questionId);
      if (!question) return;

      // Tally votes per option
      const tallies = {};
      (question.options || []).forEach((opt) => { tallies[opt] = 0; });
      data.forEach((r) => {
        const parts = (r.answer || '').split(',').map((s) => s.trim()).filter(Boolean);
        parts.forEach((p) => {
          if (tallies[p] !== undefined) tallies[p]++;
        });
      });

      // Get top 10 options
      const sortedOpts = Object.keys(tallies).sort((a, b) => tallies[b] - tallies[a]);
      const top10 = sortedOpts.slice(0, 10);

      if (top10.length > 0) {
        // Delete existing entries for this question first (avoid duplicate key error)
        const { error: deleteError } = await supabase
          .from('top_responses')
          .delete()
          .eq('poll_id', poll.id)
          .eq('question_id', questionId);

        if (deleteError) console.error('Error deleting old top responses:', deleteError);

        // Save to top_responses table
        const top10Data = top10.map((option, rank) => ({
          poll_id: poll.id,
          question_id: questionId,
          option: option,
          rank: rank + 1,
          votes: tallies[option],
          created_at: new Date().toISOString()
        }));

        const { error: insertError } = await supabase
          .from('top_responses')
          .insert(top10Data);

        if (insertError) throw insertError;
      }
    } catch (err) {
      console.error('Error saving top 10 responses:', err);
    }
  };

  // Save leaderboard for a range of questions (every 10 questions)
  const saveLeaderboardRange = async (startIndexInclusive, endIndexExclusive) => {
    try {
      const slice = questions.slice(startIndexInclusive, endIndexExclusive);
      const qIds = slice.map(q => q.id).filter(Boolean);
      
      const leaderboard = await computeLeaderboard(qIds);
      
      // Get the range display text (e.g., "Questions 1-10")
      const rangeStart = startIndexInclusive + 1;
      const rangeEnd = Math.min(endIndexExclusive, questions.length);
      const rangeLabel = `Questions ${rangeStart}-${rangeEnd}`;

      // Save to leaderboards table
      const { error } = await supabase
        .from('leaderboards')
        .insert({
          poll_id: poll.id,
          range_label: rangeLabel,
          start_question_index: startIndexInclusive,
          end_question_index: endIndexExclusive,
          leaderboard_data: leaderboard,
          created_at: new Date().toISOString()
        });

      if (error) throw error;
    } catch (err) {
      console.error('Error saving range leaderboard:', err);
    }
  };

  // Save overall leaderboard to Supabase
  const saveOverallLeaderboardToDb = async () => {
    try {
      const qIds = questions.map(q => q.id).filter(Boolean);
      const leaderboard = await computeLeaderboard(qIds);

      // Save to leaderboards table
      const { error } = await supabase
        .from('leaderboards')
        .insert({
          poll_id: poll.id,
          range_label: 'Overall',
          start_question_index: 0,
          end_question_index: questions.length,
          leaderboard_data: leaderboard,
          created_at: new Date().toISOString()
        });

      if (error) throw error;
    } catch (err) {
      console.error('Error saving overall leaderboard:', err);
    }
  };

  const startQuestionTimer = (questionData, seconds = 30) => {
    clearQuestionTimer();
    setQuestionCountdown(seconds);
    questionTimerRef.current = setInterval(() => {
      setQuestionCountdown((prev) => {
        if (prev <= 1) {
          clearQuestionTimer();
          // Save top 10 responses before ending question
          if (questionData && questionData.id) {
            saveTop10ResponsesForQuestion(questionData.id);
          }
          // End question for participants by clearing current_question_id
          endQuestionOnServer();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleStartQuestion = async (q) => {
    if (!poll) return;
    try {
      const { error } = await supabase
        .from('polls')
        .update({ current_question_id: q.id })
        .eq('id', poll.id);
      if (error) throw error;
      setPoll({ ...poll, current_question_id: q.id });
      setCurrentQuestion(q);
      // Start 30s timer for this question
      startQuestionTimer(q, 30);
    } catch (err) {
      console.error('Failed to start question:', err);
      setErrorMessage('Failed to start question.');
    }
  };

  const handleEndPoll = async () => {
    try {
      // Save overall leaderboard before ending
      await saveOverallLeaderboardToDb();

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

    // Sort options by votes desc, tie-break alphabetically
    const sortedOptions = options.slice().sort((a, b) => {
      const da = tallies[a] || 0;
      const db = tallies[b] || 0;
      if (db !== da) return db - da;
      return a.localeCompare(b);
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

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', margin: '4rem 0' }}>
        <div className="spinner" style={{ width: '40px', height: '40px' }}></div>
      </div>
    );
  }

  const currentIndex = questions.findIndex(q => q.id === currentQuestion?.id);

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
                    <button className="btn btn-success" onClick={handleStartPoll} disabled={questions.length === 0 || savingDraft || loading}>
                      <Play size={16} /> Start Poll Session
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
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  {poll.status === 'active' && !poll.current_question_id && (
                    <button className="btn btn-success" onClick={() => handleStartQuestion(currentQuestion)}>
                      Start Question
                    </button>
                  )}
                  {questionCountdown > 0 && (
                    <div style={{ padding: '0.5rem 0.75rem', borderRadius: '12px', background: 'rgba(255,255,255,0.03)', fontWeight: 700 }}>
                      Time left: {questionCountdown}s
                    </div>
                  )}
                </div>
              </div>

              {/* Show different visualization based on question type */}
              {currentQuestion.type === 'multiple_choice' && renderMCResults()}
              {currentQuestion.type === 'rating' && renderRatingResults()}
              {currentQuestion.type === 'open_text' && renderOpenTextResults()}

              {/* Leaderboard controls & displays */}
              <div style={{ marginTop: '1.5rem', marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <button className="btn btn-secondary" onClick={() => showLeaderboardForRange(0)}>
                    Show First 10 Leaderboard
                  </button>
                  <button className="btn btn-secondary" onClick={showOverall}>
                    Show Overall Leaderboard
                  </button>
                </div>

                {showRangeLeaderboard && (
                  <div style={{ marginTop: '1rem' }}>
                    <h4 style={{ marginBottom: '0.5rem' }}>Leaderboard (range)</h4>
                    {rangeLeaderboard.length === 0 ? <div>No scores yet.</div> : (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
                        {rangeLeaderboard.map((p, idx) => (
                          <div key={p.participant_id} className={`mc-option-button`} style={{ padding: '12px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div style={{ width: 44, height: 44, borderRadius: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-accent)', color: '#fff', fontWeight: 800, fontSize: '1rem' }}>{idx + 1}</div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name || 'Anonymous'}</div>
                              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{p.phone || p.participant_id || '—'}</div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontWeight: 800, fontSize: '1.1rem' }}>{p.points}</div>
                              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>pts</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div style={{ marginTop: '0.75rem' }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => setShowRangeLeaderboard(false)}>Close</button>
                    </div>
                  </div>
                )}

                {showOverallLeaderboard && (
                  <div style={{ marginTop: '1rem' }}>
                    <h4 style={{ marginBottom: '0.5rem' }}>Overall Leaderboard</h4>
                    {overallLeaderboard.length === 0 ? <div>No scores yet.</div> : (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
                        {overallLeaderboard.map((p, idx) => (
                          <div key={p.participant_id} className={`mc-option-button`} style={{ padding: '12px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div style={{ width: 44, height: 44, borderRadius: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-accent)', color: '#fff', fontWeight: 800, fontSize: '1rem' }}>{idx + 1}</div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name || 'Anonymous'}</div>
                              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{p.phone || p.participant_id || '—'}</div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontWeight: 800, fontSize: '1.1rem' }}>{p.points}</div>
                              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>pts</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div style={{ marginTop: '0.75rem' }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => setShowOverallLeaderboard(false)}>Close</button>
                    </div>
                  </div>
                )}
              </div>

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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <h3 style={{ fontSize: '1.1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>Questions Navigator</h3>
              <input
                type="search"
                className="form-input"
                placeholder="Search question, number, or options"
                value={questionSearch}
                onChange={(e) => setQuestionSearch(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', overflowY: 'auto', maxHeight: '400px' }}>
              {filteredQuestions.length === 0 ? (
                <div style={{ padding: '1rem', border: '1px dashed var(--border-color)', borderRadius: '16px', color: 'var(--text-secondary)' }}>
                  No matching questions found.
                </div>
              ) : (
                filteredQuestions.map((q) => {
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
                        <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', fontWeight: 700 }}>Question {q.questionNumber}</span>
                        <span style={{ fontSize: '0.9rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                          {q.text}
                        </span>
                      </div>
                    </button>
                  );
                }) )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

 
