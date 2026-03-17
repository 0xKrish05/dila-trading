require("dotenv").config();

const express = require("express");
const http    = require("http");
const { Server } = require("socket.io");
const cors    = require("cors");
const path    = require("path");

const db                = require("./db");
const webhookRoute      = require("./routes/webhook");
const apiRoute          = require("./routes/api");
const modeRoute         = require("./routes/mode");
const priceService      = require("./services/priceService");
const cycleManager      = require("./services/cycleManager");
const polymarketService = require("./services/polymarketService");
const Portfolio         = require("./models/Portfolio");
const Trade             = require("./models/Trade");

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: "*" },
  transports: ["websocket", "polling"],
});

app.use(cors());
app.use(express.json());

// ── Serve React build in production ──────────────────────────────────────────
const CLIENT_DIST = path.join(__dirname, "../../client/dist");
if (process.env.NODE_ENV === "production") {
  app.use(express.static(CLIENT_DIST));
}

// ── Routes ───────────────────────────────────────────────────────────────────
app.use("/api/webhook", webhookRoute(io));
app.use("/api/mode",    modeRoute(io));
app.use("/api",         apiRoute(io));

// SPA fallback
if (process.env.NODE_ENV === "production") {
  app.get("*", (_req, res) =>
    res.sendFile(path.join(CLIENT_DIST, "index.html"))
  );
}

// ── Socket.IO ─────────────────────────────────────────────────────────────────
io.on("connection", async (socket) => {
  console.log(`[WS] Client connected: ${socket.id}`);

  try {
    const portfolio  = await Portfolio.findOne().lean();
    const trades     = await Trade.find().sort({ openedAt: -1 }).limit(100).lean();
    const openTrades = await Trade.find({ status: "OPEN" }).lean();
    socket.emit("initial_state", {
      portfolio, trades, openTrades,
      cycle: cycleManager.getState(),
    });

    // Send current price immediately so dashboard never shows ——
    const p = priceService.getCurrentPrice();
    if (p) {
      socket.emit("price_update", {
        price:     p,
        probUp:    priceService.getCurrentProb(),
        polyCents: polymarketService.getLastPrices(),
        timestamp: Date.now(),
      });
    }
  } catch (e) {
    console.error("[WS] Initial state error:", e.message);
  }

  socket.on("disconnect", () =>
    console.log(`[WS] Client disconnected: ${socket.id}`)
  );
});

// ── Boot ──────────────────────────────────────────────────────────────────────
db.connect().then(async () => {
  await priceService.start(io);           // await so price is ready before WS clients connect
  cycleManager.start(io);
  polymarketService.start(io);

  // Close all open trades when cycle enters CLOSING stage (2 min remaining)
  const tradeEngine = require("./services/tradeEngine");
  tradeEngine.setIo(io);
  cycleManager.on("stage_change", async (info) => {
    if (info.stage === "CLOSING") {
      console.log("[CYCLE] CLOSING — expiring open trades at market");
      await tradeEngine.expireOpenTrades(priceService.getCurrentProb());
    }
  });

  const PORT = process.env.PORT || 5000;
  server.listen(PORT, () =>
    console.log(`[APP] DILA Trading Server -> http://localhost:${PORT}`)
  );
}).catch(err => {
  console.error("[BOOT] Fatal error:", err.message);
  process.exit(1);
});
