const mongoose = require("mongoose");

const PortfolioSchema = new mongoose.Schema({
  balance:        { type: Number, required: true, default: 500 },
  initialBalance: { type: Number, required: true, default: 500 },
  tradeCounter:   { type: Number, default: 0 },
  equityHistory:  [{
    timestamp: { type: Date, default: Date.now },
    balance:   Number,
    pnl:       Number,
  }],
}, { timestamps: true });

module.exports = mongoose.model("Portfolio", PortfolioSchema);
