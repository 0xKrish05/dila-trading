import { useState } from "react";

export default function ModeToggle({ mode, onModeChange }) {
  const isMainnet = mode === "mainnet";

  const [showConfirm,  setShowConfirm]  = useState(false);
  const [showForm,     setShowForm]     = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState("");
  const [creds, setCreds] = useState({
    walletAddress: "",
    apiKey:        "",
    apiSecret:     "",
    passphrase:    "",
  });

  const handleToggle = () => {
    if (isMainnet) {
      // Switch back to sim — no confirmation needed
      fetch("/api/mode", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ mode: "sim" }),
      }).then(() => onModeChange("sim"));
    } else {
      setShowConfirm(true);
    }
  };

  const handleConfirm = () => {
    setShowConfirm(false);
    setShowForm(true);
    setError("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const resp = await fetch("/api/mode", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ mode: "mainnet", credentials: creds }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.error || "Verification failed");
        setLoading(false);
        return;
      }
      setShowForm(false);
      onModeChange("mainnet", data.profile);
    } catch (err) {
      setError("Network error — try again");
    }
    setLoading(false);
  };

  return (
    <>
      {/* ── Toggle pill ── */}
      <div className="mode-toggle" onClick={handleToggle} title={isMainnet ? "Switch to Simulated" : "Switch to Mainnet"}>
        <span className={`mode-lbl ${!isMainnet ? "active" : ""}`}>SIM</span>
        <div className={`toggle-track ${isMainnet ? "mainnet" : ""}`}>
          <div className="toggle-thumb" />
        </div>
        <span className={`mode-lbl ${isMainnet ? "active mainnet-lbl" : ""}`}>LIVE</span>
      </div>

      {/* ── Confirmation modal ── */}
      {showConfirm && (
        <div className="modal-overlay" onClick={() => setShowConfirm(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-icon">⚠️</div>
            <h2 className="modal-title">Switch to Mainnet Trading?</h2>
            <p className="modal-body">
              You are about to switch from <strong>Simulated</strong> mode to{" "}
              <strong style={{ color: "#f0883e" }}>Real Mainnet</strong> trading on Polymarket.
              <br /><br />
              Real funds will be used. All trade positions and sizing remain the same as in simulation.
              Confirm only if you understand the risks.
            </p>
            <div className="modal-actions">
              <button className="btn-modal cancel" onClick={() => setShowConfirm(false)}>Cancel</button>
              <button className="btn-modal confirm" onClick={handleConfirm}>I Understand — Continue</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Credentials form modal ── */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-box creds-box" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">
              <span className="poly-dot" /> Connect Polymarket Account
            </h2>
            <p className="modal-sub">Enter your Polymarket credentials. We verify your account before switching modes.</p>

            <form className="creds-form" onSubmit={handleSubmit}>
              <label className="cred-label">
                Wallet Address <span className="req">*</span>
                <input
                  className="cred-input"
                  type="text"
                  placeholder="0x..."
                  value={creds.walletAddress}
                  onChange={e => setCreds(c => ({ ...c, walletAddress: e.target.value }))}
                  required
                />
              </label>

              <label className="cred-label">
                API Key
                <input
                  className="cred-input"
                  type="text"
                  placeholder="Polymarket CLOB API key"
                  value={creds.apiKey}
                  onChange={e => setCreds(c => ({ ...c, apiKey: e.target.value }))}
                />
              </label>

              <label className="cred-label">
                API Secret
                <input
                  className="cred-input"
                  type="password"
                  placeholder="API secret"
                  value={creds.apiSecret}
                  onChange={e => setCreds(c => ({ ...c, apiSecret: e.target.value }))}
                />
              </label>

              <label className="cred-label">
                Passphrase
                <input
                  className="cred-input"
                  type="password"
                  placeholder="API passphrase"
                  value={creds.passphrase}
                  onChange={e => setCreds(c => ({ ...c, passphrase: e.target.value }))}
                />
              </label>

              {error && <div className="cred-error">{error}</div>}

              <div className="modal-actions" style={{ marginTop: 16 }}>
                <button type="button" className="btn-modal cancel" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn-modal confirm" disabled={loading}>
                  {loading ? "Verifying…" : "Verify & Switch to Mainnet"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
