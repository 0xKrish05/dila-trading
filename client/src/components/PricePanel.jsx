const fmt = (n, d = 2) =>
  Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

export default function PricePanel({ price, probUp, latency, avgLatency, lastSignal }) {
  const probPct = ((probUp ?? 0.5) * 100).toFixed(1);
  const isUp    = (probUp ?? 0.5) >= 0.5;

  return (
    <div className="card price-card">
      <div className="card-lbl">Live Market</div>

      <div className="price-big">${price ? fmt(price) : "——"}</div>
      <div className="price-sub muted">BTC / USDT (Binance)</div>

      {/* Prob bar */}
      <div className="prob-wrap">
        <div className="prob-labels">
          <span className="red">DOWN</span>
          <span className={isUp ? "green" : "red"} style={{ fontWeight: 700 }}>
            {isUp ? "↑" : "↓"} {probPct}%
          </span>
          <span className="green">UP</span>
        </div>
        <div className="prob-track">
          <div
            className="prob-fill"
            style={{
              width:      `${probPct}%`,
              background: isUp ? "#3fb950" : "#f85149",
            }}
          />
          <div className="prob-mid" />
        </div>
      </div>

      {/* Last signal */}
      {lastSignal && (
        <div className="last-signal">
          <span className="muted" style={{ fontSize: ".75rem" }}>Last signal</span>{" "}
          <span className={`sig-pill ${lastSignal.signal === "BUY" ? "buy" : "sell"}`}>
            {lastSignal.signal}
          </span>
          {lastSignal.latencyMs !== undefined && (
            <span className="muted" style={{ fontSize: ".75rem" }}>
              {" "}· {lastSignal.latencyMs}ms
            </span>
          )}
        </div>
      )}

      {/* Latency */}
      <div className="latency-row">
        <div className="lat-box">
          <div className="muted" style={{ fontSize: ".68rem" }}>LAST LATENCY</div>
          <div style={{ color: latency < 50 ? "#3fb950" : latency < 200 ? "#f0883e" : "#f85149", fontWeight: 700 }}>
            {latency !== null ? `${latency}ms` : "—"}
          </div>
        </div>
        <div className="lat-box">
          <div className="muted" style={{ fontSize: ".68rem" }}>AVG LATENCY</div>
          <div style={{ fontWeight: 700 }}>
            {avgLatency !== null ? `${avgLatency}ms` : "—"}
          </div>
        </div>
      </div>
    </div>
  );
}
