import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  orderBy,
  limit,
  setDoc,
  addDoc,
  updateDoc,
  writeBatch,
  onSnapshot
} from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

export const hasValidConfig = !!(
  firebaseConfig.apiKey &&
  firebaseConfig.authDomain &&
  firebaseConfig.projectId &&
  firebaseConfig.appId
);

const configToUse = hasValidConfig ? firebaseConfig : {
  apiKey: 'placeholder-api-key',
  authDomain: 'placeholder-auth-domain',
  projectId: 'placeholder-project-id',
  storageBucket: 'placeholder-storage-bucket',
  messagingSenderId: 'placeholder-sender-id',
  appId: 'placeholder-app-id'
};

export const app = initializeApp(configToUse);
export const db = getFirestore(app);
export const auth = getAuth(app);

// Initialize anonymous auth — keep localStorage host_id in sync with UID (unless host logged in with phone)
if (hasValidConfig) {
  onAuthStateChanged(auth, (user) => {
    if (user) {
      const hasHostPhone = localStorage.getItem('pulsepoint_host_phone');
      if (!hasHostPhone) {
        const stored = localStorage.getItem('pulsepoint_host_id');
        if (stored !== user.uid) {
          localStorage.setItem('pulsepoint_host_id', user.uid);
          // Reload so all components pick up the correct hostId on first load
          window.location.reload();
        }
      }
    } else {
      signInAnonymously(auth).catch((err) => {
        console.error('Anonymous authentication failed:', err);
      });
    }
  });
}

// -------------------------------------------------------------
// Polls
// -------------------------------------------------------------

/**
 * Get poll by join code
 */
export const getPollByJoinCode = async (code) => {
  const q = query(
    collection(db, 'polls'),
    where('join_code', '==', code.toUpperCase()),
    limit(1)
  );
  const snapshot = await getDocs(q);
  if (snapshot.empty) return null;
  return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
};

/**
 * Get poll by ID. Pass hostId to enforce ownership check.
 */
export const getPollById = async (id, hostId) => {
  const snap = await getDoc(doc(db, 'polls', id));
  if (!snap.exists()) return null;
  const data = snap.data();
  if (hostId && data.host_id !== hostId) return null;
  return { id: snap.id, ...data };
};

/**
 * Get all polls with question counts — parallel fetches for speed
 */
export const getAllPolls = async () => {
  const snapshot = await getDocs(
    query(collection(db, 'polls'), orderBy('created_at', 'desc'))
  );
  return Promise.all(
    snapshot.docs.map(async (docSnap) => {
      const data = docSnap.data();
      if (data.question_count !== undefined) {
        return {
          id: docSnap.id,
          ...data
        };
      }
      // Fallback: fetch count dynamically for older docs and backfill it in the background
      const questionsSnapshot = await getDocs(
        collection(db, 'polls', docSnap.id, 'questions')
      );
      const count = questionsSnapshot.size;
      updateDoc(doc(db, 'polls', docSnap.id), { question_count: count }).catch(() => {});
      return {
        id: docSnap.id,
        ...data,
        question_count: count
      };
    })
  );
};

/**
 * Get polls created by a specific host (lookup by phone/ID or anonymous UID)
 */
export const getPollsForHost = async (hostId, anonymousUid) => {
  if (!hostId && !anonymousUid) return [];

  const hostIds = [...new Set([hostId, anonymousUid].filter(Boolean))];

  // Run one query per hostId to avoid composite index requirements,
  // then merge and sort in JS.
  const snapshots = await Promise.all(
    hostIds.map((hid) =>
      getDocs(query(collection(db, 'polls'), where('host_id', '==', hid)))
    )
  );

  const seen = new Set();
  const allDocs = [];
  for (const snapshot of snapshots) {
    for (const docSnap of snapshot.docs) {
      if (!seen.has(docSnap.id)) {
        seen.add(docSnap.id);
        allDocs.push(docSnap);
      }
    }
  }

  const results = await Promise.all(
    allDocs.map(async (docSnap) => {
      const data = docSnap.data();
      if (data.question_count !== undefined) {
        return { id: docSnap.id, ...data };
      }
      const questionsSnapshot = await getDocs(
        collection(db, 'polls', docSnap.id, 'questions')
      );
      const count = questionsSnapshot.size;
      updateDoc(doc(db, 'polls', docSnap.id), { question_count: count }).catch(() => {});
      return { id: docSnap.id, ...data, question_count: count };
    })
  );

  return results.sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at)
  );
};

