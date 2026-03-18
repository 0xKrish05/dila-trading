/**
 * GET /api/account?address=0x...
 * Returns live Polymarket account data: profile, positions, trades, balance.
 * All data sourced from public Data API (no auth required) + Polygon RPC.
 */
const express           = require("express");
const polymarketService = require("../services/polymarketService");

module.exports = function () {
  const router = express.Router();

  router.get("/", async (req, res) => {
    const { address } = req.query;

    if (!address || !address.startsWith("0x") || address.length !== 42) {
      return res.status(400).json({ error: "Valid wallet address required (?address=0x...)" });
    }

    try {
      const data = await polymarketService.fetchUserAccount(address);
      res.json(data);
    } catch (err) {
      console.error("[ACCOUNT]", err.message);
      res.status(500).json({ error: "Failed to fetch account data" });
    }
  });

  return router;
};
