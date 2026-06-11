import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { getHostId, generateJoinCode } from '../utils';
import { ArrowLeft, Plus, Trash2, ChevronUp, ChevronDown, Save } from 'lucide-react';

export default function PollForm() {
  const { id } = useParams(); // undefined if creating
  const navigate = useNavigate();
  const hostId = getHostId();
  const isEdit = !!id;

  const [title, setTitle] = useState('');
  const [questions, setQuestions] = useState([
    { text: '', type: 'multiple_choice', options: ['Option 1', 'Option 2'] }
  ]);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(isEdit);

  useEffect(() => {
    if (isEdit) {
      fetchPollData();
    }
  }, [id]);

  const fetchPollData = async () => {
    try {
      // Fetch poll details
      const { data: poll, error: pollError } = await supabase
        .from('polls')
        .select('*')
        .eq('id', id)
        .eq('host_id', hostId)
        .single();

      if (pollError || !poll) {
        console.error('Error fetching poll:', pollError);
        alert('Poll not found or unauthorized.');
        navigate('/dashboard');
        return;
      }

      setTitle(poll.title);

      // Fetch poll questions ordered by order_index
      const { data: questionsData, error: qError } = await supabase
        .from('questions')
        .select('*')
        .eq('poll_id', id)
        .order('order_index', { ascending: true });

      if (qError) throw qError;

      if (questionsData && questionsData.length > 0) {
        setQuestions(
          questionsData.map((q) => ({
            id: q.id,
            text: q.text,
            type: q.type,
            options: q.options || []
          }))
        );
      }
    } catch (err) {
      console.error(err);
      alert('Failed to load poll details.');
    } finally {
      setFetching(false);
    }
  };

  const handleAddQuestion = () => {
    setQuestions([
      ...questions,
      { text: '', type: 'multiple_choice', options: ['Option 1', 'Option 2'] }
    ]);
  };

  const handleRemoveQuestion = (index) => {
    if (questions.length === 1) {
      alert('Your poll must have at least one question.');
      return;
    }
    setQuestions(questions.filter((_, idx) => idx !== index));
  };

  const handleQuestionTextChange = (index, val) => {
    const updated = [...questions];
    updated[index].text = val;
    setQuestions(updated);
  };

  const handleQuestionTypeChange = (index, type) => {
    const updated = [...questions];
    updated[index].type = type;
    if (type === 'multiple_choice' && (!updated[index].options || updated[index].options.length === 0)) {
      updated[index].options = ['Option 1', 'Option 2'];
    }
    setQuestions(updated);
  };

  const handleOptionChange = (qIndex, oIndex, val) => {
    const updated = [...questions];
    updated[qIndex].options[oIndex] = val;
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
      alert('Multiple choice questions need at least 2 options.');
      return;
    }
    updated[qIndex].options = updated[qIndex].options.filter((_, idx) => idx !== oIndex);
    setQuestions(updated);
  };

  const handleMoveQuestion = (index, direction) => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === questions.length - 1) return;

    const newIndex = direction === 'up' ? index - 1 : index + 1;
    const updated = [...questions];
    const temp = updated[index];
    updated[index] = updated[newIndex];
    updated[newIndex] = temp;
    setQuestions(updated);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!title.trim()) {
      alert('Please enter a poll title.');
      return;
    }

    for (let i = 0; i < questions.length; i++) {
      if (!questions[i].text.trim()) {
        alert(`Question ${i + 1} has no text. Please fill it in.`);
        return;
      }
      if (questions[i].type === 'multiple_choice') {
        for (let j = 0; j < questions[i].options.length; j++) {
          if (!questions[i].options[j].trim()) {
            alert(`Option ${j + 1} in Question ${i + 1} is empty.`);
            return;
          }
        }
      }
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
          const { data } = await supabase
            .from('polls')
            .select('id')
            .eq('join_code', uniqueCode)
            .maybeSingle();
          if (!data) exists = false;
        }

        // Insert new poll
        const { data: newPoll, error: pollError } = await supabase
          .from('polls')
          .insert({
            title: title.trim(),
            join_code: uniqueCode,
            host_id: hostId,
            status: 'draft'
          })
          .select()
          .single();

        if (pollError) throw pollError;
        pollId = newPoll.id;
      } else {
        // Update poll title
        const { error: pollError } = await supabase
          .from('polls')
          .update({ title: title.trim() })
          .eq('id', pollId)
          .eq('host_id', hostId);

        if (pollError) throw pollError;
      }

      // Handle Questions (simple approach: delete existing if edit, and re-insert)
      if (isEdit) {
        const { error: deleteError } = await supabase
          .from('questions')
          .delete()
          .eq('poll_id', pollId);

        if (deleteError) throw deleteError;
      }

      // Insert questions
      const questionsToInsert = questions.map((q, idx) => ({
        poll_id: pollId,
        text: q.text.trim(),
        type: q.type,
        options: q.type === 'multiple_choice' ? q.options.map((o) => o.trim()) : [],
        order_index: idx
      }));

      const { error: insertError } = await supabase
        .from('questions')
        .insert(questionsToInsert);

      if (insertError) throw insertError;

      navigate('/dashboard');
    } catch (err) {
      console.error(err);
      alert('Error saving poll details.');
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

        <div style={{ marginTop: '2.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem', marginBottom: '1.5rem' }}>
            <h2>Questions</h2>
            <button type="button" className="btn btn-secondary btn-sm" onClick={handleAddQuestion} disabled={loading}>
              <Plus size={14} /> Add Question
            </button>
          </div>

          <div className="questions-list">
            {questions.map((q, qIndex) => (
              <div className="question-card" key={qIndex}>
                <div className="question-card-header">
                  <span className="question-number">Question {qIndex + 1}</span>
                  <div style={{ display: 'flex', gap: '0.25rem' }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleMoveQuestion(qIndex, 'up')}
                      disabled={qIndex === 0 || loading}
                      style={{ padding: '0.25rem 0.5rem' }}
                    >
                      <ChevronUp size={14} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleMoveQuestion(qIndex, 'down')}
                      disabled={qIndex === questions.length - 1 || loading}
                      style={{ padding: '0.25rem 0.5rem' }}
                    >
                      <ChevronDown size={14} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => handleRemoveQuestion(qIndex)}
                      disabled={loading}
                      style={{ padding: '0.25rem 0.5rem' }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Question Text</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Enter your question here"
                    value={q.text}
                    onChange={(e) => handleQuestionTextChange(qIndex, e.target.value)}
                    disabled={loading}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Question Type</label>
                  <select
                    className="form-select"
                    value={q.type}
                    onChange={(e) => handleQuestionTypeChange(qIndex, e.target.value)}
                    disabled={loading}
                  >
                    <option value="multiple_choice">Multiple Choice</option>
                    <option value="open_text">Open Ended Text</option>
                    <option value="rating">Rating (1-5 stars)</option>
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
                          onChange={(e) => handleOptionChange(qIndex, oIndex, e.target.value)}
                          disabled={loading}
                        />
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => handleRemoveOption(qIndex, oIndex)}
                          disabled={loading}
                          style={{ padding: '0.5rem' }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      style={{ width: 'fit-content', marginTop: '0.5rem' }}
                      onClick={() => handleAddOption(qIndex)}
                      disabled={loading}
                    >
                      <Plus size={12} /> Add Option
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '3rem' }} disabled={loading}>
          {loading ? <div className="spinner"></div> : <><Save size={18} /> Save Poll</>}
        </button>
      </form>
    </div>
  );
}
