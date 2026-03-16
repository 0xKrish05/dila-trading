/**
 * DILA — Cloudflare Worker
 * ─────────────────────────────────────────────────────────────────────────────
 * Sits between TradingView and the Railway backend.
 * Adds `workerReceivedAt` timestamp before forwarding, enabling precise
 * latency measurement from the edge to the server.
 *
 * Deploy:
 *   cd worker
 *   npx wrangler deploy
 *
 * Set these secrets in Cloudflare dashboard (Settings → Variables):
 *   BACKEND_URL   = https://your-app.railway.app
 *   API_KEY       = your WEBHOOK_SECRET from server .env
 */

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin":  "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, X-Api-Key",
        },
      });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const workerReceivedAt = Date.now();

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ ok: false, error: "Invalid JSON" }, 400);
    }

    // Inject edge timestamp for latency tracking
    body.workerReceivedAt = workerReceivedAt;

    if (!env.BACKEND_URL) {
      return jsonResponse({ ok: false, error: "BACKEND_URL not configured" }, 500);
    }

    try {
      const upstream = await fetch(`${env.BACKEND_URL}/api/webhook`, {
        method:  "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key":    env.API_KEY ?? "",
        },
        body: JSON.stringify(body),
      });

      const result = await upstream.json();

      return jsonResponse({
        ok: true,
        workerLatencyMs: Date.now() - workerReceivedAt,
        ...result,
      });

    } catch (err) {
      return jsonResponse({ ok: false, error: err.message }, 502);
    }
  },
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type":                "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
