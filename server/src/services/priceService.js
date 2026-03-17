/**
 * PriceService
 * Connects to Binance aggTrade + kline_5m WebSocket streams.
 * Feeds real-time price into tradeEngine for monitoring open positions.
 */

const WebSocket   = require("ws");
const tradeEngine = require("./tradeEngine");

class PriceService {
  constructor() {
    this.currentPrice     = null;
    this.currentProbUp    = 0.5;
    this.candle5mOpen     = null;
    this.candle5mOpenTime = null;
    this.io               = null;
    this.ws               = null;
  }

  start(io) {
    this.io = io;
    this._connect();
    console.log("[PRICE] Price service started");
  }

  getCurrentPrice() { return this.currentPrice || 0; }
  getCurrentProb()  { return this.currentProbUp; }

  _connect() {
    const url = [
      "wss://stream.binance.com:9443/stream?streams=",
      "btcusdt@aggTrade",
      "/btcusdt@kline_5m",
    ].join("");

    this.ws = new WebSocket(url);

    this.ws.on("open", () => console.log("[PRICE] Connected to Binance"));

    this.ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw);
        const stream = msg.stream || "";
        if (stream.includes("aggTrade")) {
          this._onTrade(msg.data);
        } else if (stream.includes("kline")) {
          this._onKline(msg.data);
        }
      } catch (_) {}
    });

    this.ws.on("close", () => {
      console.log("[PRICE] WS closed, reconnecting in 3s…");
      setTimeout(() => this._connect(), 3000);
    });

    this.ws.on("error", (err) => {
      console.error("[PRICE] WS error:", err.message);
    });
  }

  _onTrade(data) {
    this.currentPrice = parseFloat(data.p);

    // Simulate Polymarket probability from candle move
    if (this.candle5mOpen) {
      const move          = (this.currentPrice - this.candle5mOpen) / this.candle5mOpen;
      this.currentProbUp  = 1 / (1 + Math.exp(-move * 60));
    }

    if (this.io) {
      const probUp = parseFloat(this.currentProbUp.toFixed(4));
      this.io.emit("price_update", {
        price:     this.currentPrice,
        probUp,
        // Polymarket-style share prices in cents
        polyCents: {
          yes: Math.round(probUp * 100),        // UP share price
          no:  Math.round((1 - probUp) * 100),  // DOWN share price
        },
        timestamp: Date.now(),
      });
    }

    // Monitor every tick (engine throttles internally)
    tradeEngine.monitorOpenTrades(this.currentProbUp);
  }

  _onKline(data) {
    const k = data.k;

    // Track candle open
    if (this.candle5mOpenTime !== k.t) {
      this.candle5mOpen     = parseFloat(k.o);
      this.candle5mOpenTime = k.t;
      console.log(`[PRICE] New 5m candle open: $${this.candle5mOpen}`);
      if (this.io) {
        this.io.emit("new_candle", { open: this.candle5mOpen, openTime: k.t });
      }
    }

    // Candle closed → expire remaining open trades
    if (k.x) {
      console.log("[PRICE] 5m candle closed — expiring open trades");
      tradeEngine.expireOpenTrades(this.currentProbUp);
    }
  }
}

module.exports = new PriceService();
