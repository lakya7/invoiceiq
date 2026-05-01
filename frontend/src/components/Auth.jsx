import { useState } from "react";
import { supabase } from "../supabase";

export default function Auth() {
  const isSignup = new URLSearchParams(window.location.search).get("signup") === "true";
  const [mode, setMode] = useState(isSignup ? "signup" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [forgotMode, setForgotMode] = useState(false);

  const handle = async (e) => {
    e.preventDefault();
    setLoading(true); setError(null); setMessage(null);
    if (forgotMode) {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
      if (error) setError(error.message);
      else setMessage("Password reset link sent to your email!");
    } else if (mode === "signup") {
      const { error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } });
      if (error) setError(error.message);
      else setMessage("Check your email to confirm your account!");
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
    }
    setLoading(false);
  };

  const handleGoogle = async () => {
    const params = new URLSearchParams(window.location.search);
    const inviteToken = params.get("invite");
    // Save invite token to localStorage so it survives the OAuth redirect
    if (inviteToken) {
      localStorage.setItem("pending_invite_token", inviteToken);
    }
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: inviteToken
          ? `${window.location.origin}/login?invite=${inviteToken}`
          : `${window.location.origin}/login`,
        queryParams: { prompt: "select_account" }
      }
    });
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
          <div className="auth-card-title">{forgotMode ? "Reset password" : mode === "signup" ? "Create your account" : "Welcome back"}</div>
          <div className="auth-card-sub">{forgotMode ? "We'll send you a reset link" : mode === "signup" ? "Get started in minutes" : "Sign in to your Billtiq account"}</div>

          {!forgotMode && (
            <>
              <button className="google-btn" onClick={handleGoogle}>
                <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/><path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z"/><path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18l2.67-2.07z"/><path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.3z"/></svg>
                Continue with Google
              </button>
              <div className="auth-divider"><span>or</span></div>
            </>
          )}

          <form onSubmit={handle}>
            {mode === "signup" && !forgotMode && (
              <div className="auth-field">
                <label>Full Name</label>
                <input type="text" placeholder="Jane Smith" value={name} onChange={e => setName(e.target.value)} required />
              </div>
            )}
            <div className="auth-field">
              <label>Work Email</label>
              <input type="email" placeholder="jane@company.com" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            {!forgotMode && (
              <div className="auth-field">
                <label>
                  Password
                  {mode === "login" && <button type="button" className="forgot-link" onClick={() => { setForgotMode(true); setError(null); setMessage(null); }}>Forgot password?</button>}
                </label>
                <input type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} />
              </div>
            )}

            {error && <div className="auth-error">{error}</div>}
            {message && <div className="auth-message">{message}</div>}

            <button type="submit" className="auth-submit" disabled={loading}>
              {loading ? "Please wait..." : forgotMode ? "Send Reset Link →" : mode === "signup" ? "Create Account →" : "Sign In →"}
            </button>
          </form>

          <div className="auth-switch">
            {!forgotMode && mode === "login" && <>Don't have an account? <button onClick={() => { setMode("signup"); setError(null); setMessage(null); }}>Sign up</button></>}
            {!forgotMode && mode === "signup" && <>Already have an account? <button onClick={() => { setMode("login"); setError(null); setMessage(null); }}>Sign in</button></>}
            {forgotMode && <button onClick={() => { setForgotMode(false); setError(null); setMessage(null); }}>← Back to sign in</button>}
          </div>
          <div style={{ marginTop: 16, fontSize: 12, color: "#7a7a6e", textAlign: "center" }}>
            By continuing you agree to our{" "}
            <a href="/terms" style={{ color: "#0a3d2f", textDecoration: "none" }}>Terms</a>{" "}and{" "}
            <a href="/privacy" style={{ color: "#0a3d2f", textDecoration: "none" }}>Privacy Policy</a>
          </div>
        </div>
      </div>
    </div>
  );
}
