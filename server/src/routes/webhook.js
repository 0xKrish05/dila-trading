/**
 * POST /api/webhook
 * Receives TradingView alerts forwarded by the Cloudflare Worker.
 *
 * Expected body (sent by Pine Script alert):
 * {
 *   "signal": "BUY" | "SELL",
 *   "ticker": "BTCUSDT",
 *   "price": 70123.45,
 *   "time": "1716000000000",      ← TradingView bar time (ms)
 *   "workerReceivedAt": 1716000000050  ← injected by Cloudflare Worker
 * }
 */

const express     = require("express");
const tradeEngine = require("../services/tradeEngine");

module.exports = function (io) {
  const router = express.Router();
  tradeEngine.setIo(io);

  router.post("/", async (req, res) => {
    const serverReceivedAt = Date.now();

    // Optional API-key auth
    const secret = process.env.WEBHOOK_SECRET;
    if (secret && req.headers["x-api-key"] !== secret) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const { signal, ticker, price, time: signalTime, workerReceivedAt } = req.body;

    if (!signal || !["BUY", "SELL"].includes(signal.toUpperCase())) {
      return res.status(400).json({ error: "Invalid signal — must be BUY or SELL" });
    }

    const normalised = signal.toUpperCase();
    const latencyMs  = serverReceivedAt - (workerReceivedAt || serverReceivedAt);

    console.log(
      `[WEBHOOK] ${normalised} | ticker:${ticker} price:${price} | ` +
      `latency:${latencyMs}ms`
    );

    // Broadcast signal arrival to dashboard immediately
    io.emit("signal_received", {
      signal:            normalised,
      ticker,
      price:             parseFloat(price),
      signalTime:        signalTime ? parseInt(signalTime) : serverReceivedAt,
      workerReceivedAt:  workerReceivedAt ? parseInt(workerReceivedAt) : serverReceivedAt,
      serverReceivedAt,
      latencyMs,
    });

    // Execute trade
    const trade = await tradeEngine.onSignal(normalised, {
      signalTime:       signalTime ? parseInt(signalTime) : serverReceivedAt,
      workerReceivedAt: workerReceivedAt ? parseInt(workerReceivedAt) : serverReceivedAt,
    });

    return res.json({
      ok:            true,
      tradeId:       trade?._id ?? null,
      tradeNum:      trade?.tradeNum ?? null,
      executionMs:   Date.now() - serverReceivedAt,
    });
  });

  return router;
};
