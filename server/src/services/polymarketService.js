/**
 * PolymarketService
 * ─────────────────────────────────────────────────────────────
 * Provides real-time BTC directional prices in cents for the dashboard.
 *
 * Sources (in priority order):
 *   1. Polymarket CLOB REST – polls any active BTC binary market every 10s
 *      Uses outcomePrices + clobTokenIds (correct Gamma API fields)
 *   2. Binance momentum fallback – derived from live probUp when no
 *      Polymarket BTC binary market exists (Polymarket has no 5-min BTC market)
 *
 * NOTE: Polymarket currently offers NO 5-minute BTC up/down markets.
 *       The closest we can do is find their longest BTC binary and show that,
 *       or use live Binance momentum (probUp) as an equivalent signal.
 */

const WebSocket = require("ws");

let io          = null;
let pollHandle  = null;
let wsHandle    = null;
let marketInfo  = null;   // { question, yesId, noId }
let lastPrices  = { yes: 50, no: 50, source: "binance", market: "BTC 5-min Momentum" };

// ── Gamma API search URLs (in order of relevance) ────────────────────────────
const SEARCH_URLS = [
  "https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=20&q=bitcoin+price",
  "https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=20&q=btc+price",
  "https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=30&q=bitcoin",
];

// ── Boot ─────────────────────────────────────────────────────────────────────
async function start(socketIo) {
  io = socketIo;
  await _discoverAndPoll();
  pollHandle = setInterval(_discoverAndPoll, 10_000); // poll every 10s
  console.log("[POLY] Polymarket service started (10s REST poll)");
}

function stop() {
  if (pollHandle) clearInterval(pollHandle);
  if (wsHandle)   { try { wsHandle.terminate(); } catch (_) {} wsHandle = null; }
}

function getLastPrices() { return lastPrices; }

// Update from Binance probUp — only when we have no real Polymarket data
function updateFromProbUp(probUp) {
  lastPrices = {
    yes:    Math.round(probUp * 100),
    no:     Math.round((1 - probUp) * 100),
    source: lastPrices.source === "polymarket" ? "polymarket" : "binance",
    market: lastPrices.source === "polymarket" ? lastPrices.market : "BTC 5-min Momentum",
  };
  // Don't emit here — priceService will include it in price_update
}

// ── REST poll: find market + update prices ────────────────────────────────────
async function _discoverAndPoll() {
  let found = false;

  for (const url of SEARCH_URLS) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!resp.ok) continue;

      const markets = await resp.json();
      const btc = markets.find(m =>
        m.active && !m.closed &&
        m.outcomePrices &&
        (m.question?.toLowerCase().includes("bitcoin") ||
         m.question?.toLowerCase().includes("btc"))
      );

      if (!btc) continue;

      // Parse outcomePrices — it's a JSON string like '["0.52","0.48"]'
      let op = btc.outcomePrices;
      if (typeof op === "string") op = JSON.parse(op);

      const yes = Math.round(parseFloat(op[0]) * 100);
      const no  = Math.round(parseFloat(op[1]) * 100);

      // Store clobTokenIds for WS subscription
      const ids = btc.clobTokenIds || [];
      if (ids.length === 2 && (!marketInfo || marketInfo.yesId !== ids[0])) {
        marketInfo = { question: btc.question, yesId: ids[0], noId: ids[1] };
        _connectWS(); // subscribe for real-time updates on top of REST
      }

      lastPrices = { yes, no, source: "polymarket", market: btc.question };
      console.log(`[POLY] "${btc.question.slice(0,50)}" YES=${yes}¢ NO=${no}¢`);
      found = true;
      break;
    } catch (err) {
      console.warn("[POLY] Search failed:", err.message);
    }
  }

  if (!found) {
    // No Polymarket BTC market found — keep current Binance-derived prices
    if (lastPrices.source === "polymarket") {
      lastPrices = { ...lastPrices, source: "binance", market: "BTC 5-min Momentum" };
    }
  }

  if (io) io.emit("poly_market_update", lastPrices);
}

// ── Optional WS for real-time on top of REST ──────────────────────────────────
function _connectWS() {
  if (!marketInfo) return;
  if (wsHandle) { try { wsHandle.terminate(); } catch (_) {} }

  try {
    wsHandle = new WebSocket("wss://ws-subscriptions-clob.polymarket.com/ws/market");

    wsHandle.on("open", () => {
      wsHandle.send(JSON.stringify({
        type: "market",
        assets_ids: [marketInfo.yesId, marketInfo.noId],
      }));
      console.log("[POLY] CLOB WS subscribed to:", marketInfo.question?.slice(0, 50));
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

// ── User account lookup ───────────────────────────────────────────────────────
async function fetchUserAccount(walletAddress) {
  const addr = walletAddress.toLowerCase().trim();

  // Try profile (may 404 for proxy wallet addresses — that's OK)
  let profileName = null, avatar = null;
  try {
    const r = await fetch(
      `https://data-api.polymarket.com/profile?address=${addr}`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (r.ok) {
      const p = await r.json();
      profileName = p?.name || p?.pseudonym || p?.username || null;
      avatar      = p?.profileImage || p?.pfpUrl || null;
    }
  } catch (_) {}

  // Open positions
  let polyBalance = null, positions = [];
  try {
    const r2 = await fetch(
      `https://data-api.polymarket.com/positions?user=${addr}&sizeThreshold=0&limit=200`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (r2.ok) {
      positions = await r2.json();
      if (Array.isArray(positions)) {
        polyBalance = parseFloat(
          positions.reduce((s, p) =>
            s + parseFloat(p.size ?? 0) * parseFloat(p.curPrice ?? p.price ?? 0), 0
          ).toFixed(2)
        );
      }
    }
  } catch (_) {}

  // USDC.e wallet balance on Polygon RPC
  let usdcBalance = null;
  for (const contract of [
    "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", // USDC.e
    "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", // native USDC
  ]) {
    try {
      const callData = "0x70a08231" + addr.replace("0x", "").padStart(64, "0");
      const r3 = await fetch("https://polygon-rpc.com", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1, method: "eth_call",
          params: [{ to: contract, data: callData }, "latest"],
        }),
        signal: AbortSignal.timeout(5000),
      });
      const json = await r3.json();
      const raw  = json.result;
      if (raw && raw !== "0x" && raw !== "0x" + "0".repeat(64)) {
        const bal = parseInt(raw, 16) / 1e6;
        if (bal > 0) { usdcBalance = parseFloat(bal.toFixed(2)); break; }
      }
    } catch (_) {}
  }

  return {
    ok: true,
    profile: {
      address:       walletAddress,
      name:          profileName || addr.slice(0, 6) + "…" + addr.slice(-4),
      avatar,
      polyBalance:   positions.length > 0 ? polyBalance : null,
      usdcBalance,
      positionCount: Array.isArray(positions) ? positions.length : 0,
    },
  };
}

module.exports = { start, stop, getLastPrices, updateFromProbUp, fetchUserAccount };
