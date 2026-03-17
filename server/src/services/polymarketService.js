/**
 * PolymarketService
 * ─────────────────────────────────────────────────────────────
 * 1. Discovers active BTC binary market via Polymarket Gamma API
 * 2. Connects to Polymarket CLOB WebSocket for real-time YES/NO prices
 * 3. Falls back to Binance probUp estimate if no active market found
 *
 * CLOB WS: wss://ws-subscriptions-clob.polymarket.com/ws/market
 * Gamma API: https://gamma-api.polymarket.com/markets
 */

const WebSocket = require("ws");

let io         = null;
let ws         = null;
let reconnTimer = null;
let marketInfo  = null;   // { question, yesTokenId, noTokenId }
let lastPrices  = { yes: 50, no: 50, source: "estimated", market: null };

const CLOB_WS  = "wss://ws-subscriptions-clob.polymarket.com/ws/market";
const GAMMA_URL = "https://gamma-api.polymarket.com/markets?active=true&closed=false&tag=bitcoin&limit=20";

// ── Boot ─────────────────────────────────────────────────────────────────────
async function start(socketIo) {
  io = socketIo;
  await _discoverMarket();
  _connectWS();
  // Re-discover market every 5 min (markets rotate)
  setInterval(_discoverMarket, 5 * 60_000);
  console.log("[POLY] Polymarket service started");
}

function stop() {
  if (ws) { ws.terminate(); ws = null; }
  if (reconnTimer) { clearTimeout(reconnTimer); reconnTimer = null; }
}

function getLastPrices() { return lastPrices; }

// Only update from Binance if we have no real Polymarket data yet
function updateFromProbUp(probUp) {
  if (lastPrices.source === "polymarket") return;
  lastPrices = {
    yes:    Math.round(probUp * 100),
    no:     Math.round((1 - probUp) * 100),
    source: "estimated",
    market: null,
  };
}

// ── Step 1: find active BTC market and extract token IDs ─────────────────────
async function _discoverMarket() {
  try {
    const resp = await fetch(GAMMA_URL, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) throw new Error(`Gamma API ${resp.status}`);
    const markets = await resp.json();

    // Find BTC binary (2-outcome) active market
    const btc = markets.find(m =>
      m.active && !m.closed &&
      (m.question?.toLowerCase().includes("bitcoin") || m.question?.toLowerCase().includes("btc")) &&
      Array.isArray(m.tokens) && m.tokens.length === 2
    );

    if (!btc) {
      console.warn("[POLY] No active BTC binary market found — using estimated prices");
      marketInfo = null;
      return;
    }

    const yesToken = btc.tokens.find(t => t.outcome?.toLowerCase() === "yes") || btc.tokens[0];
    const noToken  = btc.tokens.find(t => t.outcome?.toLowerCase() === "no")  || btc.tokens[1];

    const prevMarket = marketInfo?.yesTokenId;
    marketInfo = {
      question:   btc.question,
      yesTokenId: yesToken.token_id,
      noTokenId:  noToken.token_id,
    };

    // Seed prices from REST response immediately
    if (yesToken.price != null) {
      lastPrices = {
        yes:    Math.round(parseFloat(yesToken.price) * 100),
        no:     Math.round(parseFloat(noToken.price ?? (1 - yesToken.price)) * 100),
        source: "polymarket",
        market: btc.question,
      };
      _emit();
    }

    // Resubscribe WS if market changed
    if (prevMarket !== marketInfo.yesTokenId && ws?.readyState === WebSocket.OPEN) {
      _subscribe();
    }

    console.log(`[POLY] Market: "${btc.question}" YES:${marketInfo.yesTokenId?.slice(0,8)}…`);
  } catch (err) {
    console.warn("[POLY] Market discovery failed:", err.message);
  }
}

// ── Step 2: connect CLOB WebSocket ───────────────────────────────────────────
function _connectWS() {
  if (ws) { ws.terminate(); ws = null; }

  try {
    ws = new WebSocket(CLOB_WS);

    ws.on("open", () => {
      console.log("[POLY] CLOB WebSocket connected");
      if (marketInfo) _subscribe();
    });

    ws.on("message", (raw) => {
      try {
        _handleMessage(JSON.parse(raw.toString()));
      } catch (_) {}
    });

    ws.on("close", () => {
      console.warn("[POLY] CLOB WebSocket closed — reconnecting in 5s");
      reconnTimer = setTimeout(_connectWS, 5000);
    });

    ws.on("error", (err) => {
      console.warn("[POLY] CLOB WS error:", err.message);
    });
  } catch (err) {
    console.warn("[POLY] Could not open CLOB WS:", err.message);
    reconnTimer = setTimeout(_connectWS, 10_000);
  }
}

