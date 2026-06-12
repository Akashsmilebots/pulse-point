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

  // Only honour projector_mode while the poll is actively running.
  // Draft (not started) and ended polls always fall back to banner.
  const mode = poll.status === "active" ? (poll.projector_mode || "banner") : "banner";

  // ── BANNER ────────────────────────────────────────────────────────
  if (mode === "banner") {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "#000", overflow: "hidden" }}>
        <img src="/banner.jpeg" alt="banner"
          style={{ position: "absolute", inset: 0, margin: '0 auto', height: "100%", objectFit: "cover" }} />
      </div>
    );
  }

  // ── QUESTION — big text + option cards, no votes ──────────────────
  if (mode === "question") {
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
    // Column/row layout that always fills the screen without scroll
    const cols = optCount <= 3 ? 1 : optCount <= 16 ? 2 : 3;
    const rows = optCount > 0 ? Math.ceil(optCount / cols) : 0;
    // Scale card internals based on density
    const cardFontSize = optCount <= 8 ? "clamp(12px,1.6vw,22px)" : optCount <= 14 ? "clamp(10px,1.3vw,17px)" : "clamp(9px,1.1vw,14px)";
    const letterBox = optCount <= 8 ? "clamp(28px,3.2vw,46px)" : optCount <= 14 ? "clamp(22px,2.3vw,34px)" : "clamp(18px,1.8vw,26px)";
    const letterFont = optCount <= 8 ? "clamp(12px,1.7vw,22px)" : optCount <= 14 ? "clamp(10px,1.3vw,17px)" : "clamp(8px,1.1vw,13px)";

    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "#F7F8FA", fontFamily: "'IBM Plex Sans', system-ui, sans-serif", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <style>{`@keyframes livePulse{0%,100%{opacity:1}50%{opacity:.3}}`}</style>

        {/* Header — always pinned */}
        <div style={{ padding: "clamp(12px,2.5vw,36px) clamp(20px,6vw,72px) 0", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
            <div style={{ fontFamily: "monospace", fontSize: "clamp(13px,1.8vw,24px)", fontWeight: 700, background: "#fff", border: "1px solid #E2E4E9", borderRadius: "12px", padding: "10px 22px" }}>
              Question {qIndex + 1}
            </div>
            {isLive && (
              <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "clamp(13px,1.6vw,18px)", fontWeight: 700, padding: "10px 22px", borderRadius: "999px", background: "#DC2A3C", color: "#fff" }}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#fff", display: "inline-block", animation: "livePulse 1.4s ease-in-out infinite" }} />
                LIVE NOW
              </div>
            )}
          </div>
        </div>

        {/* Body — fills remaining height, NO scroll */}
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "clamp(8px,1.5vw,22px) clamp(20px,6vw,72px) clamp(14px,2.2vw,30px)", gap: "clamp(6px,1vw,16px)", overflow: "hidden" }}>

          {/* Question text — capped so options always have room */}
          <div style={{ flexShrink: 0, maxHeight: optCount > 0 ? "24vh" : "60vh", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
            <div style={{ fontSize: "clamp(18px,3vw,50px)", fontWeight: 700, letterSpacing: "-0.5px", textAlign: "center", maxWidth: "1100px", lineHeight: 1.2, color: "#16181D" }}>
              {projQ.text}
            </div>
          </div>

          {/* Options — gridTemplateRows fills remaining height exactly, no scroll needed */}
          {opts.length > 0 && (
            <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)`, gap: "clamp(4px,0.7vw,10px)" }}>
              {opts.map((opt, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: "clamp(7px,1.1vw,16px)", background: "#fff", border: "1px solid #E2E4E9", borderRadius: "clamp(8px,1vw,14px)", padding: `clamp(4px,0.6vw,10px) clamp(7px,1vw,16px)`, overflow: "hidden", minHeight: 0 }}>
                  <span style={{ width: letterBox, height: letterBox, minWidth: letterBox, borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontFamily: "monospace", fontSize: letterFont, fontWeight: 700, background: "#EBF0FC", color: "#2B5FD9" }}>
                    {String.fromCharCode(65 + i)}
                  </span>
                  <span style={{ fontSize: cardFontSize, fontWeight: 600, color: "#16181D", lineHeight: 1.25, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{opt}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── RESULTS — ranked slots with per-option reveal ─────────────────
  if (mode === "results") {
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

        {/* Ranked rows — scroll from top, no centering that hides first row */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "clamp(12px,2vw,28px) clamp(20px,6vw,72px) clamp(20px,3vw,40px)", display: "flex", flexDirection: "column", gap: "clamp(6px,1vw,14px)" }}>
          {displayOpts.length === 0 && (
            <div style={{ textAlign: "center", color: "#9AA1AC", fontSize: "clamp(16px,2.5vw,28px)", marginTop: "3rem" }}>
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
              <div key={opt} style={{ display: "flex", alignItems: "center", gap: "clamp(10px,1.8vw,24px)", borderRadius: "clamp(10px,1.5vw,18px)", padding: "clamp(12px,1.8vw,20px) clamp(14px,2vw,28px)", background: isTop ? "#EBF0FC" : "#fff", border: isTop ? "2px solid #2B5FD9" : isRevealed ? "1px solid #BCE3CF" : "1px dashed #D6DAE1", boxShadow: isRevealed ? "0 2px 10px rgba(16,24,40,0.06)" : "none", minHeight: "clamp(52px,7vw,88px)", flexShrink: 0 }}>
                <span style={{ width: "clamp(36px,4.5vw,60px)", fontFamily: "monospace", fontSize: "clamp(16px,2.2vw,26px)", fontWeight: 700, color: isTop ? "#2B5FD9" : "#9AA1AC", flexShrink: 0 }}>
                  #{rankPos + 1}
                </span>

                {isRevealed ? (
                  <>
                    <span style={{ width: "clamp(30px,3.5vw,48px)", height: "clamp(30px,3.5vw,48px)", borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontFamily: "monospace", fontSize: "clamp(13px,1.8vw,20px)", fontWeight: 700, background: isTop ? "#2B5FD9" : "#1F8A5B", color: "#fff" }}>
                      {String.fromCharCode(65 + optIdx)}
                    </span>
                    <span style={{ flex: 1, fontSize: "clamp(14px,2vw,26px)", fontWeight: 600, color: "#16181D", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{opt}</span>
                    <span style={{ fontFamily: "monospace", fontSize: "clamp(16px,2.2vw,28px)", fontWeight: 700, color: "#16181D", flexShrink: 0 }}>
                      {votes}<span style={{ fontSize: "clamp(11px,1.2vw,15px)", color: "#9AA1AC", fontWeight: 600 }}> votes · {pct}%</span>
                    </span>
                  </>
                ) : (
                  <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "16px" }}>
                    <span style={{ width: "clamp(30px,3.5vw,50px)", height: "clamp(30px,3.5vw,50px)", borderRadius: "12px", background: "#EEF0F3", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "clamp(16px,2.2vw,24px)", fontWeight: 700, color: "#C2C7CF", flexShrink: 0 }}>?</span>
                    <span style={{ flex: 1, height: "20px", borderRadius: "10px", background: "repeating-linear-gradient(45deg,#EEF0F3,#EEF0F3 12px,#F6F7F9 12px,#F6F7F9 24px)" }} />
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
  if (mode === "leaderboard_overall" || mode?.startsWith("leaderboard_range_")) {
    const lbData = leaderboard?.leaderboard_data || [];
    const isOverall = mode === "leaderboard_overall";
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

        {/* Leaderboard rows — scrollable from top */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "clamp(12px,2vw,28px) clamp(20px,6vw,72px) clamp(20px,3vw,40px)" }}>
          <div style={{ maxWidth: "860px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "clamp(6px,0.8vw,10px)" }}>
            {lbData.length === 0 ? (
              <div style={{ textAlign: "center", color: "#9AA1AC", fontSize: "clamp(1rem,2vw,1.3rem)", padding: "3rem 0" }}>No scores yet</div>
            ) : (
              lbData.slice(0, 20).map((p, idx) => (
                <div key={p.participant_id} style={{ display: "flex", alignItems: "center", gap: "clamp(10px,1.5vw,20px)", padding: "clamp(10px,1.5vw,18px) clamp(14px,2vw,24px)", borderRadius: "14px", background: idx < 3 ? MEDAL_BG[idx] : "#fff", border: `1px solid ${idx < 3 ? MEDAL_BORDER[idx] : "#E2E4E9"}`, boxShadow: idx === 0 ? "0 2px 12px rgba(255,180,0,0.12)" : "0 1px 4px rgba(16,24,40,0.04)" }}>
                  <div style={{ width: "clamp(36px,4.5vw,52px)", height: "clamp(36px,4.5vw,52px)", borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: idx < 3 ? "transparent" : "#F0F2F5", fontSize: idx < 3 ? "clamp(1.2rem,2.5vw,1.8rem)" : "clamp(0.8rem,1.4vw,1rem)", fontWeight: 800, color: "#16181D" }}>
                    {idx < 3 ? MEDALS[idx] : idx + 1}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: "clamp(0.85rem,1.8vw,1.15rem)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#16181D" }}>{p.name || "Anonymous"}</div>
                    {p.phone && <div style={{ fontSize: "clamp(0.72rem,1vw,0.85rem)", color: "#6B7280" }}>{p.phone}</div>}
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: "clamp(1rem,2.5vw,1.6rem)", color: idx === 0 ? "#D97706" : idx === 1 ? "#6B7280" : idx === 2 ? "#A16207" : "#2B5FD9" }}>{p.points}</div>
                    <div style={{ fontSize: "clamp(0.65rem,0.9vw,0.78rem)", color: "#9AA1AC", fontWeight: 600 }}>pts</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
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
