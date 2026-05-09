import { useState, useEffect } from "react";
import { supabase } from "../supabase";

export default function ResetPassword() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionError, setSessionError] = useState(null);

  // When the user lands here from the email link, Supabase processes the
  // recovery token and emits a PASSWORD_RECOVERY event with a temporary session.
  // We wait for that before allowing submission — otherwise updateUser fails.
  useEffect(() => {
    let resolved = false;

    // If a session already exists (e.g. user navigated back to this page), use it.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        resolved = true;
        setSessionReady(true);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && session)) {
        resolved = true;
        setSessionReady(true);
      }
    });

    // Fail-safe: if Supabase never gives us a recovery session within 5s,
    // the link is probably expired or invalid.
    const timer = setTimeout(() => {
      if (!resolved) {
        setSessionError("This reset link is invalid or has expired. Please request a new one.");
      }
    }, 5000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  const handle = async (e) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    setMessage("Password updated! Redirecting to sign in…");
    // Sign out so the user logs in fresh with the new password.
    await supabase.auth.signOut();
    setTimeout(() => {
      window.location.href = "/login?reset=success";
    }, 1500);
  };

  return (
    <div className="auth-page">
      <div className="auth-left">
        <div className="auth-brand">
          <div className="logo">Bill<span>tiq</span></div>
          <p className="auth-tagline">Oracle Fusion AP exception handling for mid-market finance teams</p>
        </div>
        <div className="auth-stats">
          {[
            { num: "6 ERPs", label: "Oracle, NetSuite, QuickBooks, Xero, Zoho, Dynamics 365" },
            { num: "Match", label: "exception resolution without IT tickets" },
            { num: "Audit", label: "trail on every approval" },
          ].map((s, i) => (
            <div key={i} className="auth-stat">
              <div className="auth-stat-num">{s.num}</div>
              <div className="auth-stat-label">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="auth-right">
        <div className="auth-card">
          <div className="auth-card-title">Set a new password</div>
          <div className="auth-card-sub">Choose something you'll remember</div>

          {sessionError ? (
            <>
              <div className="auth-error">{sessionError}</div>
              <button
                type="button"
                className="auth-submit"
                style={{ marginTop: 16 }}
                onClick={() => { window.location.href = "/login"; }}
              >
                Back to sign in →
              </button>
            </>
          ) : !sessionReady ? (
            <div style={{ color: "#7a7a6e", fontSize: 14, padding: "20px 0", textAlign: "center" }}>
              Verifying reset link…
            </div>
          ) : (
            <form onSubmit={handle}>
              <div className="auth-field">
                <label>New Password</label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  minLength={6}
                  autoFocus
                />
              </div>
              <div className="auth-field">
                <label>Confirm New Password</label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>

              {error && <div className="auth-error">{error}</div>}
              {message && <div className="auth-message">{message}</div>}

              <button type="submit" className="auth-submit" disabled={loading}>
                {loading ? "Please wait..." : "Update Password →"}
              </button>
            </form>
          )}

          <div className="auth-switch">
            <button onClick={() => { window.location.href = "/login"; }}>← Back to sign in</button>
          </div>
        </div>
      </div>
    </div>
  );
}
