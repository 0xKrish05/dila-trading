/**
 * TradeEngine
 * ─────────────────────────────────────────────────────────────
 * Core trading logic:
 *   • Position sizing : 1% of total equity per trade
 *   • Entry           : simulated Polymarket-style probability
 *   • Target          : entry_prob + 0.09  (+9 cents on a $1 contract)
 *   • Stop loss       : entry_prob - 0.03  (-3 cents on a $1 contract)
 *   • P&L model       : stake × (exitProb − entryProb) / entryProb
 *     (mirrors buying probability contracts at entryProb and selling at exitProb)
 */

const Trade     = require("../models/Trade");
const Portfolio = require("../models/Portfolio");
const cycleManager = require("./cycleManager");

// lazy-loaded to avoid circular deps
let priceService;
const getPrice = () => {
  if (!priceService) priceService = require("./priceService");
  return priceService.getCurrentPrice();
};
const getProb = () => {
  if (!priceService) priceService = require("./priceService");
  return priceService.getCurrentProb();
};

const INITIAL_BALANCE = parseFloat(process.env.INITIAL_BALANCE || "500");
const RISK_PCT        = 0.01;   // 1% per trade
const TARGET_DELTA    = 0.09;   // +9 cents probability
const SL_DELTA        = 0.03;   // -3 cents probability

class TradeEngine {
  constructor() {
    this.io = null;
  }

  setIo(io) { this.io = io; }

  // ── Called from webhook route ────────────────────────────────────────────

  async onSignal(signal, meta = {}) {
    const serverReceivedAt = Date.now();

    if (!cycleManager.isInTradingWindow()) {
      console.log(`[ENGINE] ${signal} ignored — outside trading window`);
      return null;
    }

    let portfolio = await this._ensurePortfolio();

    // 1% of TOTAL equity (not just free margin)
    const stake = parseFloat((portfolio.balance * RISK_PCT).toFixed(2));

    // Free margin check
    const openTrades   = await Trade.find({ status: "OPEN" });
    const lockedEquity = openTrades.reduce((s, t) => s + t.stake, 0);
    const freeMargin   = portfolio.balance - lockedEquity;

    if (stake > freeMargin || stake < 0.01) {
      console.log(`[ENGINE] Insufficient margin: stake=$${stake} free=$${freeMargin.toFixed(2)}`);
      return null;
    }

    const direction  = signal === "BUY" ? "UP" : "DOWN";
    const entryPrice = getPrice();
    // Use ACTUAL live probUp so monitor can realistically hit TP/SL
    const rawProb    = getProb();
    const entryProb  = parseFloat(
      (direction === "UP" ? rawProb : 1 - rawProb).toFixed(4)
    );
    const targetProb   = parseFloat(Math.min(0.99, entryProb + TARGET_DELTA).toFixed(4));
    const stopLossProb = parseFloat(Math.max(0.01, entryProb - SL_DELTA).toFixed(4));

    const latencyMs      = serverReceivedAt - (meta.workerReceivedAt || serverReceivedAt);
    const totalLatencyMs = serverReceivedAt - (meta.signalTime || serverReceivedAt);

    // Increment trade counter
    portfolio = await Portfolio.findOneAndUpdate(
      {},
      { $inc: { tradeCounter: 1 } },
      { new: true }
    );
    const tradeNum = portfolio.tradeCounter;

    const trade = await Trade.create({
      tradeNum,
      signal,
      direction,
      entryPrice,
      entryProb,
      targetProb,
      stopLossProb,
      currentProb: entryProb,
      stake,
      status: "OPEN",
      openedAt: new Date(),
      signalReceivedAt: meta.signalTime || serverReceivedAt,
      workerReceivedAt: meta.workerReceivedAt || serverReceivedAt,
      serverReceivedAt,
      latencyMs,
      totalLatencyMs,
      cycleId: cycleManager.getState().cycleId,
      neuralConf: meta.neuralConf || null,
    });

    console.log(
      `[ENGINE] #${tradeNum} OPEN ${direction} | ` +
      `entry:${entryProb.toFixed(3)} target:${targetProb.toFixed(3)} sl:${stopLossProb.toFixed(3)} | ` +
      `stake:$${stake} latency:${totalLatencyMs}ms`
    );

    if (this.io) {
      this.io.emit("trade_opened", { trade, portfolio });
    }

    return trade;
  }

