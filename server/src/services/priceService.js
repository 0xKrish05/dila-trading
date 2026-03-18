/**
 * PriceService — BTC/USDT real-time price + 5m directional probability
 *
 * Binance returns 451 (geo-blocked) on Railway.
 * Primary WebSocket : Bybit  wss://stream.bybit.com/v5/public/spot
 * Fallback WebSocket: OKX    wss://ws.okx.com:8443/ws/v5/public
 * REST fallback chain: Coinbase → Kraken → CryptoCompare → CoinGecko
 */

const WebSocket   = require("ws");
const tradeEngine = require("./tradeEngine");
const polymarketService = require("./polymarketService");

// ── WebSocket configs ──────────────────────────────────────────────────────────
const WS_CONFIGS = [
  {
    name: "Bybit",
    url:  "wss://stream.bybit.com/v5/public/spot",
    onOpen(ws) {
      ws.send(JSON.stringify({ op: "subscribe", args: ["publicTrade.BTCUSDT"] }));
      ws.send(JSON.stringify({ op: "subscribe", args: ["kline.5.BTCUSDT"] }));
    },
    onMessage(data, svc) {
      if (data.topic === "publicTrade.BTCUSDT" && data.data?.length) {
        const price = parseFloat(data.data[0].p);
        if (price > 0) svc._onTickPrice(price);
      }
      if (data.topic?.startsWith("kline.5.BTCUSDT") && data.data?.length) {
        const k = data.data[0];
        svc._onKlineData({ open: parseFloat(k.open), start: k.start, confirm: k.confirm });
      }
    },
  },
  {
    name: "OKX",
    url:  "wss://ws.okx.com:8443/ws/v5/public",
    onOpen(ws) {
      ws.send(JSON.stringify({ op: "subscribe", args: [{ channel: "trades", instId: "BTC-USDT" }] }));
    },
    onMessage(data, svc) {
      if (data.arg?.channel === "trades" && data.data?.length) {
        const price = parseFloat(data.data[0].px);
        if (price > 0) svc._onTickPrice(price);
      }
    },
  },
];

// ── REST price sources (non-Binance) ─────────────────────────────────────────
const REST_SOURCES = [
  {
    url:   "https://api.coinbase.com/v2/prices/BTC-USD/spot",
    parse: d => parseFloat(d?.data?.amount),
  },
  {
    url:   "https://api.kraken.com/0/public/Ticker?pair=XBTUSD",
    parse: d => parseFloat(Object.values(d?.result ?? {})[0]?.c?.[0]),
  },
  {
    url:   "https://min-api.cryptocompare.com/data/price?fsym=BTC&tsyms=USD",
    parse: d => parseFloat(d?.USD),
  },
  {
    url:   "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
    parse: d => parseFloat(d?.bitcoin?.usd),
  },
];

