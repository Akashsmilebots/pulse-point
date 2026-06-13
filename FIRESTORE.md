# Firestore Endpoints — Pulse Point

## Collections Overview

```
polls/
  {pollId}/
    questions/
    participants/
    responses/
    leaderboard/
hosts/
```

---

## `polls`

Top-level collection. One document per event/session.

### Document Fields

| Field | Type | Description |
|---|---|---|
| `title` | string | Poll/event name |
| `join_code` | string | 6-char uppercase code participants use to join |
| `host_id` | string | Firebase Auth UID or phone of the host |
| `status` | string | `'draft'` or `'live'` |
| `current_question_id` | string \| null | ID of the currently active question |
| `question_count` | number | Cached count of questions (backfilled if missing) |
| `created_at` | string | ISO timestamp |
| `projector_mode` | string | Current projector display: `'banner'`, `'question'`, `'results'`, `'leaderboard_overall'`, `'leaderboard_range_N'`, `'question_single'` |
| `projector_question_id` | string | ID of question shown on projector (`question`, `results`, `question_single` modes) |
| `projector_single_option` | string | Option text spotlighted in `question_single` mode |
| `projector_reveals` | object | `{ [questionId]: boolean[] }` — which options have been revealed in results mode |
| `question_end_time` | number | `Date.now() + 35000` — absolute ms timestamp set when host starts a question; participants calculate remaining timer from this |

### Functions (`src/lib/firebase.js`)

| Function | Operation | Notes |
|---|---|---|
| `getPollByJoinCode(code)` | `getDocs` query by `join_code` | Case-insensitive (uppercased before query) |
| `getPollById(id, hostId?)` | `getDoc` | Optional ownership check via `host_id` |
| `getAllPolls()` | `getDocs` ordered by `created_at` desc | Backfills `question_count` if missing |
| `getPollsForHost(hostId, anonymousUid?)` | `getDocs` query by `host_id` | Runs one query per ID, merges in JS |
| `createPoll(title, hostId, uniqueCode)` | `addDoc` | Sets `status: 'draft'`, `current_question_id: null` |
| `updatePoll(id, updateData)` | `updateDoc` | Partial update; used for all projector mode changes |
| `deletePoll(id)` | batch `delete` | Deletes subcollections `questions`, `participants`, `responses`, `leaderboard` + the poll doc atomically |
| `subscribeToPoll(pollId, callback)` | `onSnapshot` | Real-time updates to the poll doc |
| `resetPollData(pollId)` | batch `delete` + `updateDoc` | Clears participants, responses, leaderboard; resets `status: 'draft'`, `current_question_id: null` |

---

## `polls/{pollId}/questions`

One document per question in the poll.

### Document Fields

| Field | Type | Description |
|---|---|---|
| `text` | string | Question text |
| `type` | string | `'multiple_choice'` (only type currently used) |
| `options` | string[] | Array of option strings |
| `order_index` | number | Sort position (0-based) |
| `created_at` | string | ISO timestamp |

### Functions

| Function | Operation | Notes |
|---|---|---|
| `getQuestionsForPoll(pollId)` | `getDocs` ordered by `order_index` | One-shot fetch |
| `subscribeToQuestions(pollId, callback)` | `onSnapshot` | Real-time ordered list |
| `getQuestionById(pollId, qId)` | `getDoc` | Single question fetch |
| `updateQuestion(pollId, questionId, updates)` | `updateDoc` | Partial update |
| `saveDraftQuestions(pollId, title, questions)` | batch `delete` + `set` | Atomically rewrites all questions; also updates `polls/{pollId}.question_count` and `title` |

---

## `polls/{pollId}/participants`

One document per registered participant (document ID = session ID).

### Document Fields

| Field | Type | Description |
|---|---|---|
| `poll_id` | string | Parent poll ID |
| `name` | string | Participant display name |
| `phone` | string | Phone number |
| `session_id` | string | Matches document ID |
| `created_at` | string | ISO timestamp |

