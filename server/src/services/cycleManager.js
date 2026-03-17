/**
 * CycleManager
 * ─────────────────────────────────────────────────────────────
 * Manages 5-minute BTC trading cycles aligned to UTC clock.
 *
 * Cycle stages:
 *   WAITING  → new cycle just started (first second)
 *   ACTIVE   → trading window open  (4:59 → 0:20 remaining)
 *   CLOSING  → last 20 seconds, no new trades accepted
 *
 * Emits every 500ms via Socket.IO: 'cycle_tick'
 * Emits via Node EventEmitter on stage change: 'stage_change'
 */

const { EventEmitter } = require("events");

class CycleManager extends EventEmitter {
  constructor() {
    super();
    this.io             = null;
    this.currentCycleId = null;
    this.stage          = "WAITING";
    this._handle        = null;
  }

  start(io) {
    this.io = io;
    this._handle = setInterval(() => this._tick(), 500);
    console.log("[CYCLE] Cycle manager started");
  }

  _tick() {
    const info = this._info();

    if (this.currentCycleId !== info.cycleId) {
      this.currentCycleId = info.cycleId;
      console.log(`[CYCLE] New cycle: ${info.cycleId}`);
      this.io.emit("new_cycle", info);
    }

    if (this.stage !== info.stage) {
      this.stage = info.stage;
      console.log(`[CYCLE] Stage: ${info.stage}`);
      this.io.emit("stage_change", info);
      // Also emit locally so server-side listeners can react
      this.emit("stage_change", info);
    }

    this.io.emit("cycle_tick", info);
  }

  _info() {
    const now       = Date.now();
    const totalMs   = 5 * 60 * 1000;
    const epochSlot = Math.floor(now / totalMs);
    const elapsed   = now - epochSlot * totalMs;           // ms into cycle
    const remaining = Math.floor((totalMs - elapsed) / 1000); // seconds left

    let stage;
    if (remaining >= 299)      stage = "WAITING";   // first second: new cycle
    else if (remaining > 20)   stage = "ACTIVE";    // 4:59 → 0:20
    else                       stage = "CLOSING";   // last 20s

    return {
      cycleId:      `C${epochSlot}`,
      cycleStart:   epochSlot * totalMs,
      elapsed:      Math.floor(elapsed / 1000),
      remaining,
      totalSec:     300,
      stage,
      tradingOpen:  stage === "ACTIVE",
    };
  }

  getState()          { return this._info(); }
  isInTradingWindow() { return this._info().stage === "ACTIVE"; }
}

module.exports = new CycleManager();