// ── Kline (5m candle open) sources ───────────────────────────────────────────
const KLINE_SOURCES = [
  {
    url:   "https://api.bybit.com/v5/market/kline?symbol=BTCUSDT&interval=5&limit=1",
    parse: d => ({ open: parseFloat(d?.result?.list?.[0]?.[1]), start: parseInt(d?.result?.list?.[0]?.[0]) }),
  },
  {
    url:   "https://www.okx.com/api/v5/market/candles?instId=BTC-USDT&bar=5m&limit=1",
    parse: d => ({ open: parseFloat(d?.data?.[0]?.[1]), start: parseInt(d?.data?.[0]?.[0]) }),
  },
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
    this._tickCount       = 0;
    this._prevPrice       = null;
  }

  async start(io) {
    this.io = io;
    await this._bootstrapPrice();
    this._pollHandle = setInterval(() => this._restPoll(), 1000); // 1s REST fallback
    this._connect();
    console.log("[PRICE] Price service started");
  }

  getCurrentPrice() { return this.currentPrice || 0; }
  getCurrentProb()  { return this.currentProbUp; }

  // ── Bootstrap via REST on startup ────────────────────────────────────────────
  async _bootstrapPrice() {
    for (const src of REST_SOURCES) {
      try {
        const r = await fetch(src.url, { signal: AbortSignal.timeout(6000) });
        if (!r.ok) continue;
        const price = src.parse(await r.json());
        if (price && price > 0) {
          this.currentPrice = price;
          console.log(`[PRICE] Bootstrap price: $${price.toFixed(2)} from ${new URL(src.url).hostname}`);
          break;
        }
      } catch (_) {}
    }

    for (const src of KLINE_SOURCES) {
      try {
        const r = await fetch(src.url, { signal: AbortSignal.timeout(6000) });
        if (!r.ok) continue;
        const { open, start } = src.parse(await r.json());
        if (open > 0) {
          this.candle5mOpen     = open;
          this.candle5mOpenTime = start;
          console.log(`[PRICE] Bootstrap candle open: $${open.toFixed(2)}`);
          break;
        }
      } catch (_) {}
    }

    if (!this.candle5mOpen && this.currentPrice) {
      this.candle5mOpen     = this.currentPrice;
      this.candle5mOpenTime = Math.floor(Date.now() / 300000) * 300000;
    }

    this._recalcProb();
    this._emitUpdate("rest");
  }

  // ── REST poll every 1s when WS silent ────────────────────────────────────────
  async _restPoll() {
    if (this._lastWsTick && Date.now() - this._lastWsTick < 2000) return;

    for (const src of REST_SOURCES) {
      try {
        const r = await fetch(src.url, { signal: AbortSignal.timeout(3000) });
        if (!r.ok) continue;
        const price = src.parse(await r.json());
        if (price && price > 0) {
          this.currentPrice = price;
          this._recalcProb();
          this._emitUpdate("rest");
          return;
        }
      } catch (_) {}
    }
  }

  // ── Called on every trade tick from WS ───────────────────────────────────────
  _onTickPrice(price) {
    this._lastWsTick  = Date.now();
    this.currentPrice = price;
    if (!this.candle5mOpen) {
      this.candle5mOpen     = price;
      this.candle5mOpenTime = Math.floor(Date.now() / 300000) * 300000;
    }
    this._recalcProb();
    this._emitUpdate("ws");
  }

  // ── Called on kline event from WS ────────────────────────────────────────────
  _onKlineData({ open, start, confirm }) {
    if (this.candle5mOpenTime !== start) {
      this.candle5mOpen     = open;
      this.candle5mOpenTime = start;
      console.log(`[PRICE] New 5m candle open: $${open.toFixed(2)}`);
      if (this.io) this.io.emit("new_candle", { open, openTime: start });
    }
    if (confirm) {
      console.log("[PRICE] 5m candle closed — expiring open trades");
      tradeEngine.expireOpenTrades(this.currentProbUp);
    }
  }

  // ── Recalculate directional probability ─────────────────────────────────────
  _recalcProb() {
    if (!this.currentPrice || !this.candle5mOpen) return;
    const move = (this.currentPrice - this.candle5mOpen) / this.candle5mOpen;
    this.currentProbUp = 1 / (1 + Math.exp(-move * 80));
  }

  // ── Emit price_update to all Socket.IO clients ────────────────────────────────
  _emitUpdate(source = "ws") {
    if (!this.io || !this.currentPrice) return;
    const probUp = parseFloat(this.currentProbUp.toFixed(4));
    polymarketService.updateFromProbUp(probUp);
    this._tickCount++;
    const dir = this._prevPrice
      ? (this.currentPrice > this._prevPrice ? "up" : this.currentPrice < this._prevPrice ? "dn" : "flat")
      : "flat";
    this._prevPrice = this.currentPrice;
    this.io.emit("price_update", {
      price:     this.currentPrice,
      probUp,
      polyCents: polymarketService.getLastPrices(),
      timestamp: Date.now(),
      tick:      this._tickCount,
      dir,
      source,
    });
    tradeEngine.monitorOpenTrades(probUp);
  }

  // ── WebSocket connection with exchange rotation ──────────────────────────────
  _connect() {
    const cfg = WS_CONFIGS[this._wsIndex % WS_CONFIGS.length];
    console.log(`[PRICE] Connecting WS: ${cfg.name} (${cfg.url.slice(0, 40)})`);

    this.ws = new WebSocket(cfg.url);

    this.ws.on("open", () => {
      console.log(`[PRICE] ${cfg.name} WS connected`);
      cfg.onOpen(this.ws);
    });

    this.ws.on("message", (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        cfg.onMessage(data, this);
      } catch (_) {}
    });

    this.ws.on("close", () => {
      this._wsIndex++;
      const next = WS_CONFIGS[this._wsIndex % WS_CONFIGS.length].name;
      const delay = this._wsIndex % WS_CONFIGS.length === 0 ? 10000 : 3000;
      console.log(`[PRICE] ${cfg.name} WS closed — switching to ${next} in ${delay / 1000}s`);
      setTimeout(() => this._connect(), delay);
    });

    this.ws.on("error", (err) => {
      console.warn(`[PRICE] ${cfg.name} WS error: ${err.message}`);
    });
  }
}

module.exports = new PriceService();