### Functions

| Function | Operation | Notes |
|---|---|---|
| `checkPhoneRegistration(pollId, phone)` | `getDocs` query by `phone` | Returns existing record or `null` |
| `registerParticipant(pollId, name, phone, sessionId)` | `setDoc` with `merge: true` | Upsert by session ID |
| `getParticipant(pollId, sessionId)` | `getDoc` | Fetch by session ID |
| `subscribeToParticipantsCount(pollId, callback)` | `onSnapshot` on collection | Returns `snap.size` |

---

## `polls/{pollId}/responses`

One document per answer submitted (a participant can have one response per question).

### Document Fields

| Field | Type | Description |
|---|---|---|
| `question_id` | string | ID of the question answered |
| `participant_id` | string | Session ID of the respondent |
| `participant_name` | string | Denormalised name |
| `participant_phone` | string | Denormalised phone |
| `answer` | string | Comma-separated selected options (e.g. `"Option A,Option C"`) |
| `created_at` | string | ISO timestamp |

### Functions

| Function | Operation | Notes |
|---|---|---|
| `submitResponse(pollId, questionId, participant, answerText)` | `addDoc` | Also triggers `updateLeaderboard` in background (non-blocking) |
| `getResponseForParticipant(pollId, questionId, participantId)` | `getDocs` query by `question_id` + `participant_id` | Used to prevent double-submission |
| `getResponsesForPoll(pollId)` | `getDocs` | All responses for export/display |
| `subscribeToResponsesForQuestion(pollId, questionId, callback)` | `onSnapshot` query by `question_id` | Per-question real-time updates |
| `subscribeToAllResponses(pollId, callback)` | `onSnapshot` on collection | Returns `{ [questionId]: response[] }` grouped map |

---

## `polls/{pollId}/leaderboard/{docId}`

Aggregated leaderboard snapshots. Document IDs: `overall`, `range_0`, `range_1`, …

### Document IDs

| docId | Covers |
|---|---|
| `overall` | All questions |
| `range_0` | Questions 1–10 |
| `range_1` | Questions 11–20 |
| `range_N` | Questions N×10+1 to (N+1)×10 |

### Document Fields

| Field | Type | Description |
|---|---|---|
| `poll_id` | string | Parent poll ID |
| `leaderboard_data` | object[] | Sorted array of participant scores (see below) |
| `top_responses` | object[] | Per-question ranked options (overall doc only) |
| `updated_at` | string | ISO timestamp of last recompute |
| `range_index` | number | Range docs only — 0-based range index |
| `question_start` | number | Range docs only — 1-based start question number |
| `question_end` | number | Range docs only — 1-based end question number |

#### `leaderboard_data` item shape
```json
{
  "participant_id": "session-abc123",
  "name": "Akash",
  "phone": "9876543210",
  "points": 42
}
```

#### Scoring formula
For each question: options are ranked 1–10 by vote count. A participant answering an option ranked `r` earns `11 - r` points.

### Functions

| Function | Operation | Notes |
|---|---|---|
| `updateLeaderboard(pollId)` | batch `set` on all leaderboard docs | Recomputes overall + all range docs atomically; called automatically by `submitResponse` |
| `subscribeToLeaderboard(pollId, docId, callback)` | `onSnapshot` | Subscribe to one leaderboard doc (e.g. `'overall'`, `'range_0'`) |

---

## `hosts`

Top-level collection for host accounts. Document ID = cleaned phone number.

### Document Fields

| Field | Type | Description |
|---|---|---|
| `username` | string | Host display name |
| `phone` | string | Digits-only phone number (also the doc ID) |
| `password` | string | Plain-text password (stored as-is) |
| `auth_uid` | string | Firebase anonymous Auth UID linked to this host |
| `updated_at` | string | ISO timestamp |

### Functions

| Function | Operation | Notes |
|---|---|---|
| `registerHost(username, phone, password)` | `setDoc` | Checks for existing phone; links current anonymous UID |
