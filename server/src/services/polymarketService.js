/**
 * PolymarketService
 * ─────────────────────────────────────────────────────────────
 * • Polls Polymarket Gamma API every 15s for live BTC market prices (YES/NO cents)
 * • Fetches user profile + USDC balance from public Polymarket data API
 * • Falls back to probUp-derived prices if no active BTC market found
 */

let io         = null;
let pollHandle = null;
let lastPrices = { yes: 50, no: 50, source: "estimated", market: null };

// ── Start polling ─────────────────────────────────────────────────────────────
function start(socketIo) {
  io = socketIo;
  _poll();
  pollHandle = setInterval(_poll, 15_000);
  console.log("[POLY] Polymarket price feed started (15s interval)");
}

function stop() {
  if (pollHandle) { clearInterval(pollHandle); pollHandle = null; }
}

function getLastPrices() { return lastPrices; }

// ── Update from local probUp when no real market available ────────────────────
function updateFromProbUp(probUp) {
  if (lastPrices.source === "polymarket") return; // don't override real data
  lastPrices = {
    yes:    Math.round(probUp * 100),
    no:     Math.round((1 - probUp) * 100),
    source: "estimated",
    market: null,
  };
}

// ── Fetch real Polymarket BTC market prices ───────────────────────────────────
async function _poll() {
  try {
    const resp = await fetch(
      "https://gamma-api.polymarket.com/markets?active=true&closed=false&tag=bitcoin&limit=20",
      { signal: AbortSignal.timeout(8000) }
    );
    if (!resp.ok) throw new Error(`Gamma API ${resp.status}`);

    const markets = await resp.json();

    // Find most active BTC binary market
    const btc = markets.find(m =>
      m.active && !m.closed &&
      Array.isArray(m.tokens) && m.tokens.length === 2 &&
      (m.question?.toLowerCase().includes("bitcoin") ||
       m.question?.toLowerCase().includes("btc"))
    );

    if (btc && btc.tokens) {
      // tokens[0] = YES, tokens[1] = NO — price is 0.00–1.00
      const yes = btc.tokens[0]?.price ?? 0.5;
      const no  = btc.tokens[1]?.price ?? 0.5;

      lastPrices = {
        yes:    Math.round(parseFloat(yes) * 100),
        no:     Math.round(parseFloat(no)  * 100),
        source: "polymarket",
        market: btc.question,
      };
      console.log(`[POLY] ${btc.question}: YES=${lastPrices.yes}¢ NO=${lastPrices.no}¢`);
    }
  } catch (err) {
    console.warn("[POLY] Price fetch failed:", err.message);
  }

  if (io) {
    io.emit("poly_market_update", lastPrices);
  }
}

// ── Fetch user account data from Polymarket public APIs ──────────────────────
async function fetchUserAccount(walletAddress) {
  const addr = walletAddress.toLowerCase();

  // 1. Profile
  let profile = null;
  try {
    const r = await fetch(
      `https://data-api.polymarket.com/profile?address=${addr}`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (r.status === 404) {
      return {
        ok: false,
        error: "Polymarket account not found. You must have an active Polymarket account (sign in at polymarket.com and make at least one trade).",
      };
    }
    if (!r.ok) {
      return {
        ok: false,
        error: `Polymarket API error (${r.status}). Check your wallet address and try again.`,
      };
    }
    profile = await r.json();
    // If the response is empty or has no identifiable fields
    if (!profile || Object.keys(profile).length === 0) {
      return {
        ok: false,
        error: "No Polymarket account found for this wallet. Sign in at polymarket.com first.",
      };
    }
  } catch (err) {
    return {
      ok: false,
      error: `Could not reach Polymarket servers: ${err.message}. Check your internet connection.`,
    };
  }

  // 2. Portfolio value (open positions)
  let polyBalance = null;
  let positions   = [];
  try {
    const r2 = await fetch(
      `https://data-api.polymarket.com/positions?user=${addr}&sizeThreshold=0&limit=100`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (r2.ok) {
      positions = await r2.json();
      // Sum current value of all positions
      const posValue = positions.reduce((s, p) => {
        const size  = parseFloat(p.size  ?? p.currentValue ?? 0);
        const price = parseFloat(p.curPrice ?? p.price ?? 0);
        return s + size * price;
      }, 0);
      polyBalance = parseFloat(posValue.toFixed(2));
    }
  } catch (_) { /* non-fatal */ }

  // 3. USDC balance via Polygon public RPC (balanceOf call)
  let usdcBalance = null;
  try {
    // USDC.e on Polygon: 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174
    const abiEncoded = "0x70a08231" + addr.slice(2).padStart(64, "0");
    const rpc = await fetch("https://polygon-rpc.com", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", method: "eth_call",
        params: [
          { to: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", data: abiEncoded },
          "latest"
        ],
        id: 1,
      }),
      signal: AbortSignal.timeout(5000),
    });
    const rpcData = await rpc.json();
    if (rpcData.result && rpcData.result !== "0x") {
      usdcBalance = parseInt(rpcData.result, 16) / 1e6; // USDC has 6 decimals
      usdcBalance = parseFloat(usdcBalance.toFixed(2));
    }
  } catch (_) { /* non-fatal */ }

  return {
    ok: true,
    profile: {
      address:    walletAddress,
      name:       profile.name || profile.username || profile.pseudonym || walletAddress.slice(0, 8) + "…",
      avatar:     profile.profileImage || profile.pfpUrl || null,
      polyBalance,          // value of open positions
      usdcBalance,          // wallet USDC on Polygon
      positionCount: positions.length,
    },
  };
}

module.exports = { start, stop, getLastPrices, updateFromProbUp, fetchUserAccount };
