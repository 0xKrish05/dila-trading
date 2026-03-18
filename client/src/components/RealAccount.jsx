import { useEffect, useState, useCallback } from "react";

const fmtUSD  = n => n != null ? "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
const fmtCents = p => p != null ? Math.round(p * 100) + "¢" : "—";
const fmtTime  = iso => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

export default function RealAccount({ address }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [tab,     setTab]     = useState("positions"); // "positions" | "trades"
  const [lastRefresh, setLastRefresh] = useState(null);

  const load = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/account?address=${address}`);
      const d = await r.json();
      if (!r.ok) { setError(d.error || "Failed to load account"); return; }
      setData(d);
      setLastRefresh(new Date());
    } catch {
      setError("Network error — retrying…");
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000); // refresh every 30s
    return () => clearInterval(t);
  }, [load]);

  if (!address) return null;

  const profile   = data?.profile   ?? {};
  const positions = data?.positions ?? [];
  const trades    = data?.trades    ?? [];

  return (
    <div className="card real-account-card">
      {/* ── Header ── */}
      <div className="ra-header">
        <div className="ra-avatar">
          {profile.avatar
            ? <img src={profile.avatar} alt="avatar" className="ra-avatar-img" />
            : <div className="ra-avatar-placeholder">{(profile.name || "?")[0].toUpperCase()}</div>
          }
        </div>
        <div className="ra-identity">
          <div className="ra-name">{profile.name || "—"}</div>
          <div className="ra-addr">{address}</div>
        </div>
        <div className="ra-stats-row">
          <div className="ra-stat">
            <div className="ra-stat-lbl">USDC Balance</div>
            <div className="ra-stat-val blue">{fmtUSD(profile.usdcBalance)}</div>
          </div>
          <div className="ra-stat">
            <div className="ra-stat-lbl">Positions Value</div>
            <div className="ra-stat-val green">{fmtUSD(profile.positionValue)}</div>
          </div>
          <div className="ra-stat">
            <div className="ra-stat-lbl">Cash P&amp;L</div>
            <div className={`ra-stat-val ${(profile.cashPnl ?? 0) >= 0 ? "green" : "red"}`}>
              {profile.cashPnl != null ? (profile.cashPnl >= 0 ? "+" : "") + fmtUSD(profile.cashPnl) : "—"}
            </div>
          </div>
          <div className="ra-stat">
            <div className="ra-stat-lbl">Volume</div>
            <div className="ra-stat-val orange">{fmtUSD(profile.totalVolume)}</div>
          </div>
          <div className="ra-stat">
            <div className="ra-stat-lbl">Positions</div>
            <div className="ra-stat-val">{profile.positionCount ?? "—"}</div>
          </div>
          <div className="ra-stat">
            <div className="ra-stat-lbl">Trades</div>
            <div className="ra-stat-val">{profile.tradeCount ?? "—"}</div>
          </div>
        </div>
        <div className="ra-actions">
          <button className="ra-refresh" onClick={load} disabled={loading} title="Refresh">
            {loading ? "⏳" : "↻"}
          </button>
          {lastRefresh && (
            <div className="ra-refresh-time">
              {lastRefresh.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </div>
          )}
        </div>
      </div>

      {error && <div className="ra-error">{error}</div>}

      {/* ── Tabs ── */}
      <div className="ra-tabs">
        <button className={`ra-tab ${tab === "positions" ? "active" : ""}`} onClick={() => setTab("positions")}>
          Open Positions ({positions.length})
        </button>
        <button className={`ra-tab ${tab === "trades" ? "active" : ""}`} onClick={() => setTab("trades")}>
          Trade History ({trades.length})
        </button>
      </div>

      {/* ── Positions Table ── */}
      {tab === "positions" && (
        loading && positions.length === 0 ? (
          <div className="ra-loading">Loading positions…</div>
        ) : positions.length === 0 ? (
          <div className="ra-empty">No open positions found for this address.</div>
        ) : (
          <div className="ra-table-wrap">
            <table className="ra-table">
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Outcome</th>
                  <th>Shares</th>
                  <th>Avg Price</th>
                  <th>Cur Price</th>
                  <th>Value</th>
                  <th>P&amp;L</th>
                  <th>P&amp;L %</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p, i) => (
                  <tr key={i} className={p.redeemable ? "redeemable" : ""}>
                    <td className="ra-market-title">{p.title}</td>
                    <td>
                      <span className={`ra-outcome ${p.outcome?.toLowerCase()}`}>{p.outcome}</span>
                    </td>
                    <td>{p.size.toFixed(0)}</td>
                    <td>{fmtCents(p.avgPrice)}</td>
                    <td>{fmtCents(p.curPrice)}</td>
                    <td>{fmtUSD(p.currentValue)}</td>
                    <td className={p.cashPnl >= 0 ? "green" : "red"}>
                      {p.cashPnl >= 0 ? "+" : ""}{fmtUSD(p.cashPnl)}
                    </td>
                    <td className={p.percentPnl >= 0 ? "green" : "red"}>
                      {p.percentPnl >= 0 ? "+" : ""}{p.percentPnl.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* ── Trades Table ── */}
      {tab === "trades" && (
        loading && trades.length === 0 ? (
          <div className="ra-loading">Loading trades…</div>
        ) : trades.length === 0 ? (
          <div className="ra-empty">No trades found for this address.</div>
        ) : (
          <div className="ra-table-wrap">
            <table className="ra-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Market</th>
                  <th>Outcome</th>
                  <th>Side</th>
                  <th>Shares</th>
                  <th>Price</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t, i) => (
                  <tr key={i}>
                    <td className="ra-time">{fmtTime(t.timestamp)}</td>
                    <td className="ra-market-title">{t.market}</td>
                    <td>
                      <span className={`ra-outcome ${t.outcome?.toLowerCase()}`}>{t.outcome}</span>
                    </td>
                    <td>
                      <span className={`ra-side ${t.side?.toLowerCase()}`}>{t.side}</span>
                    </td>
                    <td>{t.size.toFixed(0)}</td>
                    <td>{fmtCents(t.price)}</td>
                    <td>{fmtUSD(t.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
