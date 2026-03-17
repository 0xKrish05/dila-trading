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

const express      = require("express");
const tradeEngine  = require("../services/tradeEngine");
const cycleManager = require("../services/cycleManager");

module.exports = function (io) {
  const router = express.Router();
  tradeEngine.setIo(io);

  router.post("/", async (req, res) => {
    const serverReceivedAt = Date.now();

    // Optional API-key auth (header OR ?key= query param for TradingView)
    const secret = process.env.WEBHOOK_SECRET;
    if (secret) {
      const provided = req.headers["x-api-key"] || req.query.key;
      if (provided !== secret) {
        return res.status(403).json({ error: "Unauthorized" });
      }
    }

    const body = req.body;

    // Accept: signal OR action field, buy/sell OR BUY/SELL
    const rawSignal = (body.signal || body.action || "").toString().toUpperCase();
    const { ticker, price, time: signalTime, workerReceivedAt } = body;

    if (!["BUY", "SELL"].includes(rawSignal)) {
      console.log(`[WEBHOOK] Bad signal field — body keys: ${Object.keys(body).join(",")}`);
      return res.status(400).json({
        error: "Invalid signal. Send JSON with signal or action field = buy/sell",
        received: body,
      });
    }

    const normalised = rawSignal;
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

    const cycle = cycleManager.getState();

    // Execute trade
    const trade = await tradeEngine.onSignal(normalised, {
      signalTime:       signalTime ? parseInt(signalTime) : serverReceivedAt,
      workerReceivedAt: workerReceivedAt ? parseInt(workerReceivedAt) : serverReceivedAt,
    });

    const placed = !!trade;
    const reason = !placed
      ? (cycle.stage !== "ACTIVE"
          ? `Signal rejected — cycle stage is ${cycle.stage} (${cycle.remaining}s remaining). Trades only accepted during ACTIVE stage.`
          : "Signal rejected — insufficient margin or zero stake")
      : null;

    if (!placed) console.log(`[WEBHOOK] ⚠ Not placed: ${reason}`);

    return res.json({
      ok:          true,
      placed,
      tradeId:     trade?._id    ?? null,
      tradeNum:    trade?.tradeNum ?? null,
      cycleStage:  cycle.stage,
      remaining:   cycle.remaining,
      reason,
      executionMs: Date.now() - serverReceivedAt,
    });
  });

  return router;
};
