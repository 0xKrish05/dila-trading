import { useState, useEffect } from "react";
import socket from "./socket";
import CycleTimer     from "./components/CycleTimer";
import EquityPanel    from "./components/EquityPanel";
import PricePanel     from "./components/PricePanel";
import TradeHistory   from "./components/TradeHistory";
import OpenPositions  from "./components/OpenPositions";
import PortfolioChart from "./components/PortfolioChart";
import ModeToggle     from "./components/ModeToggle";

const INITIAL_BALANCE = 500;

export default function App() {
  const [connected,     setConnected]     = useState(false);
  const [price,         setPrice]         = useState(null);
  const [probUp,        setProbUp]        = useState(0.5);
  const [polyCents,     setPolyCents]     = useState(null);
  const [cycle,         setCycle]         = useState(null);
  const [portfolio,     setPortfolio]     = useState(null);
  const [trades,        setTrades]        = useState([]);
  const [openTrades,    setOpenTrades]    = useState([]);
  const [equityHistory, setEquityHistory] = useState([]);
  const [lastSignal,    setLastSignal]    = useState(null);
  const [latency,       setLatency]       = useState(null);
  const [mode,          setMode]          = useState("sim");
  const [mainnetProfile, setMainnetProfile] = useState(null);

  // ── Derived stats ──────────────────────────────────────────────────────────
  const balance      = portfolio?.balance        ?? INITIAL_BALANCE;
  const initialBal   = portfolio?.initialBalance ?? INITIAL_BALANCE;
  const totalPnl     = balance - initialBal;
  const lockedEquity = openTrades.reduce((s, t) => s + (t.stake ?? 0), 0);
  const freeMargin   = balance - lockedEquity;

  const closed       = trades.filter(t => t.status !== "OPEN");
  const wins         = closed.filter(t => (t.pnl ?? 0) > 0).length;
  const winRate      = closed.length ? (wins / closed.length * 100).toFixed(1) : "0.0";

  const durTrades    = closed.filter(t => t.closedAt && t.openedAt);
  const avgDuration  = durTrades.length
    ? (durTrades.reduce((s, t) => s + (new Date(t.closedAt) - new Date(t.openedAt)), 0)
       / durTrades.length / 1000).toFixed(1)
    : "0.0";

  const latTrades    = closed.filter(t => t.totalLatencyMs);
  const avgLatency   = latTrades.length
    ? (latTrades.reduce((s, t) => s + t.totalLatencyMs, 0) / latTrades.length).toFixed(0)
    : null;

  const isMainnet = mode === "mainnet";

  // ── Socket setup ──────────────────────────────────────────────────────────
  useEffect(() => {
    socket.on("connect",    () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));

    socket.on("initial_state", ({ portfolio, trades, openTrades, cycle }) => {
      if (portfolio)  setPortfolio(portfolio);
      if (trades)     setTrades(trades);
      if (openTrades) setOpenTrades(openTrades);
      if (cycle)      setCycle(cycle);
    });

    socket.on("price_update", ({ price, probUp, polyCents }) => {
      setPrice(price);
      setProbUp(probUp);
      if (polyCents) setPolyCents(polyCents);
    });

    socket.on("cycle_tick",       setCycle);
    socket.on("portfolio_update", setPortfolio);

    socket.on("mode_change", ({ mode, profile }) => {
      setMode(mode);
      setMainnetProfile(profile ?? null);
    });

    socket.on("signal_received", (data) => {
      setLastSignal(data);
      setLatency(data.latencyMs);
    });

    socket.on("trade_opened", ({ trade, portfolio }) => {
      setOpenTrades(p => [trade, ...p.filter(t => t._id !== trade._id)]);
      if (portfolio) setPortfolio(portfolio);
    });

    socket.on("trade_closed", ({ trade, portfolio }) => {
      setOpenTrades(p => p.filter(t => t._id !== trade._id));
      setTrades(p => {
        const idx = p.findIndex(t => t._id === trade._id);
        return idx >= 0 ? p.map(t => t._id === trade._id ? trade : t) : [trade, ...p];
      });
      if (portfolio) setPortfolio(portfolio);
    });

    socket.on("position_update", ({ tradeId, currentProb, currentPrice }) => {
      setOpenTrades(p => p.map(t =>
        t._id === tradeId ? { ...t, currentProb, currentPrice } : t
      ));
    });

    socket.on("reset", () => {
      setTrades([]); setOpenTrades([]); setPortfolio(null); setEquityHistory([]);
    });

    // Bootstrap REST
    fetch("/api/status").then(r => r.json()).then(d => {
      if (d.portfolio) setPortfolio(d.portfolio);
      if (d.cycle)     setCycle(d.cycle);
    });
    fetch("/api/trades").then(r => r.json()).then(setTrades);
    fetch("/api/open").then(r => r.json()).then(setOpenTrades);
    fetch("/api/equity-history").then(r => r.json()).then(setEquityHistory);
    fetch("/api/mode").then(r => r.json()).then(d => {
      if (d.mode) setMode(d.mode);
      if (d.profile) setMainnetProfile(d.profile);
    });

    return () => socket.removeAllListeners();
  }, []);

  const handleReset = async () => {
    if (!confirm("Reset all trades and portfolio to $500?")) return;
    await fetch("/api/reset", { method: "POST" });
  };

  const sendTestSignal = async (sig) => {
    await fetch("/api/test-signal", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ signal: sig }),
    });
  };

  const handleModeChange = (newMode, profile) => {
    setMode(newMode);
    setMainnetProfile(profile ?? null);
  };

  return (
    <div className={`app ${isMainnet ? "mainnet-mode" : ""}`}>
      {/* ── Mainnet warning banner ── */}
      {isMainnet && (
        <div className="mainnet-banner">
          <span className="blink">🔴</span>
          MAINNET LIVE TRADING ACTIVE
          {mainnetProfile && (
            <span style={{ marginLeft: 8, color: "#aaa" }}>
              · {mainnetProfile.name}
            </span>
          )}
        </div>
      )}

      {/* ── Header ── */}
      <header className="hdr">
        <div className="hdr-left">
          <span className="logo">⚡ DILA</span>
          <span className="hdr-sub">
            Neural Momentum · BTC 5-Min ·{" "}
            <span style={{ color: isMainnet ? "#f0883e" : "inherit" }}>
              {isMainnet ? "Mainnet" : "Simulated"}
            </span>
          </span>
        </div>
        <div className="hdr-right">
          <span className={`dot ${connected ? "live" : "dead"}`} />
          <span className="hdr-conn">{connected ? "Live" : "Offline"}</span>
          {lastSignal && (
            <span className={`sig-badge ${lastSignal.signal === "BUY" ? "buy" : "sell"}`}>
              {lastSignal.signal}
            </span>
          )}
          <button className="btn-test buy"  onClick={() => sendTestSignal("BUY")}>Test BUY</button>
          <button className="btn-test sell" onClick={() => sendTestSignal("SELL")}>Test SELL</button>
          <button className="btn-reset" onClick={handleReset}>Reset</button>
          {/* ── Sim / Mainnet toggle ── */}
          <ModeToggle mode={mode} onModeChange={handleModeChange} />
        </div>
      </header>

      <div className="dashboard">
        {/* Row 1 */}
        <div className="row-top">
          <CycleTimer cycle={cycle} />
          <PricePanel
            price={price} probUp={probUp} polyCents={polyCents}
            latency={latency} avgLatency={avgLatency}
            lastSignal={lastSignal}
          />
        </div>

        {/* Row 2 */}
        <EquityPanel
          balance={balance} initialBalance={initialBal} totalPnl={totalPnl}
          lockedEquity={lockedEquity} freeMargin={freeMargin}
          totalTrades={closed.length} openCount={openTrades.length}
          wins={wins} losses={closed.length - wins}
          winRate={winRate} profitable={wins}
          avgDuration={avgDuration}
        />

        {/* Row 3 */}
        <div className="row-mid">
          <PortfolioChart
            trades={closed}
            initialBalance={initialBal}
            equityHistory={equityHistory}
          />
          <OpenPositions trades={openTrades} />
        </div>

        {/* Row 4 */}
        <TradeHistory trades={trades} />
      </div>
    </div>
  );
}
