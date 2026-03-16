const express    = require("express");
const Trade      = require("../models/Trade");
const Portfolio  = require("../models/Portfolio");
const cycleManager = require("../services/cycleManager");

const INITIAL_BALANCE = parseFloat(process.env.INITIAL_BALANCE || "500");

module.exports = function (io) {
  const router = express.Router();

  // Full status snapshot
  router.get("/status", async (req, res) => {
    const portfolio  = await Portfolio.findOne();
    const balance    = portfolio?.balance ?? INITIAL_BALANCE;
    const initBal    = portfolio?.initialBalance ?? INITIAL_BALANCE;

    const openTrades   = await Trade.find({ status: "OPEN" });
    const closedTrades = await Trade.find({ status: { $ne: "OPEN" } });

    const lockedEquity = openTrades.reduce((s, t) => s + t.stake, 0);
    const wins         = closedTrades.filter(t => (t.pnl ?? 0) > 0).length;
    const totalPnl     = closedTrades.reduce((s, t) => s + (t.pnl ?? 0), 0);

    const durTrades    = closedTrades.filter(t => t.closedAt && t.openedAt);
    const avgDuration  = durTrades.length
      ? durTrades.reduce((s, t) => s + (new Date(t.closedAt) - new Date(t.openedAt)), 0)
        / durTrades.length / 1000
      : 0;

    const avgLatency = closedTrades.filter(t => t.totalLatencyMs).length
      ? closedTrades.reduce((s, t) => s + (t.totalLatencyMs ?? 0), 0)
        / closedTrades.filter(t => t.totalLatencyMs).length
      : 0;

    res.json({
      portfolio,
      stats: {
        balance:         parseFloat(balance.toFixed(2)),
        initialBalance:  initBal,
        totalPnl:        parseFloat(totalPnl.toFixed(4)),
        lockedEquity:    parseFloat(lockedEquity.toFixed(2)),
        freeMargin:      parseFloat((balance - lockedEquity).toFixed(2)),
        totalTrades:     closedTrades.length,
        openTrades:      openTrades.length,
        wins,
        losses:          closedTrades.length - wins,
        winRate:         closedTrades.length
          ? parseFloat((wins / closedTrades.length * 100).toFixed(1))
          : 0,
        profitable:      wins,
        avgDuration:     parseFloat(avgDuration.toFixed(1)),
        avgLatency:      parseFloat(avgLatency.toFixed(1)),
      },
      cycle: cycleManager.getState(),
    });
  });

  // Trade history (last 100)
  router.get("/trades", async (req, res) => {
    const trades = await Trade.find().sort({ openedAt: -1 }).limit(100).lean();
    res.json(trades);
  });

  // Open positions
  router.get("/open", async (req, res) => {
    const trades = await Trade.find({ status: "OPEN" }).lean();
    res.json(trades);
  });

  // Equity history for chart
  router.get("/equity-history", async (req, res) => {
    const portfolio = await Portfolio.findOne().lean();
    res.json(portfolio?.equityHistory ?? []);
  });

  // Send a test signal (for development without TradingView)
  router.post("/test-signal", async (req, res) => {
    const { signal = "BUY" } = req.body;
    const tradeEngine = require("../services/tradeEngine");
    tradeEngine.setIo(io);
    io.emit("signal_received", { signal, ticker: "BTCUSDT", latencyMs: 0, serverReceivedAt: Date.now() });
    const trade = await tradeEngine.onSignal(signal, {});
    res.json({ ok: true, trade });
  });

  // Reset simulation
  router.post("/reset", async (req, res) => {
    await Trade.deleteMany({});
    await Portfolio.deleteMany({});
    await Portfolio.create({ balance: INITIAL_BALANCE, initialBalance: INITIAL_BALANCE });
    io.emit("reset");
    res.json({ ok: true, message: `Reset to $${INITIAL_BALANCE}` });
  });

  return router;
};
