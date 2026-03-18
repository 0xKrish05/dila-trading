/**
 * PolymarketService
 * ─────────────────────────────────────────────────────────────
 * Two responsibilities:
 *   1. Real-time BTC directional cents for the price panel (market data)
 *   2. Real user account data: balance, positions, trades, PnL
 *
 * Data API is fully public — just wallet address needed.
 * USDC balance fetched directly from Polygon RPC.
 */

const WebSocket = require("ws");

let io          = null;
let pollHandle  = null;
let wsHandle    = null;
let marketInfo  = null;
let lastPrices  = { yes: 50, no: 50, source: "binance", market: "BTC 5-min Momentum" };

// ── Gamma API search for BTC binary market ────────────────────────────────────
const SEARCH_URLS = [
  "https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=20&q=bitcoin+price",
  "https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=20&q=btc+price",
  "https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=30&q=bitcoin",
];

// ── Boot ─────────────────────────────────────────────────────────────────────
async function start(socketIo) {
  io = socketIo;
  await _discoverAndPoll();
  pollHandle = setInterval(_discoverAndPoll, 10_000);
  console.log("[POLY] Polymarket service started");
}

function stop() {
  if (pollHandle) clearInterval(pollHandle);
  if (wsHandle)   { try { wsHandle.terminate(); } catch (_) {} wsHandle = null; }
}

function getLastPrices() { return lastPrices; }

function updateFromProbUp(probUp) {
  lastPrices = {
    yes:    Math.round(probUp * 100),
    no:     Math.round((1 - probUp) * 100),
    source: lastPrices.source === "polymarket" ? "polymarket" : "binance",
    market: lastPrices.source === "polymarket" ? lastPrices.market : "BTC 5-min Momentum",
  };
}

// ── REST poll: find BTC market + update prices ────────────────────────────────
async function _discoverAndPoll() {
  let found = false;

  for (const url of SEARCH_URLS) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!resp.ok) continue;

      const markets = await resp.json();
      const btc = markets.find(m =>
        m.active && !m.closed && m.outcomePrices &&
        (m.question?.toLowerCase().includes("bitcoin") ||
         m.question?.toLowerCase().includes("btc"))
      );
      if (!btc) continue;

      let op = btc.outcomePrices;
      if (typeof op === "string") op = JSON.parse(op);

      const yes = Math.round(parseFloat(op[0]) * 100);
      const no  = Math.round(parseFloat(op[1]) * 100);

      const ids = btc.clobTokenIds || [];
      if (ids.length === 2 && (!marketInfo || marketInfo.yesId !== ids[0])) {
        marketInfo = { question: btc.question, yesId: ids[0], noId: ids[1] };
        _connectWS();
      }

      lastPrices = { yes, no, source: "polymarket", market: btc.question };
      console.log(`[POLY] "${btc.question.slice(0,50)}" YES=${yes}¢ NO=${no}¢`);
      found = true;
      break;
    } catch (err) {
      console.warn("[POLY] Search failed:", err.message);
    }
  }

  if (!found && lastPrices.source === "polymarket") {
    lastPrices = { ...lastPrices, source: "binance", market: "BTC 5-min Momentum" };
  }

  if (io) io.emit("poly_market_update", lastPrices);
}

// ── CLOB WS for real-time on top of REST ──────────────────────────────────────
function _connectWS() {
  if (!marketInfo) return;
  if (wsHandle) { try { wsHandle.terminate(); } catch (_) {} }

  try {
    wsHandle = new WebSocket("wss://ws-subscriptions-clob.polymarket.com/ws/market");
    wsHandle.on("open", () => {
      wsHandle.send(JSON.stringify({ type: "market", assets_ids: [marketInfo.yesId, marketInfo.noId] }));
    });
    wsHandle.on("message", (raw) => {
      try {
        const events = JSON.parse(raw.toString());
        const list = Array.isArray(events) ? events : [events];
        let changed = false;
        for (const evt of list) {
          const price = parseFloat(evt.price ?? evt.best_bid ?? 0);
          if (!price || !evt.asset_id) continue;
          if (evt.asset_id === marketInfo.yesId) {
            lastPrices = { ...lastPrices, yes: Math.round(price * 100), source: "polymarket" };
            changed = true;
          } else if (evt.asset_id === marketInfo.noId) {
            lastPrices = { ...lastPrices, no: Math.round(price * 100), source: "polymarket" };
            changed = true;
          }
        }
        if (changed && io) io.emit("poly_market_update", lastPrices);
      } catch (_) {}
    });
    wsHandle.on("close", () => console.warn("[POLY] CLOB WS closed"));
    wsHandle.on("error", (e) => console.warn("[POLY] CLOB WS error:", e.message));
  } catch (e) {
    console.warn("[POLY] WS connect failed:", e.message);
  }
}

