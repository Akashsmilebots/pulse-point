import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import {
  subscribeToPoll,
  subscribeToAllResponses,
  subscribeToLeaderboard,
  subscribeToQuestions,
} from "../lib/firebase";

const MEDALS = ["🥇", "🥈", "🥉"];
const MEDAL_BG = ["rgba(255,190,0,0.12)", "rgba(140,140,160,0.10)", "rgba(180,100,40,0.10)"];
const MEDAL_BORDER = ["rgba(255,180,0,0.35)", "rgba(140,140,160,0.28)", "rgba(180,100,40,0.28)"];

export default function ProjectorScreen() {
  const { id } = useParams();
  const [poll, setPoll] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [allResponses, setAllResponses] = useState({});
  const [leaderboard, setLeaderboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [projTimerLeft, setProjTimerLeft] = useState(null);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  useEffect(() => {
    const unsub = subscribeToPoll(id, (d) => { setPoll(d); setLoading(false); });
    return () => unsub();
  }, [id]);

  useEffect(() => {
    const unsub = subscribeToQuestions(id, setQuestions);
    return () => unsub();
  }, [id]);

  useEffect(() => {
    const unsub = subscribeToAllResponses(id, setAllResponses);
    return () => unsub();
  }, [id]);

  useEffect(() => {
    if (!poll?.id) return;
    const mode = poll.projector_mode || "banner";
    let docId = null;
    if (mode === "leaderboard_overall") docId = "overall";
    else if (mode?.startsWith("leaderboard_range_")) docId = mode.replace("leaderboard_", "");
    if (!docId) { setLeaderboard(null); return; }
    const unsub = subscribeToLeaderboard(poll.id, docId, setLeaderboard);
    return () => unsub();
  }, [poll?.projector_mode, poll?.id]);

  useEffect(() => {
    if (!poll?.question_end_time) { setProjTimerLeft(null); return; }
    const update = () => {
      const remaining = Math.max(0, Math.round((poll.question_end_time - Date.now()) / 1000));
      setProjTimerLeft(remaining);
    };
    update();
    const timerId = setInterval(update, 500);
    return () => clearInterval(timerId);
  }, [poll?.question_end_time]);

  if (loading) {
    return (
      <div style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#F7F8FA", zIndex: 100 }}>
        <div className="spinner" style={{ width: "60px", height: "60px" }} />
      </div>
    );
  }
  if (!poll) {
    return (
      <div style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#F7F8FA", zIndex: 100 }}>
        Poll not found
      </div>
    );
  }

  // Honour projector_mode for active, paused, and ended polls; drafts always show banner.
  const mode = (poll.status === "active" || poll.status === "paused" || poll.status === "ended")
    ? (poll.projector_mode || "banner")
    : "banner";

  // Auto-revert to banner when the question timer expires — don't wait for host Firestore sync.
  const displayMode = (mode === "question" && projTimerLeft !== null && projTimerLeft <= 0)
    ? "banner"
    : mode;

  // ── BANNER ────────────────────────────────────────────────────────
  if (displayMode === "banner") {
    const bannerQrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(`${typeof window !== 'undefined' ? window.location.origin : ''}/join/${poll.join_code || ''}`)}&bgcolor=ffffff&color=000000&margin=10`;
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start", padding: "clamp(14px,2.5vw,36px)", gap: "clamp(10px,1.5vw,20px)", overflow: "hidden", fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>
        {/* Logo */}
        <img src="/logo.png" alt="" style={{ height: "clamp(26px,2.8vw,42px)", objectFit: "contain", opacity: 0.85, flexShrink: 0 }} />
        {/* Banner card — fills remaining height so full image is always visible */}
        <div style={{ position: "relative", width: "min(94vw,1120px)", borderRadius: "clamp(10px,1.2vw,18px)", overflow: "hidden", boxShadow: "0 6px 36px rgba(16,24,40,0.18)", flex: "1 1 0", minHeight: 0, maxHeight: "80vh" }}>
          <img src="/banner.jpeg" alt="" style={{ width: "100%", height: "100%", objectFit: "contain", background: "#f5f5f5", display: "block" }} />
          {/* Overlay with title/code centred on the banner */}
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.46)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "clamp(4px,0.8vw,12px)", padding: "clamp(10px,2vw,28px)" }}>
            <div style={{ fontSize: "clamp(16px,3vw,54px)", fontWeight: 900, color: "#fff", letterSpacing: "-0.5px", lineHeight: 1.1, textAlign: "center", textShadow: "0 2px 10px rgba(0,0,0,0.5)" }}>{poll.title}</div>
            {poll.join_code && (
              <div style={{ fontSize: "clamp(11px,1.5vw,22px)", color: "rgba(255,255,255,0.88)", fontWeight: 600, textShadow: "0 1px 4px rgba(0,0,0,0.4)" }}>
                Join code: <strong style={{ color: "#93C5FD" }}>{poll.join_code}</strong>
              </div>
            )}
          </div>
        </div>
        {/* QR below the banner card */}
        {poll.join_code && (
          <div style={{ background: "#fff", borderRadius: "clamp(8px,1vw,14px)", padding: "clamp(7px,1vw,14px)", textAlign: "center", boxShadow: "0 2px 14px rgba(16,24,40,0.1)", border: "1px solid #E2E4E9", flexShrink: 0 }}>
            <img src={bannerQrUrl} alt="QR" style={{ width: "clamp(64px,6.5vw,110px)", height: "clamp(64px,6.5vw,110px)", display: "block", borderRadius: "4px" }} />
            <div style={{ marginTop: "4px", fontSize: "clamp(9px,0.9vw,13px)", fontWeight: 600, color: "#374151" }}>Scan to join</div>
          </div>
        )}
      </div>
    );
  }

  // ── QUESTION SINGLE — question + one spotlight option ─────────────
  if (displayMode === "question_single") {
    const projQ = questions.find(q => q.id === poll.projector_question_id) || null;
    const singleOpt = poll.projector_single_option || '';
    if (!projQ) {
      return (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "#F7F8FA", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1rem" }}>
          <img src="/logo.png" alt="" style={{ height: "clamp(28px,3vw,44px)", opacity: 0.4 }} />
          <div style={{ fontSize: "clamp(16px,2.5vw,32px)", fontWeight: 700, color: "#C2C7CF" }}>Waiting for next question...</div>
        </div>
      );
    }
    const qIndex = questions.indexOf(projQ);
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "#F7F8FA", fontFamily: "'IBM Plex Sans', system-ui, sans-serif", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "clamp(12px,2.5vw,36px) clamp(20px,6vw,72px) 0", flexShrink: 0 }}>
          <div style={{ fontFamily: "monospace", fontSize: "clamp(13px,1.8vw,24px)", fontWeight: 700, background: "#fff", border: "1px solid #E2E4E9", borderRadius: "12px", padding: "10px 22px", display: "inline-block" }}>
            Question {qIndex + 1}
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "clamp(8px,1.5vw,22px) clamp(20px,6vw,72px) clamp(14px,2.2vw,30px)", gap: "clamp(16px,2.5vw,36px)" }}>
          <div style={{ fontSize: "clamp(16px,2.8vw,42px)", fontWeight: 700, letterSpacing: "-0.5px", textAlign: "center", maxWidth: "1100px", lineHeight: 1.2, color: "#16181D" }}>
            {projQ.text}
          </div>
          {singleOpt && (
            <div style={{ width: "100%", maxWidth: "900px", padding: "clamp(18px,2.5vw,44px) clamp(20px,4vw,60px)", background: "#EBF0FC", border: "2.5px solid #2B5FD9", borderRadius: "clamp(10px,1.2vw,18px)", textAlign: "center" }}>
              <span style={{ fontSize: "clamp(16px,3.2vw,52px)", fontWeight: 800, color: "#2B5FD9", lineHeight: 1.2, wordBreak: "break-word" }}>{singleOpt}</span>
            </div>
          )}
        </div>
        <div style={{ flexShrink: 0, padding: "0 clamp(20px,6vw,72px) clamp(12px,2vw,24px)", display: "flex", justifyContent: "flex-end" }}>
          <img src="/logo.png" alt="" style={{ height: "clamp(20px,2vw,32px)", opacity: 0.35 }} />
        </div>
      </div>
    );
  }

  // ── QUESTION — big text + option cards, no votes ──────────────────
  if (displayMode === "question") {
    const projQ = questions.find(q => q.id === poll.projector_question_id) || null;

    // Waiting state — no question selected yet
    if (!projQ) {
      return (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "#F7F8FA", fontFamily: "'IBM Plex Sans', system-ui, sans-serif", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "clamp(16px,2.5vw,32px)" }}>
          <img src="/logo.png" alt="" style={{ height: "clamp(36px,4vw,58px)", objectFit: "contain", opacity: 0.4 }} />
          <div style={{ fontSize: "clamp(18px,3vw,42px)", fontWeight: 700, color: "#C2C7CF", letterSpacing: "-0.3px" }}>Waiting for next question...</div>
          <div style={{ fontSize: "clamp(13px,1.6vw,20px)", color: "#D6DAE1" }}>{poll.title}</div>
        </div>
      );
    }

    const qIndex = questions.indexOf(projQ);
    const isLive = poll.current_question_id === projQ.id;
    const opts = projQ.type === "multiple_choice" ? (projQ.options || []) : [];
    const optCount = opts.length;
    // Column layout — 1 col for ≤2 opts, 2 cols otherwise, 3 cols for very many
    const cols = optCount <= 2 ? 1 : optCount <= 16 ? 2 : 3;
    const rows = optCount > 0 ? Math.ceil(optCount / cols) : 0;
    // X-large font that scales with density
    const cardFontSize = optCount <= 6 ? "clamp(18px,2.4vw,34px)" : optCount <= 12 ? "clamp(15px,1.9vw,26px)" : "clamp(12px,1.5vw,20px)";
    const timerColor = projTimerLeft !== null && projTimerLeft <= 5 ? "#DC2A3C" : "#2B5FD9";

    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "#F7F8FA", fontFamily: "'IBM Plex Sans', system-ui, sans-serif", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <style>{`@keyframes livePulse{0%,100%{opacity:1}50%{opacity:.3}}`}</style>

        {/* Header — compact, pinned */}
        <div style={{ padding: "clamp(8px,1.4vw,20px) clamp(16px,4vw,56px)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
          <div style={{ fontFamily: "monospace", fontSize: "clamp(12px,1.5vw,20px)", fontWeight: 700, background: "#fff", border: "1px solid #E2E4E9", borderRadius: "10px", padding: "6px 16px" }}>
            Question {qIndex + 1}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {isLive && projTimerLeft !== null && projTimerLeft > 0 && (
              <div style={{ fontFamily: "monospace", fontSize: "clamp(18px,3.2vw,48px)", fontWeight: 900, color: timerColor, background: "#fff", border: `3px solid ${timerColor}`, borderRadius: "12px", padding: "2px 16px", minWidth: "70px", textAlign: "center", lineHeight: 1.2, animation: projTimerLeft <= 5 ? "livePulse 0.6s ease-in-out infinite" : "none" }}>
                {projTimerLeft}
              </div>
            )}
            {isLive && (
              <div style={{ display: "flex", alignItems: "center", gap: "7px", fontSize: "clamp(11px,1.3vw,16px)", fontWeight: 700, padding: "7px 16px", borderRadius: "999px", background: "#DC2A3C", color: "#fff" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#fff", display: "inline-block", animation: "livePulse 1.4s ease-in-out infinite" }} />
                LIVE NOW
              </div>
            )}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "0 clamp(16px,4vw,56px) clamp(10px,1.5vw,20px)", gap: "clamp(6px,1vw,14px)" }}>

          {/* Question text — shrinks but always shows from top */}
          <div style={{ flexShrink: 0, paddingBottom: "clamp(6px,0.8vw,12px)" }}>
            <div style={{ fontSize: "clamp(20px,3.2vw,52px)", fontWeight: 700, letterSpacing: "-0.5px", textAlign: "center", maxWidth: "1100px", margin: "0 auto", lineHeight: 1.25, color: "#16181D" }}>
              {projQ.text}
            </div>
          </div>

          {/* Options — grid, rows fill remaining height, text starts from top-left of each card */}
          {opts.length > 0 && (
            <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)`, gap: "clamp(4px,0.6vw,10px)" }}>
              {opts.map((opt, i) => (
                <div key={i} style={{ background: "#fff", border: "1.5px solid #E2E4E9", borderRadius: "clamp(8px,1vw,14px)", padding: "clamp(10px,1.2vw,18px) clamp(12px,1.4vw,22px)", display: "flex", alignItems: "flex-start", minHeight: 0, overflow: "hidden" }}>
                  <span style={{ fontSize: cardFontSize, fontWeight: 600, color: "#16181D", lineHeight: 1.35, wordBreak: "break-word", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>{opt}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── RESULTS — ranked slots with per-option reveal ─────────────────
  if (displayMode === "results") {
    const projQ = questions.find(q => q.id === poll.projector_question_id) || null;
    const qIndex = projQ ? questions.indexOf(projQ) : -1;
    const options = projQ?.options || [];
    const qResps = projQ ? (allResponses[projQ.id] || []) : [];
    const reveals = projQ ? ((poll.projector_reveals || {})[projQ.id] || options.map(() => false)) : [];

    const tallies = {};
    options.forEach(o => { tallies[o] = 0; });
    qResps.forEach(r => {
      (r.answer || "").split(",").map(s => s.trim()).filter(Boolean).forEach(a => {
        if (tallies[a] !== undefined) tallies[a]++;
      });
    });

    const sortedOptions = options.slice().sort((a, b) => {
      const diff = (tallies[b] || 0) - (tallies[a] || 0);
      return diff !== 0 ? diff : options.indexOf(a) - options.indexOf(b);
    });

    const totalVotes = qResps.length;
    const revealCount = reveals.filter(Boolean).length;
    const displayOpts = sortedOptions.slice(0, 10);

    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "#F7F8FA", fontFamily: "'IBM Plex Sans', system-ui, sans-serif", display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Header — pinned, never scrolls */}
        <div style={{ padding: "clamp(14px,3vw,40px) clamp(20px,6vw,72px) 0", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
            <div style={{ fontFamily: "monospace", fontSize: "clamp(13px,1.8vw,24px)", fontWeight: 700, background: "#fff", border: "1px solid #E2E4E9", borderRadius: "12px", padding: "10px 22px" }}>
              {projQ ? `Top answers — Question ${qIndex + 1}` : "Results"}
            </div>
            <div style={{ fontSize: "clamp(12px,1.4vw,16px)", fontWeight: 700, padding: "10px 22px", borderRadius: "999px", background: "#EBF0FC", color: "#2B5FD9" }}>
              {revealCount} of {options.length} revealed · {totalVotes} vote{totalVotes !== 1 ? "s" : ""}
            </div>
          </div>
        </div>

        {/* Ranked rows — CSS grid fills all remaining height exactly, zero scroll */}
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden", padding: "clamp(8px,1.5vw,20px) clamp(20px,6vw,72px) clamp(12px,2vw,28px)", display: "grid", gridTemplateRows: displayOpts.length > 0 ? `repeat(${displayOpts.length}, 1fr)` : "1fr", gap: "clamp(4px,0.6vw,10px)" }}>
          {displayOpts.length === 0 && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "#9AA1AC", fontSize: "clamp(16px,2.5vw,28px)" }}>
              No responses yet
            </div>
          )}
          {displayOpts.map((opt, rankPos) => {
            const optIdx = options.indexOf(opt);
            const isRevealed = reveals[optIdx] === true;
            const isTop = rankPos === 0 && isRevealed;
            const votes = tallies[opt] || 0;
            const pct = totalVotes > 0 ? Math.round((votes / totalVotes) * 100) : 0;

            return (
              <div key={opt} style={{ display: "flex", alignItems: "center", gap: "clamp(8px,1.5vw,22px)", borderRadius: "clamp(8px,1.2vw,16px)", padding: "0 clamp(12px,2vw,28px)", background: isTop ? "#EBF0FC" : "#fff", border: isTop ? "2px solid #2B5FD9" : isRevealed ? "1px solid #BCE3CF" : "1px dashed #D6DAE1", boxShadow: isRevealed ? "0 2px 10px rgba(16,24,40,0.06)" : "none", minHeight: 0, overflow: "hidden" }}>
                <span style={{ width: "clamp(30px,4vw,56px)", fontFamily: "monospace", fontSize: "clamp(14px,2vw,24px)", fontWeight: 700, color: isTop ? "#2B5FD9" : "#9AA1AC", flexShrink: 0 }}>
                  #{rankPos + 1}
                </span>

                {isRevealed ? (
                  <>
                    <span style={{ flex: 1, fontSize: "clamp(12px,1.8vw,24px)", fontWeight: 600, color: "#16181D", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{opt}</span>
                    <span style={{ fontFamily: "monospace", fontSize: "clamp(14px,2vw,26px)", fontWeight: 700, color: "#16181D", flexShrink: 0 }}>
                      {Math.max(1, votes)}<span style={{ fontSize: "clamp(10px,1vw,14px)", color: "#9AA1AC", fontWeight: 600 }}> vote{Math.max(1, votes) !== 1 ? "s" : ""}</span>
                    </span>
                  </>
                ) : (
                  <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "12px" }}>
                    <span style={{ width: "clamp(24px,3vw,46px)", height: "clamp(24px,3vw,46px)", borderRadius: "10px", background: "#EEF0F3", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "clamp(14px,2vw,22px)", fontWeight: 700, color: "#C2C7CF", flexShrink: 0 }}>?</span>
                    <span style={{ flex: 1, height: "18px", borderRadius: "9px", background: "repeating-linear-gradient(45deg,#EEF0F3,#EEF0F3 12px,#F6F7F9 12px,#F6F7F9 24px)" }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── LEADERBOARD — light mode ──────────────────────────────────────
  if (displayMode === "leaderboard_overall" || displayMode?.startsWith("leaderboard_range_")) {
    const lbData = leaderboard?.leaderboard_data || [];
    const isOverall = displayMode === "leaderboard_overall";
    const rangeIdx = isOverall ? -1 : parseInt(mode.replace("leaderboard_range_", ""), 10);
    const rangeStart = isOverall ? null : rangeIdx * 10 + 1;
    const rangeEnd = isOverall ? null : Math.min((rangeIdx + 1) * 10, questions.length);
    const title = isOverall ? "Overall Leaderboard" : `Q${rangeStart}–${rangeEnd} Leaderboard`;
    const subtitle = isOverall ? `All ${questions.length} questions` : `Questions ${rangeStart} to ${rangeEnd}`;

    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "#F7F8FA", fontFamily: "'IBM Plex Sans', system-ui, sans-serif", display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Title header */}
        <div style={{ padding: "clamp(16px,3vw,44px) clamp(20px,6vw,72px) 0", flexShrink: 0, textAlign: "center" }}>
          <img src="/logo.png" alt="" style={{ height: "clamp(28px,3.5vw,44px)", objectFit: "contain", marginBottom: "clamp(6px,1vw,14px)", opacity: 0.65 }} />
          <div style={{ fontSize: "clamp(11px,1.2vw,14px)", fontWeight: 600, color: "#9AA1AC", textTransform: "uppercase", letterSpacing: "0.2em", marginBottom: "4px" }}>{poll.title}</div>
          <h1 style={{ fontSize: "clamp(1.4rem,3.5vw,3rem)", fontWeight: 900, color: "#16181D", marginBottom: "2px", letterSpacing: "-0.5px" }}>
            {isOverall ? "🏆" : "🏅"} {title}
          </h1>
          <p style={{ color: "#6B7280", fontSize: "clamp(0.85rem,1.4vw,1.1rem)" }}>{subtitle}</p>
        </div>

        {/* Leaderboard rows — fixed height cards, no stretch */}
        {(() => {
          const rows = lbData.slice(0, 10);
          return (
            <div style={{ overflow: "hidden", padding: "clamp(8px,1.5vw,20px) clamp(20px,6vw,72px) clamp(12px,2vw,24px)", display: "flex", flexDirection: "column", gap: "clamp(4px,0.5vw,8px)", maxWidth: "900px", width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
              {rows.length === 0 ? (
                <div style={{ height: "40px", display: "flex", alignItems: "center", justifyContent: "center", color: "#9AA1AC", fontSize: "clamp(1rem,2vw,1.3rem)" }}>No scores yet</div>
              ) : (
                rows.map((p, idx) => (
                  <div key={p.participant_id} style={{ minHeight: "70px", height: "70px", flexShrink: 0, display: "flex", alignItems: "center", gap: "clamp(8px,1.4vw,18px)", padding: "0 clamp(12px,2vw,24px)", borderRadius: "clamp(8px,1.2vw,14px)", background: idx < 3 ? MEDAL_BG[idx] : "#fff", border: `1px solid ${idx < 3 ? MEDAL_BORDER[idx] : "#E2E4E9"}`, boxShadow: idx === 0 ? "0 2px 12px rgba(255,180,0,0.12)" : "0 1px 4px rgba(16,24,40,0.04)", overflow: "hidden" }}>
                    <div style={{ width: "clamp(30px,4vw,50px)", height: "clamp(30px,4vw,50px)", borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: idx < 3 ? "transparent" : "#F0F2F5", fontSize: idx < 3 ? "clamp(1.1rem,2.2vw,1.6rem)" : "clamp(0.8rem,1.3vw,1rem)", fontWeight: 800, color: "#16181D" }}>
                      {idx < 3 ? MEDALS[idx] : idx + 1}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: "clamp(0.8rem,1.6vw,1.1rem)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#16181D" }}>{p.name || "Anonymous"}</div>
                      {p.phone && <div style={{ fontSize: "clamp(0.65rem,0.9vw,0.8rem)", color: "#6B7280" }}>{p.phone}</div>}
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: "clamp(0.95rem,2.2vw,1.5rem)", color: idx === 0 ? "#D97706" : idx === 1 ? "#6B7280" : idx === 2 ? "#A16207" : "#2B5FD9" }}>{p.points}</div>
                      <div style={{ fontSize: "clamp(0.6rem,0.8vw,0.72rem)", color: "#9AA1AC", fontWeight: 600 }}>pts</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          );
        })()}
      </div>
    );
  }

  // ── Default / waiting ─────────────────────────────────────────────
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "#F7F8FA", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1rem" }}>
      <img src="/logo.png" alt="" style={{ height: "64px", objectFit: "contain", opacity: 0.6 }} />
      <h2 style={{ fontSize: "1.8rem", fontWeight: 800, color: "#16181D" }}>{poll.title}</h2>
      <p style={{ color: "#6B7280", fontSize: "1.1rem" }}>Waiting for host...</p>
    </div>
  );
}
