/**
 * PriceService — BTC/USDT real-time price + 5m directional probability
 *
 * Connection chain (tries each until one works):
 *   WS:   stream.binance.com:443  →  stream1.binance.com:9443
 *   REST: api.binance.com  →  api1.binance.com  →  CoinGecko
 *
 * Railway blocks port 9443 outbound — we use port 443 first.
 */

const WebSocket         = require("ws");
const tradeEngine       = require("./tradeEngine");
const polymarketService = require("./polymarketService");

// Binance stream hosts to try in order
const WS_HOSTS = [
  "wss://stream.binance.com:443/stream?streams=btcusdt@aggTrade/btcusdt@kline_5m",
  "wss://stream1.binance.com:9443/stream?streams=btcusdt@aggTrade/btcusdt@kline_5m",
];

// REST price sources (Binance variants + CoinGecko fallback)
const REST_SOURCES = [
  {
    url:    "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT",
    parse:  d => parseFloat(d.price),
  },
  {
    url:    "https://api1.binance.com/api/v3/ticker/price?symbol=BTCUSDT",
    parse:  d => parseFloat(d.price),
  },
  {
    url:    "https://api2.binance.com/api/v3/ticker/price?symbol=BTCUSDT",
    parse:  d => parseFloat(d.price),
  },
  {
    url:    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
    parse:  d => parseFloat(d?.bitcoin?.usd),
  },
];

const KLINE_SOURCES = [
  "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=5m&limit=1",
  "https://api1.binance.com/api/v3/klines?symbol=BTCUSDT&interval=5m&limit=1",
  "https://api2.binance.com/api/v3/klines?symbol=BTCUSDT&interval=5m&limit=1",
];

class PriceService {
  constructor() {
    this.currentPrice     = null;
    this.currentProbUp    = 0.5;
    this.candle5mOpen     = null;
    this.candle5mOpenTime = null;
    this.io               = null;
    this.ws               = null;
    this._lastWsTick      = null;
    this._pollHandle      = null;
    this._wsIndex         = 0;
  }

  async start(io) {
    this.io = io;
    await this._bootstrapPrice();       // get price immediately via REST
    this._pollHandle = setInterval(() => this._restPoll(), 4000); // 4s REST fallback
    this._connect();
    console.log("[PRICE] Price service started");
  }

  getCurrentPrice() { return this.currentPrice || 0; }
  getCurrentProb()  { return this.currentProbUp; }

  // ── REST bootstrap — tries multiple sources ─────────────────────────────────
  async _bootstrapPrice() {
    // Get current price
    for (const src of REST_SOURCES) {
      try {
        const r = await fetch(src.url, { signal: AbortSignal.timeout(5000) });
        if (!r.ok) continue;
        const price = src.parse(await r.json());
        if (price && price > 0) {
          this.currentPrice = price;
          console.log(`[PRICE] Bootstrap price: $${price} from ${src.url.slice(8, 35)}`);
          break;
        }
      } catch (_) {}
    }

    // Get current 5m candle open
    for (const url of KLINE_SOURCES) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!r.ok) continue;
        const data = await r.json();
        const openTime  = data[0][0];
        const openPrice = parseFloat(data[0][1]);
        if (openPrice > 0) {
          this.candle5mOpen     = openPrice;
          this.candle5mOpenTime = openTime;
          console.log(`[PRICE] Bootstrap candle open: $${openPrice}`);
          break;
        }
      } catch (_) {}
    }

    // If candle open still null, use current price
    if (!this.candle5mOpen && this.currentPrice) {
      this.candle5mOpen = this.currentPrice;
      this.candle5mOpenTime = Math.floor(Date.now() / 300000) * 300000;
    }

    this._recalcProb();
    this._emitUpdate();
  }

  // ── REST poll every 4s — fires when WS is silent ────────────────────────────
  async _restPoll() {
    // Skip if WS sent a tick in the last 5s
    if (this._lastWsTick && Date.now() - this._lastWsTick < 5000) return;

    for (const src of REST_SOURCES) {
      try {
        const r = await fetch(src.url, { signal: AbortSignal.timeout(3000) });
        if (!r.ok) continue;
        const price = src.parse(await r.json());
        if (price && price > 0) {
          this.currentPrice = price;
          this._recalcProb();
          this._emitUpdate();
          return;
        }
      } catch (_) {}
    }
  }

  // ── Recalculate probUp from candle move ─────────────────────────────────────
  _recalcProb() {
    if (!this.currentPrice || !this.candle5mOpen) return;
    const move         = (this.currentPrice - this.candle5mOpen) / this.candle5mOpen;
    this.currentProbUp = 1 / (1 + Math.exp(-move * 80));
  }

  // ── Emit price_update to all clients ────────────────────────────────────────
  _emitUpdate() {
    if (!this.io || !this.currentPrice) return;
    const probUp = parseFloat(this.currentProbUp.toFixed(4));
    polymarketService.updateFromProbUp(probUp);
    this.io.emit("price_update", {
      price:     this.currentPrice,
      probUp,
      polyCents: polymarketService.getLastPrices(),
      timestamp: Date.now(),
    });
    tradeEngine.monitorOpenTrades(probUp);
  }

  // ── Binance WebSocket — tries port 443 first ─────────────────────────────────
  _connect() {
    const url = WS_HOSTS[this._wsIndex % WS_HOSTS.length];
    console.log(`[PRICE] Connecting WS: ${url.slice(0, 50)}`);

    this.ws = new WebSocket(url);

    this.ws.on("open", () => console.log("[PRICE] Binance WS connected"));

    this.ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.stream?.includes("aggTrade")) this._onTrade(msg.data);
        else if (msg.stream?.includes("kline")) this._onKline(msg.data);
      } catch (_) {}
    });

    this.ws.on("close", () => {
      this._wsIndex++;
      const delay = this._wsIndex % WS_HOSTS.length === 0 ? 10000 : 3000;
      console.log(`[PRICE] WS closed, retrying in ${delay / 1000}s (host ${this._wsIndex % WS_HOSTS.length})`);
      setTimeout(() => this._connect(), delay);
    });

    this.ws.on("error", (err) => {
      console.warn("[PRICE] WS error:", err.message);
    });
  }

  _onTrade(data) {
    this._lastWsTick  = Date.now();
    this.currentPrice = parseFloat(data.p);

    if (!this.candle5mOpen) {
      this.candle5mOpen     = this.currentPrice;
      this.candle5mOpenTime = Math.floor(Date.now() / 300000) * 300000;
    }

    this._recalcProb();
    this._emitUpdate();
  }

  _onKline(data) {
    const k = data.k;
    if (this.candle5mOpenTime !== k.t) {
      this.candle5mOpen     = parseFloat(k.o);
      this.candle5mOpenTime = k.t;
      console.log(`[PRICE] New 5m candle: $${this.candle5mOpen}`);
      if (this.io) this.io.emit("new_candle", { open: this.candle5mOpen, openTime: k.t });
    }
    if (k.x) {
      console.log("[PRICE] Candle closed — expiring open trades");
      tradeEngine.expireOpenTrades(this.currentProbUp);
    }
  }
}

module.exports = new PriceService();