  // ── Called by PriceService on every aggTrade ─────────────────────────────

  async monitorOpenTrades(probUp) {
    const openTrades = await Trade.find({ status: "OPEN" });
    if (!openTrades.length) return;

    for (const trade of openTrades) {
      // From the trade's perspective
      const tradeProb = trade.direction === "UP" ? probUp : 1 - probUp;

      // Update current probability in DB (throttled — only if changed by > 0.001)
      if (Math.abs(tradeProb - trade.currentProb) > 0.001) {
        await Trade.updateOne({ _id: trade._id }, { currentProb: tradeProb });
      }

      if (this.io) {
        this.io.emit("position_update", {
          tradeId:      trade._id.toString(),
          currentProb:  parseFloat(tradeProb.toFixed(4)),
          currentPrice: getPrice(),
        });
      }

      // Check exit conditions
      if (tradeProb >= trade.targetProb) {
        await this.closeTrade(trade, "TARGET", tradeProb);
      } else if (tradeProb <= trade.stopLossProb) {
        await this.closeTrade(trade, "STOPPED", tradeProb);
      }
    }
  }

  // ── Called when 5-min candle closes ─────────────────────────────────────

  async expireOpenTrades(probUp) {
    const openTrades = await Trade.find({ status: "OPEN" });
    for (const trade of openTrades) {
      const tradeProb = trade.direction === "UP" ? probUp : 1 - probUp;
      await this.closeTrade(trade, "EXPIRED", tradeProb);
    }
  }

  // ── Internal close ───────────────────────────────────────────────────────

  async closeTrade(trade, reason, exitProb) {
    const exitPrice = getPrice();
    const closedAt  = new Date();

    // P&L: binary contract model
    // contracts = stake / entryProb
    // exit value = contracts × exitProb
    // pnl = exit_value - stake = stake × (exitProb - entryProb) / entryProb
    const pnl = parseFloat(
      (trade.stake * (exitProb - trade.entryProb) / trade.entryProb).toFixed(4)
    );

    await Trade.updateOne({ _id: trade._id }, {
      status: reason,
      exitProb:   parseFloat(exitProb.toFixed(4)),
      exitPrice,
      pnl,
      closedAt,
    });

    // Update portfolio balance
    const portfolio = await Portfolio.findOneAndUpdate(
      {},
      {
        $inc: { balance: pnl },
        $push: {
          equityHistory: {
            timestamp: closedAt,
            balance: 0,  // filled below
            pnl,
          }
        }
      },
      { new: true }
    );
    // Correct balance in last history entry
    await Portfolio.updateOne(
      {},
      { $set: { "equityHistory.$[last].balance": portfolio.balance } },
      { arrayFilters: [{ "last.timestamp": closedAt }] }
    );

    const updatedTrade = await Trade.findById(trade._id);

    console.log(
      `[ENGINE] #${trade.tradeNum} ${reason} @ prob:${exitProb.toFixed(3)} | ` +
      `P&L: $${pnl.toFixed(4)} | balance: $${portfolio.balance.toFixed(2)}`
    );

    if (this.io) {
      this.io.emit("trade_closed", { trade: updatedTrade, portfolio });
      this.io.emit("portfolio_update", portfolio);
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  async _ensurePortfolio() {
    let p = await Portfolio.findOne();
    if (!p) {
      p = await Portfolio.create({
        balance:        INITIAL_BALANCE,
        initialBalance: INITIAL_BALANCE,
        tradeCounter:   0,
      });
      console.log(`[ENGINE] Portfolio created: $${INITIAL_BALANCE}`);
    }
    return p;
  }

}

module.exports = new TradeEngine();
