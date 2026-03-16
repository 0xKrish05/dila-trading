const fmtUSD = (n, d = 2) =>
  "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

export default function EquityPanel({
  balance, initialBalance, totalPnl,
  lockedEquity, freeMargin,
  totalTrades, openCount, wins, losses,
  winRate, profitable, avgDuration,
}) {
  const pnlColor  = totalPnl >= 0 ? "#3fb950" : "#f85149";
  const pnlSign   = totalPnl >= 0 ? "+" : "";

  const stats = [
    { lbl: "Total Equity",    val: fmtUSD(balance),      color: pnlColor },
    { lbl: "Total P&L",       val: pnlSign + fmtUSD(Math.abs(totalPnl), 4), color: pnlColor },
    { lbl: "Locked Equity",   val: fmtUSD(lockedEquity), color: "#f0883e" },
    { lbl: "Free Margin",     val: fmtUSD(freeMargin),   color: "#79c0ff" },
    { lbl: "Total Trades",    val: totalTrades,           color: "#c9d1d9" },
    { lbl: "Open Trades",     val: openCount,             color: "#f0883e" },
    { lbl: "Win Rate",        val: winRate + "%",         color: "#3fb950" },
    { lbl: "Wins",            val: wins,                  color: "#3fb950" },
    { lbl: "Losses",          val: losses,                color: "#f85149" },
    { lbl: "Profitable",      val: profitable,            color: "#3fb950" },
    { lbl: "Avg Duration",    val: avgDuration + "s",     color: "#8b949e" },
    { lbl: "Stake / Trade",   val: fmtUSD(balance * 0.01), color: "#bc8cff" },
  ];

  return (
    <div className="card equity-card">
      <div className="card-lbl">Equity Overview</div>
      <div className="equity-grid">
        {stats.map(s => (
          <div className="eq-stat" key={s.lbl}>
            <div className="eq-lbl">{s.lbl}</div>
            <div className="eq-val" style={{ color: s.color }}>{s.val}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
