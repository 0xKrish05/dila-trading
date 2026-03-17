/**
 * GET  /api/mode        — returns current mode
 * POST /api/mode        — switches mode, verifies credentials for mainnet
 */
const express = require("express");

let currentMode = "sim"; // "sim" | "mainnet"
let mainnetProfile = null;

module.exports = function (io) {
  const router = express.Router();

  router.get("/", (_req, res) => {
    res.json({ mode: currentMode, profile: mainnetProfile });
  });

  router.post("/", async (req, res) => {
    const { mode, credentials } = req.body;

    if (!["sim", "mainnet"].includes(mode)) {
      return res.status(400).json({ error: "Invalid mode" });
    }

    if (mode === "mainnet") {
      if (!credentials?.walletAddress) {
        return res.status(400).json({ error: "Credentials required" });
      }

      const verified = await verifyCredentials(credentials);
      if (!verified.ok) {
        return res.status(401).json({ error: verified.error });
      }
      mainnetProfile = verified.profile;
    } else {
      mainnetProfile = null;
    }

    currentMode = mode;
    io.emit("mode_change", { mode: currentMode, profile: mainnetProfile });
    res.json({ ok: true, mode: currentMode, profile: mainnetProfile });
  });

  return router;
};

async function verifyCredentials(creds) {
  const addr = creds.walletAddress?.trim();

  // Basic format check
  if (!addr || !addr.startsWith("0x") || addr.length !== 42) {
    return { ok: false, error: "Invalid wallet address format (must be 0x + 40 hex chars)" };
  }

  // Try Polymarket profile lookup
  try {
    const resp = await fetch(
      `https://data-api.polymarket.com/profile?address=${addr.toLowerCase()}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (resp.ok) {
      const data = await resp.json();
      return {
        ok: true,
        profile: {
          address: addr,
          name:    data.name || data.username || addr.slice(0, 8) + "…",
          avatar:  data.profileImage || null,
        },
      };
    }
  } catch (_) { /* network error — fallback */ }

  // Fallback: accept valid address even if profile fetch fails
  return {
    ok: true,
    profile: { address: addr, name: addr.slice(0, 8) + "…", avatar: null },
  };
}
