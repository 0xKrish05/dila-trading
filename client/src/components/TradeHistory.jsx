const fmtUSD = (n, d = 4) =>
  "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

const fmtCents = (prob) =>
  prob !== null && prob !== undefined ? `${Math.round(prob * 100)}¢` : "—";

const fmtTime = (iso) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";

const dur = (open, close) => {
  if (!open || !close) return "—";
  const ms = new Date(close) - new Date(open);
  return ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${(ms / 60000).toFixed(1)}m`;
};

const STATUS_COLOR = {
  TARGET:  "#3fb950",
  STOPPED: "#f85149",
  EXPIRED: "#8b949e",
  OPEN:    "#f0883e",
};

export default function TradeHistory({ trades }) {
  return (
    <div className="card hist-card">
      <div className="card-lbl">
        Trade History
        <span className="badge-count">{trades.length}</span>
      </div>
      <div className="tbl-scroll">
        <table className="trade-tbl">
          <thead>
            <tr>
              <th>#</th>
              <th>Type</th>
              <th>Open Time</th>
              <th>Open Price</th>
              <th>Entry ¢</th>
              <th>Exit ¢</th>
              <th>Close Time</th>
              <th>Duration</th>
              <th>P&L</th>
              <th>Status</th>
              <th>Latency</th>
            </tr>
          </thead>
          <tbody>
            {trades.length === 0 ? (
              <tr>
                <td colSpan="11" className="empty-msg">No trades yet — waiting for TradingView signals…</td>
              </tr>
            ) : (
              trades.map(t => {
                const pnl     = t.pnl ?? 0;
                const pnlSign = pnl >= 0 ? "+" : "";
                const rowCls  = t.status === "OPEN" ? "row-open"
                              : pnl > 0             ? "row-win"
                              : pnl < 0             ? "row-loss"
                              : "";

                return (
                  <tr key={t._id} className={`trow ${rowCls}`}>
                    <td className="muted">#{t.tradeNum}</td>
                    <td>
                      <span className={`dir-badge ${t.direction === "UP" ? "up" : "dn"}`}>
                        {t.direction === "UP" ? "▲" : "▼"} {t.signal}
                      </span>
                    </td>
                    <td className="muted">{fmtTime(t.openedAt)}</td>
                    <td>${Number(t.entryPrice).toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                    <td className="muted">{fmtCents(t.entryProb)}</td>
                    <td className="muted">{fmtCents(t.exitProb)}</td>
                    <td className="muted">{fmtTime(t.closedAt)}</td>
                    <td className="muted">{dur(t.openedAt, t.closedAt)}</td>
                    <td style={{ color: pnl >= 0 ? "#3fb950" : "#f85149", fontWeight: 700 }}>
                      {t.status === "OPEN" ? "—" : `${pnlSign}${fmtUSD(Math.abs(pnl))}`}
                    </td>
                    <td style={{ color: STATUS_COLOR[t.status] ?? "#c9d1d9" }}>
                      {t.status}
                    </td>
                    <td className="muted">
                      {t.totalLatencyMs !== undefined && t.totalLatencyMs !== null
                        ? `${t.totalLatencyMs}ms` : "—"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
