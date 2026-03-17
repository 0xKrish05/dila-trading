const fmtUSD = (n, d = 2) =>
  n !== null && n !== undefined
    ? "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })
    : "—";

export default function EquityPanel({
  balance, totalPnl,
  lockedEquity, freeMargin,
  totalTrades, openCount, wins, losses,
  winRate, profitable, avgDuration,
  mode, mainnetProfile,
}) {
  const pnlColor = totalPnl >= 0 ? "#3fb950" : "#f85149";
  const pnlSign  = totalPnl >= 0 ? "+" : "";
  const isMainnet = mode === "mainnet";

  const simStats = [
    { lbl: "Sim Equity",      val: fmtUSD(balance),                              color: pnlColor },
    { lbl: "Sim P&L",         val: pnlSign + fmtUSD(Math.abs(totalPnl), 4),      color: pnlColor },
    { lbl: "Locked Equity",   val: fmtUSD(lockedEquity),                          color: "#f0883e" },
    { lbl: "Free Margin",     val: fmtUSD(freeMargin),                            color: "#79c0ff" },
    { lbl: "Total Trades",    val: totalTrades,                                   color: "#c9d1d9" },
    { lbl: "Open Trades",     val: openCount,                                     color: "#f0883e" },
    { lbl: "Win Rate",        val: winRate + "%",                                 color: "#3fb950" },
    { lbl: "Wins",            val: wins,                                          color: "#3fb950" },
    { lbl: "Losses",          val: losses,                                        color: "#f85149" },
    { lbl: "Profitable",      val: profitable,                                    color: "#3fb950" },
    { lbl: "Avg Duration",    val: avgDuration + "s",                             color: "#8b949e" },
    { lbl: "Stake / Trade",   val: fmtUSD(balance * 0.01),                        color: "#bc8cff" },
  ];

  return (
    <div className="card equity-card">
      {/* ── Mainnet account card ── */}
      {isMainnet && mainnetProfile && (
        <div className="mainnet-account-row">
          <div className="mainnet-account-avatar">
            {mainnetProfile.avatar
              ? <img src={mainnetProfile.avatar} alt="avatar" className="poly-avatar" />
              : <div className="poly-avatar-placeholder">{mainnetProfile.name?.[0]?.toUpperCase() || "?"}</div>
            }
          </div>
          <div className="mainnet-account-info">
            <div className="mainnet-account-name">
              <span className="poly-dot-sm" /> {mainnetProfile.name}
            </div>
            <div className="mainnet-account-addr muted">{mainnetProfile.address}</div>
          </div>
          <div className="mainnet-balances">
            <div className="mainnet-bal-item">
              <span className="mainnet-bal-lbl">Wallet USDC</span>
              <span className="mainnet-bal-val" style={{ color: "#79c0ff" }}>
                {mainnetProfile.usdcBalance !== null && mainnetProfile.usdcBalance !== undefined
                  ? fmtUSD(mainnetProfile.usdcBalance)
                  : "—"}
              </span>
            </div>
            <div className="mainnet-bal-divider" />
            <div className="mainnet-bal-item">
              <span className="mainnet-bal-lbl">Positions Value</span>
              <span className="mainnet-bal-val" style={{ color: "#3fb950" }}>
                {mainnetProfile.polyBalance !== null && mainnetProfile.polyBalance !== undefined
                  ? fmtUSD(mainnetProfile.polyBalance)
                  : "—"}
              </span>
            </div>
            <div className="mainnet-bal-divider" />
            <div className="mainnet-bal-item">
              <span className="mainnet-bal-lbl">Open Positions</span>
              <span className="mainnet-bal-val" style={{ color: "#f0883e" }}>
                {mainnetProfile.positionCount ?? "—"}
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="card-lbl" style={{ marginTop: isMainnet && mainnetProfile ? 12 : 0 }}>
        {isMainnet ? "Strategy Simulation Stats" : "Equity Overview"}
      </div>

      <div className="equity-grid">
        {simStats.map(s => (
          <div className="eq-stat" key={s.lbl}>
            <div className="eq-lbl">{s.lbl}</div>
            <div className="eq-val" style={{ color: s.color }}>{s.val}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