// ── Polygon RPC USDC balance ──────────────────────────────────────────────────
const POLYGON_RPCS = [
  "https://rpc.ankr.com/polygon",
  "https://polygon.llamarpc.com",
  "https://polygon-rpc.com",
];
const USDC_CONTRACTS = [
  "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", // USDC.e
  "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", // native USDC
];

async function _fetchUSDCBalance(addr) {
  const callData = "0x70a08231" + addr.replace("0x", "").padStart(64, "0");
  for (const rpc of POLYGON_RPCS) {
    for (const contract of USDC_CONTRACTS) {
      try {
        const r = await fetch(rpc, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0", id: 1, method: "eth_call",
            params: [{ to: contract, data: callData }, "latest"],
          }),
          signal: AbortSignal.timeout(5000),
        });
        const json = await r.json();
        const raw  = json?.result;
        if (raw && raw.length > 2 && raw !== "0x" + "0".repeat(64)) {
          const bal = parseInt(raw, 16) / 1e6;
          if (bal >= 0) return parseFloat(bal.toFixed(2));
        }
      } catch (_) {}
    }
  }
  return null;
}

// ── Full account data from Polymarket public Data API ────────────────────────
async function fetchUserAccount(walletAddress) {
  const addr = walletAddress.trim();

  // 1. Profile
  let profile = {};
  for (const url of [
    `https://data-api.polymarket.com/profile?user=${addr}`,
    `https://data-api.polymarket.com/profiles/${addr}`,
  ]) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (r.ok) {
        const p = await r.json();
        if (p && (p.name || p.pseudonym || p.username || p.proxyWallet)) {
          profile = p;
          break;
        }
      }
    } catch (_) {}
  }

  // 2. Positions (public Data API)
  let positions = [];
  try {
    const r = await fetch(
      `https://data-api.polymarket.com/positions?user=${addr}&sizeThreshold=0&limit=50&sortBy=CASHPNL&sortDirection=DESC`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (r.ok) {
      const d = await r.json();
      if (Array.isArray(d)) positions = d;
    }
  } catch (_) {}

  // 3. Recent trades (public Data API)
  let trades = [];
  try {
    const r = await fetch(
      `https://data-api.polymarket.com/trades?user=${addr}&limit=30`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (r.ok) {
      const d = await r.json();
      if (Array.isArray(d)) trades = d;
    }
  } catch (_) {}

  // 4. USDC wallet balance via Polygon RPC
  const usdcBalance = await _fetchUSDCBalance(addr);

  // 5. Compute stats from positions
  const totalPositionValue = positions.reduce((s, p) => s + (parseFloat(p.currentValue) || 0), 0);
  const totalCashPnl       = positions.reduce((s, p) => s + (parseFloat(p.cashPnl) || 0), 0);
  const totalVolume        = trades.reduce((s, t) => s + (parseFloat(t.size) * parseFloat(t.price) || 0), 0);

  const name   = profile.name || profile.pseudonym || profile.username || null;
  const avatar = profile.profileImage || profile.profileImageOptimized || profile.pfpUrl || null;

  return {
    ok: true,
    profile: {
      address:            addr,
      name:               name || addr.slice(0, 6) + "…" + addr.slice(-4),
      avatar,
      usdcBalance,
      positionValue:      parseFloat(totalPositionValue.toFixed(2)),
      cashPnl:            parseFloat(totalCashPnl.toFixed(2)),
      totalVolume:        parseFloat(totalVolume.toFixed(2)),
      positionCount:      positions.length,
      tradeCount:         trades.length,
    },
    positions: positions.map(p => ({
      title:       p.title || "Unknown market",
      outcome:     p.outcome || "YES",
      size:        parseFloat(p.size) || 0,
      avgPrice:    parseFloat(p.avgPrice) || 0,
      curPrice:    parseFloat(p.curPrice) || 0,
      currentValue: parseFloat(p.currentValue) || 0,
      cashPnl:     parseFloat(p.cashPnl) || 0,
      percentPnl:  parseFloat(p.percentPnl) || 0,
      redeemable:  !!p.redeemable,
      endDate:     p.endDate || null,
      icon:        p.icon || null,
    })),
    trades: trades.map(t => ({
      market:    t.title || "Unknown",
      outcome:   t.outcome || "",
      side:      t.side || "BUY",
      size:      parseFloat(t.size) || 0,
      price:     parseFloat(t.price) || 0,
      value:     parseFloat((parseFloat(t.size) * parseFloat(t.price)).toFixed(2)),
      timestamp: t.timestamp ? new Date(t.timestamp * 1000).toISOString() : null,
      txHash:    t.transactionHash || null,
    })),
  };
}

module.exports = { start, stop, getLastPrices, updateFromProbUp, fetchUserAccount };
