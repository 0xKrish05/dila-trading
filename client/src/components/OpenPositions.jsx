const fmtUSD = (n, d = 2) =>
  "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

export default function OpenPositions({ trades }) {
  return (
    <div className="card open-card">
      <div className="card-lbl">
        Open Positions
        <span className="badge-count">{trades.length}</span>
      </div>

      {trades.length === 0 ? (
        <div className="empty-msg">No open positions</div>
      ) : (
        <div className="open-list">
          {trades.map(t => {
            const prob    = t.currentProb ?? t.entryProb;
            const probPct = (prob * 100).toFixed(1);
            const toTarget = ((t.targetProb - prob) * 100).toFixed(1);
            const toSL     = ((prob - t.stopLossProb) * 100).toFixed(1);
            const unrealPnl = parseFloat(
              (t.stake * (prob - t.entryProb) / t.entryProb).toFixed(4)
            );

            return (
              <div className="open-row" key={t._id}>
                <div className="open-top">
                  <span className={`dir-badge ${t.direction === "UP" ? "up" : "dn"}`}>
                    {t.direction === "UP" ? "▲" : "▼"} {t.direction}
                  </span>
                  <span className="muted" style={{ fontSize: ".75rem" }}>#{t.tradeNum}</span>
                  <span
                    className="open-pnl"
                    style={{ color: unrealPnl >= 0 ? "#3fb950" : "#f85149" }}
                  >
                    {unrealPnl >= 0 ? "+" : ""}{fmtUSD(Math.abs(unrealPnl), 4)}
                  </span>
                </div>

                {/* Probability bar */}
                <div className="op-prob-wrap">
                  <div className="op-prob-track">
                    {/* SL marker */}
                    <div
                      className="op-marker sl"
                      style={{ left: `${t.stopLossProb * 100}%` }}
                      title={`SL: ${(t.stopLossProb * 100).toFixed(1)}%`}
                    />
                    {/* Entry marker */}
                    <div
                      className="op-marker entry"
                      style={{ left: `${t.entryProb * 100}%` }}
                      title={`Entry: ${(t.entryProb * 100).toFixed(1)}%`}
                    />
                    {/* Target marker */}
                    <div
                      className="op-marker target"
                      style={{ left: `${t.targetProb * 100}%` }}
                      title={`Target: ${(t.targetProb * 100).toFixed(1)}%`}
                    />
                    {/* Current fill */}
                    <div
                      className="op-prob-fill"
                      style={{
                        width:      `${prob * 100}%`,
                        background: prob >= t.entryProb ? "#3fb950" : "#f85149",
                      }}
                    />
                  </div>
                  <div className="op-prob-labels">
                    <span className="red">{(t.stopLossProb * 100).toFixed(0)}%</span>
                    <span style={{ fontWeight: 700 }}>{probPct}%</span>
                    <span className="green">{(t.targetProb * 100).toFixed(0)}%</span>
                  </div>
                </div>

                <div className="open-meta">
                  <span className="muted">Stake: {fmtUSD(t.stake)}</span>
                  <span className="green">+{toTarget}% to tgt</span>
                  <span className="red">-{toSL}% to SL</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
