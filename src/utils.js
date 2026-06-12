// Utility functions for client session management and calculations

// Generate a secure UUID or fallback if not available
export const generateUUID = () => {
  if (typeof window !== 'undefined' && window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

// Generate a random 6-character alphanumeric uppercase code for events
export const generateJoinCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude ambiguous characters like O, 0, I, 1
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

// Get or create host identifier
export const getHostId = () => {
  const hostPhone = localStorage.getItem('pulsepoint_host_phone');
  if (hostPhone) {
    return hostPhone;
  }
  let hostId = localStorage.getItem('pulsepoint_host_id');
  if (!hostId) {
    hostId = generateUUID();
    localStorage.setItem('pulsepoint_host_id', hostId);
  }
  return hostId;
};

// Get or create participant session identifier
export const getParticipantSessionId = () => {
  let sessionId = localStorage.getItem('pulsepoint_participant_session_id');
  if (!sessionId) {
    sessionId = generateUUID();
    localStorage.setItem('pulsepoint_participant_session_id', sessionId);
  }
  return sessionId;
};

// Get participant name for a specific poll
export const getParticipantName = (pollId) => {
  return localStorage.getItem(`pulsepoint_name_${pollId}`) || '';
};

// Set participant name for a specific poll
export const setParticipantName = (pollId, name) => {
  localStorage.setItem(`pulsepoint_name_${pollId}`, name);
};