function _subscribe() {
  if (!marketInfo || ws?.readyState !== WebSocket.OPEN) return;
  const msg = JSON.stringify({
    type:       "market",
    assets_ids: [marketInfo.yesTokenId, marketInfo.noTokenId],
  });
  ws.send(msg);
  console.log(`[POLY] Subscribed to YES:${marketInfo.yesTokenId?.slice(0,8)}… NO:${marketInfo.noTokenId?.slice(0,8)}…`);
}

// ── Step 3: handle incoming WS messages ──────────────────────────────────────
function _handleMessage(msg) {
  if (!marketInfo) return;

  // Polymarket sends arrays or single events
  const events = Array.isArray(msg) ? msg : [msg];

  let updated = false;
  for (const evt of events) {
    const type  = evt.event_type;
    const id    = evt.asset_id;
    const price = parseFloat(evt.price ?? evt.best_bid ?? 0);

    if (!price || !id) continue;

    if (id === marketInfo.yesTokenId) {
      lastPrices = { ...lastPrices, yes: Math.round(price * 100), source: "polymarket", market: marketInfo.question };
      updated = true;
    } else if (id === marketInfo.noTokenId) {
      lastPrices = { ...lastPrices, no: Math.round(price * 100), source: "polymarket", market: marketInfo.question };
      updated = true;
    }

    // Also handle book updates (mid-price)
    if ((type === "book") && id === marketInfo.yesTokenId && Array.isArray(evt.bids) && evt.bids.length) {
      const best = parseFloat(evt.bids[0]?.price ?? 0);
      if (best > 0) {
        lastPrices = { ...lastPrices, yes: Math.round(best * 100), source: "polymarket", market: marketInfo.question };
        updated = true;
      }
    }
  }

  if (updated) _emit();
}

function _emit() {
  if (io) io.emit("poly_market_update", lastPrices);
}

// ── User account fetch ────────────────────────────────────────────────────────
async function fetchUserAccount(walletAddress) {
  const addr = walletAddress.toLowerCase().trim();

  // 1. Profile — must exist
  let profile = null;
  try {
    const r = await fetch(
      `https://data-api.polymarket.com/profile?address=${addr}`,
      { signal: AbortSignal.timeout(7000) }
    );
    if (r.status === 404) {
      return {
        ok: false,
        error: "Polymarket account not found for this address. Sign in at polymarket.com and make at least one trade first.",
      };
    }
    if (!r.ok) {
      return {
        ok: false,
        error: `Polymarket returned error ${r.status}. Check your wallet address.`,
      };
    }
    profile = await r.json();
    if (!profile || typeof profile !== "object" || (!profile.name && !profile.pseudonym && !profile.proxyWallet)) {
      return {
        ok: false,
        error: "Wallet has no Polymarket profile. Connect your wallet on polymarket.com and complete setup.",
      };
    }
  } catch (err) {
    return {
      ok: false,
      error: `Cannot reach Polymarket: ${err.message}`,
    };
  }

  // 2. Open positions value
  let polyBalance = null;
  let positions   = [];
  try {
    const r2 = await fetch(
      `https://data-api.polymarket.com/positions?user=${addr}&sizeThreshold=0&limit=200`,
      { signal: AbortSignal.timeout(7000) }
    );
    if (r2.ok) {
      positions   = await r2.json();
      polyBalance = parseFloat(
        positions.reduce((s, p) => {
          const size  = parseFloat(p.size        ?? 0);
          const price = parseFloat(p.curPrice    ?? p.price ?? 0);
          return s + size * price;
        }, 0).toFixed(2)
      );
    }
  } catch (_) {}

  // 3. Wallet USDC.e balance on Polygon via public RPC
  let usdcBalance = null;
  try {
    const data = "0x70a08231" + addr.replace("0x", "").padStart(64, "0");
    const rpc  = await fetch("https://polygon-rpc.com", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "eth_call",
        params: [{ to: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", data }, "latest"],
      }),
      signal: AbortSignal.timeout(5000),
    });
    const json = await rpc.json();
    if (json.result && json.result !== "0x") {
      usdcBalance = parseFloat((parseInt(json.result, 16) / 1e6).toFixed(2));
    }
  } catch (_) {}

  return {
    ok: true,
    profile: {
      address:       walletAddress,
      name:          profile.name || profile.pseudonym || profile.username || walletAddress.slice(0, 8) + "…",
      avatar:        profile.profileImage || profile.pfpUrl || null,
      polyBalance,
      usdcBalance,
      positionCount: positions.length,
    },
  };
}

module.exports = { start, stop, getLastPrices, updateFromProbUp, fetchUserAccount };