/**
 * Create a new poll document
 */
export const createPoll = async (title, hostId, uniqueCode) => {
  const newPoll = {
    title,
    join_code: uniqueCode,
    host_id: hostId,
    status: 'draft',
    current_question_id: null,
    question_count: 0,
    created_at: new Date().toISOString()
  };
  const docRef = await addDoc(collection(db, 'polls'), newPoll);
  return { id: docRef.id, ...newPoll };
};

/**
 * Partial update of a poll document
 */
export const updatePoll = async (id, updateData) => {
  await updateDoc(doc(db, 'polls', id), updateData);
};

/**
 * Delete a poll and all subcollection documents atomically
 */
export const deletePoll = async (id) => {
  const subcollections = ['questions', 'participants', 'responses', 'leaderboard'];
  const snapshots = await Promise.all(
    subcollections.map((sub) => getDocs(collection(db, 'polls', id, sub)))
  );
  const batch = writeBatch(db);
  snapshots.forEach((snap) => snap.docs.forEach((d) => batch.delete(d.ref)));
  batch.delete(doc(db, 'polls', id));
  await batch.commit();
};

// -------------------------------------------------------------
// Questions
// -------------------------------------------------------------

/**
 * Get all questions for a poll ordered by index
 */
export const getQuestionsForPoll = async (pollId) => {
  const snap = await getDocs(
    query(collection(db, 'polls', pollId, 'questions'), orderBy('order_index', 'asc'))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

export const subscribeToQuestions = (pollId, callback) => {
  const q = query(collection(db, 'polls', pollId, 'questions'), orderBy('order_index', 'asc'));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
};

/**
 * Get a single question by ID
 */
export const getQuestionById = async (pollId, qId) => {
  const snap = await getDoc(doc(db, 'polls', pollId, 'questions', qId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
};

/**
 * Atomically save the poll title and rewrite all questions in a single batch.
 * Returns the freshly saved question list so callers don't need a second fetch.
 */
export const saveDraftQuestions = async (pollId, title, questions) => {
  const existingSnap = await getDocs(collection(db, 'polls', pollId, 'questions'));
  const batch = writeBatch(db);

  batch.update(doc(db, 'polls', pollId), { 
    title,
    question_count: questions.length
  });
  existingSnap.docs.forEach((d) => batch.delete(d.ref));
  questions.forEach((q, idx) => {
    const ref = doc(collection(db, 'polls', pollId, 'questions'));
    batch.set(ref, {
      text: q.text.trim(),
      type: q.type,
      options: q.type === 'multiple_choice' ? q.options.map((o) => o.trim()) : [],
      order_index: idx,
      created_at: new Date().toISOString()
    });
  });
  await batch.commit();

  // Return saved questions so the caller can update state without a re-fetch
  const newSnap = await getDocs(
    query(collection(db, 'polls', pollId, 'questions'), orderBy('order_index', 'asc'))
  );
  return newSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

// -------------------------------------------------------------
// Participants
// -------------------------------------------------------------

/**
 * Check if a phone number is already registered for a poll
 */
export const checkPhoneRegistration = async (pollId, phone) => {
  const q = query(
    collection(db, 'polls', pollId, 'participants'),
    where('phone', '==', phone)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
};

/**
 * Register or update a participant (session ID is the document ID)
 */
export const registerParticipant = async (pollId, name, phone, sessionId) => {
  const ref = doc(db, 'polls', pollId, 'participants', sessionId);
  const data = {
    poll_id: pollId,
    name: name.trim(),
    phone,
    session_id: sessionId,
    created_at: new Date().toISOString()
  };
  await setDoc(ref, data, { merge: true });
  return { id: sessionId, ...data };
};

/**
 * Fetch a participant record by session ID
 */
export const getParticipant = async (pollId, sessionId) => {
  const snap = await getDoc(doc(db, 'polls', pollId, 'participants', sessionId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
};

// -------------------------------------------------------------
// Responses
// -------------------------------------------------------------

/**
 * Get all responses for a poll with denormalised participant fields
 */
export const getResponsesForPoll = async (pollId) => {
  const snap = await getDocs(collection(db, 'polls', pollId, 'responses'));
  return snap.docs.map((d) => {
    const r = d.data();
    return {
      id: d.id,
      answer: r.answer,
      question_id: r.question_id,
      participant_id: r.participant_id,
      participants: {
        id: r.participant_id,
        name: r.participant_name || 'Anonymous',
        phone: r.participant_phone || ''
      }
    };
  });
};

/**
 * Check if a participant has already answered a question
 */
export const getResponseForParticipant = async (pollId, questionId, participantId) => {
  const q = query(
    collection(db, 'polls', pollId, 'responses'),
    where('question_id', '==', questionId),
    where('participant_id', '==', participantId),
    limit(1)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
};

/**
 * Submit a response. Leaderboard update runs in the background
 * so it doesn't block the participant from seeing their confirmation.
 */
export const submitResponse = async (pollId, questionId, participant, answerText) => {
  const data = {
    question_id: questionId,
    participant_id: participant.id,
    participant_name: participant.name,
    participant_phone: participant.phone,
    answer: answerText,
    created_at: new Date().toISOString()
  };
  const ref = await addDoc(collection(db, 'polls', pollId, 'responses'), data);
  // Non-blocking background update
  updateLeaderboard(pollId).catch((err) => console.error('Leaderboard update failed:', err));
  return { id: ref.id, ...data };
};

/**
 * Reset poll: parallel fetch + single batch delete for speed
 */
export const resetPollData = async (pollId) => {
  const [pSnap, rSnap, lSnap] = await Promise.all([
    getDocs(collection(db, 'polls', pollId, 'participants')),
    getDocs(collection(db, 'polls', pollId, 'responses')),
    getDocs(collection(db, 'polls', pollId, 'leaderboard'))
  ]);
  const batch = writeBatch(db);
  pSnap.docs.forEach((d) => batch.delete(d.ref));
  rSnap.docs.forEach((d) => batch.delete(d.ref));
  lSnap.docs.forEach((d) => batch.delete(d.ref));
  batch.update(doc(db, 'polls', pollId), { status: 'draft', current_question_id: null });
  await batch.commit();
};

// -------------------------------------------------------------
// Realtime Subscriptions
// -------------------------------------------------------------

/** Subscribe to poll document changes */
export const subscribeToPoll = (pollId, callback) =>
  onSnapshot(doc(db, 'polls', pollId), (snap) => {
    if (snap.exists()) callback({ id: snap.id, ...snap.data() });
  });

/** Subscribe to participant count changes */
export const subscribeToParticipantsCount = (pollId, callback) =>
  onSnapshot(collection(db, 'polls', pollId, 'participants'), (snap) => {
    callback(snap.size);
  });

/** Subscribe to responses for a specific question */
export const subscribeToResponsesForQuestion = (pollId, questionId, callback) => {
  const q = query(
    collection(db, 'polls', pollId, 'responses'),
    where('question_id', '==', questionId)
  );
  return onSnapshot(q, (snap) => {
    callback(
      snap.docs.map((d) => {
        const r = d.data();
        return {
          id: d.id,
          answer: r.answer,
          created_at: r.created_at,
          participants: { name: r.participant_name || 'Anonymous' }
        };
      })
    );
  });
};

// -------------------------------------------------------------
// Leaderboard Aggregation
// -------------------------------------------------------------

/**
 * Compute and persist the overall leaderboard + per-10-question range leaderboards for a poll.
 * Saves: leaderboard/overall, leaderboard/range_0, leaderboard/range_1, ...
 */
export const updateLeaderboard = async (pollId) => {
  try {
    const [questionsSnap, responsesSnap] = await Promise.all([
      getDocs(query(collection(db, 'polls', pollId, 'questions'), orderBy('order_index', 'asc'))),
      getDocs(collection(db, 'polls', pollId, 'responses'))
    ]);

    const questions = questionsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const responses = responsesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    function computeForSubset(questionSubset) {
      const qIds = new Set(questionSubset.map(q => q.id));
      const byQuestion = {};
      responses.forEach(r => {
        if (r.question_id && qIds.has(r.question_id)) {
          byQuestion[r.question_id] = byQuestion[r.question_id] || [];
          byQuestion[r.question_id].push(r);
        }
      });

      const points = {};
      const topResponses = [];

      for (const q of questionSubset) {
        const resps = byQuestion[q.id] || [];
        const tallies = {};
        (q.options || []).forEach(opt => { tallies[opt] = 0; });
        resps.forEach(r => {
          (r.answer || '').split(',').map(s => s.trim()).filter(Boolean).forEach(p => {
            if (tallies[p] !== undefined) tallies[p]++;
          });
        });

        const sorted = Object.keys(tallies).sort((a, b) => tallies[b] - tallies[a]);
        const top10 = sorted.slice(0, 10);
        const rankMap = {};
        top10.forEach((opt, i) => { rankMap[opt] = i + 1; });

        topResponses.push({
          question_id: q.id,
          ranked_options: top10.map((opt, i) => ({ option: opt, rank: i + 1, votes: tallies[opt] }))
        });

        resps.forEach(r => {
          const pid = r.participant_id;
          if (!pid) return;
          if (!points[pid]) {
            points[pid] = { name: r.participant_name || 'Anonymous', phone: r.participant_phone || '', points: 0 };
          }
          (r.answer || '').split(',').map(s => s.trim()).filter(Boolean).forEach(p => {
            const rank = rankMap[p];
            if (rank) points[pid].points += (11 - rank);
          });
        });
      }

      return {
        leaderboard_data: Object.entries(points)
          .map(([pid, v]) => ({ participant_id: pid, ...v }))
          .sort((a, b) => b.points - a.points),
        top_responses: topResponses
      };
    }

    const batch = writeBatch(db);
    const now = new Date().toISOString();

    // Overall leaderboard
    const overall = computeForSubset(questions);
    batch.set(doc(db, 'polls', pollId, 'leaderboard', 'overall'), {
      poll_id: pollId,
      leaderboard_data: overall.leaderboard_data,
      top_responses: overall.top_responses,
      updated_at: now
    });

    // Per-10-question range leaderboards
    const totalRanges = Math.ceil(questions.length / 10) || 0;
    for (let i = 0; i < totalRanges; i++) {
      const rangeQ = questions.slice(i * 10, (i + 1) * 10);
      const rangeResult = computeForSubset(rangeQ);
      batch.set(doc(db, 'polls', pollId, 'leaderboard', `range_${i}`), {
        poll_id: pollId,
        range_index: i,
        question_start: i * 10 + 1,
        question_end: Math.min((i + 1) * 10, questions.length),
        leaderboard_data: rangeResult.leaderboard_data,
        updated_at: now
      });
    }

    await batch.commit();
  } catch (err) {
    console.error('Error updating leaderboard:', err);
  }
};

/** Subscribe to ALL responses for a poll, grouped by question_id */
export const subscribeToAllResponses = (pollId, callback) =>
  onSnapshot(collection(db, 'polls', pollId, 'responses'), (snap) => {
    const byQ = {};
    snap.docs.forEach((d) => {
      const r = d.data();
      if (!r.question_id) return;
      if (!byQ[r.question_id]) byQ[r.question_id] = [];
      byQ[r.question_id].push(r);
    });
    callback(byQ);
  });

/** Subscribe to a specific leaderboard document (e.g. 'overall', 'range_0') */
export const subscribeToLeaderboard = (pollId, docId, callback) =>
  onSnapshot(doc(db, 'polls', pollId, 'leaderboard', docId), (snap) => {
    if (snap.exists()) callback({ id: snap.id, ...snap.data() });
    else callback(null);
  });

// -------------------------------------------------------------
// Host Login & Identity Mapping
// -------------------------------------------------------------

/**
 * Register a new host with name, phone, and password
 */
export const registerHost = async (username, phone, password) => {
  const cleanedPhone = phone.replace(/\D/g, '');
  
  // Check if phone already registered
  const hostDocRef = doc(db, 'hosts', cleanedPhone);
  const hostSnap = await getDoc(hostDocRef);
  if (hostSnap.exists()) {
    throw new Error('A host with this phone number is already registered.');
  }

  let currentUser = auth.currentUser;
  if (!currentUser) {
    currentUser = await new Promise((resolve, reject) => {
      signInAnonymously(auth)
        .then((cred) => resolve(cred.user))
        .catch(reject);
    });
  }

  const hostData = {
    username: username.trim(),
    phone: cleanedPhone,
    password: password.trim(), // Store password
    auth_uid: currentUser ? currentUser.uid : null,
    updated_at: new Date().toISOString()
  };

  await setDoc(hostDocRef, hostData);
  return hostData;
};

/**
 * Authenticate an existing host using username/phone and password
 */
export const authenticateHost = async (identifier, password) => {
  let hostData = null;
  let docId = null;

  const cleanedPhone = identifier.replace(/\D/g, '');
  
  if (cleanedPhone.length === 10) {
    // Look up by phone number
    const hostDocRef = doc(db, 'hosts', cleanedPhone);
    const hostSnap = await getDoc(hostDocRef);
    if (hostSnap.exists()) {
      hostData = hostSnap.data();
      docId = hostSnap.id;
    }
  } else {
    // Look up by username
    const q = query(
      collection(db, 'hosts'),
      where('username', '==', identifier.trim())
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      hostData = snap.docs[0].data();
      docId = snap.docs[0].id;
    }
  }

  if (!hostData || hostData.password !== password.trim()) {
    throw new Error('Incorrect phone number/username or password.');
  }

  // Sync auth UID if authenticated
  let currentUser = auth.currentUser;
  if (!currentUser) {
    currentUser = await new Promise((resolve, reject) => {
      signInAnonymously(auth)
        .then((cred) => resolve(cred.user))
        .catch(reject);
    });
  }

  if (currentUser) {
    const hostDocRef = doc(db, 'hosts', docId);
    await setDoc(hostDocRef, {
      auth_uid: currentUser.uid,
      updated_at: new Date().toISOString()
    }, { merge: true });
    
    // Update the returned hostData
    hostData.auth_uid = currentUser.uid;
  }

  return hostData;
};

/**
 * Log in a host by mapping their phone number to their anonymous firebase auth UID.
 * Keep for backward compatibility or fallbacks.
 */
export const loginHost = async (username, phone) => {
  const cleanedPhone = phone.replace(/\D/g, '');
  let currentUser = auth.currentUser;
  
  if (!currentUser) {
    currentUser = await new Promise((resolve, reject) => {
      signInAnonymously(auth)
        .then((cred) => resolve(cred.user))
        .catch(reject);
    });
  }

  const hostData = {
    username: username.trim(),
    phone: cleanedPhone,
    auth_uid: currentUser ? currentUser.uid : null,
    updated_at: new Date().toISOString()
  };

  await setDoc(doc(db, 'hosts', cleanedPhone), hostData, { merge: true });
  return hostData;
};

/**
 * Sync the host's active anonymous auth UID if it changes.
 */
export const syncHostAuthUid = async (username, phone) => {
  if (!username || !phone) return;
  const cleanedPhone = phone.replace(/\D/g, '');
  let currentUser = auth.currentUser;
  
  if (!currentUser && hasValidConfig) {
    currentUser = await new Promise((resolve) => {
      const unsubscribe = onAuthStateChanged(auth, (user) => {
        unsubscribe();
        resolve(user);
      });
    });
  }

  if (currentUser) {
    const hostDocRef = doc(db, 'hosts', cleanedPhone);
    const hostSnap = await getDoc(hostDocRef);
    
    if (hostSnap.exists() && hostSnap.data().auth_uid !== currentUser.uid) {
      await setDoc(hostDocRef, {
        auth_uid: currentUser.uid,
        updated_at: new Date().toISOString()
      }, { merge: true });
    }
  }
};
