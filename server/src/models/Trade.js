const mongoose = require("mongoose");

const TradeSchema = new mongoose.Schema({
  tradeNum:        { type: Number, required: true },
  signal:          { type: String, enum: ["BUY", "SELL"], required: true },
  direction:       { type: String, enum: ["UP", "DOWN"],  required: true },

  // Price & probability
  entryPrice:      { type: Number, required: true },
  entryProb:       { type: Number, required: true },   // simulated [0,1]
  targetProb:      { type: Number, required: true },   // entryProb + 0.09
  stopLossProb:    { type: Number, required: true },   // entryProb - 0.03
  currentProb:     { type: Number },
  exitProb:        { type: Number },
  exitPrice:       { type: Number },

  // Money
  stake:           { type: Number, required: true },   // 1% of equity
  pnl:             { type: Number, default: null },

  // Status
  status: {
    type: String,
    enum: ["OPEN", "TARGET", "STOPPED", "EXPIRED"],
    default: "OPEN",
  },

  // Timing
  openedAt:           { type: Date, default: Date.now },
  closedAt:           { type: Date },

  // Latency tracking
  signalReceivedAt:   { type: Number },  // ms — TradingView signal time
  workerReceivedAt:   { type: Number },  // ms — Cloudflare Worker receipt
  serverReceivedAt:   { type: Number },  // ms — backend receipt
  latencyMs:          { type: Number },  // Worker → server
  totalLatencyMs:     { type: Number },  // Signal → trade open

  cycleId:        { type: String },
  neuralConf:     { type: Number },
}, { timestamps: true });

module.exports = mongoose.model("Trade", TradeSchema);
