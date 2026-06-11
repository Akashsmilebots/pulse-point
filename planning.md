# Pulse Point Planning & Change Log

## Phase 1: Initial Setup
- Created a React + Vite single-page application.
- Added Supabase backend integration in `src/supabaseClient.js`.
- Set up core pages:
  - `Home.jsx`
  - `Dashboard.jsx`
  - `PollForm.jsx`
  - `HostLive.jsx`
  - `ParticipantJoin.jsx`
  - `ParticipantPlay.jsx`
- Defined database tables: `polls`, `questions`, `participants`, `responses`.
- Implemented host and participant routing with `react-router-dom`.

## Phase 2: Event Creation Flow
- Built a separate event title screen in `PollForm.jsx`.
- Saved a new poll as draft and redirected hosts to `/polls/:id/host`.
- Added inline error messaging instead of browser alerts.
- Ensured poll state starts as `draft` until host explicitly starts the session.

## Phase 3: Host Draft Editing & Live Control
- Migrated question editor functionality into `HostLive.jsx`.
- Implemented draft saving with question persistence using Supabase.
- Added host controls to:
  - save draft changes,
  - start the session,
  - end the session,
  - reset the poll.
- Updated `handleStartPoll` to save questions first and then set `polls.current_question_id`.
- Fixed foreign key constraint issues by ensuring questions exist before activating the poll.

## Phase 4: Live Question Navigation
- Added `Next Question` and `Previous Question` navigation buttons.
- Implemented question sync to the joiner screen by updating `polls.current_question_id`.
- Added a `Questions Navigator` sidebar for host review and direct selection.
- Ensured the host can still review responses after the session ends.

## Phase 5: Current Update
- Adjusted `HostLive.jsx` so navigation buttons are enabled/disabled based on:
  - whether a current question exists,
  - whether there is more than one question,
  - current question position in the question list.
- This prevents invalid navigation when no questions exist or when the host is at the first/last question.

## Maintenance Notes
- Always update this file with a new section when making structural changes.
- Record the phase, affected files, and purpose of the change.
- Use this file as the single source of truth for workflow and design intent.

## Future Update Guidelines
- When modifying host navigation or session workflow, describe:
  1. What changed in host interaction.
  2. Which files were updated.
  3. Why the change was needed.
- When changing database behavior, include:
  1. Table and relationship changes.
  2. New Supabase queries or mutations.
  3. Any added constraints or refetch logic.
- Keep entries concise and chronological.
