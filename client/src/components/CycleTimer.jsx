export default function CycleTimer({ cycle }) {
  if (!cycle) return (
    <div className="card cycle-card">
      <div className="card-lbl">Cycle Timer</div>
      <div className="cycle-time">--:--</div>
      <div className="cycle-stage muted">Connecting…</div>
    </div>
  );

  const { remaining, stage, tradingOpen, cycleId } = cycle;
  const min = Math.floor(remaining / 60);
  const sec = remaining % 60;
  const timeStr = `${min}:${String(sec).padStart(2, "0")}`;

  const stageInfo = {
    WAITING:  { label: "Waiting for New Cycle", color: "#8b949e" },
    ACTIVE:   { label: "Place a Bet",           color: "#3fb950" },
    CLOSING:  { label: "Closing — No New Bets", color: "#f0883e" },
  }[stage] ?? { label: stage, color: "#c9d1d9" };

  // Arc: 5 min = 300 sec, radius = 42
  const r      = 42;
  const circ   = 2 * Math.PI * r;
  const filled = ((300 - remaining) / 300) * circ;
  const arcColor = stage === "ACTIVE" ? "#3fb950" : stage === "CLOSING" ? "#f0883e" : "#30363d";

  return (
    <div className="card cycle-card">
      <div className="card-lbl">Cycle Timer · {cycleId}</div>
      <div className="cycle-inner">
        <svg width="110" height="110" viewBox="0 0 110 110">
          <circle cx="55" cy="55" r={r} fill="none" stroke="#21262d" strokeWidth="8" />
          <circle
            cx="55" cy="55" r={r} fill="none"
            stroke={arcColor} strokeWidth="8"
            strokeDasharray={`${filled} ${circ - filled}`}
            strokeDashoffset={circ / 4}
            strokeLinecap="round"
            style={{ transition: "stroke-dasharray 0.5s ease" }}
          />
          <text x="55" y="52" textAnchor="middle" fill="#c9d1d9" fontSize="18" fontWeight="700">{timeStr}</text>
          <text x="55" y="68" textAnchor="middle" fill="#8b949e" fontSize="9">remaining</text>
        </svg>
      </div>
      <div className="cycle-stage" style={{ color: stageInfo.color }}>
        ● {stageInfo.label}
      </div>
    </div>
  );
}
