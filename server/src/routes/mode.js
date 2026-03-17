/**
 * GET  /api/mode        — returns current mode + profile
 * POST /api/mode        — switches mode, verifies Polymarket account for mainnet
 */
const express          = require("express");
const polymarketService = require("../services/polymarketService");

let currentMode    = "sim"; // "sim" | "mainnet"
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
        return res.status(400).json({ error: "Wallet address is required" });
      }

      const addr = credentials.walletAddress.trim();

      // Strict wallet address format check
      if (!addr.startsWith("0x") || addr.length !== 42) {
        return res.status(400).json({
          error: "Invalid wallet address. Must start with 0x and be 42 characters long.",
        });
      }

      // Fetch real Polymarket account — returns error if not found
      const result = await polymarketService.fetchUserAccount(addr);

      if (!result.ok) {
        return res.status(401).json({ error: result.error });
      }

      // Store additional API credentials (for future CLOB order signing)
      result.profile.apiKey     = credentials.apiKey     || null;
      result.profile.apiSecret  = credentials.apiSecret  || null;
      result.profile.passphrase = credentials.passphrase || null;

      mainnetProfile = result.profile;
    } else {
      mainnetProfile = null;
    }

    currentMode = mode;
    io.emit("mode_change", { mode: currentMode, profile: mainnetProfile });
    res.json({ ok: true, mode: currentMode, profile: mainnetProfile });
  });

  return router;
};
